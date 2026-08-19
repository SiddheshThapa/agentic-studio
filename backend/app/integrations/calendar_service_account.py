import asyncio
from datetime import datetime, timedelta
import os

from google.oauth2 import service_account
from googleapiclient.discovery import build

from app.core.config import GOOGLE_SERVICE_ACCOUNT_JSON

CALENDAR_ID = os.getenv("SHARED_CALENDAR_ID")
SCOPES = ["https://www.googleapis.com/auth/calendar"]


def _create_event_sync(summary_text: str, description: str, event_date: str) -> str:
    credentials = service_account.Credentials.from_service_account_file(
        GOOGLE_SERVICE_ACCOUNT_JSON, scopes=SCOPES
    )
    service = build("calendar", "v3", credentials=credentials)

    start_date = datetime.strptime(event_date, "%Y-%m-%d")
    end_date = (start_date + timedelta(days=1)).strftime("%Y-%m-%d")

    event = {
        "summary": f"Movie Launch — {summary_text[:50]}",
        "description": description,
        "start": {"date": event_date},
        "end": {"date": end_date},
    }

    created_event = service.events().insert(calendarId=CALENDAR_ID, body=event).execute()
    return created_event.get("htmlLink", created_event.get("id", ""))


async def create_event_via_service_account(summary_text: str, description: str, event_date: str) -> str:
    return await asyncio.to_thread(_create_event_sync, summary_text, description, event_date)
