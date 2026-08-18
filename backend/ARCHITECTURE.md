# Agentic Studio — Architecture

## System Overview
A studio operations backend with 3 task-specific agents orchestrated by a
LangGraph supervisor, plus a 4th standalone agent reachable only via the
A2A protocol, exposed via FastAPI. Postgres+pgvector (Supabase) is the
single persistent store for all data: documents, cache, memory, results,
and evaluation history. Row Level Security is enabled on every table.
Sensitive endpoints require a shared-secret API key. Calendar events can
be created through either of two independent backends, with automatic
fallback between them. A Next.js single-page frontend (`frontend/`)
consumes the FastAPI backend directly over CORS-enabled HTTP and covers
every endpoint: running agents, uploading/deleting reference documents,
browsing history/results, the two-path release-date confirmation flow,
and the evaluation dashboard.

---

## Files and responsibilities

### config.py
Environment settings: GEMINI_API_KEY, DATABASE_URL, TMDB_API_KEY,
CHAT_MODEL (default `"gemini-2.5-flash-lite"`) and EMBEDDING_MODEL
(default `"gemini-embedding-001"`) — the Gemini model names llm.py calls,
overridable without a code change if a newer/different model needs
swapping in, MAX_SCRIPT_TEXT_LENGTH, MAX_UPLOAD_FILE_SIZE_MB,
CACHE_TTL_HOURS, RATE_LIMIT_MAX_REQUESTS, RATE_LIMIT_WINDOW_SECONDS,
AGENT4_BASE_URL, CALENDAR_MODE (`"mcp"` or `"service_account"`, default
`"service_account"`), GOOGLE_SERVICE_ACCOUNT_JSON (path to a service
account credentials file), API_SECRET_KEY (shared secret required on
sensitive endpoints), SUPPORTED_COUNTRIES (list of country codes,
parsed from a comma-separated `SUPPORTED_COUNTRIES` env var, stripped
and uppercased, default `["US", "MX", "GB", "JP", "DE"]` — the single
source of truth for which countries Agent 4 checks and which countries
get a calendar event; both agent4_service.py and main.py read this same
list, so adding or removing a country is a one-line env change, not a
code edit in either file).

### schemas.py
TaskType (Enum: compliance, analyze, release_listing, release_check).
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
embed_text — embeds via config.py's EMBEDDING_MODEL (default
gemini-embedding-001), 768 dimensions, retry loop with exponential
backoff, raises on empty input.
generate_text — generates via config.py's CHAT_MODEL (default
gemini-2.5-flash-lite), retry loop, retries specifically on
503/UNAVAILABLE errors, returns a fallback message if retries exhaust.
Accepts optional temperature (default 0.2, used by most callers) and
response_json (default False); when response_json=True, sets Gemini's
native JSON response mode (response_mime_type="application/json"),
which returns clean JSON without markdown code-fence wrapping — used by
evaluator.py's eval functions.

### resilience.py
with_retry — decorator for automatic retry with exponential backoff, used
on database.py's get_connection.
check_rate_limit — in-memory per-session request tracker, used on
/run-agent only.
logger — shared Python logging instance, used across main.py, including
to log calendar-backend fallback warnings.
safe_generate — wraps an LLM call, returns a fallback message on failure
instead of raising; used in agents.py's check_compliance.

