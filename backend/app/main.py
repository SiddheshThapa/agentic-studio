from fastapi import FastAPI, UploadFile, File, Form, Header, Depends, HTTPException, Body, Request
from pypdf import PdfReader
import io
import json
import secrets
from datetime import datetime, timedelta
from uuid import uuid4
import httpx
from app.core.config import MAX_UPLOAD_FILE_SIZE_MB, AGENT4_BASE_URL, CALENDAR_MODE, API_SECRET_KEY, SUPPORTED_COUNTRIES
from app.data.database import (
    init_tables, get_result, connection, record_run,
    get_result_with_script, delete_documents_by_filename, cache_get,
    memory_get, save_eval_record, get_eval_summary, generate_eval_chart,
    ADMIN_LIST_DEFAULT_LIMIT, ADMIN_LIST_MAX_LIMIT, AdminTableError,
    admin_columns, admin_delete_row, admin_get_row, admin_insert_row,
    admin_list_rows, admin_structural_warnings, admin_table_summary,
    admin_update_row,
    create_user, get_user_by_email, get_user_by_id, list_users,
    update_user_role, delete_user, count_developers,
)
from app.core.auth import (
    COOKIE_NAME, SESSION_HOURS, create_session_token, get_current_user,
    hash_password, require_role, verify_password,
)
from app.data.ingest import ingest_document
from app.ai.supervisor import run_supervisor
from app.ai.agents import resolve_genre_from_listing, check_conflicts_via_a2a
from app.core.guardrails import check_query_safety
from app.ai.evaluator import score_faithfulness
from app.core.resilience import check_rate_limit, logger
from app.schemas import TaskType, AgentResponse
from fastapi.responses import Response
from reportlab.lib.pagesizes import letter
from reportlab.platypus import SimpleDocTemplate, Paragraph
from reportlab.lib.styles import getSampleStyleSheet
from app.integrations.calendar_mcp import create_calendar_event_via_mcp
from app.integrations.calendar_service_account import create_event_via_service_account
from fastapi.middleware.cors import CORSMiddleware


app = FastAPI()
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)
init_tables()

import traceback
from fastapi.responses import JSONResponse

@app.exception_handler(Exception)
async def global_exception_handler(request, exc):
    logger.error(f"Unhandled exception: {exc}\n{traceback.format_exc()}")
    return JSONResponse(
        status_code=500,
        content={"detail": f"Internal Server Error: {str(exc)}"}
    )



def require_api_key(x_api_key: str | None = Header(default=None)):
    if not API_SECRET_KEY or not x_api_key or not secrets.compare_digest(x_api_key, API_SECRET_KEY):
        raise HTTPException(status_code=403, detail="Missing or invalid API key.")

HOLIDAY_CONFLICT_WINDOW_DAYS = 3
# Display names only, for calendar-event labels — SUPPORTED_COUNTRIES (config.py) is
# the authoritative list of which countries are checked and get events created. A
# country configured there without an entry here just labels its event with its raw code.
COUNTRY_DISPLAY_NAMES = {
    "US": "United States",
    "MX": "Mexico",
    "GB": "United Kingdom",
    "JP": "Japan",
    "DE": "Germany",
}



def _nearest_clear_date(proposed_date, conflict_date):
    shift = timedelta(days=HOLIDAY_CONFLICT_WINDOW_DAYS + 1)
    if proposed_date >= conflict_date:
        return conflict_date + shift
    return conflict_date - shift


def _collect_conflicting_dates(country_code: str, conflict_report: dict) -> list:
    dates = []
    country_holiday = conflict_report.get("holidays", {}).get(country_code, {})
    if country_holiday.get("conflict"):
        dates.append(datetime.strptime(country_holiday["holiday_date"], "%Y-%m-%d").date())

    global_events = conflict_report.get("sporting_events", []) + conflict_report.get("awards_ceremonies", [])
    for entry in global_events:
        if entry.get("conflict"):
            dates.append(datetime.strptime(entry["date"], "%Y-%m-%d").date())

    return dates


async def _create_calendar_event(summary: str, description: str, event_date: str) -> str:
    if CALENDAR_MODE == "mcp":
        try:
            return await create_calendar_event_via_mcp(summary, description, event_date)
        except Exception as exc:
            logger.warning(f"MCP calendar creation failed, falling back to service account: {exc}")
    return await create_event_via_service_account(summary, description, event_date)


