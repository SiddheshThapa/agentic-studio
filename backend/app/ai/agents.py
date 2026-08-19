import re
from datetime import date, datetime
import httpx
from app.core.llm import generate_text
from app.core.guardrails import check_retrieval_confidence, retrieval_status
from app.data.retrieval import hybrid_search
from app.core.resilience import safe_generate, logger
from app.core.config import TMDB_API_KEY, AGENT4_BASE_URL
from app.ai.evaluator import _parse_json_response
import json
from uuid import uuid4
from a2a.client import A2ACardResolver, A2AClient, create_text_message_object
from a2a.types import MessageSendParams, SendMessageRequest
from a2a.utils import get_message_text
from app.data.database import get_result_with_script

TMDB_DISCOVER_URL = "https://api.themoviedb.org/3/discover/movie"

GENRE_IDS = {
    "action": 28,
    "adventure": 12,
    "animation": 16,
    "comedy": 35,
    "crime": 80,
    "documentary": 99,
    "drama": 18,
    "family": 10751,
    "fantasy": 14,
    "history": 36,
    "horror": 27,
    "music": 10402,
    "mystery": 9648,
    "romance": 10749,
    "science fiction": 878,
    "tv movie": 10770,
    "thriller": 53,
    "war": 10752,
    "western": 37,
}


def check_compliance(script_text: str) -> str:
    system_prompt = """You are a content compliance checker. Read the script excerpt.
Identify any moments that may need compliance review (violence, language, sensitive content).
For each one, state what guideline topic to check (e.g. "graphic violence rules")."""

    flagged_topics = safe_generate(generate_text, system_prompt, script_text)

    guideline_matches = hybrid_search(flagged_topics, collection="guidelines", top_k=3)
    status = retrieval_status(guideline_matches)

    if status == "empty":
        return (
            "No guideline documents matched this content. If you have not uploaded any "
            "guidelines yet, do that first — this agent can only cite documents in the "
            "knowledge base. Manual review recommended."
        )

    if status == "low_relevance":
        return (
            "Guidelines were searched, but none were relevant enough to this content to "
            "cite responsibly. Manual review recommended."
        )

    context = "\n".join(f"- {m['text']}" for m in guideline_matches)

    # "unscored" means documents were retrieved but the reranker could not rank
    # them. Reporting them with a caveat beats claiming nothing was found, which
    # is what the old boolean gate did on every reranker failure.
    caveat = ""
    if status == "unscored":
        logger.warning("Compliance report generated without relevance scoring")
        caveat = (
            "\n\nNote: automatic relevance ranking was unavailable for this report, so "
            "the guidelines quoted above may be less closely matched than usual. "
            "Verify each citation before acting on it."
        )

    final_prompt = f"""Script content flagged: {flagged_topics}

Relevant guidelines found:
{context}

Based on these guidelines, list specific compliance concerns with citations to which guideline applies."""

    return generate_text("You are a compliance report generator.", final_prompt) + caveat


def analyze_script(script_text: str) -> str:
    direct_analysis_prompt = """Read this script excerpt. Provide:
- A one-sentence logline
- Pacing score (1-10) with specific reasoning citing scenes/moments
- Character clarity score (1-10) with specific reasoning
- Key structural strengths and weaknesses"""

    direct_analysis = generate_text("You are a script analyst.", direct_analysis_prompt + "\n\n" + script_text)

    comparables = hybrid_search(direct_analysis, collection="past_films", top_k=3)
    status = retrieval_status(comparables)

    if status in ("empty", "low_relevance"):
        comparable_context = "No closely comparable past films found in the database."
    else:
        # Includes "unscored": unranked comparables are still better grounding
        # than telling the analyst there are none.
        if status == "unscored":
            logger.warning("Comparable films used without relevance scoring")
        comparable_context = "\n".join(f"- {m['text']}" for m in comparables)

    final_prompt = f"""Direct analysis:
{direct_analysis}

Comparable past films:
{comparable_context}

Based on both, give specific, actionable suggestions for improvement, and a final 
recommendation: Pass / Consider / Recommend, with reasoning grounded in the comparable films where available."""

    return generate_text("You are a senior script analyst giving a greenlight recommendation.", final_prompt)



