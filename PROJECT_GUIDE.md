# Agentic Studio — Project Guide

A ground-up technical guide written by auditing the source. Every claim below points at the file it came from. Anything that could not be determined from the codebase is marked **Unknown / not found in codebase**.

---

## Changes — client/developer split (August 2026)

The frontend is now **two** separate Next.js apps instead of one, and the backend gained a real login system to gate the difference between them.

- **`app/core/auth.py`** (new) — password hashing (PBKDF2), a signed session-cookie JWT, and `require_role(*roles)`, a FastAPI dependency used the same way as `Depends(require_api_key)`. A new `users` table (`email`, `password_hash`, `salt`, `role` ∈ `developer`|`client`) backs it — deliberately kept out of the generic `ADMIN_TABLES` browser.
- **New endpoints**: `POST /auth/login`, `POST /auth/logout`, `GET /auth/me` (no role required — these establish or read the session), and developer-only `GET/POST /auth/users`, `PATCH/DELETE /auth/users/{id}`.
- **`/admin/tables/*` now requires `require_role("developer")` in addition to the existing API key** — two independent gates, stacked, not one replacing the other.
- **`frontend/` restructured**: `packages/core` (shared code, not an npm package — see `frontend/packages/core/README.md`) plus `apps/client` (the working pipelines) and `apps/admin` (client's tabs + Database + API Log + Users). Both gate on login via `useSession()`; the admin app additionally checks `role === "developer"`.
- **The API key no longer reaches the browser.** Both apps proxy every backend call through their own `app/api/proxy/[...path]/route.ts`, which attaches `X-API-Key` server-side from a non-public `BACKEND_API_KEY` env var. `NEXT_PUBLIC_API_KEY`/`NEXT_PUBLIC_API_URL` are gone from the codebase, replaced by `BACKEND_API_KEY`/`BACKEND_API_URL`.
- **First account**: `python backend/seed_admin.py you@studio.com` — there is no signup page; every account after the first comes from the developer app's Users tab.
- Checks: `python backend/test_auth.py` (11 checks — password hashing, session token roundtrip/tamper, role-gate 401/403/pass including DB-recheck-on-downgrade and deleted-account cases), alongside the two pre-existing backend suites and the frontend's `demo.test.ts` (now run from `frontend/packages/core`).

Everything below this point that says "the frontend" in the singular predates this split — read it as describing shared behavior both apps still have, and check the two bullet points above (auth endpoints, two apps) for what's actually different. The [Folder and File Structure](#folder-and-file-structure), [API endpoints](#api-endpoints), and [Client-side features](#client-side-features) sections have been updated in place; the rest has not been re-audited against this change line by line.

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

- Dead code deleted — see [Dead code](#dead-code-removed-august-2026). Requires a manual `ALTER TABLE` on existing databases.
- Frontend rewritten for first-time users: a "Start here" tab, a guided four-step Release Planner replacing the hidden result-ID handoff, and per-task explanations of what each agent needs and returns. Split from one 980-line `page.tsx` into `components/` plus `lib/content.ts`.
- First tests in the repo: `test_release_conflicts.py`, 15 checks, no framework needed.

**Frontend features added on top of `lib/api.ts`**

Every backend call already went through one `request<T>` helper, so all four of these hook into that single seam and **no tab component was modified** for any of them. Each has its own module-level store, none persists anything, and all are off by default. Detail: [Client-side features](#client-side-features).

| Feature | Files | What it is for |
|---|---|---|
| **Demo Mode** | `lib/demo.ts` | Run the entire app against local fixtures — no backend, no Gemini quota, no calendar writes. Header toggle. |
| **Guided walkthroughs** | `lib/content.ts::WALKTHROUGHS`, `components/Walkthrough.tsx` | Four narrated tours, one per pipeline, launched from the Start here tab. Each step names the control to click and carries a visual aid. Forces Demo Mode on. |
| **Activity feed** | `lib/activity.ts`, `components/ActivityFeed.tsx` | Transient plain-language narration — "Searching the guidelines you uploaded…" → "Compliance report ready." Outcome lines are computed from the real response. |
| **API log** | `lib/apilog.ts`, `components/ApiLogPanel.tsx` | Technical drawer: method, endpoint, payload, status, response, per call. Demo calls included and flagged `simulated`. The API key is masked everywhere it could print. |

- Second test file, first on the frontend: `frontend/lib/demo.test.ts`, run with bare `node`.

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

Dependencies come from `requirements.txt`, which as of this audit is plain UTF-8/ASCII (a past UTF-16 export via PowerShell's `pip freeze > requirements.txt` on Windows is no longer the file's actual state — see `backend/ARCHITECTURE.md`'s deployment notes for how that happens). Only the libraries actually imported by project code are listed here:

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

Note: `requirements.txt` is currently a **103-pin, effectively full `pip freeze`**, not a hand-pruned direct-dependencies list — it still includes packages with no importer anywhere in the codebase (`langchain`, `langsmith`, `asyncpg`, `requests`, `lxml`, `beautifulsoup4`, among others) alongside obvious transitive dependencies (`numpy`, `pillow`, `six`, `charset-normalizer`, …). `PyJWT` is a genuine, if indirect, dependency now — `app/core/auth.py` imports it as `jwt`. A prune to direct-only dependencies has been discussed but not actually applied to the committed file; treat any claim elsewhere that it already was as describing an intended, not completed, cleanup.

### Frontend (TypeScript)

Two independent installs now, `frontend/apps/client/package.json` and `frontend/apps/admin/package.json` (plus `frontend/packages/core/package.json`, which exists only so `react`/`@types/react` resolve during type-checking — it has no build of its own). All three carry the same versions:

- `next` `16.2.12` (App Router — each app's own `app/`)
- `react` / `react-dom` `19.2.4`
- `tailwindcss` `^4` via `@tailwindcss/postcss`
- `typescript` `^5`, `eslint` `^9` + `eslint-config-next`

No test runner and no charting, diagramming, tour or toast library. `frontend/packages/core/lib/demo.test.ts` runs under bare `node` (≥ 22.6, which strips TypeScript types natively) from `frontend/packages/core`; the walkthrough visuals and the activity feed are plain JSX and Tailwind; the API log's collapsible rows are native `<details>`.

### External services

- **Google Gemini API** — chat + embeddings (`llm.py`)
- **Supabase / any Postgres with `pgvector`** — vector store and all persistence (`database.py`)
- **TMDB (themoviedb.org)** — upcoming-release data (`agents.py`)
- **Nager.Date** (`https://date.nager.at/api/v3/publicholidays`) — public holidays; **no API key required**, called anonymously (`agent4_service.py`)
- **Google Calendar API** — event creation (`calendar_service_account.py` or `calendar_mcp.py`)

---

## Architecture

### Process topology

**Four** processes must run for the full feature set — the client/developer split (see the top of this document) added a second Next.js app rather than replacing the first:

```
┌───────────────────────┐        ┌──────────────────────┐
│ apps/client (Next.js) │ HTTP   │  main.py (FastAPI)   │
│  :3000                ├───────►│  :8000               │
└───────────────────────┘  +API  └──────┬───────────────┘
                           key           │
┌───────────────────────┐  +cookie      │
│ apps/admin  (Next.js) │  via own      │ A2A protocol (httpx)
│  :3001                ├───────────────┤
└───────────────────────┘               ▼
                                ┌──────────────────────┐
                                │ agent4_service.py    │
                                │  :8001  (A2A server) │
                                └──────┬───────────────┘
                                       │ HTTPS
                                       ▼  date.nager.at
           main.py also calls: Gemini · TMDB · Google Calendar · Postgres
```

Neither Next.js app calls `main.py` directly from the browser — each proxies every request through its own `app/api/proxy/[...path]/route.ts` (server-side), which is where the shared API key and the browser's session cookie actually reach the backend. `main.py` and `agent4_service.py` each import `config.py` independently, so `SUPPORTED_COUNTRIES` must be set identically in both processes' environments.

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
| Node.js ≥ whatever Next 16 requires | `frontend/apps/client/package.json`, `frontend/apps/admin/package.json` | — | Both frontend apps, each its own install. Exact minimum: **Unknown / not found in codebase** |
| Node.js ≥ 22.6 | — | — | `frontend/packages/core/lib/demo.test.ts` only — it is TypeScript run directly, which needs native type stripping. Neither app itself requires this |

Notes grounded in code:

- **Nager.Date needs no credentials** — `agent4_service.py:61` calls it with no auth header.
- The service account's email must have write access to `SHARED_CALENDAR_ID`; the code requests scope `https://www.googleapis.com/auth/calendar` (`calendar_service_account.py:11`) but cannot grant itself calendar sharing.
- There is **no `.env.example` in the repo**. The variable names above were recovered from `config.py` and the modules that call `os.getenv` directly.
- A file named `ninth-wares-462308-f5-c99c6f0176a0.json` sits at the project root and is **not** covered by `.gitignore` (which lists only `gcp-credentials.json` and `service-account-credentials.json`). Its exact role is **Unknown / not found in codebase** — no source file references it by name; presumably a GCP key intended for `GOOGLE_SERVICE_ACCOUNT_JSON`.

---

## Installation and Setup

### 1. Backend dependencies

```bash
cd backend
python -m venv venv
venv/Scripts/activate          # Windows;  source venv/bin/activate on Linux/macOS
pip install -r requirements.txt
```

`requirements.txt` is a large, effectively-full `pip freeze` (103 pins, most never imported directly) rather than a hand-pruned list — expect the install to pull in far more than the project's direct imports. It is currently plain UTF-8/ASCII; if a copy of this repo has it as UTF-16 instead (visible as null-byte-separated characters, e.g. from a `pip freeze > requirements.txt` run in Windows PowerShell), convert it first:

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

Run from `backend/`, matching every other backend module's `app.`-prefixed imports (`from database import ...` fails with `ModuleNotFoundError` from any other working directory):

```bash
cd backend
python -c "from app.data.database import init_tables; init_tables()"
```

Creates `documents`, `cache`, `memory`, `results`, `eval_history`, `users`, enables the `vector` extension, and turns on row-level security for all six tables. `main.py` also calls `init_tables()` at import, so simply starting the API does this too — this manual step is only for initializing the database before the API's first run, or against a second environment.

### 4. Calendar backend — pick one

**Service account (default):** download the service-account JSON key, point `GOOGLE_SERVICE_ACCOUNT_JSON` at it, and share `SHARED_CALENDAR_ID` with the service account's email granting "Make changes to events".

**MCP / OAuth:** requires Node, `CALENDAR_MODE=mcp`, a Desktop-app OAuth client JSON saved as `gcp-credentials.json` in the project root, and a one-time browser sign-in:

```bash
npx @cocal/google-calendar-mcp auth
```

### 5. Frontend — two independent installs

```bash
cd frontend/apps/client && npm install
cd frontend/apps/admin && npm install
```

`packages/core` needs no install of its own — it's plain filesystem paths mapped in via each app's `tsconfig.json`, not an npm package.

Create `.env.local` in **each** app directory (`frontend/apps/client/.env.local` and `frontend/apps/admin/.env.local`):

```bash
BACKEND_API_URL=http://localhost:8000
BACKEND_API_KEY=<same value as API_SECRET_KEY>
```

Both are read server-side only, in each app's `app/api/proxy/[...path]/route.ts` via `packages/core/lib/proxy.ts`, and default to `http://localhost:8000` / `""` if absent. Note the missing `NEXT_PUBLIC_` prefix — that's deliberate: these must never reach the browser (see `BACKEND_API_URL`/`BACKEND_API_KEY` in the Environment variables table below). `NEXT_PUBLIC_API_URL`/`NEXT_PUBLIC_API_KEY` no longer exist in the codebase.

**Neither is needed to see the app running.** `npm install && npm run dev` in either app directory, then switch **Demo Mode** on in the header: every tab answers from local fixtures, with no `.env.local`, no database, no API keys and no Python process — Demo Mode also bypasses the login screen with a synthetic session. That is also the only safe way to demo the Release Planner, whose last step writes real Google Calendar events.

---

## Running the Project

Four terminals:

```bash
# 1. Agent 4 — the conflict checker (default port 8001), run from backend/
cd backend && python microservices/agent4_service.py
```

```bash
# 2. Main API (default port 8000), run from backend/ — note app.main:app
cd backend && uvicorn app.main:app --reload --port 8000
```

```bash
# 3. Client app (default port 3000)
cd frontend/apps/client && npm run dev
```

```bash
# 4. Developer app (port 3001)
cd frontend/apps/admin && npm run dev
```

Interactive API docs are available at `http://localhost:8000/docs` (FastAPI default, not disabled in `main.py`).

First run only — create a developer account to log into either app with:

```bash
cd backend && python seed_admin.py you@studio.com
```

Frontend production build (repeat for each app directory):

```bash
cd frontend/apps/client && npm run build && npm start
cd frontend/apps/admin && npm run build && npm start
```

`agent4_service.py` binds `0.0.0.0` when run as `__main__`. Its port is `AGENT4_PORT` (default `8001`) and must match `AGENT4_BASE_URL` in the main API's environment.

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
| `JWT_SECRET_KEY` | string | falls back to `API_SECRET_KEY` if unset | `backend/app/core/config.py`, `auth.py` — signs the session cookie |
| `BACKEND_API_URL` | URL, **set per frontend app**, not `NEXT_PUBLIC_` | `http://localhost:8000` | `frontend/*/app/api/proxy/[...path]/route.ts` via `packages/core/lib/proxy.ts` — read server-side only |
| `BACKEND_API_KEY` | string, **set per frontend app**, not `NEXT_PUBLIC_` | `""` | same — must match `API_SECRET_KEY` |

`NEXT_PUBLIC_API_URL`/`NEXT_PUBLIC_API_KEY` (previously read directly by `frontend/lib/api.ts`) no longer exist in the codebase — replaced by the two `BACKEND_*` variables above, which the browser never sees.

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

🔒 = requires `X-API-Key` header matching `API_SECRET_KEY`. 🧑‍💻 = requires a logged-in session cookie with `role = "developer"` (`Depends(require_role("developer"))`) — see [Login sessions](#login-sessions).

| Method | Path | Auth | Parameters (type / format) |
|---|---|---|---|
| `POST` | `/run-agent` | 🔒 | Form: `script_text` (str, required), `task` (`compliance`\|`analyze`\|`release_listing`\|`release_check`\|`greenlight`), `session_id` (str, default `"default"`), `evaluate` (bool, default `false`) |
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
| `POST` | `/auth/login` | — | JSON body: `{email, password}`. Sets the `session` httpOnly cookie on success. Returns `{email, role}` |
| `POST` | `/auth/logout` | — | none. Clears the `session` cookie |
| `GET` | `/auth/me` | — (needs a valid session cookie, but no `X-API-Key`) | none. `401` if not logged in, else `{email, role}` |
| `GET` | `/auth/users` | 🧑‍💻 | none. Returns `{users: [{id, email, role, created_at}]}` |
| `POST` | `/auth/users` | 🧑‍💻 | JSON body: `{email, password, role}` — `role` ∈ `developer`\|`client`; `400` on duplicate email |
| `PATCH` | `/auth/users/{user_id}` | 🧑‍💻 | JSON body: `{role}` |
| `DELETE` | `/auth/users/{user_id}` | 🧑‍💻 | Path only |
| `GET` | `/admin/tables` | 🔒 🧑‍💻 | none |
| `GET` | `/admin/tables/{table}` | 🔒 🧑‍💻 | Query: `limit` (default 50, clamped to 1–200), `offset`, `q` (case-insensitive substring across every readable column) |
| `GET` | `/admin/tables/{table}/{row_id}` | 🔒 🧑‍💻 | Path: `table` ∈ the 5 registered tables (not `users`), `row_id` (int, or the sha256 key for `cache`) |
| `POST` | `/admin/tables/{table}` | 🔒 🧑‍💻 | JSON body: `{column: value, …}` — unknown columns rejected |
| `PATCH` | `/admin/tables/{table}/{row_id}` | 🔒 🧑‍💻 | JSON body: `{column: value, …}` |
| `DELETE` | `/admin/tables/{table}/{row_id}` | 🔒 🧑‍💻 | Path only. For `documents` this deletes the whole filename group |

The `/admin/tables` prefix requires **both** an API key and a developer-role session on **reads as well as writes**, unlike the app's other read endpoints. `/result/{id}` returns one known row; `GET /admin/tables/memory` returns every session anyone has run. See [Admin table browser](#admin-table-browser).

### Login sessions

`POST /auth/login` first rate-limits: `429` past 20 attempts/60s for the caller's source IP, and independently `429` past 5 attempts/60s for the submitted email — both via the same in-process `check_rate_limit` tracker `/run-agent` uses, so both reset on restart and aren't shared across worker processes. It then verifies `{email, password}` against the `users` table (PBKDF2 hash comparison) and, on success, sets a `session` cookie: httpOnly, `SameSite=Lax`, 12-hour expiry, carrying a JWT with `{sub, email, role, exp}` signed by `JWT_SECRET_KEY` (falls back to `API_SECRET_KEY` if unset). Every subsequent request that needs to know who's logged in reads that cookie — there is no bearer token returned to store client-side. `require_role("developer")` is a second, independent gate from `require_api_key`: an endpoint under both needs a valid `X-API-Key` header **and** a valid developer-role session cookie; missing either is a `401`/`403` depending on which is missing. Unlike `require_api_key`, `require_role` re-reads the user's current role from the DB (`get_user_by_id`) on every call rather than trusting the JWT's `role` claim, so a demotion or `DELETE /auth/users/{id}` takes effect immediately on gated routes instead of waiting out the 12-hour session. There is no signup endpoint — accounts are created by an existing developer via `POST /auth/users`, or, for the very first account, by running `backend/seed_admin.py` directly against the database. `PATCH`/`DELETE /auth/users/{id}` both refuse (`400`) to demote or delete the last remaining `developer` account (`count_developers() <= 1`), since doing so would lock every `/admin/*` and `/auth/users` route with no way back short of direct DB access.

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

**Error status codes actually raised:** `403` (missing/invalid API key, or logged in as the wrong role for `require_role`), `401` (no session / expired session / deleted account, for `require_role`-gated routes and `GET /auth/me`), `429` (rate limit — `/run-agent`/`/check-conflicts`/`/finalize-calendar` and, separately, `/auth/login`), `400` (unsafe/too-short input, unknown country code in overrides, or a rejected `/auth/*` body such as a bad role, a duplicate email, or demoting/deleting the last developer account). Several "not found" cases return a `200` with an `{"error": ...}` body rather than a `404` — see `main.py::get_result_endpoint` and the date endpoints; `/auth/users/{id}` write endpoints do use a real `404` when the id doesn't exist.

### Database writes

| Table | Written by | Contents |
|---|---|---|
| `documents` | `ingest.py::ingest_document` | `collection` (`guidelines`/`past_films`/`scripts`), chunk `text`, `metadata` JSONB (`{"filename": …}`), `embedding vector(768)` |
| `cache` | `/run-agent` | key `question` = `"{task}:{script_text}"`, `answer`, `created_at`; upsert on conflict |
| `memory` | `/run-agent` | `session_id`, `role` (`user`/`assistant`), `content` (truncated to 200 chars), `created_at` |
| `results` | `/run-agent` | `task`, `script_text`, `result`, `created_at`. Written by `database.py::record_run` together with the `memory` and `cache` rows, in one statement and one transaction |
| `eval_history` | `/run-agent` when `evaluate=true` | `task`, `faithfulness_score`, `created_at` |
| `users` | `POST /auth/users` (developer-only), or `backend/seed_admin.py` for the first account | `email` (unique), `password_hash`, `salt`, `role` (`developer`/`client`), `created_at`. Not reachable through `/admin/tables` — see [Admin table browser](#admin-table-browser) |

All six tables have `ROW LEVEL SECURITY` enabled by `init_tables()`, with no policies defined in the codebase.

### External side effects

- **Google Calendar events** — created by `_create_events_from_dates`, one per supported country. Summary format: `"Movie Launch — {genre} — {Country Name}"` truncated to 50 chars by `calendar_service_account.py:24`; all-day event spanning the date to date+1. Returns the event's `htmlLink`.
- **Logs** — `resilience.py:5` configures stdout logging as `%(asctime)s [%(levelname)s] %(message)s` under logger name `agentic_studio`. No log file is written; `*.log` in `.gitignore` is unused by the code.
- **Downloaded PDFs** — the browser saves `result_{id}.pdf` via `frontend/lib/api.ts::downloadResult`.

With **Demo Mode** on, none of the above happens: no calendar event, no database row, no file, and no network request of any kind. PDF download is refused with an explanation rather than faked, since the file is rendered server-side.

---

## Admin table browser

Generic list / read / create / update / delete over all five tables, for an admin UI that does not know the schema in advance. The SQL lives in `database.py` alongside every other query and uses the same `connection()` / `_fetch_*` / `_execute*` helpers — there is no second connection strategy.

### How the generic SQL stays safe

Only two things are ever interpolated into a statement, and neither comes from the request:

1. **Table names** come from `database.py::ADMIN_TABLES`, a hardcoded registry of the five tables. An unregistered name is a `400`, not a query.
2. **Column names** are checked against `information_schema.columns` for that table — the live schema, not a hardcoded list, because the schema is created with `CREATE TABLE IF NOT EXISTS` and has been hand-altered before.

Both must then satisfy `^[A-Za-z_][A-Za-z0-9_]*$` (`_safe`) before being quoted. Every value is a bound parameter. `ORDER BY` clauses are literals in the registry.

### Structural fields

Some columns are read for their *meaning* elsewhere in the app rather than stored as plain data. The API marks them but does not block editing them — the point is that a client can warn:

| Table.column | What depends on it |
|---|---|
| `results.script_text` | For `release_check` rows this is `"<date>\|<listing_result_id>"`, re-split by `/check-conflicts`, `/confirm-date`, `/override-date` and `/finalize-calendar` |
| `memory.created_at` + `memory.id` | `memory_get` orders by `created_at DESC, id DESC`; both turns of a run share a transaction timestamp, so the `id` tiebreaker is what keeps a reply after its question |
| `cache.created_at` | The 24-hour TTL is computed from this in SQL at read time. There is no expiry column, so moving it forward revives an expired answer |
| `cache.question` | A sha256 digest of `"<task>:<script_text>"`, not question text. Editing it orphans the row |
| `documents.embedding` | `vector(768)` written by `ingest.py`; dense search matches on it |
| `documents.metadata` | `metadata->>'filename'` is what groups the chunks of one PDF |

Each appears in the `columns[]` metadata as `"structural": true` with a `structural_note`, and any write that touches one comes back with a `structural_warnings` array naming it.

### Search

`?q=` matches a case-insensitive substring against every readable column, each cast to text, so one term covers ids, timestamps, task names and JSONB alike — `q=2026-11` finds a `created_at`, `q=thriller` finds a task. The count query carries the same filter, or pagination would page through a total that does not match the rows on screen.

`ponytail:` it is a sequential scan with an ILIKE per column — fine for a table you can browse by hand, wrong for one you cannot. A `pg_trgm` index per searched column, or a maintained `tsvector`, is the upgrade.

### Two behaviours worth knowing

- **`documents.embedding` is omitted from row payloads** — 768 floats per chunk would make a 50-row page unusable. It still appears in `columns[]` with `"omitted": true`.
- **Deleting a `documents` row deletes its whole filename group**, routed through the same `delete_documents_by_filename` path as `DELETE /document`, because one uploaded PDF is many chunk rows and removing one leaves a half-searchable document. The response carries `"grouped_by": "filename"` and the count. A chunk with no `metadata.filename` is refused with a `400` rather than deleted individually.

### Response shape

`GET /admin/tables/results?limit=2`:

```json
{
  "table": "results",
  "primary_key": "id",
  "ordered_by": "id DESC",
  "note": "One row per agent run…",
  "columns": [
    {"name": "id", "type": "integer", "nullable": false, "primary_key": true,
     "structural": false, "structural_note": null, "omitted": false},
    {"name": "script_text", "type": "text", "nullable": false, "primary_key": false,
     "structural": true, "structural_note": "For release_check rows this is…", "omitted": false}
  ],
  "pagination": {"limit": 2, "offset": 0, "total": 812, "returned": 2, "has_more": true},
  "rows": [{"id": 812, "task": "compliance", "script_text": "INT. WAREHOUSE…", "…": "…"}]
}
```

`PATCH` and `POST` return the row as it now stands plus `structural_warnings`; `DELETE` returns `deleted_rows` and `grouped_by`.

Creating rows is supported but rarely the right tool: every row in these tables is normally produced by a pipeline that maintains invariants a raw `INSERT` skips (`ingest_document` embeds and classifies, `record_run` writes results + memory + cache in one transaction). `documents` carries a note saying so; a row created there has no embedding and will never be returned by dense search.

---

## Client-side features

Four features live entirely in the browser, shared by both apps via `frontend/packages/core`. They exist because `lib/api.ts` routes every backend call through one `request<T>` helper, which makes it the only place that has to know about any of them — **no tab component was changed to add any of these.** Each keeps its state in a module-level store read through `useSyncExternalStore`, so none of them needs an effect (the React 19 lint config rejects `setState` in an effect body). Nothing is written to `localStorage`: every toggle is off again on reload.

The API log (below) is now **developer-app only** — `apps/client` doesn't import `ApiLogPanel` at all, it isn't a toggle a client-app user can even discover. The other three (Demo Mode, walkthroughs, activity feed) are in both apps. A fifth piece of client-side state, `lib/session.ts`'s `useSession()`, isn't in this list because it isn't a toggle — it's the login/role gate both app shells check before rendering anything else; see [Login sessions](#login-sessions).

### Demo Mode — `lib/demo.ts`

A boolean plus a fixture table. When on, `request<T>` resolves against `demoRequest()` and no socket is opened.

| | |
|---|---|
| Toggle | Header pill, off by default |
| Covers | `/health`, `/run-agent` (all four tasks), `/check-conflicts`, `/finalize-calendar`, `/confirm-date`, `/override-date`, `/ingest`, `/document`, `/result/{id}`, `/history/{id}`, `/eval/summary`, `/eval/chart` |
| Not covered | `GET /result/{id}/download` — the PDF is rendered by `reportlab` on the server, so there is nothing to fake. In Demo Mode the button explains that instead |
| Labelling | Every fixture body opens with a `DEMO DATA` line; the eval chart PNG is watermarked `DEMO`; a persistent amber banner sits under the header |
| Isolation | `app/page.tsx` keys the tab container on the flag, so toggling remounts every panel — a demo answer cannot be left on screen in live mode, or the reverse |

Adding a backend endpoint means adding a fixture: an unrouted path throws rather than resolving to nothing.

Result IDs in the fixtures are `4101` compliance, `4102` analyze, `4103` release_listing, `4104` release_check — `GET /result/4101` resolves, anything else returns the not-found shape.

### Guided walkthroughs — `lib/content.ts::WALKTHROUGHS`, `components/Walkthrough.tsx`

Four tours launched from the Start here tab, one per pipeline: `compliance` (7 steps), `analyze` (6), `release_listing` (6), `release_planner` (6). Starting one switches Demo Mode on; leaving Demo Mode ends the tour, so a walkthrough can never narrate live data.

Each step carries `where` (the control's physical location), `action`, `expect` (what the fixtures will show), and one visual aid:

| `visual.kind` | Renders as |
|---|---|
| `control` | A mock of the real control — tab strip, dropdown, textarea, date field, button, tick box or the Demo Mode switch — with an amber ring and an arrow |
| `beforeAfter` | Two stacked states with an arrow, for steps whose point is what changes |
| `flow` | The Release Planner's four stages with one lit; stage names are read from `PLANNER_STEPS`, not retyped |

The dock is non-modal and collapsible, so the tab underneath stays usable.

### Activity feed — `lib/activity.ts`, `components/ActivityFeed.tsx`

Transient narration in the bottom-left corner, capped at 3 items, auto-dismissed 6 s after settling. Supplementary to each panel's own result display, never a replacement for it.

`describeRequest(path, options)` is pure and returns the in-flight steps plus a closure that builds the completion line **from the actual response body** — which is why the feed reads identically in both modes:

| Action | Completion line, and where the number comes from |
|---|---|
| Run an agent | `Compliance report ready. Scored 8/10…` — `eval.score`; a cache hit says so instead, off `from_cache` |
| Upload a PDF | `Added 24 searchable pieces.` — `inserted_chunks` (`0` ⇒ "already in the knowledge base") |
| Remove a document | `Removed 24 pieces.` — `deleted_chunks` |
| Check holidays | `Found 2 clashes… for each of the 5 countries.` — counted off `conflict_report` |
| Create calendar events | `Created 5 calendar events, one per country.` — `Object.keys(events).length` |
| Load history | `Found 8 messages from earlier runs.` — `history.length` |

Endpoints with no entry are silent — that is what keeps the 30-second health poll out of the feed. Copy lives in `content.ts::ACTIVITY_COPY`; the checks reject any user-visible step containing `hybrid`, `rerank`, `embed`, `vector`, `chunk`, `collection`, `A2A`, `pgvector`, `BM25`, `supervisor` or `endpoint`.

### API log — `lib/apilog.ts`, `components/ApiLogPanel.tsx`

A bottom drawer, off by default, toggled by the `{ }` pill in the header. Recording is always on (a 50-entry ring buffer), so the panel can be opened *after* something goes wrong and still show the call.

One row per call: method chip, path, `simulated` badge for Demo Mode, status, duration, timestamp. Expanding a row (native `<details>`) shows headers, request payload and response body. Bodies are held by reference and only stringified on expand.

**The API key is never printed.** `maskSecrets()` replaces the key's value in headers, request payloads, error strings and response bodies, and the `X-API-Key` header is written as `••••••••` at the point of recording rather than at the point of display. This mattered more before the client/developer split: the key it was masking (`NEXT_PUBLIC_API_KEY`) used to be inlined into the JS bundle regardless (see [Known limitations](#security-notes)), so `maskSecrets()` was only stopping the log from being the thing that put it on screen. Now that both apps proxy through a server-side route holding `BACKEND_API_KEY`, the browser never has the key to begin with — `maskSecrets()` is cheap remaining insurance against whatever else ends up in a header or response body, not a fix for an otherwise-exposed secret.

Live entries settle with the real HTTP status from `liveRequest`; Demo Mode entries settle with `200` plus the `simulated` flag, which the row explains. An entry settles once, so the `catch` in `request<T>` cannot overwrite a status that was already recorded correctly. Every logging call is wrapped in `try/catch` — a logging failure can never fail a request that worked.

---

## Folder and File Structure

```
agentic-studio/
├── CLAUDE.md                       Guidance for Claude Code — commands, architecture, conventions
├── PROJECT_GUIDE.md                This file
├── README.md                       Top-level overview
├── backend/
│   ├── ARCHITECTURE.md             Design document: per-file responsibilities, known limitations
│   ├── requirements.txt            Pinned Python deps
│   ├── seed_admin.py               One-time CLI: create the first developer account
│   ├── test_release_conflicts.py   15 checks: release-date logic, retrieval confidence gate
│   ├── test_admin_tables.py        17 checks: admin registry, structural marking, identifier safety
│   ├── test_auth.py                11 checks: password hashing, session token, role gate
│   ├── app/
│   │   ├── main.py                 FastAPI app: every HTTP route, CORS, date-scheduling orchestration
│   │   ├── schemas.py              TaskType enum, AgentResponse, EvalResult pydantic models
│   │   ├── ai/
│   │   │   ├── supervisor.py       LangGraph router (4 tasks) + the Greenlight Committee graph
│   │   │   ├── agents.py           Every task implementation + TMDB genre ID map
│   │   │   └── evaluator.py        LLM-as-judge faithfulness scoring
│   │   ├── core/
│   │   │   ├── config.py           Single point where every env var is read
│   │   │   ├── llm.py              Gemini client: embed_text (768-dim) and generate_text, with retries
│   │   │   ├── guardrails.py       Input safety (length, profanity+direct-address, injection), retrieval confidence
│   │   │   ├── resilience.py       Retry decorator, in-memory rate limiter, logger, safe_generate fallback
│   │   │   └── auth.py             Password hashing, session JWT, require_role() — the login system
│   │   ├── data/
│   │   │   ├── database.py         All SQL: schema creation, BM25, eval aggregation, admin browser, users
│   │   │   ├── ingest.py           PDF chunking (300/50 words), LLM classification, dedupe, insert
│   │   │   └── retrieval.py        Hybrid dense+BM25 search with Gemini reranking
│   │   └── integrations/
│   │       ├── calendar_service_account.py   Google Calendar via service account (default path)
│   │       ├── calendar_mcp.py               Google Calendar via MCP stdio server (CALENDAR_MODE=mcp)
│   │       └── web_fetch.py                  Unused utility, kept for now — see Dead code
│   └── microservices/
│       └── agent4_service.py       Standalone A2A microservice: holiday/sport/awards conflict checking
└── frontend/
    ├── packages/core/              Shared code — not an npm package, see its own README.md
    │   ├── README.md               Why this folder exists and how the path aliases resolve it
    │   ├── globals.css             Design tokens, imported by both apps
    │   ├── lib/
    │   │   ├── api.ts              Every backend call + the types mirroring the API
    │   │   ├── content.ts          All user-facing copy: task info, glossary, walkthroughs, narration
    │   │   ├── demo.ts             Demo Mode flag, fixtures, walkthrough state
    │   │   ├── activity.ts         Activity-feed store + describeRequest()
    │   │   ├── apilog.ts           API-log ring buffer + maskSecrets()
    │   │   ├── session.ts          useSession() — the login/role gate hook, demo-aware
    │   │   ├── proxy.ts            The same-origin backend proxy both apps re-export
    │   │   └── demo.test.ts        Frontend checks — `node lib/demo.test.ts`
    │   └── components/
    │       ├── GuidePanel.tsx      "Start here" tab + the four walkthrough launchers
    │       ├── AgentsPanel.tsx     compliance / analyze / release_listing / release_check / greenlight
    │       ├── ReleasePlanner.tsx  The four-step release-date flow
    │       ├── DocumentsPanel.tsx  Upload and remove PDFs
    │       ├── HistoryPanel.tsx    Session turns + result lookup/download
    │       ├── InsightsPanel.tsx   Faithfulness summary and chart
    │       ├── Walkthrough.tsx     Guided-tour dock + its three visual-aid renderers
    │       ├── ActivityFeed.tsx    Plain-language narration stack
    │       ├── LoginForm.tsx       Shared email/password form, used by both apps
    │       └── ui.tsx              Shared presentational pieces, no data fetching
    ├── apps/client/                Start here · Documents · Agents · Release Planner · History · Insights
    │   ├── app/page.tsx            App shell: header, mode toggle, health poller, login gate, tabs
    │   ├── app/layout.tsx          Root layout
    │   ├── app/globals.css         `@import`s packages/core/globals.css
    │   ├── app/api/proxy/[...path]/route.ts   Re-exports packages/core/lib/proxy.ts
    │   ├── package.json            Next 16 / React 19 / Tailwind 4 — its own install, port 3000
    │   ├── tsconfig.json           Path-maps @/lib, @/components into packages/core
    │   └── next.config.ts          turbopack.root points at frontend/, not this app's own directory
    └── apps/admin/                 Everything client has, plus Database, API Log, Users
        ├── app/page.tsx            Same shell, + the three admin-only tabs, + role check
        ├── app/api/proxy/[...path]/route.ts   Same re-export
        ├── components/             Admin-only, imported via the @/admin/* alias:
        │   ├── DatabasePanel.tsx       Visual browser over the 5 non-users tables
        │   ├── DatabaseEditor.tsx      Add/edit form + delete confirmation for those tables
        │   ├── ApiLogPanel.tsx         Technical request/response drawer
        │   └── UsersPanel.tsx          Create/list/change-role/remove accounts
        ├── package.json            Same stack, port 3001 (`-p 3001` on dev/start)
        └── next.config.ts          Same turbopack.root fix as apps/client
```

### Dead code (removed August 2026)

All of the following were found unused and have been deleted:

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

**None found.** No `.github/`, no `Dockerfile`, no `Procfile`, no `vercel.json`, no `render.yaml`. Git history mentions a Vercel deployment and Linux deployment fixes (commits `b7bd72f`, `c7671ce`), but no deployment configuration is committed. `main.py`'s CORS config is currently `allow_origins=["*"]` — wide open, not a per-deployment list (see Security Notes below) — so there is no origin allowlist to keep in sync with a deployment target in the first place.

### Tests

`test_release_conflicts.py` — **15 checks, no test framework required**:

```bash
python test_release_conflicts.py
```

It uses plain `assert` statements and a `__main__` runner, so it needs nothing installed, but is written so `pytest` collects it unchanged if pytest is ever added.

Coverage: the listing parser (including titles containing parentheses, and undated films), the 14-day competition window at its inclusive boundary, signed day offsets, same-day releases, and all four `retrieval_status` states — in particular that an unscored result is not mistaken for an irrelevant one.

`test_admin_tables.py` — **17 checks, no framework required**:

```bash
python test_admin_tables.py
```

Covers the admin browser's validation layer: the registry is complete, an unregistered table is unreachable, the three documented invariants are marked structural, warnings fire only for structural columns, `documents` deletes by filename group and omits embeddings, and — the one that matters most — `_safe()` refuses every identifier that is not a plain identifier (`id; DROP TABLE results`, `a"b`, `id --`, `results.id`, …), since that is the only place a name is interpolated into SQL.

Not covered, because they need a live database: `admin_columns` (reads `information_schema`), `_validate_writable`, and every statement that touches a real row.

`frontend/lib/demo.test.ts` — **the frontend checks, also framework-free**:

```bash
cd frontend && node lib/demo.test.ts
```

Node ≥ 22.6 strips the TypeScript types natively, so this needs nothing installed either. Two consequences worth knowing: `tsconfig.json` sets `allowImportingTsExtensions` (safe under `noEmit`) because the test imports `./demo.ts` with its extension, and `lib/activity.ts` imports `./content.ts` relatively rather than through the `@/` alias, which bare node cannot resolve.

Coverage:

- **Demo Mode** — every path `lib/api.ts` can call has a fixture; an unrouted path rejects; fixtures label themselves as demo data; the calendar fixture's links point at a day view rather than an event id; an override does not stick to the fixture; the document list is frozen.
- **Walkthroughs** — starting one forces Demo Mode on; leaving Demo Mode ends it; restarting rewinds it; all four pipelines exist and no step is missing a visual aid or a `where` line.
- **Activity feed** — the ten narrated routes produce the expected outcome line *when fed the real fixtures*; the health poll and the eval chart stay silent; a cache hit says so; no user-visible step contains internal vocabulary; a malformed body does not throw.
- **API log** — the API key is masked in headers, payloads and response bodies; an entry settles once; the buffer caps at 50.

Between them these are the only tests in the repo. The database, LLM, A2A, calendar and ingestion paths have no automated coverage, and no test exercises a React component — the checks cover the stores and the pure functions the components read.

---

## Troubleshooting

Only issues discoverable from the code, its comments, or its error handling:

**"backend not reachable" badge in the UI, backend is running.**
Both apps proxy every call through their own `app/api/proxy/[...path]/route.ts` (server-side), which forwards to `BACKEND_API_URL` (default `http://localhost:8000` if unset). Check that env var is set correctly in the app's own `.env.local` (`frontend/apps/client/.env.local` or `frontend/apps/admin/.env.local`) and restart `npm run dev` — Next.js only re-reads `.env.local` on server start, not on every request. Since this is now read server-side rather than inlined at build time (unlike the old `NEXT_PUBLIC_API_URL`), the proxy route's own server logs are the first place to check when this badge shows.

**Everything works but the answers look canned, or a `DEMO DATA` banner is showing.**
Demo Mode is on — the header toggle is amber. Switch it off to reach the real backend. It also switches itself on whenever a guided walkthrough is started from the Start here tab.

**A walkthrough step points at a control that is not there.**
The `where` text in `content.ts::WALKTHROUGHS` describes real screen positions and nothing enforces that it stays true. If a control moved in `AgentsPanel.tsx` or `ReleasePlanner.tsx`, that step's text needs updating by hand.

**`Demo Mode has no fixture for POST /some-path.`**
A new endpoint was added to `lib/api.ts` without a matching entry in `lib/demo.ts::ROUTES`. Deliberate: a silently empty response would be worse. Add the fixture; `node lib/demo.test.ts` will tell you if any path is still uncovered.

**All protected endpoints return `403 "Missing or invalid API key."`**
`main.py::require_api_key` fails closed: if `API_SECRET_KEY` is unset on the server, *every* request is rejected regardless of what the client sends.

**Browser CORS errors.**
`main.py`'s `allow_origins` is currently `["*"]` — every origin is allowed, so this shouldn't happen when calling the backend directly. It almost always means the request is being blocked somewhere else (a proxy misconfiguration, a network error surfacing as a CORS-shaped message in devtools) rather than an actual CORS rejection. Neither frontend app should be calling the backend directly from the browser in the first place — both proxy through their own same-origin `app/api/proxy/[...path]/route.ts` — so a real CORS error usually means a call bypassed that proxy.

**`429 "Rate limit exceeded. Please wait before submitting another request."`**
10 requests per 60 s per `session_id`, on `/run-agent`, `/check-conflicts`, and `/finalize-calendar`. The tracker is a plain module-level dict (`resilience.py:31`), so it resets on restart and is per-worker — running multiple uvicorn workers multiplies the effective limit.

**`429 "Too many login attempts. Try again shortly."`**
A different limit, on `POST /auth/login` only: 20 attempts/60s per source IP, and independently 5 attempts/60s per submitted email. Same underlying in-process tracker and the same per-restart/per-worker caveat as above.

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
As committed, the file is plain UTF-8/ASCII, so this shouldn't happen against the repo as-is. It *can* happen after regenerating the file — a `pip freeze > requirements.txt` run from Windows PowerShell writes UTF-16 by default, visible as null-byte-separated characters. Convert to UTF-8 first — command in the Installation section — if that's how the file was last regenerated.

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

1. **Resolved: `NEXT_PUBLIC_API_KEY` inlined into the client JS bundle.** This was true before the client/developer split. Both frontend apps now proxy every call through their own `app/api/proxy/[...path]/route.ts`, which attaches the key server-side from a non-public `BACKEND_API_KEY` — the browser never receives it. `apilog.ts::maskSecrets()` (still exercised by the frontend checks) is now defense-in-depth rather than covering for an otherwise-real exposure.
2. **`ninth-wares-462308-f5-c99c6f0176a0.json` is not gitignored.** `.gitignore` covers `gcp-credentials.json` and `service-account-credentials.json` only. If this is a GCP key, one `git add .` commits it.
3. **RLS is enabled with no policies.** `init_tables()` enables row-level security on all six tables (including `users`) but the codebase defines no policies — the app connects via `DATABASE_URL`, presumably as an owner/bypass role. Exact role: **Unknown / not found in codebase**.
4. **Read endpoints are unauthenticated.** `/result/{id}`, `/result/{id}/download`, `/history/{session_id}`, `/eval/summary`, and `/eval/chart` carry no `require_api_key` dependency, and result IDs are sequential integers. `/auth/me` is also reachable with no `X-API-Key` by design — it only reads whatever session cookie was sent, which a caller can't forge without the signing secret.
5. **`/auth/login` is rate-limited, but only in-process.** It throttles per source IP (20 requests/60s) and independently per submitted email (5 requests/60s), reusing the same `resilience.check_rate_limit` tracker `/run-agent` uses — so like that one, the counters reset on restart and aren't shared across worker processes. Fine for a single-process internal deployment; a multi-worker/multi-instance one would need a shared store to make the limit hold across all of them.
6. **Sessions are stateless JWTs with no general revocation list, but not entirely unchecked.** `require_role` (gating every `/admin/tables/*` and `/auth/users*` route) re-reads the user's row from the DB on each call, so deleting or demoting a user via `DELETE`/`PATCH /auth/users/{id}` takes effect on those routes immediately. The gap: `GET /auth/me` and anything relying only on `get_current_user` (JWT decode, no DB lookup) still treats a deleted account's still-valid token as logged in until it naturally expires (12 hours).
7. **No password reset or self-service change.** `PATCH /auth/users/{id}` only accepts a role change. The only way to change a password today is for a developer to delete the account and recreate it.