async def _compute_recommended_dates(proposed_date_str: str) -> tuple[dict, dict]:
    conflict_report = await check_conflicts_via_a2a(proposed_date_str)
    proposed_date = datetime.strptime(proposed_date_str, "%Y-%m-%d").date()

    recommended_dates = {}
    for country_code in SUPPORTED_COUNTRIES:
        conflicting_dates = _collect_conflicting_dates(country_code, conflict_report)

        if conflicting_dates:
            nearest_conflict = min(conflicting_dates, key=lambda d: abs((d - proposed_date).days))
            final_date = _nearest_clear_date(proposed_date, nearest_conflict)
        else:
            final_date = proposed_date

        recommended_dates[country_code] = final_date.isoformat()

    return conflict_report, recommended_dates


async def _create_events_from_dates(genre: str, description: str, country_dates: dict) -> dict:
    events = {}
    for country_code, date_str in country_dates.items():
        country_name = COUNTRY_DISPLAY_NAMES.get(country_code, country_code)
        event_link = await _create_calendar_event(
            f"{genre} — {country_name}", description, date_str
        )
        events[country_code] = {"date": date_str, "calendar_event": event_link}

    return events





@app.post("/ingest", dependencies=[Depends(require_api_key)])
async def ingest_endpoint(file: UploadFile = File(...)):
    contents = await file.read()

    if len(contents) > MAX_UPLOAD_FILE_SIZE_MB * 1024 * 1024:
        return {"error": f"File exceeds {MAX_UPLOAD_FILE_SIZE_MB}MB limit."}

    reader = PdfReader(io.BytesIO(contents))
    text = ""
    for page in reader.pages:
        text += page.extract_text() + "\n"

    ids = ingest_document(text, {"filename": file.filename})
    return {"inserted_chunks": len(ids), "ids": ids}



@app.get("/health")
async def health_check():
    try:
        with connection() as conn, conn.cursor() as cur:
            cur.execute("SELECT 1;")
        db_status = "ok"
    except Exception:
        db_status = "unreachable"

    return {"status": "ok" if db_status == "ok" else "degraded", "database": db_status}



@app.delete("/document", dependencies=[Depends(require_api_key)])
async def delete_document_endpoint(filename: str):
    count = delete_documents_by_filename(filename)
    return {"deleted_chunks": count}


@app.post("/run-agent", response_model=AgentResponse, dependencies=[Depends(require_api_key)])
async def run_agent_endpoint(
    script_text: str = Form(...),
    task: TaskType = Form(...),
    session_id: str = Form(default="default"),
    evaluate: bool = Form(default=False)
):
    if not check_rate_limit(session_id):
        raise HTTPException(status_code=429, detail="Rate limit exceeded. Please wait before submitting another request.")

    logger.info(f"run-agent called: task={task.value}, session={session_id}")

    min_length = 1 if task == TaskType.release_listing else 10
    check_toxicity = task not in (TaskType.greenlight, TaskType.analyze)
    if not check_query_safety(script_text, min_length=min_length, check_toxicity=check_toxicity):
        raise HTTPException(status_code=400, detail="Script text is too short or invalid.")

    cache_key = f"{task.value}:{script_text}"
    cached = cache_get(cache_key)
    user_turn = f"[{task.value}] {script_text[:200]}"

    if cached:
        # cache_question=None: this answer is already cached, don't rewrite it.
        result_id = record_run(
            task=task.value, script_text=script_text, result=cached,
            session_id=session_id, user_turn=user_turn, assistant_turn=cached[:200],
        )
        return {"result_id": result_id, "task": task.value, "result": cached, "from_cache": True}

    state = await run_supervisor(script_text, task.value)
    result_id = record_run(
        task=task.value, script_text=script_text, result=state["result"],
        session_id=session_id, user_turn=user_turn,
        assistant_turn=state["result"][:200], cache_question=cache_key,
    )

    eval_score = None
    if evaluate:
        faith_result = score_faithfulness(script_text, state["result"])
        save_eval_record(task.value, faith_result.score)
        eval_score = faith_result.model_dump()

    return {
        "result_id": result_id,
        "task": task.value,
        "result": state["result"],
        "from_cache": False,
        "eval": eval_score
    }

@app.get("/eval/summary")
async def eval_summary_endpoint():
    return get_eval_summary()


@app.get("/eval/chart")
async def eval_chart_endpoint():
    chart_base64 = generate_eval_chart()
    return {"chart_base64": chart_base64}




@app.get("/result/{result_id}")
async def get_result_endpoint(result_id: int):
    result = get_result(result_id)

    if not result:
        return {"error": "not found"}

    return {
        "task": result["task"],
        "result": result["result"]
    }




