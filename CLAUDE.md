# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

Four processes, four terminals (from repo root):

```bash
cd backend && python microservices/agent4_service.py     # Agent 4 conflict checker, port 8001 (AGENT4_PORT)
cd backend && uvicorn app.main:app --reload --port 8000   # main API — note the app.main:app module path
cd frontend/apps/client && npm run dev                    # client app, port 3000
cd frontend/apps/admin && npm run dev                     # developer app, port 3001
```

Every backend module imports via the `app.` package prefix (`from app.core.config import ...`), so it must run with `backend/` as the working directory — `uvicorn app.main:app`, not `cd backend/app && uvicorn main:app`. `microservices/agent4_service.py` works around this itself by prepending `backend/` to `sys.path`, so it runs correctly either as `python microservices/agent4_service.py` or from inside `microservices/`.

Nothing in the client or developer app requires the other to be running — each is a normal Next.js app with its own `package.json`, own port, own `.env.local`. Both need the backend and (for the release-date flow) Agent 4.

- Backend tests, from `backend/`: `python test_release_conflicts.py` (15 checks — release-date logic, retrieval confidence gate), `python test_admin_tables.py` (17 checks — admin registry, structural marking, SQL identifier safety), `python test_auth.py` (11 checks — password hashing, session JWT roundtrip/tamper, and the role gate's 401/403/pass paths including DB-recheck-on-downgrade and deleted-account cases). Plain asserts, no framework needed; all three written so pytest collects them unchanged if pytest is ever added.
- Frontend checks: `node lib/demo.test.ts` from `frontend/packages/core` — same style, no runner (Node ≥ 22.6 strips the types). Covers Demo Mode fixtures, the walkthrough store, activity narration and API-key masking.
- Frontend, run inside **each** of `frontend/apps/client` and `frontend/apps/admin` separately (they are independent installs): `npm run lint`, `npx tsc --noEmit`, `npm run build`. The lint config enforces React 19's `react-hooks/set-state-in-effect` — a bare `setState()` call in an effect body fails the build. Fetch inside an inline async IIFE with a `cancelled` guard (see `InsightsPanel.tsx` or `lib/session.ts`), or use `useSyncExternalStore` for external stores (see `DocumentsPanel.tsx`).
- DB schema: created idempotently by `init_tables()` on first use — no migration tool. Adding a column means editing `_create_schema()` **and** hand-applying it to existing databases (`CREATE TABLE IF NOT EXISTS` won't alter one).
- First developer account: `python backend/seed_admin.py you@studio.com` (prompts for a password). There is no signup UI — every account after the first is created from the Users tab in the developer app.
- Interactive API docs: `http://localhost:8000/docs`.
- No CI. `backend/requirements.txt` lists direct dependencies only, not a `pip freeze`.

## Architecture

Two Python FastAPI services plus **two** Next.js frontends sharing one component/lib package. `app.main` (in `backend/app/main.py`) is the only backend service either frontend talks to; it calls `microservices/agent4_service.py` over the **A2A protocol** (`A2ACardResolver` → `A2AClient`), not plain HTTP. `AGENT4_BASE_URL` must match where Agent 4 actually listens.

`POST /run-agent` flow: rate limit (`resilience.check_rate_limit`, in-process dict — resets on restart, not shared across workers) → `guardrails.check_query_safety` → `cache_get` → `supervisor.run_supervisor` → `database.record_run` → optional faithfulness eval.

`supervisor.py` is a LangGraph `StateGraph` with exactly one node that switches on `state["task"]` for four of the five tasks (compliance / analyze / release_listing / release_check); the fifth, `greenlight`, runs its own multi-node LangGraph debate graph (`build_greenlight_committee`) instead. Adding a *routed* task means a branch in `route_node` plus a member in `schemas.TaskType`; adding another standalone graph means a new `build_*` function and a branch in `run_supervisor`.

RAG lives in `app/data/retrieval.py::hybrid_search`: dense pgvector search + BM25 → max-normalized 0.6/0.4 blend → LLM rerank. Collections (`guidelines`, `past_films`, `scripts`) are assigned per chunk by an LLM classifier in `app/data/ingest.py`.

The release-date workflow spans several endpoints and uses `results.script_text` as a state carrier: `release_check` results store `"<date>|<listing_result_id>"`, and `/check-conflicts`, `/confirm-date`, `/override-date`, `/finalize-calendar` all re-split that string. Changing the format breaks all four. The frontend assembles it in `ReleasePlanner.tsx` so users never see it.

Calendar writes go through `_create_calendar_event`: `CALENDAR_MODE=mcp` tries the stdio MCP server (spawns `npx @cocal/google-calendar-mcp`) and **silently falls back** to the service-account path on any failure.

## Login sessions and roles — read before touching auth

`app/core/auth.py` + `app/data/database.py`'s seven `users` functions are the whole login system: a `users` table (`email`, PBKDF2 `password_hash`+`salt`, `role` ∈ `developer`|`client`), a JWT session cookie (`COOKIE_NAME = "session"`, 12h, signed with `JWT_SECRET_KEY` falling back to `API_SECRET_KEY`), and `require_role(*roles)` — a FastAPI dependency, used the same way as `Depends(require_api_key)`.

- `require_role("developer")` gates all six `/admin/tables/*` routes (**layered on top of** `require_api_key`, not instead of it) and all four `/auth/users` routes. `/auth/login`, `/auth/logout`, `/auth/me` need no role — they're how you get a session in the first place.
- `require_role` re-checks the role (and existence) against `get_user_by_id` on **every** call rather than trusting the JWT's `role` claim alone — the claim is a snapshot from login time, so without this a demoted or deleted account would keep developer access until its 12h session expired. None of `require_role`'s callers are on the latency-sensitive `/run-agent` path, so the extra query is acceptable there.
- The `users` table is deliberately **not** in `ADMIN_TABLES` — the generic admin browser casts every column to text for `?q=` search and returns whole rows, which is wrong for a table holding password hashes. `create_user`/`get_user_by_email`/`get_user_by_id`/`list_users`/`count_developers`/`update_user_role`/`delete_user` in `database.py` are the only way to touch it.
- `main.py::_refuse_if_last_developer` blocks demoting or deleting the only remaining developer account (via `count_developers`) — without it, that action locks every `/admin/*` and `/auth/users` route with no way back in short of direct DB access and re-running `seed_admin.py`.
- No signup flow. The first account comes from `backend/seed_admin.py`; every account after that from the developer app's Users tab (`apps/admin/components/UsersPanel.tsx` → `/auth/users`).
- `/auth/login` **is** rate-limited (unlike other auth routes), via the same in-process `resilience.check_rate_limit` tracker `/run-agent` uses: 20 attempts/60s per source IP and 5 attempts/60s per email, checked independently so both credential stuffing (many emails, one IP) and brute-forcing one account (many IPs) get throttled. Resets on restart and isn't shared across workers, same caveat as everywhere else that tracker is used.

## Two frontends, one backend

`frontend/` is an npm-workspace-free monorepo: `packages/core` (shared, no build of its own) plus two independent Next.js apps, `apps/client` and `apps/admin`. Full detail in `frontend/packages/core/README.md`; the short version:

- **`packages/core`** — every backend call (`lib/api.ts`), all copy (`lib/content.ts`), Demo Mode, the activity feed, the API log store, the session hook (`lib/session.ts`), design tokens (`globals.css`), and every panel that isn't developer-only (Agents, Documents, Release Planner, History, Insights, Guide, Walkthrough, `LoginForm`, plus `ui.tsx`). Not an npm package — no build, no `node_modules` entry for it in either app. Each app's `tsconfig.json` maps `@/lib/*` and `@/components/*` straight into this folder as plain filesystem paths, and it carries its own tiny `package.json` (react/tailwind/typescript/next only) purely so those imports resolve when type-checked from outside. **Never** import from `apps/*` into `packages/core` — only the other way around.
- **`apps/client`** — Start here, Documents, Agents, Release Planner, History, Insights. `SHELL_COPY.tabs` (shared, includes "Database") is filtered to drop it here rather than forked into a second tab list.
- **`apps/admin`** — everything `apps/client` has, plus Database, the API Log overlay, and Users — imported under a distinct `@/admin/*` alias (`apps/admin/components/`), specifically so they can never end up in the client bundle by accident. `SHELL_COPY.tabs` is extended with one extra `Users` entry, appended in `apps/admin/app/page.tsx` rather than added to the shared list.
- Both apps gate on login: `useSession()` (`packages/core/lib/session.ts`) checks `/auth/me` on load and renders `LoginForm` until it succeeds. The admin app additionally checks `role === "developer"` and shows a plain "no developer access" screen otherwise, with sign-out. Demo Mode bypasses the check entirely with a synthetic session — it never touches the network, session included.
- **Neither app calls the backend directly from the browser.** Both proxy every call through their own `app/api/proxy/[...path]/route.ts` (thin re-export of `packages/core/lib/proxy.ts`), which runs server-side, attaches `X-API-Key` from a **non**-`NEXT_PUBLIC_` env var (`BACKEND_API_KEY`), and streams the response back — including `Set-Cookie`, so the session cookie set by `/auth/login` stays same-origin for the browser even though the backend runs on a different port. `NEXT_PUBLIC_API_KEY` no longer exists anywhere in the code; don't reintroduce a `NEXT_PUBLIC_`-prefixed secret.
- Turbopack's `root` in each app's `next.config.ts` points two levels up (`frontend/`, not the app's own directory) — required because these apps import source from outside their own folder (`../../packages/core`) and Turbopack refuses to resolve imports outside its declared root otherwise.
- Dev ports: client `3000` (default), admin `3001` (`next dev -p 3001`, set in `apps/admin/package.json`).

## Database access — read before touching database.py

All queries go through a lazily-built `ThreadedConnectionPool`. Connecting to the remote Postgres costs ~2.4s, so a connection-per-query design spent almost all of its time on handshakes.

- Use the `connection()` context manager, or the `_fetch_one` / `_fetch_all` / `_execute` / `_execute_returning` helpers. **Never call `.close()` on a pooled connection** — that destroys it instead of returning it. There is no `get_connection()` anymore, deliberately.
- The pool is built on first use, not at import, so an unreachable database fails individual endpoints rather than preventing the module from importing.
- `record_run()` writes the `results`, `memory`, and `cache` rows for one agent run in a **single statement** using data-modifying CTEs — one round trip, one transaction. Pass `cache_question=None` on a cache hit to skip the cache write.
- `/run-agent` makes exactly **3** round trips: `cache_get`, the supervisor's data fetch, and `record_run`. If you add a query to this path, you are adding ~1 second. Check first whether an existing query can return the column you need.
- Both memory rows from one run share a transaction timestamp, so `memory_get` orders by `created_at DESC, id DESC`. Dropping the `id` tiebreaker makes replies sort before their questions.

## Admin table browser

`ADMIN_TABLES` (database.py) + the `/admin/tables` routes are generic CRUD over the five non-`users` tables, for a UI that doesn't know the schema. Same pool and same helpers as everything else.

- **Only two things are ever interpolated into a statement**: a table name from the `ADMIN_TABLES` registry, and a column name checked against `information_schema` for that table. Both must pass `_safe()`'s identifier regex first. Values are always parameters. Keep it that way — this is the one place in the codebase that builds SQL from names.
- Columns other code reads *for meaning* are listed per table in `ADMIN_TABLES[...]["structural"]` with a note saying what breaks. Edits are allowed; the API returns `structural_warnings` instead. Adding an invariant elsewhere in the app means adding it here.
- Deleting a `documents` row deletes **every chunk sharing its filename**, via `delete_documents_by_filename` — one PDF is many rows. A chunk with no `metadata.filename` is refused rather than deleted alone.
- `documents.embedding` is omitted from row payloads (768 floats × 50 rows); it stays in the column metadata flagged `omitted`.
- Reads require **both** `require_api_key` and `require_role("developer")`, unlike `/result/{id}` and `/history/{id}` — a whole-table dump is a different exposure, and now also a different audience (developer app only).
- `?q=` searches by casting every readable column to text and ILIKE-ing it. The count query must keep the same filter or pagination pages past the end.
- Checks: `python test_admin_tables.py`.

`apps/admin/components/DatabaseEditor.tsx` holds the write controls. Structural fields are gated three deep — unlock the field, confirm the risk, confirm again on save listing every structural column actually changed — and never blocked. `DATABASE_WRITE_COPY.structuralRisks` (keyed `table.column`) is the *what breaks* sentence; a column with no entry gets a vaguer fallback but never silence, so a newly flagged column degrades safely. Deletes always name their consequence, and `documents` deletes the whole filename group with the count in the confirmation. Every write bumps a `reload` counter that is part of the fetch's request key, so the list and the per-table counts refetch — a UI showing the pre-save value is how people learn not to trust it.

The **Database tab** (`apps/admin/components/DatabasePanel.tsx`) is the browser: five per-collection renderers, never a JSON dump or a cell grid. It reads `columns[].structural` from the API to decide *which* fields to badge, and `DATABASE_COPY.structuralLabels` for *how to say it* — the backend's own notes name endpoints and are not shown to users. Its loading state is derived from whether the loaded page matches the current table/offset/query, because `setLoading(true)` at the top of an effect is exactly what `react-hooks/set-state-in-effect` rejects.

## Retrieval confidence — four states, not a boolean

`guardrails.retrieval_status()` returns `empty` / `unscored` / `low_relevance` / `confident`. Prefer it over the legacy `check_retrieval_confidence()` boolean.

`rerank_score` is **0–10** (absolute relevance, from the LLM reranker) and is `None` when reranking failed. `hybrid_score` is **0.0–1.0** (max-normalized rank order). They are not interchangeable: back-filling `rerank_score` from `hybrid_score` was a real bug — the value could never reach the 5.0 threshold, so every reranker outage was reported to users as "no relevant guidelines found."

Treat `unscored` as usable-with-a-caveat, not as failure.

## Conventions

- LLM access only via `app/core/llm.py` (`generate_text` / `embed_text`, Google Gemini, 768-dim embeddings hard-coded to match the `vector(768)` column). Wrap calls that must not raise in `resilience.safe_generate`.
- **Don't reach for an LLM when the data is already structured.** `check_release_conflicts` does date arithmetic, not prompting — it was an LLM call, and the replacement is ~5000× faster, free, and can't hallucinate a film. Same reasoning applies to anything operating on TMDB fields or dates.
- All mutating endpoints require `X-API-Key` via `Depends(require_api_key)`; `/admin/*` and `/auth/users*` additionally require `Depends(require_role("developer"))`; `/auth/login`/`/auth/logout`/`/auth/me` require neither (they establish or read the session itself); other read endpoints (`/health`, `/result/*`, `/history/*`, `/eval/*`) are open.
- `SUPPORTED_COUNTRIES` (config.py, env-driven) is authoritative; `COUNTRY_DISPLAY_NAMES` in `main.py` only labels events.
- CORS is currently wide open in `main.py` (`allow_origins=["*"]`, no per-origin list, `allow_credentials` unset/default `False`). Since both frontends proxy through their own Next.js server rather than calling the backend directly from the browser (see "Two frontends, one backend" above), this isn't load-bearing for the current topology — the browser never talks cross-origin to the backend at all. It's still a real gap for the unauthenticated read endpoints (`/result/*`, `/history/*`, `/eval/*`): CORS and the API key are independent protections, and the wildcard means any origin can read them directly. A future direct browser client would need a real origin allowlist and, if it's expected to carry the session cookie cross-origin, `allow_credentials=True` (which is incompatible with `allow_origins=["*"]` per the CORS spec and would require an explicit origin list instead).

## Frontend

```
frontend/
  packages/core/
    lib/api.ts            every backend call — and the one seam everything below hooks into
    lib/content.ts        every sentence of user-facing explanation
    lib/demo.ts            Demo Mode: flag, fixtures, walkthrough state
    lib/activity.ts        plain-language narration store
    lib/apilog.ts           technical request/response log
    lib/session.ts          useSession() — login/role gate, demo-aware
    lib/proxy.ts             the same-origin backend proxy both apps re-export
    lib/demo.test.ts        all frontend checks — `node lib/demo.test.ts`
    components/             ui.tsx + every panel that isn't developer-only
    globals.css              design tokens, imported by both apps
  apps/client/
    app/page.tsx            shell: header, mode toggle, health badge, client's 6 tabs
    app/api/proxy/[...path]/route.ts   re-exports packages/core/lib/proxy.ts
  apps/admin/
    app/page.tsx            shell: same as client, + Database/API Log/Users
    app/api/proxy/[...path]/route.ts   same re-export
    components/              admin-only: DatabasePanel, DatabaseEditor, ApiLogPanel, UsersPanel
                              (imported via the @/admin/* alias, never @/components/*)
```

`lib/content.ts` is the single source of truth for explanatory copy, and it mirrors backend constants — `GENRES` must match `agents.py::GENRE_IDS`, `MIN_SCRIPT_CHARS` must match the `min_length` in `run_agent_endpoint`. Update both together.

The UI is written for someone who has never seen the tool: each task states what it does, what input it needs, and what comes back. Keep that property when adding features.

`lib/demo.ts` is Demo Mode: a module-level flag plus fixture responses for every endpoint. `api.ts::request()` short-circuits to `demoRequest()` when the flag is on, so no panel knows the mode exists and nothing reaches the network, the LLM quota, or Google Calendar. The flag is deliberately not persisted (off on every load), and each app's `page.tsx` keys the tab container on it so toggling remounts every panel rather than leaving a demo answer on screen. **Adding an endpoint means adding a fixture** — an unrouted path throws. `lib/session.ts` is the one deliberate exception: it short-circuits to a synthetic user under Demo Mode rather than adding fixtures for a login system that isn't the point of a demo. Checks: `node lib/demo.test.ts` from `frontend/packages/core`.

`lib/activity.ts` + `components/ActivityFeed.tsx` narrate what the app is doing, in plain language, while it does it. `request()` calls `narrateRequest()` on the way in and `finish(body)` on the way out, so the outcome line is computed from the real response and reads the same in both modes — no panel does any of this itself. `describeRequest()` is pure and covered by the checks, including a regex that rejects internal vocabulary (`hybrid`, `rerank`, `chunk`, `A2A`, …) in any user-visible step. Routes with no entry stay silent, which is what keeps the 30-second health poll (and now `/auth/me`) out of the feed.

`lib/apilog.ts` + `apps/admin/components/ApiLogPanel.tsx` are the technical counterpart: a 50-entry ring buffer of what `request()` actually sent and received, Demo Mode calls included and flagged `simulated`. Off by default, its own store and toggle, independent of the activity feed, and **developer-app only** now — `apps/client` doesn't import it at all. `maskSecrets()` still exists and is still exercised by the checks, though the exposure it originally existed for (`NEXT_PUBLIC_API_KEY` printing in the log) is gone now that the key never reaches the browser; it's cheap insurance against whatever ends up in a header or response body next. `logApiEnd` settles an entry once, so `liveRequest`'s real HTTP status wins over the catch handler's.

`WALKTHROUGHS` (content.ts) + `components/Walkthrough.tsx` are the four guided tours, one per pipeline, launched from GuidePanel. The dock is mounted by `page.tsx` **outside** the mode-keyed container, because starting a tour switches Demo Mode on and would otherwise unmount itself. Every step carries a `visual` (`control` | `beforeAfter` | `flow`); the checks reject a step without one. If you move a control in AgentsPanel or ReleasePlanner, the step's `where` text is now wrong — it describes real screen positions.

## Known issues, not yet fixed

- `database.bm25_search` rebuilds the entire BM25 index from every row on every query — the hard scaling wall.
- `ingest.py` classifies **per chunk**, so one document can scatter across collections; it should be one decision per document. Chunks store no page numbers, so citations can't point at a location.
- `main.py::_nearest_clear_date` shifts 4 days off the nearest conflict and never re-checks, so it can land on a second holiday.
- Sporting and awards dates in `agent4_service.py` are hardcoded for 2026–2028 and will rot silently.
- `/confirm-date` and `/override-date` duplicate what `/finalize-calendar` does; the UI no longer calls them.
- Self-reported faithfulness averages **4.86/10**, i.e. the system's own metric says answers are about half grounded.
- The `frontend/.vercel` project link (if still present) points at the old single-app layout and needs to become two deploy targets, one rooted at `apps/client` and one at `apps/admin`.
- `liveRequest`'s network-failure error message now says "Could not reach the app's own server" — accurate for the proxy hop, but a user seeing it can no longer tell from the message alone whether the Next.js server or the FastAPI backend behind it is the one that's down; the proxy route logs (or lack of a log line) is where to look first.

## Reference

`backend/ARCHITECTURE.md` (per-file responsibilities, sync/async boundaries, known limitations) and `PROJECT_GUIDE.md` (setup, env vars, endpoint contracts, client-side features, troubleshooting). Both have been brought up to date with the auth + two-frontend work above. Their older content still predates that work in a few corners (deployment topology in particular assumes one frontend); this file is authoritative where they disagree. `frontend/packages/core/README.md` is the short, frontend-only version of the "Two frontends, one backend" section above.
