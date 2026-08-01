import json
import os
from datetime import date, datetime

import httpx
import uvicorn

from a2a.server.agent_execution import AgentExecutor, RequestContext
from a2a.server.apps import A2AFastAPIApplication
from a2a.server.events import EventQueue
from a2a.server.request_handlers import DefaultRequestHandler
from a2a.server.tasks import InMemoryTaskStore
from a2a.types import AgentCapabilities, AgentCard, AgentSkill
from a2a.utils import new_agent_text_message

NAGER_API_BASE = "https://date.nager.at/api/v3/publicholidays"
COUNTRY_CODES = ["US", "MX", "GB", "JP", "DE"]
CONFLICT_WINDOW_DAYS = 3
AGENT4_PORT = int(os.getenv("AGENT4_PORT", "8001"))


def _fetch_holidays_for_year(year: int, country_code: str) -> list[dict] | None:
    try:
        response = httpx.get(f"{NAGER_API_BASE}/{year}/{country_code}", timeout=10)
        response.raise_for_status()
        return response.json()
    except Exception:
        return None


def check_country_holidays(date_str: str) -> dict:
    proposed_date = date.fromisoformat(date_str)

    years_to_check = {proposed_date.year}
    if proposed_date.month == 1 and proposed_date.day <= CONFLICT_WINDOW_DAYS:
        years_to_check.add(proposed_date.year - 1)
    if proposed_date.month == 12 and proposed_date.day > 31 - CONFLICT_WINDOW_DAYS:
        years_to_check.add(proposed_date.year + 1)

    report = {}
    for country_code in COUNTRY_CODES:
        holidays = []
        primary_year_failed = False

        for year in years_to_check:
            year_holidays = _fetch_holidays_for_year(year, country_code)
            if year_holidays is None:
                if year == proposed_date.year:
                    primary_year_failed = True
                continue
            holidays.extend(year_holidays)

        if primary_year_failed:
            report[country_code] = {
                "status": "unknown",
                "conflict": None,
                "holiday_date": None,
                "holiday_name": None,
            }
            continue

        nearest = min(
            holidays,
            key=lambda h: abs((date.fromisoformat(h["date"]) - proposed_date).days),
            default=None,
        )

        if nearest is None:
            report[country_code] = {
                "status": "ok",
                "conflict": False,
                "holiday_date": None,
                "holiday_name": None,
            }
            continue

        days_away = abs((date.fromisoformat(nearest["date"]) - proposed_date).days)
        conflict = days_away <= CONFLICT_WINDOW_DAYS

        report[country_code] = {
            "status": "ok",
            "conflict": conflict,
            "holiday_date": nearest["date"] if conflict else None,
            "holiday_name": nearest["name"] if conflict else None,
        }

    return report


class HolidayCheckExecutor(AgentExecutor):
    async def execute(self, context: RequestContext, event_queue: EventQueue) -> None:
        date_str = context.get_user_input().strip()
        report = check_country_holidays(date_str)
        await event_queue.enqueue_event(new_agent_text_message(json.dumps(report)))

    async def cancel(self, context: RequestContext, event_queue: EventQueue) -> None:
        raise NotImplementedError("Agent 4 does not support cancellation.")


agent_card = AgentCard(
    name="Agent 4 - Holiday Checker",
    description=(
        "Checks whether a proposed release date falls within "
        f"{CONFLICT_WINDOW_DAYS} days of a public holiday in "
        f"{', '.join(COUNTRY_CODES)}."
    ),
    url=f"http://localhost:{AGENT4_PORT}/",
    version="1.0.0",
    default_input_modes=["text"],
    default_output_modes=["text"],
    capabilities=AgentCapabilities(),
    skills=[
        AgentSkill(
            id="check-holiday-conflicts",
            name="Check Holiday Conflicts",
            description=(
                "Given a date (YYYY-MM-DD), reports which of US, MX, GB, JP, "
                "and DE have a public holiday within "
                f"{CONFLICT_WINDOW_DAYS} days of it."
            ),
            tags=["holidays", "scheduling"],
            examples=["2026-12-24"],
        )
    ],
)

request_handler = DefaultRequestHandler(
    agent_executor=HolidayCheckExecutor(),
    task_store=InMemoryTaskStore(),
)

app = A2AFastAPIApplication(agent_card=agent_card, http_handler=request_handler).build()


if __name__ == "__main__":
    uvicorn.run(app, host="0.0.0.0", port=AGENT4_PORT)
