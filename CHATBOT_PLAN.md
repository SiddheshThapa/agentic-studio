# Two in-app assistants — plan (not yet built)

Goal: a help chatbot in the client app (walks a user through running the pipelines) and a separate one in the developer app (walks a developer through the codebase/admin tools), each backed by its own knowledge base. This document is the plan; nothing here is implemented yet.

**Decided:**
1. The developer knowledge base includes source files, not just the docs (bigger ingestion job, needs a re-ingest step kept in mind whenever code changes — see below).
2. Both assistants are multi-turn, reusing the existing `memory` table / `session_id` mechanism the agent pipelines already use — no new storage.

## Why this reuses existing infrastructure, not new infrastructure

The codebase already has every piece this needs, once for RAG (`compliance`/`analyze`) and once for chat history (`memory` table, session_id):

| Need | Already exists as |
|---|---|
| Chunk + embed text | `backend/app/data/ingest.py` (PDF only today — needs a markdown path added) |
| Store chunks + vectors | `documents` table, `collection` column already distinguishes `guidelines`/`past_films`/`scripts` |
| Retrieve relevant chunks | `retrieval.py::hybrid_search` — dense + BM25 + LLM rerank, works per-collection |
| Confidence signal | `guardrails.py::retrieval_status` — reuse directly, same four states |
| Generate an answer | `llm.py::generate_text` |
| Conversation history | `database.py::memory_add`/`memory_get`, keyed by `session_id` |
| Role gating | `require_role("developer")` — the developer assistant needs this; the client one doesn't |

So the plan below is: two new **collections** in the existing `documents` table (`client_help`, `dev_help`), one new **task type** (or two — open question below) that does RAG the same way `compliance` does but against these collections, and a small chat UI reusing the panel/`ui.tsx` conventions already in `packages/core`. No new database, no new vector store, no new LLM provider.

## Knowledge base — what goes in, and how it gets there

**Client knowledge base** (`client_help` collection): how to use each panel — what Agents/Documents/Release Planner/History/Insights do, what input each needs, what a result means, what Demo Mode is. Largely already written, in `frontend/packages/core/lib/content.ts` (`PANEL_COPY`, `GLOSSARY`, `TASK_INFO`) and the walkthrough copy — this is closer to "reformat existing copy into ingestible chunks" than "write a new manual."

**Developer knowledge base** — two collections, not one, because they behave differently:
- `dev_docs`: `CLAUDE.md`, `backend/ARCHITECTURE.md`, `PROJECT_GUIDE.md`, `README.md`, `frontend/packages/core/README.md` — exactly the files just brought up to date. This is *why* getting the docs accurate mattered beyond human readability: they become part of the developer bot's source of truth, and a stale doc doesn't just mislead a person anymore, it makes the bot confidently wrong.
- `dev_code`: the actual source — `backend/app/**/*.py`, `backend/microservices/*.py`, `frontend/packages/core/**/*.{ts,tsx}`, `frontend/apps/*/app/**/*.{ts,tsx}`, `frontend/apps/*/components/**/*.tsx`. Excluded: `node_modules`, `.next`, `__pycache__`, anything in `.gitignore`, and secrets-shaped files (`.env*`, credential JSONs) — never ingested, full stop, regardless of gitignore state.

Splitting docs from code means re-ingesting one doesn't disturb the other, and the retrieval/answer step can weight or label them differently (a code chunk should probably be quoted verbatim with a file path; a doc chunk summarized).

**Getting it into the database**: a new script, `backend/ingest_docs.py`, extending `ingest.py`'s chunking to plain text (no `pypdf` needed) for both markdown and source files, writing into `client_help`/`dev_docs`/`dev_code` with a **fixed collection per source** rather than the existing per-chunk LLM classification — deliberately the opposite of `ingest.py`'s current per-chunk classifier (a noted limitation in `ARCHITECTURE.md`): here, which collection a file belongs to is already known from its path, so there's nothing to classify.

Chunking code isn't the same problem as chunking prose: splitting mid-function by a fixed word count (the existing 300-word/50-overlap scheme) will cut function bodies in half. **v1 answer: reuse the fixed-size chunker anyway, but chunk per-file with a larger overlap (≈100 words) and store the file path + a starting line number in `metadata`**, accepting that some chunks are ragged, rather than building a language-aware (AST-based) splitter — that's a real upgrade path, not a v1 requirement, and the fixed-size scheme is exactly what `ingest.py` already has. Flagging this as the corner most likely to need revisiting once real usage shows whether ragged chunks actually hurt answer quality.