async def get_genre_release_listing(genre: str) -> str:
    genre_id = GENRE_IDS.get(genre.strip().lower())
    if genre_id is None:
        return f'Genre "{genre}" is not recognized. Supported genres: {", ".join(sorted(GENRE_IDS))}.'

    current_year = datetime.now().year
    next_year = current_year + 1
    params = {
        "api_key": TMDB_API_KEY,
        "with_genres": genre_id,
        "primary_release_date.gte": f"{current_year}-01-01",
        "primary_release_date.lte": f"{next_year}-12-31",
        "sort_by": "popularity.desc",
    }

    try:
        async with httpx.AsyncClient(timeout=10) as client:
            response = await client.get(TMDB_DISCOVER_URL, params=params)
            response.raise_for_status()
        films = response.json().get("results", [])
    except Exception as exc:
        return f"Could not fetch releases: {exc}"

    if not films:
        return f"No upcoming {genre} films found for {current_year}-{next_year}."

    return "\n".join(
        f"- {film['title']} ({film.get('release_date') or 'date unknown'})"
        for film in films
    )


def resolve_genre_from_listing(listing_result_id: int) -> str:
    listing = get_result_with_script(listing_result_id)
    return listing["script_text"].strip()


COMPETITION_WINDOW_DAYS = 14

# Matches the lines get_genre_release_listing() writes above, e.g.
#   "- Evil Dead Burn (2026-07-07)"
#   "- Untitled Project (date unknown)"
_LISTING_LINE = re.compile(r"^-\s*(?P<title>.+?)\s*\((?P<date>\d{4}-\d{2}-\d{2}|date unknown)\)\s*$")


def parse_listing(listing_text: str) -> tuple[list[tuple[str, date]], list[str]]:
    """Turn a stored listing back into (title, date) pairs.

    Returns the dated films and, separately, the titles TMDB had no date for —
    those can't be compared, and silently dropping them would hide them.
    """
    dated: list[tuple[str, date]] = []
    undated: list[str] = []

    for line in listing_text.splitlines():
        match = _LISTING_LINE.match(line.strip())
        if not match:
            continue
        title, raw = match.group("title"), match.group("date")
        if raw == "date unknown":
            undated.append(title)
        else:
            dated.append((title, date.fromisoformat(raw)))

    return dated, undated


def find_competing_releases(
    proposed_date: date, listing_text: str, window_days: int = COMPETITION_WINDOW_DAYS
) -> tuple[list[tuple[str, date, int]], list[str]]:
    """Films landing within `window_days` either side of the proposed date.

    Each hit is (title, release date, offset in days) where offset is negative for
    films opening before the proposed date. Sorted by release date.
    """
    dated, undated = parse_listing(listing_text)

    competing = [
        (title, released, (released - proposed_date).days)
        for title, released in dated
        if abs((released - proposed_date).days) <= window_days
    ]
    competing.sort(key=lambda row: row[1])
    return competing, undated


def _describe_offset(offset: int) -> str:
    if offset == 0:
        return "same day"
    direction = "after" if offset > 0 else "before"
    magnitude = abs(offset)
    return f"{magnitude} day{'' if magnitude == 1 else 's'} {direction}"


def check_release_conflicts(genre: str, proposed_date: str, listing_text: str) -> str:
    """Report which films compete with a release on `proposed_date`.

    This used to ask an LLM to read the listing and pick out nearby dates. The
    listing is generated data with known dates in it, so the comparison is done
    directly here: exact, instant, free, and it cannot invent a film that was
    never in the list.
    """
    target = date.fromisoformat(proposed_date)
    competing, undated = find_competing_releases(target, listing_text)

    lines: list[str] = []
    if competing:
        lines.append(
            f"{len(competing)} {genre} release{'' if len(competing) == 1 else 's'} "
            f"within {COMPETITION_WINDOW_DAYS} days of {proposed_date}:"
        )
        lines.append("")
        lines.extend(
            f"- {title} — {released.isoformat()} ({_describe_offset(offset)})"
            for title, released, offset in competing
        )
    else:
        lines.append(
            f"No {genre} releases fall within {COMPETITION_WINDOW_DAYS} days of {proposed_date}."
        )

    if undated:
        lines.append("")
        lines.append(
            f"Not comparable — no release date announced: {', '.join(sorted(undated))}."
        )

    return "\n".join(lines)


