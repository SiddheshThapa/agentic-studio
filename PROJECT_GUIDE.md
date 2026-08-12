# Agentic Studio — Project Guide

A ground-up technical guide written by auditing the source. Every claim below points at the file it came from. Anything that could not be determined from the codebase is marked **Unknown / not found in codebase**.

---

## Changes — August 2026

For teammates returning to the project. Each item is covered in detail in its own section below.

**Correctness**

- `release_check` no longer asks an LLM to find nearby dates. The listing is generated data with known dates in it, so the comparison is now arithmetic in `agents.py::check_release_conflicts` — about 0.025 ms instead of seconds, free, deterministic, and unable to invent a film that was never in the list.
- The retrieval confidence gate had a real bug: a failed reranker wrote `hybrid_score` (0.0–1.0) into `rerank_score`, which could never clear the 5.0 threshold. **Every reranker outage was reported to users as "no relevant guidelines found."** Replaced by `guardrails.retrieval_status`, which distinguishes `empty` / `unscored` / `low_relevance` / `confident`.
- `supervisor.py` was fetching the same database row twice for `release_check` (once for the film list, once for the genre — they are two columns of one row).
- `memory_get` now orders by `created_at DESC, id DESC`. Both turns of a run share a transaction timestamp, and without the `id` tiebreaker replies could sort before their questions.

**Performance** — `/run-agent` (`release_check`): **16.9 s → 3.2 s**, measured as the median of 8 runs.

| Change | Effect |
|---|---|
| Connection pool (`ThreadedConnectionPool`) | Connecting cost ~2.4 s **per query**; now paid once |
| 7 database round trips → 3 | Duplicate row fetch removed; 4 writes merged into one CTE statement |

None of that came from changing the AI. The logic was already 0.025 ms; the time was connection setup.

**Housekeeping**

