from typing import TypedDict
from langgraph.graph import StateGraph, END
from agents import (
    check_compliance,
    analyze_script,
    get_genre_release_listing,
    check_release_conflicts,
)
from database import get_result


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
        genre, proposed_date, listing_result_id = state["script_text"].split("|", 2)
        listing_text = get_result(int(listing_result_id.strip()))["result"]
        result = check_release_conflicts(genre.strip(), proposed_date.strip(), listing_text)
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