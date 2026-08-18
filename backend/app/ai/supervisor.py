from typing import TypedDict
from langgraph.graph import StateGraph, END
from app.ai.agents import (
    check_compliance,
    analyze_script,
    get_genre_release_listing,
    check_release_conflicts,
    resolve_genre_from_listing,
    check_compliance_structured,
    generate_script_digest,
    producer_agent,
    executive_agent,
    check_conflicts_via_a2a
)
import json
from app.data.database import get_result


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
        if "|" not in state["script_text"]:
            result = f"Error: Expected script_text in the format 'YYYY-MM-DD|listing_result_id' but got: {state['script_text']}"
        else:
            proposed_date, listing_result_id = state["script_text"].split("|", 1)
            listing_result_id = int(listing_result_id.strip())
            listing_text = get_result(listing_result_id)["result"]
            genre = resolve_genre_from_listing(listing_result_id)
            result = check_release_conflicts(genre, proposed_date.strip(), listing_text)
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


async def run_supervisor(script_text: str, task: str):
    if task == "greenlight":
        graph = build_greenlight_committee()
        initial_state = {"script_text": script_text, "iteration_count": 0}
        result_state = await graph.ainvoke(initial_state)
        return {"result": result_state["result"], "task": task}

    graph = build_supervisor()
    initial_state = {"script_text": script_text, "task": task, "result": ""}
    return await graph.ainvoke(initial_state)


class CommitteeState(TypedDict, total=False):
    script_text: str
    script_digest: dict
    producer_pitch: dict
    executive_review: dict
    iteration_count: int
    final_verdict: dict
    compliance_data: dict
    date_conflict_data: dict
    previous_concerns: list
    result: str
    trace: list[str]


async def digest_node(state: CommitteeState) -> CommitteeState:
    digest = generate_script_digest(state["script_text"])
    state["script_digest"] = digest
    
    trace = state.get("trace", [])
    trace.append("Script condensed via summarizer LLM")
    state["trace"] = trace
    
    return state


async def producer_node(state: CommitteeState) -> CommitteeState:
    rejections = []
    if "executive_review" in state and state["executive_review"]:
        rejections = state["executive_review"].get("concern_list", [])
    
    pitch = producer_agent(state.get("script_digest", {}), rejections)
    state["producer_pitch"] = pitch
    state["iteration_count"] = state.get("iteration_count", 0) + 1
    return state


async def gatekeeper_node(state: CommitteeState) -> CommitteeState:
    trace = state.get("trace", [])
    if "compliance_data" not in state or not state["compliance_data"]:
        state["compliance_data"] = check_compliance_structured(state["script_text"])
        trace.append("Compliance checks fetched and mapped")
    
    if "date_conflict_data" not in state or not state["date_conflict_data"]:
        proposed_date = state.get("producer_pitch", {}).get("pitch_fields", {}).get("proposed_release_date", "2026-12-25")
        try:
            conflicts = await check_conflicts_via_a2a(proposed_date)
            state["date_conflict_data"] = conflicts
            trace.append("Agent 4 queried for calendar conflicts")
        except Exception:
            state["date_conflict_data"] = {}
            
    state["trace"] = trace

    hard_violations = state["compliance_data"].get("hard_violations", [])
    if hard_violations:
        state["executive_review"] = {
            "concern_list": hard_violations,
            "is_approved": False,
            "message": "Auto-rejected by gatekeeper due to hard compliance violations."
        }
    else:
        state["executive_review"] = None

    return state


def route_after_gatekeeper(state: CommitteeState) -> str:
    if state.get("executive_review") is not None and state["executive_review"].get("is_approved") is False:
        return "stalemate_edge"
    return "executive_node"


async def executive_node(state: CommitteeState) -> CommitteeState:
    review = executive_agent(
        state.get("script_digest", {}),
        state.get("producer_pitch", {}),
        state.get("compliance_data", {}),
        state.get("date_conflict_data", {})
    )
    if "executive_review" in state and state["executive_review"]:
        state["previous_concerns"] = state["executive_review"].get("concern_list", [])
    else:
        state["previous_concerns"] = []
        
    state["executive_review"] = review
    return state


def route_after_executive(state: CommitteeState) -> str:
    review = state.get("executive_review", {})
    if review.get("is_approved"):
        return "mediator_node"
    
    current_concerns = set(review.get("concern_list", []))
    previous_concerns = set(state.get("previous_concerns", []))
    
    is_stalemate = current_concerns == previous_concerns and len(current_concerns) > 0
    
    if is_stalemate or state.get("iteration_count", 0) >= 3:
        return "mediator_node"
    
    return "producer_node"


async def mediator_node(state: CommitteeState) -> CommitteeState:
    review = state.get("executive_review", {})
    is_approved = review.get("is_approved", False)
    
    conflicts = state.get("date_conflict_data", {})
    has_hard_conflict = False
    
    holidays = conflicts.get("holidays", {})
    for country, details in holidays.items():
        if details.get("conflict"):
            has_hard_conflict = True
            break
            
    if not is_approved:
        verdict = {"status": "RED", "message": "Needs Human Review (Rejected or Stalemate)"}
    elif has_hard_conflict:
        verdict = {"status": "YELLOW", "message": "Approved by Executive, but has severe Date Conflicts. Re-schedule."}
    else:
        verdict = {"status": "GREEN", "message": "Approved. Safe release date."}
        
    state["final_verdict"] = verdict
    state["result"] = json.dumps({
        "digest": state.get("script_digest"),
        "pitch": state.get("producer_pitch"),
        "review": state.get("executive_review"),
        "verdict": verdict,
        "trace": state.get("trace", [])
    }, indent=2)
    return state


def build_greenlight_committee():
    graph = StateGraph(CommitteeState)
    graph.add_node("digest_node", digest_node)
    graph.add_node("producer_node", producer_node)
    graph.add_node("gatekeeper_node", gatekeeper_node)
    graph.add_node("executive_node", executive_node)
    graph.add_node("mediator_node", mediator_node)
    
    graph.set_entry_point("digest_node")
    graph.add_edge("digest_node", "producer_node")
    graph.add_edge("producer_node", "gatekeeper_node")
    
    graph.add_conditional_edges(
        "gatekeeper_node",
        route_after_gatekeeper,
        {
            "executive_node": "executive_node",
            "stalemate_edge": "mediator_node"
        }
    )
    
    graph.add_conditional_edges(
        "executive_node",
        route_after_executive,
        {
            "mediator_node": "mediator_node",
            "producer_node": "producer_node"
        }
    )
    
    graph.add_edge("mediator_node", END)
    return graph.compile()