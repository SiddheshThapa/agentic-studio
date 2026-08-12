from typing import TypedDict
from langgraph.graph import StateGraph, END
from agents import (
    check_compliance,
    analyze_script,
    get_genre_release_listing,
    check_release_conflicts,
)
from database import get_result_with_script


class SupervisorState(TypedDict):
    script_text: str
    task: str
    result: str


async def route_node(state: SupervisorState) -> SupervisorState:
    task = state["task"]

    if task == "compliance":
        result = check_compliance(state["script_text"])
    elif task == "analyze":
        result = analyze_script(state["script_text"])
    elif task == "release_listing":
        result = await get_genre_release_listing(state["script_text"].strip())
    elif task == "release_check":
        proposed_date, listing_result_id = state["script_text"].split("|", 1)
        listing_result_id = int(listing_result_id.strip())

        # One fetch, not two: the genre is this row's script_text and the film
        # list is its result, so the old get_result + resolve_genre_from_listing
        # pair was reading the same row twice.
        listing = get_result_with_script(listing_result_id)
        if listing is None:
            result = (
                f"No release listing found with ID {listing_result_id}. "
                "Run Browse Upcoming Releases first, then use the ID it returns."
            )
        else:
            result = check_release_conflicts(
                listing["script_text"].strip(), proposed_date.strip(), listing["result"]
            )
    else:
        result = f"Unknown task: {task}"

    state["result"] = result
    return state


def build_supervisor():
    graph = StateGraph(SupervisorState)
    graph.add_node("route", route_node)
    graph.set_entry_point("route")
    graph.add_edge("route", END)
    return graph.compile()


async def run_supervisor(script_text: str, task: str) -> SupervisorState:
    graph = build_supervisor()
    initial_state = {"script_text": script_text, "task": task, "result": ""}
    return await graph.ainvoke(initial_state)