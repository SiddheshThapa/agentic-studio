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
cache, memory, results, evaluation history, and (as of the client/developer
split) user accounts. Row Level Security is enabled on every table.
Sensitive endpoints require a shared-secret API key; a second, independent
layer — a login session cookie carrying a `developer`/`client` role — gates
the admin-only surface (`/admin/tables/*`, `/auth/users*`) on top of that.
Calendar events can be created through either of two independent backends,
with automatic fallback between them.

**Two** Next.js apps consume this backend — `frontend/apps/client` (the
working pipelines: running agents including the Greenlight Committee's
"Boardroom Chat" view, uploading/deleting reference documents, browsing
history/results, the release-date confirmation flow, the evaluation
dashboard) and `frontend/apps/admin` (everything client has, plus the raw
database browser, a technical request/response log, and user-account
management) — sharing one buildless source folder (`frontend/packages/
core`) rather than duplicating code between them. Neither talks to the
FastAPI backend directly from the browser: each proxies every call through
its own Next.js server route, which is also where the shared API key and
the browser's session cookie actually meet the backend. The system is
designed to be deployed as **four** independent services — two on Render
(the FastAPI backend and Agent 4) and two on Vercel (one frontend
deployment per app) — connected entirely through environment variables,
not shared infrastructure. CORS between the frontends and the backend is
no longer load-bearing for this topology (see Deployment) since the
browser only ever talks to its own origin.

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
JWT_SECRET_KEY (signs the login session cookie, see app/core/auth.py below;
falls back to API_SECRET_KEY so there isn't a second required secret to
provision — set it explicitly only if the two should ever need to rotate
independently).

### schemas.py
TaskType (Enum: compliance, analyze, release_listing, release_check,
**greenlight**). AgentResponse (Pydantic model: result_id, task, result,
from_cache, eval). EvalResult (Pydantic model: score, reasoning).

### app/data/database.py [synchronous, psycopg2]
Connections are pooled, not opened per query: `get_pool()` lazily builds a
module-level `psycopg2.pool.ThreadedConnectionPool` (`DB_POOL_MIN`-`DB_POOL_MAX`,
default 1-10) on first use — building it at import time would make importing
this module fail whenever the database is unreachable, taking the whole API
down instead of just the endpoints that need data. `_create_pool` is
retry-wrapped via `app/core/resilience.py`'s `with_retry`. The `connection()`
context manager borrows a pooled connection and always returns it (discarding
and retrying once if the server closed it while idle); code must never call
`.close()` on what it yields, since that destroys the connection instead of
returning it to the pool. There is no `get_connection()` anymore. Four
helpers built on `connection()` — `_fetch_all`, `_fetch_one`, `_execute`,
`_execute_returning` — are what nearly every function below actually calls,
replacing what used to be repeated open-cursor/execute/fetch/commit/close
boilerplate in each one.
init_tables — creates all 6 tables (documents, cache, memory,
results, eval_history, users) and enables Row Level Security on all 6. **Called at
import time in main.py** (module-level `init_tables()`, not inside a
startup event), so simply importing `app.main` — or starting uvicorn against
it — attempts a live DB connection immediately; an unreachable DATABASE_URL
fails the whole process before it can serve `/health`.
insert_document, search_similar, get_all_documents_for_bm25, bm25_search,
delete_documents_by_filename, cache_get (24h TTL via SQL INTERVAL),
cache_set, memory_add, memory_get, save_result, get_result,
get_result_with_script, save_eval_record, get_eval_summary,
generate_eval_chart (uses matplotlib, imported at top of file).
create_user, get_user_by_email, get_user_by_id, list_users, count_developers,
update_user_role, delete_user — the only functions that touch the `users`
table (see app/core/auth.py below). `get_user_by_id` returns `(id, email,
role)` and exists specifically so `require_role` can re-check a session's
role against the live DB row rather than trusting the JWT claim.
`count_developers` backs `main.py::_refuse_if_last_developer`, which blocks
demoting/deleting the last developer account. Deliberately not exposed
through `ADMIN_TABLES`/the generic admin browser: that browser casts every
column to text for `?q=` search and returns whole rows, which is fine for
`cache`/`results` but wrong for a table holding `password_hash`/`salt`.

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
on database.py's `_create_pool` (the connection pool builder, not a
per-query connection anymore — see app/data/database.py above).
check_rate_limit — in-memory per-key request tracker, used on
/run-agent, /check-conflicts, /finalize-calendar (per session), and
/auth/login (per source IP and, independently, per email — see
"Login sessions" below).
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

