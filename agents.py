from datetime import datetime
import httpx
from llm import generate_text
from guardrails import check_retrieval_confidence
from retrieval import hybrid_search
from resilience import safe_generate
from config import TMDB_API_KEY

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

    if not check_retrieval_confidence(guideline_matches):
        return "No sufficiently relevant guidelines found for this content. Manual review recommended."

    context = "\n".join(f"- {m['text']}" for m in guideline_matches)

    final_prompt = f"""Script content flagged: {flagged_topics}

Relevant guidelines found:
{context}

Based on these guidelines, list specific compliance concerns with citations to which guideline applies."""

    return generate_text("You are a compliance report generator.", final_prompt)


def analyze_script(script_text: str) -> str:
    direct_analysis_prompt = """Read this script excerpt. Provide:
- A one-sentence logline
- Pacing score (1-10) with specific reasoning citing scenes/moments
- Character clarity score (1-10) with specific reasoning
- Key structural strengths and weaknesses"""

    direct_analysis = generate_text("You are a script analyst.", direct_analysis_prompt + "\n\n" + script_text)

    comparables = hybrid_search(direct_analysis, collection="past_films", top_k=3)

    if not check_retrieval_confidence(comparables):
        comparable_context = "No closely comparable past films found in the database."
    else:
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


def check_release_conflicts(genre: str, proposed_date: str, listing_text: str) -> str:
    prompt = f"""Given this list of upcoming {genre} film releases, list every film
scheduled for release near {proposed_date} (within 2 weeks before or after) that could
compete with a new {genre} release on that date. For each one, state: movie name, genre,
studio, and release date. If none are found, say so clearly.

Release listing:
{listing_text}"""

    return generate_text("You are a release scheduling analyst.", prompt)