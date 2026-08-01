from fastapi import FastAPI, UploadFile, File, Form, HTTPException
from pypdf import PdfReader
import io
import json
from datetime import datetime, timedelta
from uuid import uuid4
import httpx
from a2a.client import A2ACardResolver, A2AClient, create_text_message_object
from a2a.types import MessageSendParams, SendMessageRequest
from a2a.utils import get_message_text
from config import MAX_UPLOAD_FILE_SIZE_MB, AGENT4_BASE_URL
from database import (
    init_tables, save_result, get_result, get_connection,
    get_result_with_script, delete_documents_by_filename, cache_get, cache_set,
    memory_add, memory_get, save_eval_record, get_eval_summary, generate_eval_chart
)
from ingest import ingest_document
from supervisor import run_supervisor
from guardrails import check_query_safety
from evaluator import score_faithfulness
from resilience import check_rate_limit, logger
from schemas import TaskType, AgentResponse
from fastapi.responses import Response
from reportlab.lib.pagesizes import letter
from reportlab.platypus import SimpleDocTemplate, Paragraph
from reportlab.lib.styles import getSampleStyleSheet
from calendar_mcp import create_calendar_event_via_mcp

app = FastAPI()
init_tables()

HOLIDAY_CONFLICT_WINDOW_DAYS = 3
COUNTRY_NAMES = {
    "US": "United States",
    "MX": "Mexico",
    "GB": "United Kingdom",
    "JP": "Japan",
    "DE": "Germany",
}


async def _check_holidays_via_a2a(date_str: str) -> dict:
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


def _nearest_clear_date(proposed_date, holiday_date):
    shift = timedelta(days=HOLIDAY_CONFLICT_WINDOW_DAYS + 1)
    if proposed_date >= holiday_date:
        return holiday_date + shift
    return holiday_date - shift


async def _create_country_events(genre: str, description: str, confirmed_date: str) -> dict:
    holiday_report = await _check_holidays_via_a2a(confirmed_date)
    proposed_date = datetime.strptime(confirmed_date, "%Y-%m-%d").date()

    events = {}
    for country_code, country_name in COUNTRY_NAMES.items():
        country_status = holiday_report.get(country_code, {})

        if country_status.get("conflict"):
            holiday_date = datetime.strptime(country_status["holiday_date"], "%Y-%m-%d").date()
            final_date = _nearest_clear_date(proposed_date, holiday_date)
        else:
            final_date = proposed_date

        final_date_str = final_date.isoformat()
        event_link = await create_calendar_event_via_mcp(
            f"{genre} — {country_name}", description, final_date_str
        )
        events[country_code] = {"date": final_date_str, "calendar_event": event_link}

    return {"holiday_report": holiday_report, "events": events}





@app.post("/ingest")
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
        conn = get_connection()
        conn.close()
        db_status = "ok"
    except Exception:
        db_status = "unreachable"

    return {"status": "ok" if db_status == "ok" else "degraded", "database": db_status}



@app.delete("/document")
async def delete_document_endpoint(filename: str):
    count = delete_documents_by_filename(filename)
    return {"deleted_chunks": count}


@app.post("/run-agent",response_model=AgentResponse)
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

    memory_add(session_id, "user", f"[{task.value}] {script_text[:200]}")

    cache_key = f"{task.value}:{script_text}"
    cached = cache_get(cache_key)

    if cached:
        result_id = save_result(task.value, script_text, cached)
        memory_add(session_id, "assistant", cached[:200])
        return {"result_id": result_id, "task": task.value, "result": cached, "from_cache": True}

    state = await run_supervisor(script_text, task.value)
    cache_set(cache_key, state["result"])
    result_id = save_result(task.value, script_text, state["result"])
    memory_add(session_id, "assistant", state["result"][:200])

    eval_score = None
    if evaluate:
        faith_result = score_faithfulness(script_text, state["result"])
        save_eval_record(task.value, faith_result.score, None)
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



@app.post("/confirm-date/{result_id}")
async def confirm_date_endpoint(result_id: int):
    existing = get_result_with_script(result_id)
    if not existing:
        return {"error": "not found"}
    genre, proposed_date, _listing_result_id = existing["script_text"].split("|", 2)
    country_result = await _create_country_events(genre.strip(), existing["result"], proposed_date.strip())
    return {"result_id": result_id, "confirmed": True, **country_result}


@app.post("/override-date/{result_id}")
async def override_date_endpoint(result_id: int, new_date: str = Form(...)):
    existing = get_result_with_script(result_id)
    if not existing:
        return {"error": "not found"}
    genre, _proposed_date, _listing_result_id = existing["script_text"].split("|", 2)
    country_result = await _create_country_events(genre.strip(), existing["result"], new_date)
    return {"result_id": result_id, "confirmed": True, "forced_date": new_date, **country_result}



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