### app/core/auth.py
Login sessions: password hashing, the session JWT, and the role gate. Added
alongside the client/developer frontend split (see the frontend section
below) — this is what makes `/admin/tables/*` and `/auth/users*` visible only
to a `developer`-role session, distinct from the `X-API-Key` shared secret
that gates every mutating endpoint regardless of who's logged in.
hash_password(password, salt=None) → (hash, salt) — PBKDF2-HMAC-SHA256,
390,000 iterations (OWASP's 2024 minimum), a fresh random salt
(`secrets.token_hex(16)`) per call unless one is supplied for verification.
verify_password(password, hash, salt) — recomputes and compares via
`secrets.compare_digest` (timing-safe, same pattern as `require_api_key`).
create_session_token(user_id, email, role) — signs a JWT (PyJWT) with
`{sub, email, role, exp}`, 12-hour expiry, using `config.JWT_SECRET_KEY`
(falls back to `API_SECRET_KEY` if unset, so there isn't a second required
secret to provision unless the two should rotate independently).
decode_session_token(token) — verifies and decodes; returns `None` rather
than raising on any `PyJWTError` (expired, tampered, wrong signature), so
callers can treat "no session" and "bad session" identically.
get_current_user(session=Cookie(...)) — FastAPI dependency reading the
`session` cookie; `None` if absent or invalid, never raises. Used directly by
`GET /auth/me` (which turns `None` into a 401 itself) and indirectly by
require_role below.
require_role(*roles) — returns a FastAPI dependency: 401 if not logged in,
401 if the session's user id no longer resolves to a row in `users`
(deleted account), 403 if the *current* DB role isn't in `roles`, otherwise
returns the JWT's decoded fields merged with that freshly-read role. It
calls `get_user_by_id` on every invocation instead of trusting the JWT's
`role` claim, so a demotion or deletion takes effect immediately rather than
waiting out the 12h session — the JWT claim is only a snapshot from login
time. Used exactly like `Depends(require_api_key)`, and stacked *with* it
(not instead of it) on `/admin/tables/*` — see main.py below.

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
/ingest, and DELETE /document — and, stacked with require_role("developer"),
all six /admin/tables/* routes. GET endpoints (/health, /result/{id},
/result/{id}/download, /eval/summary, /eval/chart, /history/{session_id})
require no key.

**Login endpoints** (app/core/auth.py does the actual work; see above):
POST /auth/login — rate-limited before anything else runs: 429 past 20
requests/60s for the caller's source IP, and independently 429 past 5
requests/60s for the submitted email (both via `resilience.check_rate_limit`,
so both are in-process and reset on restart). Then verifies email+password
against the users table (get_user_by_email + verify_password), issues a
session JWT (create_session_token) as an httpOnly, SameSite=Lax cookie, 12h
expiry. Returns {email, role}. No API key or existing session required —
this is how a session is created in the first place.
POST /auth/logout — clears the session cookie. Returns {ok: true}.
GET /auth/me — returns {email, role} from the current session cookie, or
401 if there isn't one. This is what both frontends poll once on load to
decide between rendering LoginForm and the app shell.
GET /auth/users, POST /auth/users, PATCH /auth/users/{id}, DELETE
/auth/users/{id} — developer-only (require_role("developer")), no API key
needed on top since these aren't part of the API-key-gated surface. List
returns {id, email, role, created_at} per user, password hashes never
included in any response. POST validates role ∈ {developer, client} and
returns 400 on a duplicate email (unique constraint on `users.email`).
PATCH validates the same role enum. Both PATCH (when demoting away from
`developer`) and DELETE first call `_refuse_if_last_developer`, which uses
`count_developers()` to return 400 rather than let the only remaining
developer account be demoted or deleted — without that guard the app locks
every `/admin/*` and `/auth/users` route with no way back short of direct DB
access and re-running `seed_admin.py`. There is no self-service password
change or reset endpoint — an account's password can currently only be set
at creation time.

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

### frontend/ [Next.js 16 App Router, React 19, Tailwind 4 — two apps]
As of the client/developer split, `frontend/` holds **two** independent
Next.js apps (`apps/client`, `apps/admin`) plus a shared, buildless source
folder (`packages/core`) neither of them installs as a package — each app's
`tsconfig.json` path-maps `@/lib/*` and `@/components/*` straight into it.
Full mechanical detail (why it isn't an npm workspace, why Turbopack's
`root` has to point two directories up, why `packages/core` carries its own
tiny `package.json`) lives in `frontend/packages/core/README.md`; this
section covers what each app is *for*.

**Neither app calls main.py's API directly from the browser anymore.** Both
proxy every call through their own same-origin `app/api/proxy/[...path]/
route.ts` (a two-line re-export of `packages/core/lib/proxy.ts`), which runs
on the Next.js server, attaches `X-API-Key` from a server-only
`BACKEND_API_KEY` env var, and streams the backend's response — including
`Set-Cookie` — straight back. This is what keeps the API key out of the
browser (previously `NEXT_PUBLIC_API_KEY`, inlined into the client JS
bundle — see the old Known Limitation #15, now resolved) and what lets the
session cookie set by `/auth/login` stay same-origin for the browser even
though the FastAPI backend runs on a different port entirely. From CORS's
perspective, the browser never leaves its own origin; the proxy's call to
the backend is server-to-server and isn't subject to browser CORS at all.

packages/core/lib/api.ts — every backend call lives in this one file: typed
wrappers (checkHealth, runAgent, confirmDate, overrideDate, checkConflicts,
finalizeCalendar, ingestDocument, deleteDocument, getResult,
downloadResult, getHistory, getEvalSummary, getEvalChart, plus login,
logout, getCurrentUser, listAdminUsers, createAdminUser,
updateAdminUserRole, deleteAdminUser for the auth/users surface) plus the
request-mirroring TypeScript types (`TaskType` includes `"greenlight"`,
AgentResponse, ConflictReport, DateConfirmationResponse,
ConflictCheckResponse, SessionUser, AdminUser, etc.). A single `request<T>`
helper calls the same-origin proxy (`API_URL = "/api/proxy"`) and normalizes
both network failures and non-OK responses into a thrown `ApiError`
carrying the HTTP status and a message extracted from the response body's
`detail`/`error` field. The `authed` flag `liveRequest` still accepts on
every call site is now vestigial — the proxy attaches `X-API-Key`
unconditionally — kept rather than touching the ~15 call sites that pass it.

packages/core/lib/session.ts — `useSession(demo)`: checks `GET /auth/me`
once on mount (async IIFE + cancelled guard, not a bare effect setState),
returns `{checked, user, refresh}`. Under Demo Mode it never calls the
network at all, returning a synthetic `{email: "demo@studio.example", role:
"developer"}` instead — consistent with Demo Mode's existing rule that
nothing reaches the network, applied to login rather than adding fixtures
for a system that isn't the point of a demo.

**apps/client/app/page.tsx** — Start here, Documents, Agents, Release
Planner, History, Insights. Gated on `useSession`: not logged in renders
`LoginForm` (shared, `packages/core/components/LoginForm.tsx`); logged in
renders the tab shell exactly as before, plus a Sign out button.
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

**apps/admin/app/page.tsx** — everything apps/client has, plus:
- DatabasePanel/DatabaseEditor — the admin table browser UI (see Admin
  table browser above), gated server-side by `require_role("developer")`
  even if someone points a client-role session's cookie at these routes
  directly.
- ApiLogPanel — the technical request/response drawer (see Client-side
  features in PROJECT_GUIDE.md).
- UsersPanel — create accounts, change role, remove access, calling the
  `/auth/users*` routes. No signup flow anywhere in either app; the first
  account comes from `backend/seed_admin.py`.
Gated the same way as apps/client, plus a second check: a successfully
logged-in session with `role !== "developer"` sees a plain "this account
doesn't have developer access" screen with sign-out, rather than the app
shell — the backend would refuse the admin routes anyway, but the UI says
so immediately instead of surfacing 403s per-request.

Environment: each app has its own `.env.local`. `BACKEND_API_URL` (default
`http://localhost:8000`) and `BACKEND_API_KEY` (must match main.py's
API_SECRET_KEY) are read only by the proxy route, server-side — no
`NEXT_PUBLIC_` prefix, so neither is ever inlined into the browser bundle.

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
Four independent services (two on Render, two on Vercel — see System
Overview above), connected purely through environment variables — no
shared filesystem or process between them. (The
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

**Vercel — two frontend deployments, not one**
Since the client/developer split, `frontend/` is two independent Next.js
apps and needs two separate Vercel projects (or two deploy targets on
whatever host): Root Directory `frontend/apps/client` for one, `frontend/
apps/admin` for the other. Each needs its own environment variables:
`BACKEND_API_URL` set to the backend Render service's URL, `BACKEND_API_KEY`
matching `API_SECRET_KEY` — **not** prefixed `NEXT_PUBLIC_`, since these are
read only by each app's own `app/api/proxy/[...path]/route.ts` on the
server, never by browser code. A `frontend/.vercel` project link created
before the split points at the old single-app layout and needs to be
recreated (or repointed) as two projects.

**CORS no longer needs an entry per frontend deployment.** Because both
apps proxy through their own Next.js server rather than calling main.py
directly from the browser, the backend only ever sees server-to-server
requests from them — not subject to CORS. The wildcard CORS config
(`allow_origins=["*"]`) below is about any *other*, direct browser client;
see the Known Limitations note before deploying if one is ever added.

---

## Known limitations
1. Database access is synchronous (psycopg2) inside async FastAPI
   endpoints, which serializes database calls under concurrent load.
   Scaling this would require migrating database.py to asyncpg.
2. **Resolved.** `score_context_precision` was never wired into any
   endpoint. It has since been deleted along with the
   `eval_history.context_precision_score` column and the frontend tile
   that always showed `—` for it (see PROJECT_GUIDE.md's Dead code
   section).
3. **Resolved.** `MAX_SCRIPT_TEXT_LENGTH` was defined in config.py but
   never enforced against incoming `script_text`. It, along with
   `CACHE_TTL_HOURS`, `RATE_LIMIT_MAX_REQUESTS`, and
   `RATE_LIMIT_WINDOW_SECONDS` (same problem — declared, never imported),
   has since been deleted from config.py.
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
15. **Resolved.** NEXT_PUBLIC_API_KEY used to be a Next.js "public" env
    var inlined into the client-side JS bundle. Both frontend apps now
    proxy every backend call through their own server-side route
    (`app/api/proxy/[...path]/route.ts`), which attaches the key from a
    server-only `BACKEND_API_KEY` instead — the browser never receives it.
    Combined with #5's wildcard CORS, though: an unauthenticated read
    endpoint is still reachable from any origin, since CORS and the API
    key are independent protections and only the latter changed here.
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
20. `POST /auth/login` rate-limits per source IP (20/60s) and per submitted
    email (5/60s) via the same in-process `check_rate_limit` tracker used
    on `/run-agent` — so, like that one, the counters reset on restart and
    aren't shared across worker processes. Acceptable for a small internal
    deployment; a multi-worker or multi-instance production deployment
    would need a shared store (Redis or similar) for this to hold across
    all of them.
21. There is no password reset or self-service password change. Changing
    a password currently means a developer deleting the account and
    recreating it (which issues a new one), since `PATCH /auth/users/{id}`
    only accepts a `role` change.
22. The session JWT is stateless and has no general server-side revocation
    list, but it is not entirely unchecked either: `require_role` (used by
    every `/admin/tables/*` and `/auth/users*` route) re-reads the user's
    row via `get_user_by_id` on each call, so deleting or demoting an
    account through `DELETE`/`PATCH /auth/users/{id}` takes effect on those
    routes immediately, not after a 12h wait. The gap is narrower than it
    used to be: `GET /auth/me` and anything else that depends only on
    `get_current_user` (decode-only, no DB lookup) still treats a deleted
    account's still-valid JWT as logged in until it expires naturally.
23. `frontend/packages/core/lib/proxy.ts` forwards every request header
    (minus `host`/`content-length`) to the backend, including whatever a
    client sends — this is fine today since Next.js's own server is the
    only caller, but it means the proxy trusts the backend to validate
    everything the browser could have put in a header, rather than
    stripping to an allowlist.

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
7. Create the first login: from `backend/`, `python seed_admin.py
   you@studio.com` (prompts for a password, ≥ 8 characters), which creates
   a `developer`-role account. Every account after that is created from
   the developer app's Users tab — there is no signup page.
8. To run each frontend app — **repeat for both** `frontend/apps/client`
   and `frontend/apps/admin`, they are independent installs: `npm install`
   inside the app directory, then an `.env.local` in that same directory
   with `BACKEND_API_URL` (`http://localhost:8000`) and `BACKEND_API_KEY`
   (matching `API_SECRET_KEY` — **not** `NEXT_PUBLIC_`-prefixed, this one
   is read only by the app's own proxy route, server-side), then `npm run
   dev` — client serves on `http://localhost:3000`, admin on
   `http://localhost:3001` (`-p 3001` is baked into `apps/admin/package
   .json`'s `dev`/`start` scripts). If a dev server or type-checker
   behaves oddly after a crash/interrupted run, delete that app's own
   `.next` (pure build cache, safe to delete, regenerates automatically)
   before investigating further — this is especially worth doing if the
   project directory is synced by OneDrive/Dropbox/etc., since background
   syncing can corrupt files that are being actively written mid-build.
9. Run `pip freeze > requirements.txt` (from `backend/`, in a POSIX shell
   or with explicit UTF-8 output) before deploying to Render — check it
   for Windows-only packages (e.g. `pywin32`) if generated on Windows,
   since Render's Linux build environment cannot install them.