async def check_conflicts_via_a2a(date_str: str) -> dict:
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


def check_compliance_structured(script_text: str) -> dict:
    flagged_topics = safe_generate(generate_text, "Identify topics that need compliance review.", script_text)
    guideline_matches = hybrid_search(flagged_topics, collection="guidelines", top_k=3)
    
    if not check_retrieval_confidence(guideline_matches):
        return {"hard_violations": [], "soft_violations": [], "message": "No guidelines found."}
        
    context = "\n".join(f"- {m['text']}" for m in guideline_matches)
    prompt = f"Script flagged: {flagged_topics}\nGuidelines: {context}\nIdentify any strict/hard violations and soft/borderline violations based on these guidelines. Return strict JSON with 'hard_violations' (list of strings) and 'soft_violations' (list of strings)."
    
    result = generate_text("You are a compliance checker. Output strict JSON with lists 'hard_violations' and 'soft_violations'.", prompt, response_json=True)
    try:
        return _parse_json_response(result)
    except Exception:
        return {"hard_violations": [], "soft_violations": [], "message": "Failed to parse compliance"}


def generate_script_digest(script_text: str) -> dict:
    prompt = f"Condense the following script into a digest containing 'genre', 'tone', 'rating_relevant_content' (list), and 'marketable_hooks' (list). Script: {script_text}"
    result = generate_text("You are a script summarizer. Output strict JSON with 'genre', 'tone', 'rating_relevant_content', and 'marketable_hooks'.", prompt, response_json=True)
    try:
        return _parse_json_response(result)
    except Exception:
        return {
            "error": "Failed to parse digest",
            "raw": result,
            "genre": "unknown",
            "tone": "unknown",
            "rating_relevant_content": [],
            "marketable_hooks": [],
        }


def producer_agent(script_digest: dict, executive_rejections: list[str] = None) -> dict:
    prompt = f"Script digest: {json.dumps(script_digest)}\n"
    if executive_rejections:
        prompt += f"Previous executive rejections to address: {json.dumps(executive_rejections)}\n"
    
    prompt += "Pitch this script focusing on marketability and mitigating any previous concerns. Output strict JSON with 'pitch_fields' (dict containing EXACT keys: 'title_concept', 'strengths' (list), 'target_demographic', 'budget_tier', 'mitigation_plan', 'proposed_release_date' (YYYY-MM-DD)) and 'strategy' (string)."
    
    result = generate_text("You are a passionate film producer. Output strict JSON.", prompt, response_json=True)
    try:
        return _parse_json_response(result)
    except Exception:
        return {"pitch_fields": {}, "strategy": "Error generating pitch"}


def executive_agent(script_digest: dict, producer_pitch: dict, compliance_data: dict, date_conflict_data: dict) -> dict:
    prompt = f"Script digest: {json.dumps(script_digest)}\nProducer Pitch: {json.dumps(producer_pitch)}\nCompliance Data: {json.dumps(compliance_data)}\nDate Conflicts: {json.dumps(date_conflict_data)}\n"
    prompt += "Evaluate the pitch against the data. Output strict JSON with 'concern_list' (list of strings), 'is_approved' (boolean), and 'message' (string explaining the decision)."
    
    result = generate_text("You are a pragmatic studio executive. Output strict JSON.", prompt, response_json=True)
    try:
        return _parse_json_response(result)
    except Exception:
        return {"concern_list": ["Error generating review"], "is_approved": False, "message": "Parse error"}