### guardrails.py
check_query_safety — rejects empty/too-short (configurable minimum
length, default 10 characters) input, input flagged by
check_content_toxicity, and input matching a known prompt-injection
phrase. Before matching against INJECTION_PATTERNS, input is normalized
(whitespace collapsed via `" ".join(text.lower().split())`) so extra or
irregular whitespace and casing don't bypass detection.
INJECTION_PATTERNS — a literal-phrase list (e.g. "ignore previous
instructions", "forget everything above", "new instructions:", "act as
if", "bypass your rules") matched by exact substring against the
normalized input.
check_content_toxicity — flags direct abuse/harassment aimed at the
system without an LLM call. Splits input into sentences (on `.`, `!`,
`?`); a sentence is flagged only if it contains both a second-person
direct-address marker (DIRECT_ADDRESS_MARKERS: "you", "your", "you're",
"youre", "yourself", "u" — matched after stripping surrounding
punctuation from each token) and profane/abusive language per the
better-profanity library (profanity.contains_profanity). This
co-occurrence requirement is deliberate: it lets ordinary script content
containing profanity or violence in first-/third-person narrative or
dialogue pass through unflagged (the app's core use case), while still
catching direct second-person abuse ("f*** you", "you are stupid").
It is a heuristic, not a semantic classifier — it can flag in-fiction
second-person dialogue between characters (false positive) and miss
abuse using words outside better-profanity's word list, e.g. mild
insults like "useless" or "idiot" (false negative); see Known
Limitations.
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
release-listing step fetches structured data directly from the TMDb API
(see agents.py) instead of scraping a webpage.

### calendar_mcp.py [async, real MCP protocol]
create_calendar_event_via_mcp — connects to the @cocal/google-calendar-mcp
server via a stdio subprocess using the real MCP client protocol, calls
its create-event tool with start/end fields. Loads its own environment
via load_dotenv() independently. Requires a gcp-credentials.json file
(OAuth client credentials) in the project root and SHARED_CALENDAR_ID.
Requires a one-time interactive authorization
(`npx @cocal/google-calendar-mcp auth`) to be run once per machine before
first use; this saves a reusable token locally. Raises on any failure
(missing credentials file, expired/missing token, subprocess/auth
errors) — it does not handle its own failures; the caller in main.py is
responsible for that.

### calendar_service_account.py [async]
create_event_via_service_account — creates a calendar event using a
Google service account (google-api-python-client +
google.oauth2.service_account.Credentials), authenticating with the
service account key file at GOOGLE_SERVICE_ACCOUNT_JSON and writing to
SHARED_CALENDAR_ID via the Calendar API's events.insert. No interactive
auth step is required — the service account must instead be shared on
SHARED_CALENDAR_ID with write ("Make changes to events") permission
ahead of time. The underlying googleapiclient call is synchronous; it
runs inside asyncio.to_thread so it doesn't block the event loop. Same
input/output signature as calendar_mcp.py's function (summary,
description, event date in, an event link/id string out), so the two
are interchangeable.

### agent4_service.py [async, standalone FastAPI + real A2A protocol]
A separate process (its own uvicorn entry point, port from AGENT4_PORT,
default 8001) exposing one A2A skill that checks a proposed date against
three conflict categories and returns them combined in a single report:
- check_country_holidays — for each country in config.py's
  SUPPORTED_COUNTRIES (default US, MX, GB, JP, DE; configurable via the
  SUPPORTED_COUNTRIES env var, no code change needed), queries the free
  Nager.Date public holidays API for the relevant year(s) and reports
  whether a holiday falls within 3 days of the given date. A failure
  fetching one country's data is isolated and reported as that
  country's status being `"unknown"`, without affecting the other
  countries. Agent4_service.py imports SUPPORTED_COUNTRIES directly from
  config.py rather than reading its own env var, which also means it now
  picks up `.env` values via config.py's `load_dotenv()` call (it has no
  dotenv loading of its own otherwise — see AGENT4_PORT below, which is
  unaffected and still reads its own env var directly).
- check_global_event_conflicts — checks a date against a hardcoded
  `{year: date}` table of known event dates (used for both sporting
  events and awards ceremonies), returning the nearest occurrence's
  name, date, whether it falls within the conflict window, and how many
  days away it is.
- SPORTING_EVENTS covers the Super Bowl and FIFA World Cup final;
  AWARDS_EVENTS covers the Oscars, Golden Globes, and Grammy Awards —
  each a hardcoded table of publicly announced dates for the years
  currently known, requiring periodic manual updates as further years
  are announced.
- check_all_conflicts combines all three into one report:
  `{"holidays": {...per-country...}, "sporting_events": [...],
  "awards_ceremonies": [...]}`.
- HolidayCheckExecutor (the A2A AgentExecutor) parses the incoming
  message as a date string, calls check_all_conflicts, and returns the
  combined report as a single JSON-encoded text message — one A2A skill,
  one call, one combined response; there is no per-category skill or
  endpoint.