@app.get("/history/{session_id}")
async def history_endpoint(session_id: str):
    return {"history": memory_get(session_id)}



@app.post("/confirm-date/{result_id}", dependencies=[Depends(require_api_key)])
async def confirm_date_endpoint(result_id: int):
    existing = get_result_with_script(result_id)
    if not existing:
        return {"error": "not found"}
    proposed_date, listing_result_id = existing["script_text"].split("|", 1)
    genre = resolve_genre_from_listing(int(listing_result_id.strip()))
    conflict_report, recommended_dates = await _compute_recommended_dates(proposed_date.strip())
    events = await _create_events_from_dates(genre, existing["result"], recommended_dates)
    return {"result_id": result_id, "confirmed": True, "conflict_report": conflict_report, "events": events}


@app.post("/override-date/{result_id}", dependencies=[Depends(require_api_key)])
async def override_date_endpoint(result_id: int, new_date: str = Form(...)):
    existing = get_result_with_script(result_id)
    if not existing:
        return {"error": "not found"}
    _proposed_date, listing_result_id = existing["script_text"].split("|", 1)
    genre = resolve_genre_from_listing(int(listing_result_id.strip()))
    conflict_report, recommended_dates = await _compute_recommended_dates(new_date)
    events = await _create_events_from_dates(genre, existing["result"], recommended_dates)
    return {
        "result_id": result_id,
        "confirmed": True,
        "forced_date": new_date,
        "conflict_report": conflict_report,
        "events": events,
    }


@app.post("/check-conflicts/{result_id}", dependencies=[Depends(require_api_key)])
async def check_conflicts_endpoint(result_id: int, session_id: str = "default"):
    if not check_rate_limit(session_id):
        raise HTTPException(status_code=429, detail="Rate limit exceeded. Please wait before submitting another request.")

    existing = get_result_with_script(result_id)
    if not existing:
        return {"error": "not found"}
    proposed_date, _listing_result_id = existing["script_text"].split("|", 1)
    proposed_date = proposed_date.strip()

    conflict_report, recommended_dates = await _compute_recommended_dates(proposed_date)
    return {
        "result_id": result_id,
        "proposed_date": proposed_date,
        "conflict_report": conflict_report,
        "recommended_dates": recommended_dates,
    }


@app.post("/finalize-calendar/{result_id}", dependencies=[Depends(require_api_key)])
async def finalize_calendar_endpoint(
    result_id: int,
    session_id: str = "default",
    overrides: dict[str, str] = Body(default={}),
):
    if not check_rate_limit(session_id):
        raise HTTPException(status_code=429, detail="Rate limit exceeded. Please wait before submitting another request.")

    unknown_codes = sorted(set(overrides) - set(SUPPORTED_COUNTRIES))
    if unknown_codes:
        raise HTTPException(
            status_code=400,
            detail=(
                f"Unknown country code(s) in overrides: {unknown_codes}. "
                f"Supported country codes: {', '.join(SUPPORTED_COUNTRIES)}."
            ),
        )

    existing = get_result_with_script(result_id)
    if not existing:
        return {"error": "not found"}
    proposed_date, listing_result_id = existing["script_text"].split("|", 1)
    genre = resolve_genre_from_listing(int(listing_result_id.strip()))

    conflict_report, recommended_dates = await _compute_recommended_dates(proposed_date.strip())
    final_dates = {**recommended_dates, **overrides}

    events = await _create_events_from_dates(genre, existing["result"], final_dates)
    return {"result_id": result_id, "confirmed": True, "conflict_report": conflict_report, "events": events}



@app.get("/result/{result_id}/download")
async def download_result_endpoint(result_id: int):
    result = get_result(result_id)
    if not result:
        return {"error": "not found"}

    buffer = io.BytesIO()
    doc = SimpleDocTemplate(buffer, pagesize=letter)
    styles = getSampleStyleSheet()
    story = [Paragraph(f"Task: {result['task']}", styles["Heading2"]), Paragraph(result["result"].replace("\n", "<br/>"), styles["Normal"])]
    doc.build(story)
    buffer.seek(0)

    return Response(
        content=buffer.read(),
        media_type="application/pdf",
        headers={"Content-Disposition": f"attachment; filename=result_{result_id}.pdf"}
    )


# ---------------------------------------------------------------------------
# Login sessions
#
# Splits the app into a client build and a developer build sharing this one
# backend: role lives in the session cookie's JWT (app/core/auth.py), checked
# by require_role() below. Cookie, not a token the frontend stores itself, so
# a same-origin Next.js proxy route can hold the real X-API-Key server-side
# and forward it on the strength of this cookie alone.
# ---------------------------------------------------------------------------


