from fastapi import FastAPI, UploadFile, File, Form, Header, Depends, HTTPException, Body
from pypdf import PdfReader
import io
import json
import secrets
from datetime import datetime, timedelta
from uuid import uuid4
import httpx
from a2a.client import A2ACardResolver, A2AClient, create_text_message_object
from a2a.types import MessageSendParams, SendMessageRequest
from a2a.utils import get_message_text
from config import MAX_UPLOAD_FILE_SIZE_MB, AGENT4_BASE_URL, CALENDAR_MODE, API_SECRET_KEY, SUPPORTED_COUNTRIES
from database import (
    init_tables, get_result, connection, record_run,
    get_result_with_script, delete_documents_by_filename, cache_get,
    memory_get, save_eval_record, get_eval_summary, generate_eval_chart
)
from ingest import ingest_document
from supervisor import run_supervisor
from agents import resolve_genre_from_listing
from guardrails import check_query_safety
from evaluator import score_faithfulness
from resilience import check_rate_limit, logger
from schemas import TaskType, AgentResponse
from fastapi.responses import Response
from reportlab.lib.pagesizes import letter
from reportlab.platypus import SimpleDocTemplate, Paragraph
from reportlab.lib.styles import getSampleStyleSheet
from calendar_mcp import create_calendar_event_via_mcp
from calendar_service_account import create_event_via_service_account
from fastapi.middleware.cors import CORSMiddleware


app = FastAPI()
app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:3000",
        "https://agentic-studio-eight.vercel.app",
    ],
    allow_methods=["*"],
    allow_headers=["*"],
)
init_tables()


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


async def _check_conflicts_via_a2a(date_str: str) -> dict:
    async with httpx.AsyncClient() as httpx_client:
        agent_card = await A2ACardResolver(httpx_client, AGENT4_BASE_URL).get_agent_card()
        client = A2AClient(httpx_client, agent_card=agent_card)

        request = SendMessageRequest(
            id=str(uuid4()),
            params=MessageSendParams(message=create_text_message_object(content=date_str)),
        )
        response = await client.send_message(request)
        report_text = get_message_text(response.root.result)
        return json.loads(report_text)


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
    conflict_report = await _check_conflicts_via_a2a(proposed_date_str)
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
    if not check_query_safety(script_text, min_length=min_length):
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