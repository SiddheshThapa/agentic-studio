# Agentic Studio — Architecture

## System Overview
A studio operations backend with 3 task-specific agents orchestrated by a
LangGraph supervisor, exposed via FastAPI. Postgres+pgvector (Supabase) is
the single persistent store for all data: documents, cache, memory,
results, and evaluation history. Row Level Security is enabled on every
table.

---

## Files and responsibilities

### config.py
Environment settings: GEMINI_API_KEY, DATABASE_URL, TMDB_API_KEY,
MAX_SCRIPT_TEXT_LENGTH, MAX_UPLOAD_FILE_SIZE_MB, CACHE_TTL_HOURS,
RATE_LIMIT_MAX_REQUESTS, RATE_LIMIT_WINDOW_SECONDS.

### schemas.py
TaskType (Enum: compliance, analyze, release_check).
AgentResponse (Pydantic model: result_id, task, result, from_cache, eval).
EvalResult (Pydantic model: score, reasoning).

### database.py [synchronous, psycopg2]
get_connection — retry-wrapped via resilience.py's with_retry decorator.
init_tables — creates all 5 tables (documents, cache, memory, results,
eval_history) and enables Row Level Security on all 5.
insert_document, search_similar, get_all_documents_for_bm25, bm25_search,
delete_documents_by_filename, cache_get (24h TTL via SQL INTERVAL),
cache_set, memory_add, memory_get, save_result, get_result,
get_result_with_script, save_eval_record, get_eval_summary,
generate_eval_chart (uses matplotlib, imported at top of file).

### llm.py [synchronous]
embed_text — gemini-embedding-001, 768 dimensions, retry loop with
exponential backoff, raises on empty input.
generate_text — gemini-2.5-flash-lite, retry loop, retries specifically
on 503/UNAVAILABLE errors, returns a fallback message if retries exhaust.

### resilience.py
with_retry — decorator for automatic retry with exponential backoff, used
on database.py's get_connection.
check_rate_limit — in-memory per-session request tracker.
logger — shared Python logging instance, used across main.py.
safe_generate — wraps an LLM call, returns a fallback message on failure
instead of raising; used in agents.py's check_compliance.

### guardrails.py
check_query_safety — rejects empty/short (<10 char) input and known
prompt-injection phrases.
check_retrieval_confidence — rejects retrieval results below a
rerank_score threshold, preventing weak matches from being used.

### retrieval.py
hybrid_search — the single retrieval path used by agents.py. Combines
database.py's search_similar (dense/vector) and bm25_search (keyword),
normalizes both score types to 0-1, fuses with a 0.6 dense / 0.4 BM25
weighting, then reranks the shortlist via gemini_rerank (one batched
Gemini call scoring all candidates at once).

### web_fetch.py [async]
fetch_page_text — async httpx GET plus BeautifulSoup cleaning of a
webpage's text content. Direct HTTP implementation (not the MCP
protocol). Not currently called anywhere in the codebase — Agent 3's
release-listing step now fetches structured data directly from the TMDb
API (see agents.py) instead of scraping a webpage.

### calendar_mcp.py [async, real MCP protocol]
create_calendar_event_via_mcp — connects to the @cocal/google-calendar-mcp
server via a stdio subprocess using the real MCP client protocol, calls
its create-event tool with start/end fields. Loads its own environment
via load_dotenv() independently. Requires GOOGLE_OAUTH_CREDENTIALS
(pointed at an absolute path to a Google OAuth credentials JSON file) and
SHARED_CALENDAR_ID. Requires a one-time interactive authorization
(`npx @cocal/google-calendar-mcp auth`) to be run once per machine before
first use; this saves a reusable token locally.

### ingest.py [synchronous]
chunk_text — splits text into ~300-word chunks with 50-word overlap
between consecutive chunks.
classify_chunk — asks the LLM to classify a chunk into guidelines,
past_films, or scripts.
document_exists — checks for an existing identical chunk in a collection
before inserting, preventing duplicates.
ingest_document — orchestrates the full pipeline: validate input isn't
empty, chunk the text, classify each chunk, skip duplicates, embed and
store the rest.

