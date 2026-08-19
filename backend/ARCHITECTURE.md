# Agentic Studio — Architecture

## System Overview
A studio operations backend with 5 task types — 4 orchestrated by a LangGraph
supervisor (compliance, analyze, release_listing, release_check) plus a 5th
that runs its own multi-agent LangGraph debate graph (greenlight) — plus a
standalone 4th agent (the release-date conflict checker) reachable only via
the A2A protocol. Exposed via FastAPI. The backend is organized as a
domain-driven package (`backend/app/`: `ai/`, `core/`, `data/`,
`integrations/`) rather than a flat set of top-level modules; a separate
`backend/microservices/` package holds the standalone A2A agent. Postgres +
pgvector (Supabase) is the single persistent store for all data: documents,
cache, memory, results, and evaluation history. Row Level Security is
enabled on every table. Sensitive endpoints require a shared-secret API key.
Calendar events can be created through either of two independent backends,
with automatic fallback between them. A Next.js single-page frontend
(`frontend/`) consumes the FastAPI backend directly over CORS-enabled HTTP
and covers every endpoint: running agents (including the Greenlight
Committee's "Boardroom Chat" view), uploading/deleting reference documents,
browsing history/results, the two-path release-date confirmation flow, and
the evaluation dashboard. The system is designed to be deployed as three
independent services — two on Render (the FastAPI backend and Agent 4) and
one on Vercel (the frontend) — connected entirely through environment
variables and CORS configuration, not shared infrastructure.

**Import/run note:** because every backend module imports via the `app.`
package prefix (e.g. `from app.core.config import ...`), the backend must be
run with `backend/` as the working directory / on the Python path — e.g.
`cd backend && uvicorn app.main:app --reload`, not `cd backend/app &&
uvicorn main:app`. `backend/microservices/agent4_service.py` works around
this itself by prepending its own parent directory (`backend/`) to
`sys.path` at import time, so `python microservices/agent4_service.py` (or
`python agent4_service.py` from inside `microservices/`) works either way.

---

## Files and responsibilities

### app/core/config.py
Environment settings: GEMINI_API_KEY, DATABASE_URL, TMDB_API_KEY, CHAT_MODEL
(default `"gemini-3.1-flash-lite"`) and EMBEDDING_MODEL (default
`"gemini-embedding-001"`) — the Gemini model names llm.py calls, overridable
without a code change if a newer/different model needs swapping in,
MAX_SCRIPT_TEXT_LENGTH, MAX_UPLOAD_FILE_SIZE_MB, CACHE_TTL_HOURS,
RATE_LIMIT_MAX_REQUESTS, RATE_LIMIT_WINDOW_SECONDS, AGENT4_BASE_URL
(default `http://localhost:8001`), CALENDAR_MODE (`"mcp"` or
`"service_account"`, default `"service_account"`), GOOGLE_SERVICE_ACCOUNT_JSON
(path to a service account credentials file — on Render this points at the
platform's mounted Secret File path, not a repo-relative path),
API_SECRET_KEY (shared secret required on sensitive endpoints),
SUPPORTED_COUNTRIES (list of country codes, parsed from a comma-separated
`SUPPORTED_COUNTRIES` env var, stripped and uppercased, default `["US",
"MX", "GB", "JP", "DE"]` — the single source of truth for which countries
Agent 4 checks and which countries get a calendar event; both
agent4_service.py and main.py read this same list, so adding or removing a
country is a one-line env change, not a code edit in either file).

### schemas.py
TaskType (Enum: compliance, analyze, release_listing, release_check,
**greenlight**). AgentResponse (Pydantic model: result_id, task, result,
from_cache, eval). EvalResult (Pydantic model: score, reasoning).

### app/data/database.py [synchronous, psycopg2]
get_connection — retry-wrapped via `app/core/resilience.py`'s with_retry
decorator. init_tables — creates all 5 tables (documents, cache, memory,
results, eval_history) and enables Row Level Security on all 5. **Called at
import time in main.py** (module-level `init_tables()`, not inside a
startup event), so simply importing `app.main` — or starting uvicorn against
it — attempts a live DB connection immediately; an unreachable DATABASE_URL
fails the whole process before it can serve `/health`.
insert_document, search_similar, get_all_documents_for_bm25, bm25_search,
delete_documents_by_filename, cache_get (24h TTL via SQL INTERVAL),
cache_set, memory_add, memory_get, save_result, get_result,
get_result_with_script, save_eval_record, get_eval_summary,
generate_eval_chart (uses matplotlib, imported at top of file).

### app/core/llm.py [synchronous]
embed_text — embeds via config.py's EMBEDDING_MODEL (default
gemini-embedding-001), 768 dimensions, retry loop with exponential backoff,
raises on empty input.
generate_text — generates via config.py's CHAT_MODEL, retry loop, retries
specifically on 503/UNAVAILABLE errors, returns a fallback message if
retries exhaust. Accepts optional temperature (default 0.2, used by most
callers) and response_json (default False); when response_json=True, sets
Gemini's native JSON response mode (response_mime_type="application/json"),
used by every JSON-producing caller across the codebase (evaluator.py's eval
functions, and — as of the Greenlight Committee — agents.py's
check_compliance_structured, generate_script_digest, producer_agent, and
executive_agent).

### app/core/resilience.py
with_retry — decorator for automatic retry with exponential backoff, used
on database.py's get_connection.
check_rate_limit — in-memory per-session request tracker, used on
/run-agent, /check-conflicts, and /finalize-calendar.
logger — shared Python logging instance, used across main.py, including to
log calendar-backend fallback warnings.
safe_generate — wraps an LLM call, returns a fallback message on failure
instead of raising; used in agents.py's check_compliance.

### app/core/guardrails.py
check_query_safety — rejects empty/too-short (configurable minimum length,
default 10 characters) input, input flagged by check_content_toxicity (only
when `check_toxicity=True` is passed — see main.py's `/run-agent`), and
input matching a known prompt-injection phrase. Before matching against
INJECTION_PATTERNS, input is normalized (whitespace collapsed via `" "
.join(text.lower().split())`) so extra or irregular whitespace and casing
don't bypass detection.
INJECTION_PATTERNS — a literal-phrase list (e.g. "ignore previous
instructions", "forget everything above", "new instructions:", "act as if",
"bypass your rules") matched by exact substring against the normalized
input.
check_content_toxicity — flags direct abuse/harassment aimed at the system
without an LLM call. Splits input into sentences (on `.`, `!`, `?`); a
sentence is flagged only if it contains both a second-person direct-address
marker (DIRECT_ADDRESS_MARKERS: "you", "your", "you're", "youre",
"yourself", "u" — matched after stripping surrounding punctuation from each
token) and profane/abusive language per the better-profanity library
(profanity.contains_profanity). This co-occurrence requirement is
deliberate: it lets ordinary script content containing profanity or
violence in first-/third-person narrative or dialogue pass through
unflagged (the app's core use case), while still catching direct
second-person abuse ("f*** you", "you are stupid"). It is a heuristic, not a
semantic classifier — it can flag in-fiction second-person dialogue between
characters (false positive) and miss abuse using words outside
better-profanity's word list, e.g. mild insults like "useless" or "idiot"
(false negative); see Known Limitations.
check_retrieval_confidence — rejects retrieval results below a
rerank_score threshold, preventing weak matches from being used.

### app/data/retrieval.py
gemini_rerank — one batched Gemini call that scores every shortlisted
candidate's relevance (0-10) against the query in a single request, then
sorts by that score. On any failure (bad JSON, wrong array length, LLM
error) it falls back to the pre-rerank hybrid_score instead of raising, so
retrieval degrades gracefully rather than failing the caller.
hybrid_search — the single retrieval path used by agents.py. Combines
database.py's search_similar (dense/vector) and bm25_search (keyword),
normalizes both score types to 0-1, fuses with a 0.6 dense / 0.4 BM25
weighting, then reranks the shortlist via gemini_rerank.

### app/integrations/web_fetch.py [async]
fetch_page_text — async httpx GET plus BeautifulSoup cleaning of a
webpage's text content. Direct HTTP implementation (not the MCP protocol).
Not currently called anywhere in the codebase — Agent 3's release-listing
step fetches structured data directly from the TMDb API (see agents.py)
instead of scraping a webpage.

### app/integrations/calendar_mcp.py [async, real MCP protocol]
create_calendar_event_via_mcp — connects to the @cocal/google-calendar-mcp
server via a stdio subprocess using the real MCP client protocol, calls its
create-event tool with start/end fields. Requires a gcp-credentials.json
file (OAuth client credentials) — CREDENTIALS_PATH resolves to a
`gcp-credentials.json` sitting next to this file, i.e.
`backend/app/integrations/gcp-credentials.json`, **not** the repo-root
`gcp-credentials.json` — and SHARED_CALENDAR_ID. Requires a one-time
interactive authorization (`npx @cocal/google-calendar-mcp auth`) to be run
once per machine before first use; this saves a reusable token locally.
Because this token and credentials file live on local disk, MCP mode is
only reliably usable when running locally — see Deployment. Raises on any
failure (missing credentials file, expired/missing token, subprocess/auth
errors) — it does not handle its own failures; the caller in main.py is
responsible for that.

### app/integrations/calendar_service_account.py [async]
create_event_via_service_account — creates a calendar event using a Google
service account (google-api-python-client + google.oauth2.service_account
.Credentials), authenticating with the service account key file at
GOOGLE_SERVICE_ACCOUNT_JSON and writing to SHARED_CALENDAR_ID via the
Calendar API's events.insert. No interactive auth step is required — the
service account must instead be shared on SHARED_CALENDAR_ID with write
("Make changes to events") permission ahead of time. The underlying
googleapiclient call is synchronous; it runs inside asyncio.to_thread so it
doesn't block the event loop. Same input/output signature as
calendar_mcp.py's function, so the two are interchangeable.

### microservices/agent4_service.py [async, standalone FastAPI + real A2A protocol]
A separate process (its own uvicorn entry point; reads AGENT4_PORT for
local runs, default 8001 — on Render, the start command binds directly to
Render's $PORT instead, see Deployment) exposing one A2A skill that checks
a proposed date against three conflict categories and returns them combined
in a single report:
- check_country_holidays — for each country in config.py's
  SUPPORTED_COUNTRIES, queries the free Nager.Date public holidays API for
  the relevant year(s) and reports whether a holiday falls within 3 days of
  the given date. A failure fetching one country's data is isolated and
  reported as that country's status being `"unknown"`.
- check_global_event_conflicts — checks a date against a hardcoded `{year:
  date}` table (SUPER_BOWL_DATES, WORLD_CUP_FINAL_DATES, OSCARS_DATES,
  GOLDEN_GLOBES_DATES, GRAMMYS_DATES), returning the nearest occurrence's
  name, date, whether it falls within the conflict window, and how many
  days away it is. Requires periodic manual updates as further years are
  announced.
- check_all_conflicts combines all three into one report:
  `{"holidays": {...per-country...}, "sporting_events": [...],
  "awards_ceremonies": [...]}`.
- HolidayCheckExecutor (the A2A AgentExecutor) parses the incoming message
  as a date string, calls check_all_conflicts, and returns the combined
  report as a single JSON-encoded text message.
Agent 4 is reachable only via A2A, not as an in-process function call — both
main.py (release_check confirm/override/check-conflicts/finalize flow) and
agents.py's `check_conflicts_via_a2a` (used by the Greenlight Committee's
gatekeeper_node) talk to it as a separate service over the network.

### app/data/ingest.py [synchronous]
chunk_text — splits text into ~300-word chunks with 50-word overlap between
consecutive chunks.
classify_chunk — asks the LLM to classify a chunk into guidelines,
past_films, or scripts.
document_exists — checks for an existing identical chunk in a collection
before inserting, preventing duplicates.
ingest_document — orchestrates the full pipeline: validate input isn't
empty, chunk the text, classify each chunk, skip duplicates, embed and
store the rest.

### app/ai/agents.py [mixed sync/async]
Holds every LLM-calling worker function used by both the ordinary
supervisor graph and the Greenlight Committee graph.

**Supervisor-routed functions:**
check_compliance(script_text) [sync] — uses safe_generate to flag risky
content, retrieval.hybrid_search against the "guidelines" collection,
check_retrieval_confidence to gate on weak matches, then generates the
final compliance report citing the matched guideline text.
analyze_script(script_text) [sync] — generates a direct structural analysis
(logline, pacing/clarity scores with reasoning), searches the "past_films"
collection via hybrid_search, then produces a final recommendation grounded
in both the direct analysis and any comparable titles found.
get_genre_release_listing(genre) [async] — maps the genre name to a TMDb
numeric genre ID via the static GENRE_IDS dict, then calls TMDb's Discover
Movie API filtered by that genre ID and a primary_release_date range
covering the current year through next year. No LLM call. Returns a clear
message if the genre is unrecognized, TMDb returns zero results, or the
request fails.
resolve_genre_from_listing(listing_result_id) [sync] — loads a previously
stored release_listing result via database.py's get_result_with_script and
returns its stored script_text (the genre originally submitted for that
listing).
check_release_conflicts(genre, proposed_date, listing_text) [sync] — asks
the LLM to identify any competing releases within 2 weeks of the proposed
date.
check_conflicts_via_a2a(date_str) [async] — the actual A2A client call to
Agent 4: resolves its Agent Card via A2ACardResolver against
config.AGENT4_BASE_URL, sends the date as a text message via A2AClient, and
JSON-decodes the combined conflict report from the response. **This
function moved here from main.py** in the domain-driven refactor — main.py
now imports and calls it rather than implementing A2A client logic itself.
Used by both main.py's release_check confirmation flow and the Greenlight
Committee's gatekeeper_node below.

**Greenlight Committee worker functions** (all JSON-mode LLM calls, all
parsed via evaluator.py's `_parse_json_response` — the same robust
multi-strategy parser used for eval scoring, which tries raw `json.loads`,
then strips markdown code fences, then regex-extracts the first `{...}`
block from surrounding prose, so an occasional stray fence or preamble from
the LLM doesn't crash the graph):
check_compliance_structured(script_text) [sync] — same guideline retrieval
as check_compliance, but returns structured JSON (`hard_violations`,
`soft_violations`) instead of prose, for the gatekeeper_node's automated
rejection logic. Falls back to `{"hard_violations": [], "soft_violations":
[], "message": "Failed to parse compliance"}` on any parse failure.
generate_script_digest(script_text) [sync] — condenses the script into JSON
(`genre`, `tone`, `rating_relevant_content`, `marketable_hooks`). Falls back
to an object with empty `rating_relevant_content`/`marketable_hooks` lists
(rather than an object missing those keys entirely) on parse failure, so
downstream consumers — including the frontend's `GreenlightCommitteeResult`
component, which iterates these lists — never have to handle a missing
field, only an empty one.
producer_agent(script_digest, executive_rejections) [sync] — pitches the
script (JSON: `pitch_fields` with title_concept/strengths/
target_demographic/budget_tier/mitigation_plan/proposed_release_date, plus
`strategy`), incorporating any prior executive rejections into the pitch to
address them. Falls back to `{"pitch_fields": {}, "strategy": "Error
generating pitch"}` on parse failure.
executive_agent(script_digest, producer_pitch, compliance_data,
date_conflict_data) [sync] — evaluates the pitch against all gathered data
(JSON: `concern_list`, `is_approved`, `message`). Falls back to a rejection
verdict (`is_approved: False`) on parse failure, so a broken LLM response
never silently approves a script.

### app/ai/supervisor.py [async throughout]
Contains **two** LangGraph graphs, selected by run_supervisor based on task.

**The ordinary supervisor graph** (compliance / analyze / release_listing /
release_check):
SupervisorState — TypedDict with script_text, task, result.
route_node [async] — single routing function, branches on task: "compliance"
calls check_compliance directly (sync), "analyze" calls analyze_script
directly (sync), "release_listing" awaits get_genre_release_listing
(async), "release_check" splits script_text on "|" into proposed_date and a
listing result_id, loads the listing text via database.get_result, resolves
genre via agents.resolve_genre_from_listing, then calls
check_release_conflicts (sync).
build_supervisor — builds a single-node graph: route → END.

**The Greenlight Committee graph** (task == "greenlight" only) — a
multi-round LLM debate between a Producer and an Executive, arbitrated by a
deterministic (non-LLM) Mediator:
CommitteeState — TypedDict (total=False) carrying script_text,
script_digest, producer_pitch, executive_review, iteration_count,
final_verdict, compliance_data, date_conflict_data, previous_concerns,
result, trace.
digest_node [async] — calls generate_script_digest, appends a trace entry.
producer_node [async] — calls producer_agent, passing the previous
executive round's concern_list (if any) so the pitch addresses prior
objections; increments iteration_count.
gatekeeper_node [async] — runs two independent checks before the executive
ever sees the pitch: (1) check_compliance_structured against the script
(only computed once — cached in state so repeated committee rounds don't
re-run it), and (2) check_conflicts_via_a2a against the producer's
proposed_release_date (defaults to `"2026-12-25"` if the LLM didn't supply
one), also cached in state; any exception from the A2A call is caught and
degrades to an empty `{}` conflict report rather than failing the graph
(this is expected whenever Agent 4 / microservices/agent4_service.py isn't
running — see Setup requirements). If hard_violations were found, it
short-circuits straight to an auto-rejected executive_review and routes
directly to the mediator (skipping the executive round entirely).
route_after_gatekeeper — "stalemate_edge" (→ mediator) if the gatekeeper
already auto-rejected, else "executive_node".
executive_node [async] — calls executive_agent with the digest, pitch, and
both gatekeeper datasets; stores the previous round's concern_list as
previous_concerns before overwriting executive_review.
route_after_executive — approved → mediator_node. Otherwise: if the current
concern_list is identical to the previous round's (a stalemate) or
iteration_count has reached 3, → mediator_node; otherwise loops back to
producer_node for another pitch round.
mediator_node [async] — pure Python, no LLM call. Not approved → RED
("Needs Human Review"). Approved but a holiday conflict was flagged
anywhere in date_conflict_data → YELLOW ("Approved... but has severe Date
Conflicts"). Approved and clear → GREEN. Serializes
{digest, pitch, review, verdict, trace} as the JSON string stored as
`result` — this is what the frontend's GreenlightCommitteeResult component
parses and renders as the "Boardroom Chat" view.
build_greenlight_committee — digest_node → producer_node → gatekeeper_node
→ (conditional: executive_node or straight to mediator_node) →
(conditional from executive_node: mediator_node or back to producer_node)
→ mediator_node → END.

run_supervisor(script_text, task) [async] — if task == "greenlight", builds
and invokes the Greenlight Committee graph with `{"script_text":
script_text, "iteration_count": 0}` as initial state; otherwise builds and
invokes the ordinary supervisor graph as before. Both paths return a dict
containing `result`.

**CRITICAL:** any function agents.py calls that changes between sync and
async requires the calling node's `await` to be added or removed
accordingly, in *either* graph.

### app/ai/evaluator.py [synchronous]
_parse_json_response(text) — robust JSON extraction: tries json.loads
directly, then with markdown code fences (```json ... ``` or ``` ... ```)
stripped, then falls back to regex-extracting the first `{...}` block from
surrounding prose. Raises if none of these succeed, letting the caller's
try/except degrade gracefully. **Reused directly by app/ai/agents.py** for
every Greenlight Committee JSON call (check_compliance_structured,
generate_script_digest, producer_agent, executive_agent) rather than each
call site doing its own bare `json.loads` — this is the one shared JSON
parser for every JSON-mode LLM response in the codebase, evaluator or
agent.
score_faithfulness(script_text, agent_result) → EvalResult — asks the LLM
(temperature=0.0, JSON response mode) to judge whether the agent's answer
is grounded in the actual script, returns a 1-10 score with reasoning. The
entire LLM call and parse step is wrapped in one try/except: any failure
returns EvalResult(score=None, reasoning="Could not parse evaluation
response.") instead of raising — so an eval failure never crashes
/run-agent's main response.
score_context_precision(query, retrieved_chunks) → dict — same pattern,
asking the LLM to judge whether retrieved chunks were relevant to the
query. Defined but not currently called from any endpoint; wiring it in
requires agents.py to also return the chunks it retrieved, which it does
not currently do.

### app/main.py [FastAPI, async endpoints]
CORS middleware — currently wide open: `allow_origins=["*"]`,
`allow_methods=["*"]`, `allow_headers=["*"]`, with no `allow_credentials`.
This is a simplification from an earlier explicit-allowlist design (see
Known Limitations #5 for the tradeoff) — convenient for local development
against any frontend origin/port, but means any website can call this API
from a browser once it's deployed publicly, since there is no origin
restriction at all. **Before deploying this publicly, replace the wildcard
with an explicit allowlist** (the frontend's stable domain, plus an
`allow_origin_regex` for preview deployments if using Vercel).

`init_tables()` runs at module import time (not inside a FastAPI startup
event) — see database.py above.

A global exception handler (`@app.exception_handler(Exception)`) catches
any otherwise-unhandled exception, logs the full traceback via
resilience.logger, and returns a 500 with the exception message in
`detail` rather than crashing the worker or returning FastAPI's default
opaque error page.

require_api_key — a FastAPI dependency reading the `X-API-Key` header;
rejects with 403 if API_SECRET_KEY is unset/empty, if the header is
missing, or if it doesn't match (compared via secrets.compare_digest to
avoid timing attacks). Applied to POST /run-agent, POST /confirm-date,
POST /override-date, POST /check-conflicts, POST /finalize-calendar, POST
/ingest, and DELETE /document. GET endpoints (/health, /result/{id},
/result/{id}/download, /eval/summary, /eval/chart, /history/{session_id})
require no key.

COUNTRY_DISPLAY_NAMES — a display-name-only lookup (US, MX, GB, JP, DE by
default) used solely to label calendar events; it is not the authoritative
list of which countries are checked or get events. That role belongs to
config.py's SUPPORTED_COUNTRIES.

_create_calendar_event(summary, description, event_date) — the single
entry point main.py uses to create a calendar event. If CALENDAR_MODE is
`"mcp"`, it first tries calendar_mcp.create_calendar_event_via_mcp; if that
raises for any reason, it logs a warning and falls back to
calendar_service_account.create_event_via_service_account instead. If
CALENDAR_MODE is anything else (the default, `"service_account"`), it
calls the service-account backend directly without attempting MCP at all.

_collect_conflicting_dates / _nearest_clear_date /
_compute_recommended_dates / _create_events_from_dates — unchanged in
behavior from the original design: _compute_recommended_dates calls Agent 4
(via `agents.check_conflicts_via_a2a`, not an in-file A2A client anymore)
once for the combined conflict report, then for each configured country
computes either the original proposed date or a shifted date that clears
the nearest conflict; _create_events_from_dates is the only remaining code
path that actually creates calendar events, one per country.

POST /ingest — accepts a PDF upload, enforces MAX_UPLOAD_FILE_SIZE_MB,
extracts text inline via pypdf, passes to ingest.ingest_document. Requires
a valid API key.
GET /health — verifies database connectivity. No API key required. This is
also what the frontend's header status pill polls every 30 seconds.
DELETE /document — removes all chunks matching a given filename. Requires
a valid API key.
POST /run-agent — the main pipeline: check_rate_limit, log the call,
check_query_safety (min_length=1 for release_listing, else 10;
**check_toxicity is skipped entirely for `greenlight` and `analyze`
tasks** — deliberate, since realistic script content routinely contains
violence/profanity in dialogue or narrative that the toxicity heuristic
would otherwise misflag), memory_add (user turn), check cache, on a cache
hit return immediately; otherwise await run_supervisor (routes internally
to either graph — see supervisor.py), cache_set, save_result, memory_add
(assistant turn), and optionally score_faithfulness plus save_eval_record
if evaluate=true. For a `greenlight` result, the cached/stored/scored
`result` string is the Greenlight Committee's serialized JSON blob (digest,
pitch, review, verdict, trace) — score_faithfulness still runs against it
as plain text if evaluate=true, comparing the JSON blob to the source
script rather than a prose answer. Requires a valid API key.
GET /eval/summary — average faithfulness and context precision across all
evaluated runs. No API key required.
GET /eval/chart — a base64-encoded PNG chart of scores over time. No API
key required.
GET /result/{id} — returns a stored result's task and text. No API key
required.
GET /result/{id}/download — generates and returns a PDF of a result via
reportlab. For a `greenlight` result this embeds the raw JSON string as the
PDF body (no pretty-printing) — the polished view only exists in the
frontend's GreenlightCommitteeResult renderer. No API key required.
GET /history/{session_id} — returns stored conversation turns for a
session. No API key required.
POST /confirm-date/{id} — parses date|listing_id from the stored
release_check result's script_text, resolves genre via
agents.resolve_genre_from_listing, calls _compute_recommended_dates
followed immediately by _create_events_from_dates with no overrides,
creating real per-country calendar events for that date, shifted around any
conflicts Agent 4 reports. Requires a valid API key. Not rate-limited.
POST /override-date/{id} — same, but accepts a new_date form field to force
a different date than originally proposed. Requires a valid API key. Not
rate-limited.
POST /check-conflicts/{id} — the review half: parses date|listing_id the
same way, but only calls _compute_recommended_dates and returns the
conflict report plus each country's recommended date. Creates no calendar
events. Requires a valid API key and is rate-limited the same way
/run-agent is.
POST /finalize-calendar/{id} — the finalize half: accepts an optional JSON
body of per-country date overrides. Any override key not present in
config.SUPPORTED_COUNTRIES is rejected with a 400 before any event is
created. Otherwise resolves genre, recomputes recommended dates, overlays
the validated overrides, and calls _create_events_from_dates with the
merged map. Requires a valid API key and is rate-limited the same way as
/check-conflicts.

`release_check` and `greenlight` are the only two task types with a
post-generation action path: release_check's is the confirm/override or
check-conflicts/finalize-calendar calendar flow above; greenlight's
"action" is entirely contained within the graph itself (the Producer/
Executive/Mediator debate) — there is no separate confirm/approve endpoint
for a greenlight verdict, the RED/YELLOW/GREEN result is final once
/run-agent returns.

### frontend/ [Next.js 16 App Router, React 19, Tailwind 4]
A single-page dashboard that is the only client of main.py's API — it calls
the backend directly from the browser (via CORS) rather than through a
Next.js API route/proxy.

frontend/lib/api.ts — every backend call lives in this one file: typed
wrappers (checkHealth, runAgent, confirmDate, overrideDate, checkConflicts,
finalizeCalendar, ingestDocument, deleteDocument, getResult,
downloadResult, getHistory, getEvalSummary, getEvalChart) plus the
request-mirroring TypeScript types (`TaskType` includes `"greenlight"`,
AgentResponse, ConflictReport, DateConfirmationResponse,
ConflictCheckResponse, etc.). A single `request<T>` helper attaches
`X-API-Key` (from NEXT_PUBLIC_API_KEY) when a call is marked `authed`,
reads NEXT_PUBLIC_API_URL as the backend base URL, and normalizes both
network failures and non-OK responses into a thrown `ApiError` carrying the
HTTP status and a message extracted from the response body's
`detail`/`error` field.

frontend/app/page.tsx — the entire UI: a tab bar (Agents, Documents,
History & Results, Insights) plus a health-check pill in the header that
polls GET /health every 30s.
- AgentsPanel — task picker (compliance / analyze / release_listing /
  release_check / **greenlight**) with the matching input for each task,
  runs POST /run-agent, and:
  - for `greenlight` results, renders `GreenlightCommitteeResult` — parses
    the stored result string as JSON (`digest`, `pitch`, `review`,
    `verdict`, `trace`) and renders it as a "Boardroom Chat": a processing
    trace, a Script Dossier card (genre/tone/hooks), a Producer Pitch card,
    an Executive Memo card (with concern list if revisions were
    requested), and a final RED/YELLOW/GREEN "Studio Stamp" verdict card.
    Falls back to rendering the raw string if JSON.parse fails or any of
    the four top-level keys is missing. `digest.marketable_hooks` is
    accessed defensively (`digest.marketable_hooks ?? []`) since the
    backend can — on an LLM parse failure — return a digest object without
    that key populated.
  - for release_check results, offers both the one-click path (Confirm
    Proposed Date → /confirm-date, or an override date → /override-date)
    and the review path (Check Holiday & Event Conflicts →
    /check-conflicts, shows ConflictFindings and an editable per-country
    date list seeded from recommended_dates, then Confirm & Create
    Calendar Events → /finalize-calendar with only the user-edited entries
    sent as overrides).
- DocumentsPanel — PDF upload (POST /ingest) and delete-by-filename
  (DELETE /document).
- HistoryPanel — loads a session's stored turns (GET /history/{id}) and
  looks up/downloads a stored result by ID (GET /result/{id}, GET
  /result/{id}/download).
- InsightsPanel — GET /eval/summary and GET /eval/chart (rendered as a
  base64 PNG `<img>`), with a manual refresh button.

Environment: frontend/.env.local (local) or Vercel's project environment
variables (deployed) set NEXT_PUBLIC_API_URL (the FastAPI base URL —
`http://localhost:8000` locally) and NEXT_PUBLIC_API_KEY (must match
main.py's API_SECRET_KEY). Both are Next.js "public" env vars, so they are
inlined into the client-side JS bundle at build time — see Known
Limitations.

---

## The agents

1. compliance — self-querying RAG against the "guidelines" collection,
   cites the specific matched guideline in its report.
2. analyze — direct structural analysis plus RAG against the "past_films"
   collection, produces a Pass/Consider/Recommend verdict.
3. release_check — a two-step flow: release_listing fetches upcoming genre
   releases directly from the TMDb API and stores the genre used;
   release_check takes only a date and a reference to that listing,
   resolves the genre automatically, and flags potential date conflicts
   against the listing. On confirm/override or check-conflicts/
   finalize-calendar, main.py creates one real Google Calendar event per
   country, each shifted around whatever holiday, sporting-event, or
   awards-ceremony conflicts Agent 4 reports for that country and date.
4. **greenlight — the Greenlight Committee.** A self-contained LangGraph
   debate, distinct from the other three: a Producer agent pitches the
   script (re-pitching up to twice more if rejected), an Executive agent
   evaluates each pitch against a compliance check and an Agent 4 date-
   conflict check, and a deterministic Mediator (no LLM call) issues a
   final RED (rejected / stalemate / 3 rounds exhausted) / YELLOW (approved
   but a date conflict exists) / GREEN (approved and clear) verdict. Runs
   through `/run-agent` like every other task, but via its own graph
   (`build_greenlight_committee` in supervisor.py) rather than the shared
   single-node supervisor graph the other four tasks use.
5. Agent 4 (release-date conflict checker) — a standalone service,
   deployed independently, reachable only via A2A, not routed through
   either LangGraph graph directly (it's called *from* both the
   release_check flow and the greenlight flow, but isn't a graph node
   itself). Given a date, it reports holiday conflicts across whichever
   countries config.py's SUPPORTED_COUNTRIES configures, plus conflicts
   with major sporting events and major awards ceremonies, all combined
   into one report from a single A2A call.

---

## Data flow, end to end

**compliance / analyze / release_listing / release_check:**
```
main.py receives a request
  → require_api_key validates the X-API-Key header (sensitive endpoints only)
  → guardrails.py validates input
  → database.py checked for a cached answer
  → supervisor.py's ordinary graph routes to the correct agents.py function
      → agents.py calls llm.py for generation, retrieval.py for search
      → retrieval.py calls database.py for dense+keyword search
      → (release_listing only) agents.py calls the TMDb API directly
      → (release_check only) agents.py resolves genre from the stored
        release_listing result via database.py
  → database.py stores the result and updates the cache
  → (release_check only, on confirm/override or check-conflicts/
    finalize-calendar) main.py calls Agent 4 over A2A for a combined
    conflict report, computes each country's (possibly shifted) date, then
    calls calendar_mcp.py or calendar_service_account.py (per
    CALENDAR_MODE, with fallback) to create each country's real calendar
    event
```

**greenlight:**
```
main.py receives a request
  → require_api_key, guardrails.py (toxicity check skipped), cache check
  → supervisor.py's build_greenlight_committee graph runs:
      digest_node    → agents.generate_script_digest (LLM, JSON mode)
      producer_node  → agents.producer_agent (LLM, JSON mode)
      gatekeeper_node → agents.check_compliance_structured (LLM + RAG)
                        AND agents.check_conflicts_via_a2a (A2A → Agent 4,
                        over the network, separately deployed/running)
      executive_node → agents.executive_agent (LLM, JSON mode)
      [loop back to producer_node up to 2 more times if rejected and not
       a stalemate]
      mediator_node  → pure Python verdict logic, no LLM call
  → database.py stores the result (the serialized committee JSON) and
    updates the cache
  → frontend renders it via GreenlightCommitteeResult as a Boardroom Chat
```

---

## Deployment
Three independent services, connected purely through environment
variables and CORS — no shared filesystem or process between them. (The
CORS configuration currently in main.py is wide open — `allow_origins=["*"]`
— see Known Limitations before relying on this section's original
allowlist-based design for a public deployment.)

**Render — backend (`app/main.py`)**
Build command: `pip install -r requirements.txt` (run from `backend/`).
Start command: `uvicorn app.main:app --host 0.0.0.0 --port $PORT` — note
the `app.main:app` module path (not `main:app`), since main.py now lives at
`backend/app/main.py` and imports everything via the `app.` package prefix.
Holds every environment variable listed under Setup requirements below,
plus AGENT4_BASE_URL pointed at Agent 4's real deployed URL and
GOOGLE_SERVICE_ACCOUNT_JSON pointed at Render's Secret File path.

**Render — Agent 4 (`microservices/agent4_service.py`)**
Build command: same, `pip install -r requirements.txt`. Start command:
`uvicorn microservices.agent4_service:app --host 0.0.0.0 --port $PORT`
(run from `backend/`) — deliberately different from `python
agent4_service.py`, because that file's own `if __name__ == "__main__":`
block reads a separate AGENT4_PORT variable that doesn't receive Render's
`$PORT` substitution; invoking uvicorn directly against the module's `app`
object bypasses that block entirely. Needs its own copy of the same
environment variables (since it imports config.py, which loads all of them
at once) and its own copy of the GOOGLE_SERVICE_ACCOUNT_JSON Secret File.
It does need its own AGENT4_PUBLIC_URL, set to this service's own real
deployed URL — this populates the `url` field on the A2A Agent Card it
serves. Both AGENT4_BASE_URL and AGENT4_PUBLIC_URL must be set for A2A
calls to succeed end to end.

**Connecting the two Render services:** deploy Agent 4 first (or update
this after either deploys), copy its assigned Render URL, then set the
backend service's AGENT4_BASE_URL to that exact URL and Agent 4's own
AGENT4_PUBLIC_URL to the same URL, letting both redeploy. Until both are
set correctly, /confirm-date, /override-date, /check-conflicts,
/finalize-calendar, **and the greenlight task's gatekeeper_node** will fail
to reach Agent 4 even though both services are individually healthy — for
greenlight this failure is caught and silently degrades to an empty
conflict report (see supervisor.py above), so a misconfigured
AGENT4_BASE_URL won't crash a greenlight run, it will just make every
verdict blind to date conflicts (never YELLOW, only GREEN or RED).

**Vercel — frontend**
Root Directory must be set to `frontend`. Environment variables:
NEXT_PUBLIC_API_URL set to the backend Render service's URL,
NEXT_PUBLIC_API_KEY matching API_SECRET_KEY.

**CORS is the one place all three services must agree** — see the
Known Limitations note on the current wildcard CORS config before
deploying.

---

## Known limitations
1. Database access is synchronous (psycopg2) inside async FastAPI
   endpoints, which serializes database calls under concurrent load.
   Scaling this would require migrating database.py to asyncpg.
2. score_context_precision is implemented but not wired into any endpoint;
   doing so requires agents.py to also return retrieved chunks alongside
   its text answer.
3. MAX_SCRIPT_TEXT_LENGTH is defined in config.py but not currently
   enforced against incoming script_text.
4. Agent 3's release-listing step reads TMDb's first results page only (no
   pagination beyond ~20 films) and does not include per-film studio data.
5. **CORS currently allows every origin** (`allow_origins=["*"]`, all
   methods/headers). This is fine for local development but is a real
   exposure once the backend is deployed publicly: any website's
   client-side JS can call every unauthenticated GET endpoint
   (/health, /result/{id}, /result/{id}/download, /eval/summary,
   /eval/chart, /history/{session_id}), and the API key check on the
   mutating endpoints is the only remaining line of defense for those.
   Replace with an explicit allowlist (plus an `allow_origin_regex` for
   Vercel preview URLs if applicable) before a public deploy.
6. The calendar-event fallback covers exactly one failure path: MCP
   failing over to the service-account backend. There is no further
   fallback.
7. Agent 4's hardcoded sporting-event and awards-ceremony date tables only
   cover years with an officially announced date at the time they were
   written; they require periodic manual updates.
8. The per-country date-shift logic (_nearest_clear_date) shifts once,
   toward whichever single conflicting date is nearest the proposed date.
   It does not re-check whether the shifted date now falls inside a
   different conflict's window.
9. Confirming or overriding a date consults Agent 4 fresh each time, but
   neither /confirm-date nor /override-date is rate-limited the way
   /run-agent is. /check-conflicts and /finalize-calendar are rate-limited.
10. check_content_toxicity is a heuristic (second-person marker + profanity
    co-occurrence), not a semantic classifier — see guardrails.py above.
    It's bypassed entirely for `greenlight` and `analyze` tasks by design.
11. INJECTION_PATTERNS remains a finite literal-phrase list; novel
    injection phrasings not on the list still get through undetected.
12. The Gemini API's free/low tiers can cap generate_content requests per
    project; once exhausted, calls fail with a 429 RESOURCE_EXHAUSTED
    error, which llm.py's generate_text does not retry (its retry logic
    only covers 503/UNAVAILABLE). Callers using safe_generate
    (check_compliance) or a full try/except (evaluator.py, retrieval.py's
    gemini_rerank, and — as of the Greenlight Committee — every function
    in agents.py that calls _parse_json_response) degrade gracefully;
    analyze_script's direct generate_text calls do not.
13. /finalize-calendar recomputes recommended dates itself rather than
    reusing whatever /check-conflicts returned earlier, so if Agent 4's
    underlying data changes between the two calls, the actually-created
    event dates could differ slightly from what was reviewed.
14. A country added to SUPPORTED_COUNTRIES beyond the default 5 will have
    its calendar events labeled with its raw country code unless a
    friendlier name is also added to main.py's COUNTRY_DISPLAY_NAMES.
15. NEXT_PUBLIC_API_KEY is a Next.js "public" env var, so it is inlined
    into the client-side JS bundle and visible to anyone who opens the
    deployed frontend's dev tools — a genuine credential-exposure risk on
    a public deployment. Combined with #5's wildcard CORS, a publicly
    deployed instance currently has weaker request-origin protection than
    the API-key check alone might suggest.
16. The two Render services and the Supabase database each have
    independent free-tier behavior (e.g. cold starts after inactivity),
    not something the application code accounts for or surfaces to the
    user.
17. The Greenlight Committee's gatekeeper_node defaults to
    `proposed_release_date = "2026-12-25"` if the Producer's LLM response
    didn't include one (missing key or failed JSON parse) — a run can
    silently conflict-check the wrong date rather than surfacing that the
    Producer's output was incomplete.
18. The committee's stalemate detection (`route_after_executive`) compares
    the current round's `concern_list` to the previous round's as Python
    sets of strings — if the Executive rephrases the same underlying
    concern even slightly between rounds, it won't be recognized as a
    stalemate and the debate will run the full 3 iterations instead of
    stopping early.
19. `backend/app/integrations/calendar_mcp.py` resolves its OAuth
    credentials file relative to its own directory
    (`backend/app/integrations/gcp-credentials.json`), which is easy to
    confuse with a `gcp-credentials.json` placed at the repo root — MCP
    calendar mode will fail to find credentials if the file is only
    present at the root.

---

## Setup requirements for a fresh environment
1. A Supabase (or any Postgres) project with the pgvector extension
   available.
2. A root-level `.env` file with: GEMINI_API_KEY, DATABASE_URL,
   SHARED_CALENDAR_ID, TMDB_API_KEY, CALENDAR_MODE (`"mcp"` or
   `"service_account"`, default `"service_account"` if unset),
   API_SECRET_KEY. Optionally CHAT_MODEL, EMBEDDING_MODEL,
   SUPPORTED_COUNTRIES (comma-separated, default `US,MX,GB,JP,DE` — set
   identically for both the main backend and agent4_service.py, since each
   process reads it independently from config.py).
3. At least one of the two calendar backends set up — see
   calendar_service_account.py / calendar_mcp.py above and Known
   Limitation #19 for the credentials-file path gotcha.
4. From `backend/`, run `python -c "from app.data.database import
   init_tables; init_tables()"` (or simply start the app once — main.py
   calls this at import time) to create all tables and enable RLS.
5. To run Agent 4 (required for /confirm-date, /override-date,
   /check-conflicts, /finalize-calendar, **and for the greenlight task's
   date-conflict check** to work), start it as its own process from
   `backend/`: `python microservices/agent4_service.py` (or `uvicorn
   microservices.agent4_service:app --port 8001`). Without it running
   locally, greenlight runs still complete — the gatekeeper_node's A2A
   call fails and is caught, degrading to no date-conflict data — but a
   verdict can then never come back YELLOW, and release_check's
   confirm/override/check-conflicts/finalize-calendar endpoints will fail
   outright.
6. To run the backend itself: from `backend/`, `pip install -r
   requirements.txt` then `uvicorn app.main:app --reload --port 8000`.
   Confirm `requirements.txt` is plain UTF-8 before installing — a file
   regenerated via PowerShell's `pip freeze > requirements.txt` on Windows
   is written as UTF-16 by default, which `pip install -r` cannot parse.
7. To run the frontend: `npm install` inside frontend/, then a
   frontend/.env.local with NEXT_PUBLIC_API_URL (`http://localhost:8000`)
   and NEXT_PUBLIC_API_KEY (matching API_SECRET_KEY), then `npm run dev`
   — serves on `http://localhost:3000`. If the dev server or type-checker
   behaves oddly after a crash/interrupted run, delete `frontend/.next`
   (pure build cache, safe to delete, regenerates automatically) before
   investigating further — this is especially worth doing if the project
   directory is synced by OneDrive/Dropbox/etc., since background syncing
   can corrupt files that are being actively written mid-build.
8. Run `pip freeze > requirements.txt` (from `backend/`, in a POSIX shell
   or with explicit UTF-8 output) before deploying to Render — check it
   for Windows-only packages (e.g. `pywin32`) if generated on Windows,
   since Render's Linux build environment cannot install them.