Agent 4 is reachable only via A2A, not as an in-process function call —
main.py talks to it as a separate service over the network. It is not
part of the LangGraph supervisor graph; it is invoked only from
main.py's calendar-confirmation flow.

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
resolve_genre_from_listing(listing_result_id) [sync] — loads a
previously stored release_listing result via database.py's
get_result_with_script and returns its stored script_text (the genre
that was originally submitted for that listing), so a genre never needs
to be supplied a second time by the caller.
check_release_conflicts(genre, proposed_date, listing_text) [sync] — no
I/O of its own; takes a genre, a proposed date, and a previously fetched
listing_text (the output of get_genre_release_listing, retrieved via
database.py's get_result), and asks the LLM to identify any competing
releases within 2 weeks of the proposed date.

### supervisor.py [async throughout]
SupervisorState — TypedDict with script_text, task, result.
route_node [async] — single routing function, branches on task:
"compliance" calls check_compliance directly (no await, sync function),
"analyze" calls analyze_script directly (no await, sync function),
"release_listing" awaits get_genre_release_listing (async, no LLM call),
"release_check" splits script_text on "|" into proposed_date and a
listing result_id only, loads the listing text via database.py's
get_result, resolves genre from the referenced listing result via
agents.py's resolve_genre_from_listing, then calls
check_release_conflicts directly (no await, sync function).
build_supervisor — builds a single-node graph: route → END.
run_supervisor [async] — invokes the graph via graph.ainvoke(...).

CRITICAL: any function agents.py calls that changes between sync and
async requires route_node's call to that function to be updated
accordingly (add or remove await).

### evaluator.py [synchronous]
_parse_json_response(text) — robust JSON extraction used by both eval
functions below: tries json.loads directly, then with markdown code
fences (```json ... ``` or ``` ... ```) stripped, then falls back to
regex-extracting the first `{...}` block from surrounding prose. Raises
if none of these succeed, letting the caller's try/except degrade
gracefully.
score_faithfulness(script_text, agent_result) → EvalResult — asks the LLM
(temperature=0.0, JSON response mode via llm.py's response_json=True) to
judge whether the agent's answer is grounded in the actual script,
returns a 1-10 score with reasoning. The entire LLM call and parse step
is wrapped in one try/except: any failure (LLM error, rate limit, or
unparseable response) returns EvalResult(score=None, reasoning="Could
not parse evaluation response.") instead of raising — so an eval failure
never crashes /run-agent's main response.
score_context_precision(query, retrieved_chunks) → dict — same pattern
(temperature=0.0, JSON response mode, fully wrapped try/except) asking
the LLM to judge whether retrieved chunks were relevant to the query.
Defined but not currently called from any endpoint; wiring it in
requires agents.py to also return the chunks it retrieved, which it does
not currently do.

### main.py [FastAPI, async endpoints]
CORS middleware — allow_origins restricted to `http://localhost:3000`
(the frontend's dev origin), all methods and headers allowed; required
because frontend/lib/api.ts calls this API directly from the browser.

require_api_key — a FastAPI dependency reading the `X-API-Key` header;
rejects with 403 if API_SECRET_KEY is unset/empty, if the header is
missing, or if it doesn't match (compared via secrets.compare_digest to
avoid timing attacks). Applied to POST /run-agent, POST /confirm-date,
POST /override-date, POST /check-conflicts, POST /finalize-calendar,
POST /ingest, and DELETE /document. GET endpoints (/health,
/result/{id}, /result/{id}/download, /eval/summary, /eval/chart,
/history/{session_id}) require no key.

COUNTRY_DISPLAY_NAMES — a display-name-only lookup (US, MX, GB, JP, DE
by default) used solely to label calendar events; it is not the
authoritative list of which countries are checked or get events. That
role belongs to config.py's SUPPORTED_COUNTRIES. A country configured in
SUPPORTED_COUNTRIES without an entry in COUNTRY_DISPLAY_NAMES still gets
a fully working calendar event — its label just falls back to the raw
country code (e.g. `"Horror — CA"`) until a friendlier name is added.

_create_calendar_event(summary, description, event_date) — the single
entry point main.py uses to create a calendar event. If CALENDAR_MODE is
`"mcp"`, it first tries calendar_mcp.py's create_calendar_event_via_mcp;
if that raises for any reason (missing OAuth credentials file, missing
saved token, subprocess/auth error, or any other failure), it logs a
warning and falls back to calendar_service_account.py's
create_event_via_service_account instead. If CALENDAR_MODE is anything
else (the default, `"service_account"`), it calls the service-account
backend directly without attempting MCP at all. Either way, the caller
always gets an event created through whichever backend actually works —
an MCP misconfiguration alone never fails the request.

_check_conflicts_via_a2a(date_str) — sends the date to Agent 4 over A2A
(via AGENT4_BASE_URL) and returns its combined
holidays/sporting_events/awards_ceremonies report.

_collect_conflicting_dates(country_code, conflict_report) — for a given
country, gathers every conflicting reference date relevant to it: that
country's holiday date (if flagged), plus every sporting-event and
awards-ceremony date flagged as conflicting anywhere in the report
(these are global — a Super Bowl or Oscars conflict applies to every
country's event, not just one).

_nearest_clear_date(proposed_date, conflict_date) — shifts the proposed
date forward or backward (whichever is closer) by just enough days to
clear the given conflicting date.

_compute_recommended_dates(proposed_date_str) — the read-only half of
what used to be _create_country_events. Calls Agent 4 once for the
combined conflict report, then for each country in
config.SUPPORTED_COUNTRIES: collects that country's conflicting dates
(holiday + any global sporting/awards conflicts), and if any exist,
shifts to the date nearest to the proposed date that clears the closest
one; otherwise keeps the original date. Returns
`(conflict_report, recommended_dates)` — no calendar events are created.

_create_events_from_dates(genre, description, country_dates) — the
side-effecting half. Takes an already-decided `{country_code: date_str}`
map (recommended dates, overridden dates, or a mix) and creates one
calendar event per entry via _create_calendar_event, labeled with
COUNTRY_DISPLAY_NAMES.get(code, code). This is the only remaining code
path that reaches calendar_mcp.py / calendar_service_account.py.

POST /ingest — accepts a PDF upload, enforces MAX_UPLOAD_FILE_SIZE_MB,
extracts text inline via pypdf, passes to ingest.ingest_document.
Requires a valid API key.
GET /health — verifies database connectivity. No API key required.
DELETE /document — removes all chunks matching a given filename.
Requires a valid API key.
POST /run-agent — the main pipeline: check_rate_limit, log the call,
check_query_safety, memory_add (user turn), check cache, on a cache hit
return immediately; otherwise await run_supervisor, cache_set, save_result,
memory_add (assistant turn), and optionally score_faithfulness plus
save_eval_record if evaluate=true. Rate-limit and safety failures raise
HTTPException rather than returning bare error dicts, since the endpoint
declares response_model=AgentResponse. Requires a valid API key.
GET /eval/summary — average faithfulness and context precision across all
evaluated runs. No API key required.
GET /eval/chart — a base64-encoded PNG chart of scores over time. No API
key required.
GET /result/{id} — returns a stored result's task and text. No API key
required.
GET /result/{id}/download — generates and returns a PDF of a result via
reportlab. No API key required.
GET /history/{session_id} — returns stored conversation turns for a
session. No API key required.
POST /confirm-date/{id} — parses date|listing_id from the stored
release_check result's script_text, resolves genre from the referenced
listing result via agents.py's resolve_genre_from_listing, calls
_compute_recommended_dates followed immediately by
_create_events_from_dates with no overrides, creating real per-country
calendar events for that date, shifted around any conflicts Agent 4
reports. Response and one-call behavior are unchanged from before the
review/finalize split below — this endpoint is unaffected by it except
internally. Requires a valid API key. Not rate-limited.
POST /override-date/{id} — same, but accepts a new_date form field to
force a different date than originally proposed, regardless of
conflicts reported for that original date (Agent 4 is still consulted
for the new date, and per-country shifts still apply to it). Requires a
valid API key. Not rate-limited.
POST /check-conflicts/{id} — the review half of the same computation:
parses date|listing_id the same way, but only calls
_compute_recommended_dates and returns the conflict report plus each
country's recommended date. Creates no calendar events. Requires a
valid API key and is rate-limited the same way /run-agent is (via
resilience.check_rate_limit, keyed by an optional `session_id` query
parameter, default `"default"`).
POST /finalize-calendar/{id} — the finalize half: accepts an optional
JSON body of per-country date overrides (e.g. `{"US": "2026-12-30"}`).
Any override key not present in config.SUPPORTED_COUNTRIES is rejected
with a 400 listing the currently configured supported codes, before any
event is created. Otherwise resolves genre, recomputes recommended dates
via _compute_recommended_dates, overlays the validated overrides onto
them, and calls _create_events_from_dates with the merged map. Requires
a valid API key and is rate-limited the same way /check-conflicts is.

There is no approve/reject/redirect workflow anywhere in this project.
Agent 1 (compliance) and Agent 2 (analyze) results are generated and
immediately viewable/downloadable, with no gating step. Only Agent 3
(release_check) has a post-generation action. The one-click path
(/confirm-date, /override-date) is still binary and still always
creates calendar events immediately, exactly as before. A second,
optional path now also exists for anyone who wants to review Agent 4's
findings first: POST /check-conflicts returns the conflict report and
each country's recommended date with no calendar events created, then a
separate POST /finalize-calendar — optionally overriding specific
countries' dates — is the step that actually creates them. Both paths
end up calling the same underlying helpers and produce calendar events
adjusted around whatever conflicts Agent 4 reports for each country.

### frontend/ [Next.js 16 App Router, React 19, Tailwind 4]
A single-page dashboard that is the only client of main.py's API — it
calls the backend directly from the browser (via CORS) rather than
through a Next.js API route/proxy.

frontend/lib/api.ts — every backend call lives in this one file: typed
wrappers (checkHealth, runAgent, confirmDate, overrideDate,
checkConflicts, finalizeCalendar, ingestDocument, deleteDocument,
getResult, downloadResult, getHistory, getEvalSummary, getEvalChart)
plus the request-mirroring TypeScript types (AgentResponse,
ConflictReport, DateConfirmationResponse, ConflictCheckResponse, etc.).
A single `request<T>` helper attaches `X-API-Key` (from
NEXT_PUBLIC_API_KEY) when a call is marked `authed`, reads
NEXT_PUBLIC_API_URL as the backend base URL, and normalizes both
network failures and non-OK responses into a thrown `ApiError` carrying
the HTTP status and a message extracted from the response body's
`detail`/`error` field.

frontend/app/page.tsx — the entire UI: a tab bar (Agents, Documents,
History & Results, Insights) plus a health-check pill in the header that
polls GET /health every 30s.
- AgentsPanel — task picker (compliance / analyze / release_listing /
  release_check) with the matching input for each task, runs
  POST /run-agent, and for release_check results, offers both the
  one-click path (Confirm Proposed Date → /confirm-date, or an override
  date → /override-date) and the review path (Check Holiday & Event
  Conflicts → /check-conflicts, shows ConflictFindings and an editable
  per-country date list seeded from recommended_dates, then Confirm &
  Create Calendar Events → /finalize-calendar with only the
  user-edited entries sent as overrides).
- DocumentsPanel — PDF upload (POST /ingest) and delete-by-filename
  (DELETE /document).
- HistoryPanel — loads a session's stored turns (GET /history/{id}) and
  looks up/downloads a stored result by ID (GET /result/{id},
  GET /result/{id}/download).
- InsightsPanel — GET /eval/summary and GET /eval/chart (rendered as a
  base64 PNG `<img>`), with a manual refresh button.

Environment: frontend/.env.local sets NEXT_PUBLIC_API_URL (the FastAPI
base URL, e.g. `http://localhost:8000`) and NEXT_PUBLIC_API_KEY (must
match main.py's API_SECRET_KEY). Both are Next.js "public" env vars, so
they are inlined into the client-side JS bundle at build time — see
Known Limitations for what this means for the API key.

---

## The agents

1. compliance — self-querying RAG against the "guidelines" collection,
   cites the specific matched guideline in its report.
2. analyze — direct structural analysis plus RAG against the "past_films"
   collection, produces a Pass/Consider/Recommend verdict.
3. release_check — a two-step flow: release_listing fetches upcoming
   genre releases directly from the TMDb API and stores the genre used;
   release_check takes only a date and a reference to that listing,
   resolves the genre automatically, and flags potential date conflicts
   against the listing. On confirm/override, main.py creates one real
   Google Calendar event per country (via calendar_mcp.py or
   calendar_service_account.py, per CALENDAR_MODE, with automatic
   fallback between them), each shifted around whatever holiday,
   sporting-event, or awards-ceremony conflicts Agent 4 reports for that
   country and date.
4. Agent 4 (release-date conflict checker) — a standalone service,
   reachable only via A2A, not routed through the LangGraph supervisor.
   Given a date, it reports holiday conflicts across whichever countries
   config.py's SUPPORTED_COUNTRIES configures (default US, MX, GB, JP,
   DE), plus conflicts with major sporting events and major awards
   ceremonies, all combined into one report from a single A2A call.
   Invoked by main.py's confirm/override-date flow (once per confirmed
   or overridden date) and by the check-conflicts/finalize-calendar
   review flow (once per check-conflicts call, and again internally
   when finalize-calendar recomputes recommended dates).

---

## Data flow, end to end
main.py receives a request
  → require_api_key validates the X-API-Key header (sensitive endpoints
    only)
  → guardrails.py validates input
  → database.py checked for a cached answer
  → supervisor.py routes to the correct agents.py function
      → agents.py calls llm.py for generation, retrieval.py for search
      → retrieval.py calls database.py for dense+keyword search
      → (release_listing only) agents.py calls the TMDb API directly
      → (release_check only) agents.py resolves genre from the stored
        release_listing result via database.py
  → database.py stores the result and updates the cache
  → (release_check only, on confirm/override) main.py calls Agent 4 over
    A2A for a combined conflict report, computes each country's
    (possibly shifted) date, then calls calendar_mcp.py or
    calendar_service_account.py (per CALENDAR_MODE, with fallback) to
    create each country's real calendar event

---

## Known limitations
1. Database access is synchronous (psycopg2) inside async FastAPI
   endpoints, which serializes database calls under concurrent load.
   Scaling this would require migrating database.py to asyncpg.
2. score_context_precision is implemented but not wired into any
   endpoint; doing so requires agents.py to also return retrieved chunks
   alongside its text answer.
3. MAX_SCRIPT_TEXT_LENGTH is defined in config.py but not currently
   enforced against incoming script_text.
4. Agent 3's release-listing step reads TMDb's first results page only
   (no pagination beyond ~20 films) and does not include per-film studio
   data, since that requires a separate TMDb movie-details call per film.
5. The API key check protects the 7 mutating/costly endpoints
   (/run-agent, /confirm-date, /override-date, /check-conflicts,
   /finalize-calendar, /ingest, DELETE /document) only. Read-only
   endpoints — /health, /result/{id}, /result/{id}/download,
   /eval/summary, /eval/chart, /history/{session_id} — remain fully open
   to anyone who can reach the server; this is an intentional scope
   boundary, not an oversight, but means stored results and conversation
   history are readable without a key if the server is publicly
   reachable.
6. The calendar-event fallback covers exactly one failure path: MCP
   failing over to the service-account backend. There is no further
   fallback — if CALENDAR_MODE is `"service_account"` (the default) and
   that backend itself fails, or if the service-account fallback fails
   after an MCP failure, the request still fails.
7. Agent 4's hardcoded sporting-event and awards-ceremony date tables
   only cover years with an officially announced date at the time they
   were written; they require periodic manual updates as further years'
   events are scheduled. The holiday-check country list no longer shares
   this maintenance burden — it's configurable via SUPPORTED_COUNTRIES,
   not hardcoded.
8. The per-country date-shift logic (_nearest_clear_date) shifts once,
   toward whichever single conflicting date is nearest the proposed
   date. It does not re-check whether the shifted date now falls inside
   a different conflict's window — if a country's date conflicts with
   both a holiday and a global sporting/awards event, only the nearer of
   the two is guaranteed to be cleared by the shift.
9. Confirming or overriding a date consults Agent 4 fresh each time, but
   neither /confirm-date nor /override-date is rate-limited the way
   /run-agent is — repeated calls are unrestricted beyond the API key
   check. /check-conflicts and /finalize-calendar are rate-limited the
   same way /run-agent is; this limitation applies only to the original
   one-click endpoints, which were intentionally left unchanged.
10. check_content_toxicity is a heuristic (second-person marker +
    profanity co-occurrence), not a semantic classifier: it can flag
    legitimate in-fiction second-person dialogue between script
    characters as toxic (false positive), and it cannot catch abuse
    phrased with words outside better-profanity's word list, e.g. mild
    insults like "useless" or "idiot" that aren't recognized as profanity
    (false negative). This trade-off is intentional — an LLM-based
    semantic check would catch more cases but adds cost/latency to every
    request, which check_query_safety cannot afford.
11. INJECTION_PATTERNS remains a finite literal-phrase list; novel
    injection phrasings not on the list still get through undetected.
12. The Gemini free tier caps gemini-2.5-flash-lite at 20
    generate_content requests per day per project. This affects every
    LLM call in the app (compliance, analyze, release-check, ingestion
    classification, retrieval reranking, eval scoring) — once exhausted,
    calls fail with a 429 RESOURCE_EXHAUSTED error, which llm.py's
    generate_text does not retry (its retry logic only covers
    503/UNAVAILABLE); a 429 propagates as an exception to the caller.
    Callers using safe_generate (check_compliance) or a full
    try/except around the whole call (evaluator.py's eval functions,
    retrieval.py's gemini_rerank) degrade gracefully; others (e.g.
    analyze_script's direct generate_text calls) do not.
13. /finalize-calendar recomputes recommended dates itself rather than
    reusing whatever /check-conflicts returned earlier, so if Agent 4's
    underlying data changes between the two calls (an updated hardcoded
    sporting/awards date, or a different Nager.Date response), the
    actually-created event dates could differ slightly from what was
    reviewed. In practice Agent 4's data sources are effectively static
    per date, so this is expected to be rare.
14. A country added to SUPPORTED_COUNTRIES beyond the default 5 (US, MX,
    GB, JP, DE) will have its calendar events labeled with its raw
    country code (e.g. `"Horror — CA"`) unless a friendlier name is also
    added to main.py's COUNTRY_DISPLAY_NAMES — the system functions
    correctly either way, this only affects the event's display label.
15. NEXT_PUBLIC_API_KEY is a Next.js "public" env var, so it is inlined
    into the client-side JS bundle and visible to anyone who opens the
    deployed frontend's dev tools. This is a real credential-exposure
    risk for anything beyond local development against `localhost:3000`
    — deploying the frontend publicly as-is would leak API_SECRET_KEY to
    every visitor. Mitigating this would require proxying authenticated
    calls through a Next.js server route (or a separate backend-for-
    frontend) that holds the key server-side instead.
16. CORS on main.py is currently locked to `http://localhost:3000` only;
    deploying the frontend to any other origin requires updating
    `allow_origins` in main.py's CORSMiddleware setup.

---

## Setup requirements for a fresh environment
1. A Supabase (or any Postgres) project with the pgvector extension
   available.
2. A .env file with: GEMINI_API_KEY, DATABASE_URL, SHARED_CALENDAR_ID,
   TMDB_API_KEY (a free API key from themoviedb.org, used by Agent 3's
   release-listing step), CALENDAR_MODE (`"mcp"` or `"service_account"`,
   default `"service_account"` if unset), API_SECRET_KEY (a shared
   secret; every request to /run-agent, /confirm-date, /override-date,
   /check-conflicts, /finalize-calendar, /ingest, and DELETE /document
   must send it as the `X-API-Key` header — leaving this unset rejects
   all requests to those endpoints). Optionally, SUPPORTED_COUNTRIES (a
   comma-separated list of country codes, default `US,MX,GB,JP,DE`) to
   change which countries Agent 4 checks and which countries get
   calendar events — set it identically for both main.py and
   agent4_service.py, since each process reads it independently from
   config.py.
3. At least one of the two calendar backends set up (both may be set up
   at once, since CALENDAR_MODE selects between them and MCP falls back
   to the service account automatically on failure):
   - **Service account path** (default): a Google Cloud service account
     with its JSON key downloaded, referenced by
     GOOGLE_SERVICE_ACCOUNT_JSON in .env, with that service account's
     email shared on SHARED_CALENDAR_ID with "Make changes to events"
     permission. No interactive login needed.
   - **MCP/OAuth path**: Node.js/npx installed; a Google Cloud project
     with the Calendar API enabled and Desktop app OAuth credentials
     downloaded as JSON, saved as gcp-credentials.json in the project
     root; one-time only, run `npx @cocal/google-calendar-mcp auth` and
     complete the browser sign-in to save a reusable local token.
4. Run `python -c "from database import init_tables; init_tables()"` (or
   simply start the app once) to create all tables and enable RLS.
5. To run Agent 4 (required for /confirm-date, /override-date,
   /check-conflicts, and /finalize-calendar to work), start
   agent4_service.py as its own process, separately from main.py; it
   listens on AGENT4_PORT (default 8001), matching the AGENT4_BASE_URL
   main.py uses to reach it.
6. To run the frontend: `npm install` inside frontend/, then a
   frontend/.env.local with NEXT_PUBLIC_API_URL (main.py's base URL,
   e.g. `http://localhost:8000`) and NEXT_PUBLIC_API_KEY (matching
   main.py's API_SECRET_KEY), then `npm run dev` — it serves on
   `http://localhost:3000` by default, which is the only origin main.py's
   CORS policy currently allows.