@app.post("/auth/login")
async def login_endpoint(request: Request, response: Response, credentials: dict = Body(...)):
    email = (credentials.get("email") or "").strip()
    password = credentials.get("password") or ""

    # Rate-limited per source IP (catches credential stuffing across many
    # emails) and per email (catches brute-forcing one account from many
    # IPs) — reuses the same in-process tracker /run-agent uses, so like
    # that one it resets on restart and isn't shared across workers.
    client_ip = request.client.host if request.client else "unknown"
    if not check_rate_limit(f"login_ip:{client_ip}", max_requests=20, window_seconds=60):
        raise HTTPException(status_code=429, detail="Too many login attempts. Try again shortly.")
    if email and not check_rate_limit(f"login_email:{email.lower()}", max_requests=5, window_seconds=60):
        raise HTTPException(status_code=429, detail="Too many login attempts. Try again shortly.")

    row = get_user_by_email(email) if email else None
    if row is None:
        raise HTTPException(status_code=401, detail="Invalid email or password.")

    user_id, user_email, password_hash, salt, role = row
    if not verify_password(password, password_hash, salt):
        raise HTTPException(status_code=401, detail="Invalid email or password.")

    token = create_session_token(user_id, user_email, role)
    response.set_cookie(
        COOKIE_NAME, token,
        httponly=True, samesite="lax", max_age=SESSION_HOURS * 3600,
    )
    return {"email": user_email, "role": role}


@app.post("/auth/logout")
async def logout_endpoint(response: Response):
    response.delete_cookie(COOKIE_NAME)
    return {"ok": True}


@app.get("/auth/me")
async def me_endpoint(user: dict | None = Depends(get_current_user)):
    if user is None:
        raise HTTPException(status_code=401, detail="Not logged in.")
    return {"email": user["email"], "role": user["role"]}


# ---------------------------------------------------------------------------
# User accounts — developer-only. No signup: accounts are created here by an
# existing developer (or the seed_admin.py script, for the very first one).
# ---------------------------------------------------------------------------


@app.get("/auth/users", dependencies=[Depends(require_role("developer"))])
async def list_users_endpoint():
    return {
        "users": [
            {"id": r[0], "email": r[1], "role": r[2], "created_at": r[3].isoformat()}
            for r in list_users()
        ]
    }


@app.post("/auth/users", dependencies=[Depends(require_role("developer"))])
async def create_user_endpoint(body: dict = Body(...)):
    email = (body.get("email") or "").strip()
    password = body.get("password") or ""
    role = body.get("role")
    if not email or not password:
        raise HTTPException(status_code=400, detail="email and password are required.")
    if role not in ("developer", "client"):
        raise HTTPException(status_code=400, detail="role must be 'developer' or 'client'.")

    password_hash, salt = hash_password(password)
    try:
        user_id = create_user(email, password_hash, salt, role)
    except Exception:
        # Don't echo the raw DB error back to the client (e.g. constraint
        # text) — the near-certain cause is the UNIQUE(email) constraint.
        logger.warning("create_user failed for %s", email, exc_info=True)
        raise HTTPException(status_code=400, detail="Could not create user (duplicate email?).")
    return {"id": user_id, "email": email.lower(), "role": role}


def _refuse_if_last_developer(user_id: int, action: str) -> None:
    """Guards demote/delete: without this, removing the last developer
    account locks every /admin/* and /auth/users route with no way back in
    short of DB access and re-running seed_admin.py."""
    target = get_user_by_id(user_id)
    if target is not None and target[2] == "developer" and count_developers() <= 1:
        raise HTTPException(
            status_code=400,
            detail=f"Can't {action} the only developer account — create another developer first.",
        )


@app.patch("/auth/users/{user_id}", dependencies=[Depends(require_role("developer"))])
async def update_user_role_endpoint(user_id: int, body: dict = Body(...)):
    role = body.get("role")
    if role not in ("developer", "client"):
        raise HTTPException(status_code=400, detail="role must be 'developer' or 'client'.")
    if role != "developer":
        _refuse_if_last_developer(user_id, "demote")
    if not update_user_role(user_id, role):
        raise HTTPException(status_code=404, detail=f"No user {user_id}.")
    return {"id": user_id, "role": role}