- `requirements.txt` regenerated from a 103-pin `pip freeze` to 21 direct dependencies.
- Dead code deleted — see [Dead code](#dead-code-removed-august-2026). Requires a manual `ALTER TABLE` on existing databases.
- Frontend rewritten for first-time users: a "Start here" tab, a guided four-step Release Planner replacing the hidden result-ID handoff, and per-task explanations of what each agent needs and returns. Split from one 980-line `page.tsx` into `components/` plus `lib/content.ts`.
- First tests in the repo: `test_release_conflicts.py`, 15 checks, no framework needed.

**Known-unfixed** issues are listed in `ARCHITECTURE.md` under Known limitations — most importantly `bm25_search` rebuilding its index from every row on every query, and `ingest.py` classifying per chunk rather than per document.

---

## Project Overview

Agentic Studio is an **AI operations platform for a film studio**. It exposes four distinct agent tasks over a FastAPI HTTP API, with a Next.js web console on top, backed by a Postgres + `pgvector` database.

The four tasks are defined in `schemas.py` as `TaskType` and dispatched in `supervisor.py::route_node`:

| Task value | What it actually does | Implemented in |
|---|---|---|
| `compliance` | LLM flags sensitive moments in a script excerpt, then RAG-retrieves matching studio guideline chunks and writes a cited compliance report | `agents.py::check_compliance` |
| `analyze` | LLM produces logline / pacing score / character-clarity score, retrieves comparable past films, then issues a **Pass / Consider / Recommend** greenlight call | `agents.py::analyze_script` |
| `release_listing` | Queries TMDB Discover for upcoming films in a genre across the current and next calendar year | `agents.py::get_genre_release_listing` |
| `release_check` | Given `YYYY-MM-DD\|<listing_result_id>`, reports by **date arithmetic** (no LLM) which films in that stored listing release within 14 days of the proposed date | `agents.py::check_release_conflicts` ||| `release_check` | Given `YYYY-MM-DD\|<listing_result_id>`, reports by **date arithmetic** (no LLM) which films in that stored listing release within 14 days of the proposed date | `agents.py::check_release_conflicts` |

Layered on top of `release_check` is a **release-date scheduling workflow** (`main.py`): a separate A2A-protocol microservice (`agent4_service.py`) checks the proposed date against public holidays in each supported country plus hardcoded major sporting and awards events; `main.py` shifts conflicting dates to the nearest clear day per country, lets a human review and edit each country's date, then writes the final dates into a shared Google Calendar.

The problem it solves, as implemented: **deciding whether a script is compliant and viable, and when to release it in each territory without colliding with a national holiday, the Super Bowl, or the Oscars** — with the resulting dates written to a real calendar.

---

## Tech Stack and Key Dependencies

### Backend (Python)

Dependencies come from `requirements.txt` (note: that file is **UTF-16 encoded**, see Troubleshooting). Only the libraries actually imported by project code are listed here:

| Library | Version pinned | Used for | Imported in |
|---|---|---|---|
| `fastapi` | `0.140.0` | HTTP API framework | `main.py` |
| `uvicorn` | `0.51.0` | ASGI server | `agent4_service.py`, run command |
| `langgraph` | `1.2.9` | Single-node `StateGraph` that routes tasks | `supervisor.py` |
| `google-genai` | `2.14.0` | Gemini chat + embeddings client | `llm.py` |
| `psycopg2-binary` | `2.9.12` | Postgres driver | `database.py` |
| `a2a-sdk` | `0.3.26` | Agent-to-Agent protocol, client and server | `main.py`, `agent4_service.py` |
| `mcp` | `2.0.0` | MCP stdio client for the calendar server | `calendar_mcp.py` |
| `google-api-python-client` | `2.198.0` | Google Calendar v3 API | `calendar_service_account.py` |
| `rank-bm25` | `0.2.2` | BM25 lexical retrieval half of hybrid search | `database.py::bm25_search` |
| `numpy` | `2.2.6` | Score normalization in hybrid search | `retrieval.py` |
| `pypdf` | `6.14.2` | Extract text from uploaded PDFs | `main.py` |
| `reportlab` | `5.0.0` | Generate downloadable result PDFs | `main.py` |
| `matplotlib` | `3.10.9` | Render the eval-score trend chart (`Agg` backend) | `database.py` |
| `better-profanity` | `0.7.0` | Toxicity guardrail | `guardrails.py` |
| `httpx` | `0.28.1` | TMDB, Nager.Date, A2A transport | `agents.py`, `agent4_service.py` |
| `python-dotenv` | `1.2.2` | `.env` loading | `config.py`, `llm.py`, `database.py`, `calendar_mcp.py` |
| `pydantic` | `2.13.4` | Response models | `schemas.py` |
| `python-multipart` | `0.0.32` | Form/multipart parsing for FastAPI | required by `Form(...)`/`File(...)` in `main.py` |

Note: `requirements.txt` was regenerated from a `pip freeze` (103 pins) down to direct dependencies only. `langchain`, `langsmith`, `asyncpg`, `requests`, `lxml`, `PyJWT`, `beautifulsoup4` and the rest of the never-imported pins were removed; transitive dependencies are left to pip.

### Frontend (TypeScript)

From `frontend/package.json`:

- `next` `16.2.12` (App Router — `frontend/app/`)
- `react` / `react-dom` `19.2.4`
- `tailwindcss` `^4` via `@tailwindcss/postcss`
- `typescript` `^5`, `eslint` `^9` + `eslint-config-next`

### External services

- **Google Gemini API** — chat + embeddings (`llm.py`)
- **Supabase / any Postgres with `pgvector`** — vector store and all persistence (`database.py`)
- **TMDB (themoviedb.org)** — upcoming-release data (`agents.py`)
- **Nager.Date** (`https://date.nager.at/api/v3/publicholidays`) — public holidays; **no API key required**, called anonymously (`agent4_service.py`)
- **Google Calendar API** — event creation (`calendar_service_account.py` or `calendar_mcp.py`)

---

## Architecture

### Process topology

Three processes must run for the full feature set:

```
┌────────────────────┐        ┌──────────────────────┐
│ frontend (Next.js) │ HTTP   │  main.py (FastAPI)   │
│  :3000             ├───────►│  :8000               │
└────────────────────┘  +API  └──────┬───────────────┘
                        key           │
                                      │ A2A protocol (httpx)
                                      ▼
                             ┌──────────────────────┐
                             │ agent4_service.py    │
                             │  :8001  (A2A server) │
                             └──────┬───────────────┘
                                    │ HTTPS
                                    ▼  date.nager.at
        main.py also calls: Gemini · TMDB · Google Calendar · Postgres
```

`main.py` and `agent4_service.py` each import `config.py` independently, so `SUPPORTED_COUNTRIES` must be set identically in both processes' environments.

### Request flow: `POST /run-agent`

Traced through `main.py::run_agent_endpoint`:

1. **Rate limit** — `resilience.py::check_rate_limit(session_id)`, in-process dict, 10 requests / 60 s. Exceeded → `429`.
2. **Guardrails** — `guardrails.py::check_query_safety`: minimum length (1 for `release_listing`, else 10), profanity *only when combined with direct address* ("you", "your", …), and 10 prompt-injection substrings. Fails → `400`.
3. **Memory write** — `database.py::memory_add(session_id, "user", …)`, first 200 chars.
4. **Cache lookup** — key is the literal string `f"{task}:{script_text}"`; `cache_get` accepts rows newer than 24 h. Hit → returns immediately with `from_cache: true` (still writing a new `results` row).
5. **Supervisor** — `supervisor.py::run_supervisor` compiles a one-node LangGraph and dispatches on `task`.
6. **Persist** — `cache_set`, `save_result` (returns the `result_id` everything downstream keys on), `memory_add` for the assistant turn.
7. **Optional eval** — if `evaluate=true`, `evaluator.py::score_faithfulness` asks Gemini at `temperature=0.0` for `{"score", "reasoning"}`, stored via `save_eval_record`.

### Retrieval pipeline (`retrieval.py::hybrid_search`)

Used by `compliance` and `analyze` only:

1. Embed the query — Gemini `gemini-embedding-001`, forced to **768 dimensions** (`llm.py`), matching the `vector(768)` column in `database.py`.
2. **Dense** search — pgvector cosine distance (`<=>`), top 8.
3. **Lexical** search — `BM25Okapi` over *all* documents in the collection, loaded into memory each call (`database.py::bm25_search`).
4. **Fusion** — min-max normalize each score set, combine as `0.6 * dense + 0.4 * bm25`.
5. **Rerank** — `gemini_rerank` asks Gemini to score each candidate 0–10 (JSON mode, temperature 0). On failure it sets `rerank_score = None` rather than falling back to `hybrid_score`, which is on a 0.0–1.0 scale and could never clear the 5.0 gate.
6. **Confidence gate** — `guardrails.py::retrieval_status` returns `empty` / `unscored` / `low_relevance` / `confident`. `compliance` gives a different message for each, and `unscored` still produces a report with an explicit caveat. Previously a reranker outage was indistinguishable from an empty knowledge base.

### Ingestion pipeline (`ingest.py`)

`POST /ingest` → `pypdf` text extraction → `chunk_text` (300 words, 50-word overlap) → per chunk, `classify_chunk` asks Gemini to label it `guidelines` / `past_films` / `scripts` (defaults to `scripts` on any other answer) → dedupe via exact-text match → embed → insert.

**Note:** classification is per *chunk*, not per document, so one PDF can be split across all three collections.

### Release-date workflow (`main.py`)

The date pipeline has two entry paths that converge:

- **Quick path** — `POST /confirm-date/{id}` (or `/override-date/{id}` with a forced date): computes recommendations and creates calendar events in one shot.
- **Review path** — `POST /check-conflicts/{id}` returns the conflict report + recommended per-country dates for human review, then `POST /finalize-calendar/{id}` accepts per-country overrides and creates the events.

Shared internals:

- `_check_conflicts_via_a2a(date_str)` — resolves Agent 4's card via `A2ACardResolver`, sends the date as a plain text message, parses the JSON reply.
- `_collect_conflicting_dates` — gathers the country's conflicting holiday plus any conflicting global sporting/awards event.
- `_nearest_clear_date` — shifts by `HOLIDAY_CONFLICT_WINDOW_DAYS + 1` = **4 days**, away from the proposed date's side of the conflict.
- `_create_calendar_event` — if `CALENDAR_MODE == "mcp"`, tries MCP and **falls back to the service account on any exception** (logged as a warning); otherwise goes straight to the service account.

### Agent 4 (`agent4_service.py`)

An A2A server (`A2AFastAPIApplication`) exposing one skill, `check-holiday-conflicts`. Its executor takes a `YYYY-MM-DD` string and returns JSON with three keys: `holidays` (per country), `sporting_events`, `awards_ceremonies`. Conflict window is **3 days** either side.

Holiday data is live from Nager.Date; when the proposed date is within 3 days of a year boundary it also fetches the adjacent year. If the *primary* year's fetch fails, that country reports `status: "unknown"` rather than a false "clear".

Sporting and awards dates are **hardcoded dicts** (`SUPER_BOWL_DATES`, `WORLD_CUP_FINAL_DATES`, `OSCARS_DATES`, `GOLDEN_GLOBES_DATES`, `GRAMMYS_DATES`) covering roughly 2026–2030, with a source comment noting they need periodic manual updates.

---

## Prerequisites

Every credential and external account required, with the file that reads it:

| Requirement | Env var / file | Read in | Required for |
|---|---|---|---|
| Google Gemini API key | `GEMINI_API_KEY` | `config.py:6`, `llm.py:10` | All LLM + embedding calls — effectively everything |
| Postgres with `pgvector` | `DATABASE_URL` | `config.py:7`, `database.py:15` | All persistence; `init_tables()` runs `CREATE EXTENSION IF NOT EXISTS vector` |
| TMDB API key (free, themoviedb.org) | `TMDB_API_KEY` | `config.py:8`, `agents.py:7` | `release_listing` task only |
| Shared API secret | `API_SECRET_KEY` | `config.py:27`, `main.py::require_api_key` | Every protected endpoint. **If unset, all protected endpoints return 403** |
| Google Calendar ID | `SHARED_CALENDAR_ID` | `calendar_service_account.py:10`, `calendar_mcp.py:9` | Calendar event creation |
| Google service-account JSON path | `GOOGLE_SERVICE_ACCOUNT_JSON` | `config.py:26`, `calendar_service_account.py:15` | Default (`service_account`) calendar mode |
| Google OAuth desktop credentials | file `gcp-credentials.json` at project root (path built in `calendar_mcp.py:10`) | `calendar_mcp.py` | `CALENDAR_MODE=mcp` only |
| Node.js / `npx` | — | `calendar_mcp.py:15` spawns `npx -y @cocal/google-calendar-mcp` | `CALENDAR_MODE=mcp` only |
| Node.js ≥ whatever Next 16 requires | `frontend/package.json` | — | Frontend. Exact minimum: **Unknown / not found in codebase** |

Notes grounded in code:

- **Nager.Date needs no credentials** — `agent4_service.py:61` calls it with no auth header.
- The service account's email must have write access to `SHARED_CALENDAR_ID`; the code requests scope `https://www.googleapis.com/auth/calendar` (`calendar_service_account.py:11`) but cannot grant itself calendar sharing.
- There is **no `.env.example` in the repo**. The variable names above were recovered from `config.py` and the modules that call `os.getenv` directly.
- A file named `ninth-wares-462308-f5-c99c6f0176a0.json` sits at the project root and is **not** covered by `.gitignore` (which lists only `gcp-credentials.json` and `service-account-credentials.json`). Its exact role is **Unknown / not found in codebase** — no source file references it by name; presumably a GCP key intended for `GOOGLE_SERVICE_ACCOUNT_JSON`.

---

## Installation and Setup

### 1. Backend dependencies

```bash
python -m venv venv
venv/Scripts/activate          # Windows;  source venv/bin/activate on Linux/macOS
pip install -r requirements.txt
```

If `pip` errors on `requirements.txt`, it is UTF-16 encoded — convert first:

```bash
python -c "open('requirements.txt','w',encoding='utf-8').write(open('requirements.txt',encoding='utf-16').read())"
```

### 2. Create `.env` at the project root

```bash
GEMINI_API_KEY=<your gemini key>
DATABASE_URL=postgresql://user:pass@host:5432/dbname
TMDB_API_KEY=<your tmdb key>
API_SECRET_KEY=<any shared secret you choose>
SHARED_CALENDAR_ID=<google calendar id>
CALENDAR_MODE=service_account
GOOGLE_SERVICE_ACCOUNT_JSON=./service-account-credentials.json
SUPPORTED_COUNTRIES=US,MX,GB,JP,DE
```

### 3. Initialize the database

```bash
python -c "from database import init_tables; init_tables()"
```

Creates `documents`, `cache`, `memory`, `results`, `eval_history`, enables the `vector` extension, and turns on row-level security for all five tables. Prints `all tables ready`. `main.py` also calls `init_tables()` at import, so simply starting the API does this too.

### 4. Calendar backend — pick one

**Service account (default):** download the service-account JSON key, point `GOOGLE_SERVICE_ACCOUNT_JSON` at it, and share `SHARED_CALENDAR_ID` with the service account's email granting "Make changes to events".

**MCP / OAuth:** requires Node, `CALENDAR_MODE=mcp`, a Desktop-app OAuth client JSON saved as `gcp-credentials.json` in the project root, and a one-time browser sign-in:

```bash
npx @cocal/google-calendar-mcp auth
```

### 5. Frontend

```bash
cd frontend
npm install
```

Create `frontend/.env.local`:

```bash
NEXT_PUBLIC_API_URL=http://localhost:8000
NEXT_PUBLIC_API_KEY=<same value as API_SECRET_KEY>
```

Both are read in `frontend/lib/api.ts:3-4` and default to `""` if absent — which silently points every request at the frontend's own origin.

---

## Running the Project

Three terminals:

```bash
# 1. Agent 4 — the conflict checker (default port 8001)
python agent4_service.py
```

```bash
# 2. Main API (default port 8000)
uvicorn main:app --reload --port 8000
```

```bash
# 3. Frontend (default port 3000)
cd frontend && npm run dev
```

Interactive API docs are available at `http://localhost:8000/docs` (FastAPI default, not disabled in `main.py`).

Frontend production build:

```bash
cd frontend && npm run build && npm start
```

`agent4_service.py` binds `0.0.0.0` when run as `__main__` (`agent4_service.py:209`). Its port is `AGENT4_PORT` (default `8001`) and must match `AGENT4_BASE_URL` in `main.py`'s environment.

---

## Inputs

### Environment variables

| Variable | Type / format | Default | Read in |
|---|---|---|---|
| `GEMINI_API_KEY` | string | none | `config.py`, `llm.py` |
| `DATABASE_URL` | Postgres URI | none | `config.py`, `database.py` |
| `TMDB_API_KEY` | string | none | `config.py` |
| `API_SECRET_KEY` | string | none (unset ⇒ all protected endpoints 403) | `config.py` |
| `CHAT_MODEL` | Gemini model id | `gemini-2.5-flash-lite` | `config.py:9` |
| `EMBEDDING_MODEL` | Gemini model id | `gemini-embedding-001` | `config.py:10` |
| `AGENT4_BASE_URL` | URL | `http://localhost:8001` | `config.py:18` |
| `AGENT4_PORT` | integer | `8001` | `agent4_service.py:20` |
| `SUPPORTED_COUNTRIES` | comma-separated ISO-3166 alpha-2, uppercased | `US,MX,GB,JP,DE` | `config.py:19-23` |
| `CALENDAR_MODE` | `"mcp"` \| `"service_account"` | `service_account` | `config.py:25` |
| `GOOGLE_SERVICE_ACCOUNT_JSON` | filesystem path | none | `config.py:26` |
| `SHARED_CALENDAR_ID` | Google Calendar ID | none | `calendar_service_account.py:10` |
| `NEXT_PUBLIC_API_URL` | URL | `""` | `frontend/lib/api.ts:3` |
| `NEXT_PUBLIC_API_KEY` | string | `""` | `frontend/lib/api.ts:4` |

### Hardcoded constants (not env-configurable)

| Constant | Value | Location |
|---|---|---|
| `MAX_UPLOAD_FILE_SIZE_MB` | `10` | `config.py:13` |
| `HOLIDAY_CONFLICT_WINDOW_DAYS` | `3` (shift is +1 ⇒ 4 days) | `main.py:48` |
| `CONFLICT_WINDOW_DAYS` | `3` | `agent4_service.py:19` |
| rate limit | 10 requests / 60 s per session | `resilience.py:34` defaults |
| cache TTL | 24 h | `database.py::cache_get` default |
| chunk size / overlap | 300 / 50 words | `ingest.py:19` |
| embedding dimensionality | 768 | `llm.py:23`, enforced in `database.py:91` |
| hybrid weights | 0.6 dense / 0.4 BM25 | `retrieval.py:60` |
| rerank confidence floor | 5.0 | `guardrails.py:50` |

`MAX_SCRIPT_TEXT_LENGTH`, `CACHE_TTL_HOURS`, `RATE_LIMIT_MAX_REQUESTS`, and `RATE_LIMIT_WINDOW_SECONDS` were declared in `config.py` but never imported, so editing them had no effect. They have been **deleted**. The live values are the function defaults listed above.

### API endpoints

🔒 = requires `X-API-Key` header matching `API_SECRET_KEY`.

| Method | Path | Auth | Parameters (type / format) |
|---|---|---|---|
| `POST` | `/run-agent` | 🔒 | Form: `script_text` (str, required), `task` (`compliance`\|`analyze`\|`release_listing`\|`release_check`), `session_id` (str, default `"default"`), `evaluate` (bool, default `false`) |
| `POST` | `/ingest` | 🔒 | Multipart: `file` — a PDF, ≤ 10 MB |
| `DELETE` | `/document` | 🔒 | Query: `filename` (str, exact match against `metadata->>'filename'`) |
| `GET` | `/health` | — | none |
| `GET` | `/result/{result_id}` | — | Path: `result_id` (int) |
| `GET` | `/result/{result_id}/download` | — | Path: `result_id` (int) |
| `GET` | `/history/{session_id}` | — | Path: `session_id` (str) |
| `GET` | `/eval/summary` | — | none |
| `GET` | `/eval/chart` | — | none |
| `POST` | `/confirm-date/{result_id}` | 🔒 | Path: `result_id` of a `release_check` run |
| `POST` | `/override-date/{result_id}` | 🔒 | Form: `new_date` (`YYYY-MM-DD`) |
| `POST` | `/check-conflicts/{result_id}` | 🔒 | Query: `session_id` (str, default `"default"`) |
| `POST` | `/finalize-calendar/{result_id}` | 🔒 | Query: `session_id`; JSON body: `{"US": "2026-05-01", …}` — keys must be in `SUPPORTED_COUNTRIES` or `400` |

**Critical input format:** for `task=release_check`, `script_text` must be the pipe-joined string `"<YYYY-MM-DD>|<listing_result_id>"` — split in `supervisor.py:29` and again in every date endpoint in `main.py`. The `listing_result_id` must be the `result_id` of a prior `release_listing` run, because `resolve_genre_from_listing` reads that row's `script_text` back as the genre.

Recognized genres for `release_listing` (`agents.py::GENRE_IDS`): `action`, `adventure`, `animation`, `comedy`, `crime`, `documentary`, `drama`, `family`, `fantasy`, `history`, `horror`, `music`, `mystery`, `romance`, `science fiction`, `tv movie`, `thriller`, `war`, `western`.

### Agent 4's A2A input

A plain-text A2A message containing a single `YYYY-MM-DD` date (`agent4_service.py:161`). Its agent card is served at `AGENT4_BASE_URL` and resolved by `A2ACardResolver`.

---

## Outputs

### API responses

| Endpoint | Response shape |
|---|---|
| `POST /run-agent` | `{result_id: int, task: str, result: str, from_cache: bool, eval: {score, reasoning} \| null}` (`schemas.py::AgentResponse`) |
| `POST /ingest` | `{inserted_chunks: int, ids: int[]}`, or `{error: "File exceeds 10MB limit."}` |
| `DELETE /document` | `{deleted_chunks: int}` |
| `GET /health` | `{status: "ok"\|"degraded", database: "ok"\|"unreachable"}` |
| `GET /result/{id}` | `{task, result}` or `{error: "not found"}` |
| `GET /result/{id}/download` | `application/pdf` binary, `Content-Disposition: attachment; filename=result_{id}.pdf` |
| `GET /history/{session_id}` | `{history: [{role, content}]}` — last 20 turns, chronological |
| `GET /eval/summary` | `{count, average_faithfulness}`, or `{count: 0}` when empty |
| `GET /eval/chart` | `{chart_base64: str}` — base64 PNG line chart, `""` when no data |
| `/confirm-date`, `/override-date`, `/finalize-calendar` | `{result_id, confirmed: true, conflict_report, events: {"US": {date, calendar_event}}}` (+ `forced_date` on override) |
| `/check-conflicts` | `{result_id, proposed_date, conflict_report, recommended_dates: {"US": "YYYY-MM-DD"}}` |

`conflict_report` structure (`agent4_service.py::check_all_conflicts`):

```json
{
  "holidays": {
    "US": {"status": "ok|unknown", "conflict": true, "holiday_date": "2026-07-04", "holiday_name": "Independence Day"}
  },
  "sporting_events":   [{"name": "Super Bowl", "date": "2026-02-08", "conflict": false, "days_away": 42}],
  "awards_ceremonies": [{"name": "Oscars", "date": "2026-03-15", "conflict": false, "days_away": 12}]
}
```

**Error status codes actually raised:** `403` (missing/invalid API key), `429` (rate limit), `400` (unsafe/too-short input, or unknown country code in overrides). Several "not found" cases return a `200` with an `{"error": ...}` body rather than a `404` — see `main.py::get_result_endpoint` and the date endpoints.

### Database writes

| Table | Written by | Contents |
|---|---|---|
| `documents` | `ingest.py::ingest_document` | `collection` (`guidelines`/`past_films`/`scripts`), chunk `text`, `metadata` JSONB (`{"filename": …}`), `embedding vector(768)` |
| `cache` | `/run-agent` | key `question` = `"{task}:{script_text}"`, `answer`, `created_at`; upsert on conflict |
| `memory` | `/run-agent` | `session_id`, `role` (`user`/`assistant`), `content` (truncated to 200 chars), `created_at` |
| `results` | `/run-agent` | `task`, `script_text`, `result`, `created_at`. Written by `database.py::record_run` together with the `memory` and `cache` rows, in one statement and one transaction |
| `eval_history` | `/run-agent` when `evaluate=true` | `task`, `faithfulness_score`, `created_at` |

All five tables have `ROW LEVEL SECURITY` enabled by `init_tables()`, with no policies defined in the codebase.

### External side effects

- **Google Calendar events** — created by `_create_events_from_dates`, one per supported country. Summary format: `"Movie Launch — {genre} — {Country Name}"` truncated to 50 chars by `calendar_service_account.py:24`; all-day event spanning the date to date+1. Returns the event's `htmlLink`.
- **Logs** — `resilience.py:5` configures stdout logging as `%(asctime)s [%(levelname)s] %(message)s` under logger name `agentic_studio`. No log file is written; `*.log` in `.gitignore` is unused by the code.
- **Downloaded PDFs** — the browser saves `result_{id}.pdf` via `frontend/lib/api.ts::downloadResult`.

---

## Folder and File Structure

```
agentic-studio/
├── main.py                        FastAPI app: all 13 routes, CORS, date-scheduling orchestration
├── agent4_service.py              Standalone A2A microservice: holiday/sport/awards conflict checking
├── supervisor.py                  LangGraph single-node router mapping task → agent function
├── agents.py                      The four task implementations + TMDB genre ID map
├── llm.py                         Gemini client: embed_text (768-dim) and generate_text, with retries
├── retrieval.py                   Hybrid dense+BM25 search with Gemini reranking
├── ingest.py                      PDF chunking (300/50 words), LLM classification, dedupe, insert
├── database.py                    All SQL, schema creation, BM25, eval aggregation, matplotlib chart
├── guardrails.py                  Input safety (length, profanity+direct-address, injection) and retrieval confidence
├── evaluator.py                   LLM-as-judge faithfulness / context-precision scoring
├── resilience.py                  Retry decorator, in-memory rate limiter, logger, safe_generate fallback
├── schemas.py                     TaskType enum, AgentResponse, EvalResult pydantic models
├── config.py                      Single point where every env var is read
├── calendar_service_account.py    Google Calendar via service account (default path)
├── calendar_mcp.py                Google Calendar via MCP stdio server (CALENDAR_MODE=mcp)
├── requirements.txt               Pinned Python deps (UTF-16 encoded)
├── ARCHITECTURE.md                Pre-existing 628-line design document
└── frontend/
    ├── app/page.tsx               App shell: header, health poller, tab switching
    ├── components/                One file per tab, plus ui.tsx for shared pieces
    ├── lib/content.ts             All user-facing explanatory copy
    ├── app/layout.tsx             Root layout
    ├── app/globals.css            Tailwind entry + custom animations
    ├── lib/api.ts                 Every backend call + TypeScript types mirroring the API
    ├── package.json               Next 16 / React 19 / Tailwind 4
    └── next.config.ts             Empty config (defaults only)
```

### Dead code (removed August 2026)

All of the following were found unused and have been deleted:

- `web_fetch.py::fetch_page_text` — no importer anywhere. File deleted, along with the `beautifulsoup4` dependency.
- `evaluator.py::score_context_precision` — never called. Deleted, along with the `eval_history.context_precision_score` column and the frontend tile that always showed `—`.
- `config.py`'s `MAX_SCRIPT_TEXT_LENGTH`, `CACHE_TTL_HOURS`, `RATE_LIMIT_MAX_REQUESTS`, `RATE_LIMIT_WINDOW_SECONDS` — declared, never imported. Deleted.
- `results.approved` and `results.feedback` columns — never written or read. Dropped from the schema and from the live database.
- `database.py::get_connection` — obsolete once every query moved to the pool; calling `.close()` on a pooled connection would destroy it.

The dropped columns required a manual `ALTER TABLE` on existing databases, since `init_tables()` uses `CREATE TABLE IF NOT EXISTS` and cannot alter one:

```sql
ALTER TABLE results DROP COLUMN approved, DROP COLUMN feedback;
ALTER TABLE eval_history DROP COLUMN context_precision_score;
```

### CI/CD

**None found.** No `.github/`, no `Dockerfile`, no `Procfile`, no `vercel.json`, no `render.yaml`. Git history mentions a Vercel deployment and Linux deployment fixes (commits `b7bd72f`, `c7671ce`), and `main.py`'s CORS list includes `https://agentic-studio-eight.vercel.app`, but no deployment configuration is committed.

### Tests

`test_release_conflicts.py` — **15 checks, no test framework required**:

```bash
python test_release_conflicts.py
```

It uses plain `assert` statements and a `__main__` runner, so it needs nothing installed, but is written so `pytest` collects it unchanged if pytest is ever added.

Coverage: the listing parser (including titles containing parentheses, and undated films), the 14-day competition window at its inclusive boundary, signed day offsets, same-day releases, and all four `retrieval_status` states — in particular that an unscored result is not mistaken for an irrelevant one.

These are the only tests in the repo. The database, LLM, and A2A paths have no automated coverage.

---

## Troubleshooting

Only issues discoverable from the code, its comments, or its error handling:

**"system offline" badge in the UI, backend is running.**
`frontend/lib/api.ts:3` defaults `API_URL` to `""`, so `checkHealth()` requests `/health` on the *frontend's* origin. Create `frontend/.env.local` with `NEXT_PUBLIC_API_URL` and restart `npm run dev` — `NEXT_PUBLIC_*` values are inlined at build/dev-server start, so editing them without a restart changes nothing.

**All protected endpoints return `403 "Missing or invalid API key."`**
`main.py::require_api_key` fails closed: if `API_SECRET_KEY` is unset on the server, *every* request is rejected regardless of what the client sends.

**Browser CORS errors.**
`main.py`'s `allow_origins` is an explicit list — currently `http://localhost:3000` and `https://agentic-studio-eight.vercel.app`. Any other origin is blocked and must be added to that list.

**`429 "Rate limit exceeded."`**
10 requests per 60 s per `session_id`. The tracker is a plain module-level dict (`resilience.py:31`), so it resets on restart and is per-worker — running multiple uvicorn workers multiplies the effective limit.

**`ValueError: Embedding must be 768 numbers`.**
Raised in `database.py:92` and `:109`. Changing `EMBEDDING_MODEL` to something that does not honor `output_dimensionality=768` (`llm.py:23`) breaks all inserts and searches against the existing `vector(768)` column.

**"I'm having trouble generating a response right now."**
Gemini returned 503/UNAVAILABLE three times; `llm.py:56` returns this literal string rather than raising, so it can land in a stored result.

**"Service temporarily unavailable. Please try again shortly."**
`resilience.py::safe_generate` fallback. Only `check_compliance`'s first LLM call is wrapped in it — every other `generate_text` call propagates its exception as a 500.

**"No guideline documents matched this content..."**
Not an error: `retrieval_status` returned `empty`, meaning nothing in the `guidelines` collection matched at all. Usually nothing has been ingested yet — upload guideline PDFs in the Documents tab.

**"Guidelines were searched, but none were relevant enough..."**
`retrieval_status` returned `low_relevance`: documents were found and scored, but none reached 5.0/10. The guidelines you uploaded do not cover this content.

**A compliance report ending "automatic relevance ranking was unavailable"**
`retrieval_status` returned `unscored` — the Gemini reranker failed or returned unparseable JSON, so the guidelines are reported unranked. Check the logs for `Reranking unavailable`. Before August 2026 this case was silently reported as "no relevant guidelines found", which made a reranker outage look like an empty knowledge base.

**Compliance/analysis finds nothing after uploading a PDF.**
`ingest.py::classify_chunk` labels each *chunk* independently and falls back to `scripts` for any unrecognized LLM answer, so a guidelines document can end up split across collections. `compliance` only searches `guidelines`; `analyze` only searches `past_films`.

**Re-uploading the same PDF inserts 0 chunks.**
`ingest.py::document_exists` skips chunks whose text already exists in that collection, by exact string match.

**`pip install -r requirements.txt` fails to parse the file.**
The file is UTF-16 encoded (visible as null-byte-separated characters). Convert to UTF-8 first — command in the Installation section.

**Agent 4 calls hang or fail.**
`main.py`'s A2A client uses `httpx.AsyncClient()` with **no timeout** in `_check_conflicts_via_a2a`, so an unreachable Agent 4 can hang the request. Agent 4's own outbound Nager.Date calls do have a 10 s timeout (`agent4_service.py:61`).

**A country reports `status: "unknown"`.**
Nager.Date's request for that country's primary year failed. `agent4_service.py:90` deliberately reports unknown rather than "clear" so a fetch failure is never mistaken for an all-clear.

**Sporting/awards conflicts look wrong for future years.**
Those dates are hardcoded (`agent4_service.py:25-46`) and cover roughly 2026–2030 only. A date outside that range matches against the nearest hardcoded entry, which may be years away. The source comment states these need periodic manual updates.

**Calendar event created with a raw country code as its label (e.g. "Horror — CA").**
`main.py::COUNTRY_DISPLAY_NAMES` only maps the five defaults. A country added to `SUPPORTED_COUNTRIES` without a display-name entry works correctly but is labeled with its code.

**`400 "Unknown country code(s) in overrides"` from `/finalize-calendar`.**
Override keys are validated against `SUPPORTED_COUNTRIES`. Because `main.py` and `agent4_service.py` read that variable independently, a mismatch between the two processes' environments will cause confusing failures.

---

## Security Notes Found in the Code

Stated because they are visible facts about the implementation, not speculation:

1. **`NEXT_PUBLIC_API_KEY` is inlined into the client JS bundle.** Next.js exposes every `NEXT_PUBLIC_*` variable to the browser, so the deployed frontend ships `API_SECRET_KEY` to every visitor. `ARCHITECTURE.md` note 15 acknowledges this and suggests proxying through a server route.
2. **`ninth-wares-462308-f5-c99c6f0176a0.json` is not gitignored.** `.gitignore` covers `gcp-credentials.json` and `service-account-credentials.json` only. If this is a GCP key, one `git add .` commits it.
3. **RLS is enabled with no policies.** `init_tables()` enables row-level security on all five tables but the codebase defines no policies — the app connects via `DATABASE_URL`, presumably as an owner/bypass role. Exact role: **Unknown / not found in codebase**.
4. **Read endpoints are unauthenticated.** `/result/{id}`, `/result/{id}/download`, `/history/{session_id}`, `/eval/summary`, and `/eval/chart` carry no `require_api_key` dependency, and result IDs are sequential integers.
