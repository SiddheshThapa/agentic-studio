# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

Three processes, three terminals (from repo root):

```bash
python agent4_service.py            # Agent 4 conflict checker, port 8001 (AGENT4_PORT)
uvicorn main:app --reload --port 8000
cd frontend && npm run dev          # Next.js, port 3000
```

- Tests: `python test_release_conflicts.py` — 15 checks, plain asserts, no framework needed. Written so pytest collects it unchanged if pytest is ever added. Covers the release-date logic and the retrieval confidence gate.
- Frontend: `npm run lint`, `npx tsc --noEmit`, `npm run build`. The lint config enforces React 19's `react-hooks/set-state-in-effect` — a bare `setState()` call in an effect body fails the build. Fetch inside an inline async IIFE with a `cancelled` guard (see `InsightsPanel.tsx`), or use `useSyncExternalStore` for external stores (see `DocumentsPanel.tsx`).
- DB schema: created idempotently by `init_tables()` on first use — no migration tool. Adding a column means editing `_create_schema()` **and** hand-applying it to existing databases (`CREATE TABLE IF NOT EXISTS` won't alter one).
- Interactive API docs: `http://localhost:8000/docs`.
- No CI. `requirements.txt` lists direct dependencies only, not a `pip freeze`.

## Architecture

Two Python FastAPI services plus a Next.js frontend. `main.py` is the only service the frontend talks to; it calls `agent4_service.py` over the **A2A protocol** (`A2ACardResolver` → `A2AClient`), not plain HTTP. `AGENT4_BASE_URL` must match where Agent 4 actually listens.

`POST /run-agent` flow: rate limit (`resilience.check_rate_limit`, in-process dict — resets on restart, not shared across workers) → `guardrails.check_query_safety` → `cache_get` → `supervisor.run_supervisor` → `database.record_run` → optional faithfulness eval.

`supervisor.py` is a LangGraph `StateGraph` with exactly one node that switches on `state["task"]`. It is a router, not a multi-step graph — adding a task means a branch in `route_node` plus a member in `schemas.TaskType`.

RAG lives in `retrieval.py::hybrid_search`: dense pgvector search + BM25 → max-normalized 0.6/0.4 blend → LLM rerank. Collections (`guidelines`, `past_films`, `scripts`) are assigned per chunk by an LLM classifier in `ingest.py`.

The release-date workflow spans several endpoints and uses `results.script_text` as a state carrier: `release_check` results store `"<date>|<listing_result_id>"`, and `/check-conflicts`, `/confirm-date`, `/override-date`, `/finalize-calendar` all re-split that string. Changing the format breaks all four. The frontend assembles it in `ReleasePlanner.tsx` so users never see it.

Calendar writes go through `_create_calendar_event`: `CALENDAR_MODE=mcp` tries the stdio MCP server (spawns `npx @cocal/google-calendar-mcp`) and **silently falls back** to the service-account path on any failure.

## Database access — read before touching database.py

All queries go through a lazily-built `ThreadedConnectionPool`. Connecting to the remote Postgres costs ~2.4s, so a connection-per-query design spent almost all of its time on handshakes.

- Use the `connection()` context manager, or the `_fetch_one` / `_fetch_all` / `_execute` / `_execute_returning` helpers. **Never call `.close()` on a pooled connection** — that destroys it instead of returning it. There is no `get_connection()` anymore, deliberately.
- The pool is built on first use, not at import, so an unreachable database fails individual endpoints rather than preventing the module from importing.
- `record_run()` writes the `results`, `memory`, and `cache` rows for one agent run in a **single statement** using data-modifying CTEs — one round trip, one transaction. Pass `cache_question=None` on a cache hit to skip the cache write.
- `/run-agent` makes exactly **3** round trips: `cache_get`, the supervisor's data fetch, and `record_run`. If you add a query to this path, you are adding ~1 second. Check first whether an existing query can return the column you need.
- Both memory rows from one run share a transaction timestamp, so `memory_get` orders by `created_at DESC, id DESC`. Dropping the `id` tiebreaker makes replies sort before their questions.

## Retrieval confidence — four states, not a boolean

`guardrails.retrieval_status()` returns `empty` / `unscored` / `low_relevance` / `confident`. Prefer it over the legacy `check_retrieval_confidence()` boolean.

`rerank_score` is **0–10** (absolute relevance, from the LLM reranker) and is `None` when reranking failed. `hybrid_score` is **0.0–1.0** (max-normalized rank order). They are not interchangeable: back-filling `rerank_score` from `hybrid_score` was a real bug — the value could never reach the 5.0 threshold, so every reranker outage was reported to users as "no relevant guidelines found."

Treat `unscored` as usable-with-a-caveat, not as failure.

## Conventions

- LLM access only via `llm.py` (`generate_text` / `embed_text`, Google Gemini, 768-dim embeddings hard-coded to match the `vector(768)` column). Wrap calls that must not raise in `resilience.safe_generate`.
- **Don't reach for an LLM when the data is already structured.** `check_release_conflicts` does date arithmetic, not prompting — it was an LLM call, and the replacement is ~5000× faster, free, and can't hallucinate a film. Same reasoning applies to anything operating on TMDB fields or dates.
- All mutating endpoints require `X-API-Key` via `Depends(require_api_key)`; read endpoints (`/health`, `/result/*`, `/history/*`, `/eval/*`) are open.
- `SUPPORTED_COUNTRIES` (config.py, env-driven) is authoritative; `COUNTRY_DISPLAY_NAMES` in `main.py` only labels events.
- CORS origins are a hard-coded list in `main.py` — new deploy domains must be added there.

## Frontend

```
app/page.tsx          shell: header, health badge, tab switching
components/           one file per tab + ui.tsx for shared pieces
lib/api.ts            every backend call
lib/content.ts        every sentence of user-facing explanation
```

`lib/content.ts` is the single source of truth for explanatory copy, and it mirrors backend constants — `GENRES` must match `agents.py::GENRE_IDS`, `MIN_SCRIPT_CHARS` must match the `min_length` in `run_agent_endpoint`. Update both together.

The UI is written for someone who has never seen the tool: each task states what it does, what input it needs, and what comes back. Keep that property when adding features. `NEXT_PUBLIC_API_KEY` ships to the browser, so the API key is effectively public — a route handler proxying to FastAPI would fix it.

## Known issues, not yet fixed

- `database.bm25_search` rebuilds the entire BM25 index from every row on every query — the hard scaling wall.
- `ingest.py` classifies **per chunk**, so one document can scatter across collections; it should be one decision per document. Chunks store no page numbers, so citations can't point at a location.
- `main.py::_nearest_clear_date` shifts 4 days off the nearest conflict and never re-checks, so it can land on a second holiday.
- Sporting and awards dates in `agent4_service.py` are hardcoded for 2026–2028 and will rot silently.
- `/confirm-date` and `/override-date` duplicate what `/finalize-calendar` does; the UI no longer calls them.
- Self-reported faithfulness averages **4.86/10**, i.e. the system's own metric says answers are about half grounded.

## Reference

`ARCHITECTURE.md` (per-file responsibilities, sync/async boundaries) and `PROJECT_GUIDE.md` (setup, env vars, endpoint contracts, troubleshooting). Both predate the August 2026 changes in places — this file is authoritative where they disagree.
