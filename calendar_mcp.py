from datetime import datetime, timedelta
from mcp import ClientSession, StdioServerParameters
from mcp.client.stdio import stdio_client
import os
from dotenv import load_dotenv

load_dotenv()

CALENDAR_ID = os.getenv("SHARED_CALENDAR_ID")
CREDENTIALS_PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)), "gcp-credentials.json")


async def create_calendar_event_via_mcp(summary_text: str, description: str, event_date: str) -> str:
    server_params = StdioServerParameters(
        command="npx",
        args=["-y", "@cocal/google-calendar-mcp"],
        env={**os.environ, "GOOGLE_OAUTH_CREDENTIALS": CREDENTIALS_PATH},
    )

    start_date = datetime.strptime(event_date, "%Y-%m-%d")
    end_date = (start_date + timedelta(days=1)).strftime("%Y-%m-%d")

    async with stdio_client(server_params) as (read, write):
        async with ClientSession(read, write) as session:
            await session.initialize()
            result = await session.call_tool("create-event", arguments={
                "calendarId": CALENDAR_ID,
                "summary": f"Movie Launch — {summary_text[:50]}",
                "description": description,
                "start": event_date,
                "end": end_date,
            })
            return result.content[0].text