### agents.py [mixed sync/async]
check_compliance(script_text) [sync] — uses safe_generate to flag risky
content, retrieval.hybrid_search against the "guidelines" collection,
check_retrieval_confidence to gate on weak matches, then generates the
final compliance report citing the matched guideline text.
analyze_script(script_text) [sync] — generates a direct structural
analysis (logline, pacing/clarity scores with reasoning), searches the
"past_films" collection via hybrid_search, then produces a final
recommendation grounded in both the direct analysis and any comparable
titles found.
get_genre_release_listing(genre) [async] — maps the genre name to a TMDb
numeric genre ID via the static GENRE_IDS dict, then calls TMDb's
Discover Movie API (`httpx.AsyncClient`) filtered by that genre ID and a
primary_release_date range covering the current year through next year
(computed from datetime.now().year). Formats titles and release dates
directly from TMDb's structured JSON response — no LLM call in this
function. Returns a clear message if the genre is unrecognized, if TMDb
returns zero results, or if the request fails.
check_release_conflicts(genre, proposed_date, listing_text) [sync] — no
I/O of its own; takes a previously fetched listing_text (the output of
get_genre_release_listing, retrieved via database.py's get_result) and
asks the LLM to identify any competing releases within 2 weeks of the
proposed date.

### supervisor.py [async throughout]
SupervisorState — TypedDict with script_text, task, result.
route_node [async] — single routing function, branches on task:
"compliance" calls check_compliance directly (no await, sync function),
"analyze" calls analyze_script directly (no await, sync function),
"release_listing" awaits get_genre_release_listing (async, no LLM call),
"release_check" splits script_text on "|" into genre, proposed_date, and
a listing result_id, loads the listing text via database.py's
get_result, then calls check_release_conflicts directly (no await, sync
function).
build_supervisor — builds a single-node graph: route → END.
run_supervisor [async] — invokes the graph via graph.ainvoke(...).

CRITICAL: any function agents.py calls that changes between sync and
async requires route_node's call to that function to be updated
accordingly (add or remove await).

### evaluator.py [synchronous]
score_faithfulness(script_text, agent_result) → EvalResult — asks the LLM
to judge whether the agent's answer is grounded in the actual script,
returns a 1-10 score with reasoning.
score_context_precision(query, retrieved_chunks) → dict — asks the LLM to
judge whether retrieved chunks were relevant to the query. Defined but
not currently called from any endpoint; wiring it in requires agents.py
to also return the chunks it retrieved, which it does not currently do.

### main.py [FastAPI, async endpoints]
POST /ingest — accepts a PDF upload, enforces MAX_UPLOAD_FILE_SIZE_MB,
extracts text inline via pypdf, passes to ingest.ingest_document.
GET /health — verifies database connectivity.
DELETE /document — removes all chunks matching a given filename.
POST /run-agent — the main pipeline: check_rate_limit, log the call,
check_query_safety, memory_add (user turn), check cache, on a cache hit
return immediately; otherwise await run_supervisor, cache_set, save_result,
memory_add (assistant turn), and optionally score_faithfulness plus
save_eval_record if evaluate=true. Rate-limit and safety failures raise
HTTPException rather than returning bare error dicts, since the endpoint
declares response_model=AgentResponse.
GET /eval/summary — average faithfulness and context precision across all
evaluated runs.
GET /eval/chart — a base64-encoded PNG chart of scores over time.
GET /result/{id} — returns a stored result's task and text.
GET /result/{id}/download — generates and returns a PDF of a result via
reportlab.
GET /history/{session_id} — returns stored conversation turns for a
session.
POST /confirm-date/{id} — parses genre|date from the stored release_check
result's script_text, creates a real calendar event for that date.
POST /override-date/{id} — same, but accepts a new_date form field to
force a different date than originally proposed, regardless of conflicts.

There is no approve/reject/redirect workflow anywhere in this project.
Agent 1 (compliance) and Agent 2 (analyze) results are generated and
immediately viewable/downloadable, with no gating step. Only Agent 3
(release_check) has a post-generation action, and it is binary:
confirm the proposed date, or override it with a different one — both
paths always result in a calendar event being created.

---

## The 3 agents

1. compliance — self-querying RAG against the "guidelines" collection,
   cites the specific matched guideline in its report.
2. analyze — direct structural analysis plus RAG against the "past_films"
   collection, produces a Pass/Consider/Recommend verdict.
3. release_check — a two-step flow: release_listing fetches upcoming
   genre releases directly from the TMDb API, then release_check flags
   potential date conflicts against that listing, and on confirm/override
   creates a real Google Calendar event via genuine MCP protocol.

---

## Data flow, end to end
main.py receives a request
  → guardrails.py validates input
  → database.py checked for a cached answer
  → supervisor.py routes to the correct agents.py function
      → agents.py calls llm.py for generation, retrieval.py for search
      → retrieval.py calls database.py for dense+keyword search
      → (release_listing only) agents.py calls the TMDb API directly
  → database.py stores the result and updates the cache
  → (release_check only, on confirm/override) main.py calls
    calendar_mcp.py to create a real calendar event

---

## Known limitations
1. Database access is synchronous (psycopg2) inside async FastAPI
   endpoints, which serializes database calls under concurrent load.
   Scaling this would require migrating database.py to asyncpg.
2. score_context_precision is implemented but not wired into any
   endpoint; doing so requires agents.py to return retrieved chunks
   alongside its text answer.
3. No user authentication exists on any endpoint.
4. MAX_SCRIPT_TEXT_LENGTH is defined in config.py but not currently
   enforced against incoming script_text.
5. Agent 3's release-listing step reads TMDb's first results page only
   (no pagination beyond ~20 films) and does not include per-film studio
   data, since that requires a separate TMDb movie-details call per film.

---

## Setup requirements for a fresh environment
1. A Supabase (or any Postgres) project with the pgvector extension
   available.
2. A .env file with: GEMINI_API_KEY, DATABASE_URL, SHARED_CALENDAR_ID,
   GOOGLE_OAUTH_CREDENTIALS (absolute path to a Google OAuth credentials
   JSON file), TMDB_API_KEY (a free API key from themoviedb.org, used by
   Agent 3's release-listing step).
3. Node.js/npx installed, for running the calendar MCP server.
4. A Google Cloud project with the Calendar API enabled, OAuth consent
   screen configured (External, with the operator's own email added as a
   test user), and Desktop app OAuth credentials downloaded as JSON.
5. One-time only, run `npx @cocal/google-calendar-mcp auth` and complete
   the browser sign-in — this saves a reusable local token.
6. Run `python -c "from database import init_tables; init_tables()"` (or
   simply start the app once) to create all tables and enable RLS.