**Staying current**: no watcher, no CI hook — `ingest_docs.py` is run by hand after a doc or code change worth reflecting, same as the DB schema's "hand-apply" ethos. Re-running it should **replace** a source's existing chunks rather than append duplicates (delete-by-`metadata.source_path` then re-insert, mirroring `delete_documents_by_filename`'s existing pattern), so staleness is bounded by "did anyone re-run it," not by unbounded duplicate accumulation.

## The endpoint(s)

Two shapes are possible; recommendation is the first, both are laid out so the choice is explicit:

**A. One new `TaskType.assistant`, audience carried in the request** — `POST /run-agent` gets a fifth-ish branch: `script_text` becomes the user's question, a new `audience` field (`"client"`|`"developer"`) picks the collection, `route_node` does hybrid_search + generate_text against it, same shape as `compliance`. Developer audience additionally requires `require_role("developer")` — meaning this one task type has a *conditional* auth requirement, which doesn't fit `run_agent_endpoint`'s current single `Depends(require_api_key)` cleanly and would need a per-request check inside the handler.

**B. Two endpoints** — `POST /assist/client` (needs login, any role) and `POST /assist/developer` (needs `require_role("developer")`), each a thin wrapper calling one shared internal function with a different collection name. Mirrors how `/auth/users*` is already separated from the general API-key surface. More endpoints, but the auth requirement is a plain `Depends(...)` on each, no branching inside the handler.

**Recommendation: B.** It matches the existing pattern of "the FastAPI dependency list is the whole story of who can call this," which every other endpoint in this codebase follows.

Both endpoints follow the same shape as `/run-agent`: `session_id` in, `memory_add` the user turn, `hybrid_search` the right collection(s) (`client_help` for `/assist/client`; `dev_docs` **and** `dev_code` for `/assist/developer`, merged the same way `compliance` merges its single collection today — reranked together so a code chunk and a doc chunk compete on relevance, not on which collection ran first), `generate_text` with retrieved context **and** recent turns from `memory_get(session_id)` folded into the prompt, `memory_add` the assistant turn, return the answer. No new caching semantics needed beyond what already exists — a repeated question can still hit `cache_get`/`cache_set` the same way `/run-agent` does, keyed the same way (`f"{task}:{question}"`-shaped).

## The frontend

A `HelpChat` component in `packages/core/components/` (client) and a role-appropriate variant or the same component with a `variant` prop (developer) — most of it (message list, input box, loading state) is identical, only the endpoint, system framing, and empty-state copy differ, so this should be **one component parameterized**, not two. Likely surfaced as a persistent corner launcher similar to how `ActivityFeed` sits outside the tab-keyed container, so it survives tab switches and Demo Mode toggles. **Demo Mode implication**: needs its own fixture(s) in `lib/demo.ts` (a canned Q&A or two) — the existing rule ("adding an endpoint means adding a fixture, an unrouted path throws") applies here too, and is cheap to satisfy since the chat doesn't need to be *useful* in Demo Mode, just present and clearly labeled as demo data like everything else there.

## Build order

1. `backend/ingest_docs.py` — the ingestion script, `client_help`/`dev_docs`/`dev_code` collections, delete-then-reinsert-by-source-path. Testable standalone before any endpoint exists (run it, then check `/admin/tables/documents?q=...` in the developer app to see the chunks land).
2. `POST /assist/client` and `POST /assist/developer` in `main.py`, mirroring `/run-agent`'s shape as described above. `test_assistant.py` alongside, plain-assert style like the other three backend test files.
3. `HelpChat` component in `packages/core/components/`, one `variant` prop for client vs developer copy/endpoint, surfaced as a persistent launcher outside the tab-keyed container (same pattern as `ActivityFeed`).
4. Demo Mode fixtures for both new endpoints in `lib/demo.ts`, plus checks in `demo.test.ts`.
5. Re-run `backend/ingest_docs.py` once more right before shipping, since steps 2–4 will have changed the docs and code it needs to know about.

## Left genuinely open, worth a second look once this is running

- **Chunking code by fixed word count** (see above) — the most likely thing to need an upgrade once real questions expose ragged answers.
- **No rate limiting planned** on either `/assist/*` endpoint beyond what already exists elsewhere — worth adding if these turn out to be hit harder than the agent endpoints.
- **Citation format** — whether an answer should name which doc/file it drew from (`ARCHITECTURE.md`, line ~140) is left to whoever writes the prompt in step 2; `check_compliance`'s citation style is the closest existing precedent to follow.