@app.delete("/auth/users/{user_id}", dependencies=[Depends(require_role("developer"))])
async def delete_user_endpoint(user_id: int):
    _refuse_if_last_developer(user_id, "delete")
    if not delete_user(user_id):
        raise HTTPException(status_code=404, detail=f"No user {user_id}.")
    return {"deleted": user_id}


# ---------------------------------------------------------------------------
# Admin table browser
#
# Generic list/read/create/update/delete over the five tables. The SQL lives in
# database.py with every other query; these are thin wrappers that translate
# AdminTableError into HTTP status codes.
#
# The whole prefix requires an API key, including the read routes. The app's
# other open reads return one known row (/result/{id}) or one named session
# (/history/{id}); GET /admin/tables/memory returns every session anyone has
# ever run, which is a different exposure and gets the same gate as the writes.
# require_role("developer") is layered on top of the API key, not instead of
# it: this is the boundary the client/developer app split actually depends on.
# ---------------------------------------------------------------------------


def _admin_or_400(fn, *args, **kwargs):
    try:
        return fn(*args, **kwargs)
    except AdminTableError as err:
        raise HTTPException(status_code=400, detail=str(err))


@app.get("/admin/tables", dependencies=[Depends(require_api_key), Depends(require_role("developer"))])
async def admin_tables_endpoint():
    return {
        "tables": admin_table_summary(),
        "pagination": {"default_limit": ADMIN_LIST_DEFAULT_LIMIT, "max_limit": ADMIN_LIST_MAX_LIMIT},
        "structural_fields": (
            "Columns marked structural are read for meaning elsewhere in the app, not just "
            "stored. Editing one is allowed and not blocked here; each carries the note "
            "explaining what depends on it."
        ),
    }


@app.get("/admin/tables/{table}", dependencies=[Depends(require_api_key), Depends(require_role("developer"))])
async def admin_list_endpoint(
    table: str,
    limit: int = ADMIN_LIST_DEFAULT_LIMIT,
    offset: int = 0,
    q: str | None = None,
):
    return _admin_or_400(admin_list_rows, table, limit=limit, offset=offset, query=q)


@app.get("/admin/tables/{table}/{row_id}", dependencies=[Depends(require_api_key), Depends(require_role("developer"))])
async def admin_get_row_endpoint(table: str, row_id: str):
    row = _admin_or_400(admin_get_row, table, row_id)
    if row is None:
        raise HTTPException(status_code=404, detail=f"No row {row_id} in '{table}'.")

    return {
        "table": table,
        "row_id": row_id,
        "columns": _admin_or_400(admin_columns, table),
        "row": row,
    }


@app.post("/admin/tables/{table}", dependencies=[Depends(require_api_key), Depends(require_role("developer"))])
async def admin_create_row_endpoint(table: str, values: dict = Body(...)):
    warnings = _admin_or_400(admin_structural_warnings, table, list(values))
    try:
        created = _admin_or_400(admin_insert_row, table, values)
    except HTTPException:
        raise
    except Exception as err:
        # NOT NULL, type and constraint violations arrive here. The database is
        # the authority on what a valid row is; this just reports its refusal.
        logger.warning(f"admin insert into {table} rejected: {err}")
        raise HTTPException(status_code=400, detail=f"The database rejected this row: {err}")

    return {"table": table, **created, "structural_warnings": warnings}


@app.patch("/admin/tables/{table}/{row_id}", dependencies=[Depends(require_api_key), Depends(require_role("developer"))])
async def admin_update_row_endpoint(table: str, row_id: str, values: dict = Body(...)):
    warnings = _admin_or_400(admin_structural_warnings, table, list(values))
    try:
        updated = _admin_or_400(admin_update_row, table, row_id, values)
    except HTTPException:
        raise
    except Exception as err:
        logger.warning(f"admin update of {table}/{row_id} rejected: {err}")
        raise HTTPException(status_code=400, detail=f"The database rejected this change: {err}")

    if updated is None:
        raise HTTPException(status_code=404, detail=f"No row {row_id} in '{table}'.")

    return {"table": table, "row_id": row_id, **updated, "structural_warnings": warnings}


@app.delete("/admin/tables/{table}/{row_id}", dependencies=[Depends(require_api_key), Depends(require_role("developer"))])
async def admin_delete_row_endpoint(table: str, row_id: str):
    deleted = _admin_or_400(admin_delete_row, table, row_id)
    if deleted["deleted_rows"] == 0:
        raise HTTPException(status_code=404, detail=f"No row {row_id} in '{table}'.")

    logger.info(f"admin deleted {deleted['deleted_rows']} row(s) from {table} via id={row_id}")
    return {"table": table, "row_id": row_id, **deleted}