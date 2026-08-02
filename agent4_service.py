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

from config import SUPPORTED_COUNTRIES

NAGER_API_BASE = "https://date.nager.at/api/v3/publicholidays"
CONFLICT_WINDOW_DAYS = 3
AGENT4_PORT = int(os.getenv("AGENT4_PORT", "8001"))

# Hardcoded, publicly known/announced dates. Verified against official
# sources at the time this was written; needs periodic manual updates as
# further years are announced.
SUPER_BOWL_DATES = {
    2026: "2026-02-08",  # Super Bowl LX, Levi's Stadium
    2027: "2027-02-14",  # Super Bowl LXI, SoFi Stadium
    2028: "2028-02-13",  # Super Bowl LXII, Mercedes-Benz Stadium
}
WORLD_CUP_FINAL_DATES = {
    2026: "2026-07-19",  # MetLife Stadium
    2030: "2030-07-21",  # Morocco/Portugal/Spain
}
OSCARS_DATES = {
    2026: "2026-03-15",  # 98th Academy Awards
    2027: "2027-03-14",  # 99th Academy Awards
    2028: "2028-03-05",  # 100th Academy Awards
}
GOLDEN_GLOBES_DATES = {
    2026: "2026-01-11",  # 83rd Golden Globes
    2027: "2027-01-10",  # 84th Golden Globes
}
GRAMMYS_DATES = {
    2026: "2026-02-01",  # 68th Grammy Awards
    2027: "2027-02-07",  # 69th Grammy Awards
}

SPORTING_EVENTS = {
    "Super Bowl": SUPER_BOWL_DATES,
    "FIFA World Cup Final": WORLD_CUP_FINAL_DATES,
}
AWARDS_EVENTS = {
    "Oscars": OSCARS_DATES,
    "Golden Globes": GOLDEN_GLOBES_DATES,
    "Grammy Awards": GRAMMYS_DATES,
}


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
    for country_code in SUPPORTED_COUNTRIES:
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


def check_global_event_conflicts(
    date_str: str, event_group: dict[str, dict[int, str]], window_days: int = CONFLICT_WINDOW_DAYS
) -> list[dict]:
    proposed_date = date.fromisoformat(date_str)

    results = []
    for event_name, dates_by_year in event_group.items():
        candidates = [date.fromisoformat(d) for d in dates_by_year.values()]
        if not candidates:
            continue

        nearest = min(candidates, key=lambda d: abs((d - proposed_date).days))
        days_away = abs((nearest - proposed_date).days)

        results.append({
            "name": event_name,
            "date": nearest.isoformat(),
            "conflict": days_away <= window_days,
            "days_away": days_away,
        })

    return results


def check_all_conflicts(date_str: str) -> dict:
    return {
        "holidays": check_country_holidays(date_str),
        "sporting_events": check_global_event_conflicts(date_str, SPORTING_EVENTS),
        "awards_ceremonies": check_global_event_conflicts(date_str, AWARDS_EVENTS),
    }


class HolidayCheckExecutor(AgentExecutor):
    async def execute(self, context: RequestContext, event_queue: EventQueue) -> None:
        date_str = context.get_user_input().strip()
        report = check_all_conflicts(date_str)
        await event_queue.enqueue_event(new_agent_text_message(json.dumps(report)))

    async def cancel(self, context: RequestContext, event_queue: EventQueue) -> None:
        raise NotImplementedError("Agent 4 does not support cancellation.")


agent_card = AgentCard(
    name="Agent 4 - Release Date Conflict Checker",
    description=(
        "Checks whether a proposed release date falls within "
        f"{CONFLICT_WINDOW_DAYS} days of a public holiday in "
        f"{', '.join(SUPPORTED_COUNTRIES)}, a major sporting event (Super Bowl, "
        "FIFA World Cup final), or a major awards ceremony (Oscars, Golden "
        "Globes, Grammy Awards)."
    ),
    url=f"http://localhost:{AGENT4_PORT}/",
    version="1.0.0",
    default_input_modes=["text"],
    default_output_modes=["text"],
    capabilities=AgentCapabilities(),
    skills=[
        AgentSkill(
            id="check-holiday-conflicts",
            name="Check Release Date Conflicts",
            description=(
                "Given a date (YYYY-MM-DD), reports holiday conflicts for "
                f"{', '.join(SUPPORTED_COUNTRIES)}, plus conflicts with major "
                "sporting events and major awards ceremonies, all within "
                f"{CONFLICT_WINDOW_DAYS} days of the given date, in a single "
                "combined report."
            ),
            tags=["holidays", "sporting-events", "awards", "scheduling"],
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
