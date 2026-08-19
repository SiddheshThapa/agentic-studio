# 🎬 Agentic Studio

A multi-agent AI platform for film & TV script evaluation, built with **FastAPI**, **LangGraph**, and **Next.js**. It combines Retrieval-Augmented Generation (RAG), a multi-agent debate system, calendar conflict checking, and a real-time evaluation dashboard — all accessible through a sleek dark-mode UI.

---

## ✨ Key Features

| Feature | Description |
|---|---|
| **Greenlight Committee** | A LangGraph multi-agent graph where a Producer and Executive debate a script across up to 3 rounds. A deterministic Mediator issues the final RED / YELLOW / GREEN verdict. |
| **Compliance Check** | RAG-based review that identifies content flagged against ingested studio guidelines. |
| **Script Analysis** | Structural analysis (pacing, characters, logline) enriched with vector-searched comparable films. |
| **Release Planning** | Browse upcoming releases by genre (TMDB API) and conflict-check a proposed date. |
| **Calendar Integration** | Automatically creates localized release events in Google Calendar (via MCP or Service Account). |
| **Faithfulness Evaluation** | Each agent run can be scored by an LLM judge (0–10) with reasoning, tracked over time. |
| **Semantic Caching** | Identical queries hit a Postgres cache instead of re-running LLM calls. |
| **Session Memory** | Conversation turns stored per session and replayed as context. |

---

## 🏗️ Project Structure

```
agentic-studio/
├── backend/
│   ├── app/
│   │   ├── main.py                          # FastAPI app, all HTTP routes
│   │   ├── schemas.py                       # Pydantic models (TaskType, AgentResponse)
│   │   ├── ai/
│   │   │   ├── supervisor.py                # LangGraph graphs (Supervisor + Greenlight Committee)
│   │   │   ├── agents.py                    # LLM worker functions (all agent logic)
│   │   │   └── evaluator.py                 # LLM-as-judge faithfulness scorer
│   │   ├── core/
│   │   │   ├── config.py                    # Environment variables & constants
│   │   │   ├── llm.py                       # Google GenAI SDK wrapper (generate_text, embed_text)
│   │   │   ├── guardrails.py                # Toxicity filter, prompt injection detection
│   │   │   └── resilience.py                # Retry decorator, rate limiter, structured logger
│   │   ├── data/
│   │   │   ├── database.py                  # Postgres CRUD (pgvector, cache, memory, results, eval)
│   │   │   ├── ingest.py                    # PDF chunking + embedding storage
│   │   │   └── retrieval.py                 # Hybrid search (pgvector cosine + BM25 rerank)
│   │   └── integrations/
│   │       ├── calendar_mcp.py              # Google Calendar via Model Context Protocol
│   │       ├── calendar_service_account.py  # Google Calendar via Service Account
│   │       └── web_fetch.py                 # BeautifulSoup web scraping utility
│   └── microservices/
│       └── agent4_service.py                # Standalone A2A server (port 8001) — holiday & event conflict checker
│
└── frontend/
    ├── app/
    │   ├── layout.tsx                       # Root layout with font and metadata
    │   ├── page.tsx                         # Single-page app — all panels, state, and UI components
    │   └── globals.css                      # Global CSS and custom animations
    └── lib/
        └── api.ts                           # All typed API calls to the backend (fetch wrappers, TypeScript interfaces)
```

---

## 🤖 Agent Data Flows

### 1. Compliance Check (`compliance`)

Checks script content against studio guidelines stored in the RAG vector database.

```
Script Input
    │
    ▼
[LLM Pass 1] — Flag topics needing review (e.g. "graphic violence", "strong language")
    │
    ▼
[Hybrid Search] — Query pgvector + BM25 against the "guidelines" collection
    │
    ├── Confidence too low? ──► Return: "Manual review recommended."
    │
    ▼
[LLM Pass 2] — Generate final compliance report with guideline citations
    │
    ▼
Result (string)
```

---

### 2. Script Analysis (`analyze`)

Performs a structural analysis of the script and enriches it with comparable films.

```
Script Input
    │
    ▼
[LLM Pass 1] — Generate logline, pacing score (1-10), character score (1-10), strengths/weaknesses
    │
    ▼
[Hybrid Search] — Query pgvector + BM25 against the "past_films" collection
    │
    ├── Confidence too low? ──► Use: "No closely comparable past films found."
    │
    ▼
[LLM Pass 2] — Merge analysis with comparables, produce final Pass / Consider / Recommend verdict
    │
    ▼
Result (string)
```

---

### 3. Release Listing (`release_listing`)

Fetches real upcoming releases from TMDB for a given genre.

```
Genre Input (e.g. "horror")
    │
    ▼
[TMDB API] — Discover movies by genre ID for current + next year, sorted by popularity
    │
    ├── Genre not recognized? ──► Return supported genres list
    │
    ▼
Result — Formatted list of "Title (YYYY-MM-DD)"
```

---

### 4. Release Conflict Check (`release_check`)

Given a proposed release date, identifies competing films and holiday conflicts.

```
Input: "YYYY-MM-DD | listing_result_id"
    │
    ├── [Database] — Fetch previous release_listing result by ID
    │
    ▼
[LLM] — Identify films from the listing that release within ±2 weeks of the proposed date
    │
    ▼
Result — Competing films with studio, genre, and release date
```

> After this step, the user can call `/check-conflicts` → `/confirm-date` → `/finalize-calendar`
> to resolve holiday clashes and create Google Calendar events per country.

---

### 5. Greenlight Committee (`greenlight`) — Multi-Agent Graph

A LangGraph `StateGraph` where LLM agents debate the script and a deterministic Mediator issues the final verdict.

```
Script Input
    │
    ▼
[digest_node]      — LLM condenses script → strict JSON: genre, tone, hooks, rating content
    │
    ▼
[producer_node]    — LLM pitches the script → JSON: title_concept, strengths, target_demographic,
                     budget_tier, mitigation_plan, proposed_release_date (YYYY-MM-DD)
    │
    ▼
[gatekeeper_node]  — Two parallel non-LLM checks:
    │                  1. RAG compliance check (hard_violations vs soft_violations)
    │                  2. A2A call to Agent 4 (port 8001) with proposed_release_date
    │                     checking public holidays (US/MX/GB/JP/DE), Super Bowl,
    │                     FIFA World Cup final, Oscars, Golden Globes, Grammys
    │
    ├── hard_violations found? ──────────────────────────────────────────────► [mediator_node] → 🔴 RED
    │
    ▼
[executive_node]   — LLM evaluates pitch against all data → JSON: concern_list,
                     is_approved (bool), message
    │
    ├── is_approved = True? ────────────────────────────────────────────────► [mediator_node]
    │
    ├── Stalemate? (concerns unchanged from previous round) ───────────────► [mediator_node] → 🔴 RED
    │
    ├── iteration_count >= 3? ──────────────────────────────────────────────► [mediator_node] → 🔴 RED
    │
    └── Otherwise? ─────────────────────────────────────────────────────────► [producer_node] (re-pitch)

[mediator_node]    — Pure Python rules engine (no LLM):
    │                  · is_approved=False          → 🔴 RED
    │                  · is_approved=True + date conflict → 🟡 YELLOW
    │                  · is_approved=True + no conflict  → 🟢 GREEN
    │
    ▼
Result — JSON: { digest, pitch, review, verdict, trace }
```

---

### Agent 4 — A2A Microservice (port 8001)

Runs as a completely independent FastAPI server, communicating via the **A2A (Agent-to-Agent) Protocol**. It accepts a date string and returns a structured conflict report.

```
Date Input (YYYY-MM-DD)
    │
    ├── [Nager.at API] — Check public holidays for US, MX, GB, JP, DE within ±3 days
    │
    ├── [Hardcoded schedule] — Check Super Bowl, FIFA World Cup final within ±3 days
    │
    └── [Hardcoded schedule] — Check Oscars, Golden Globes, Grammy Awards within ±3 days
    │
    ▼
Result — JSON: { holidays: {...}, sporting_events: [...], awards_ceremonies: [...] }
```

---

## 🚀 Getting Started

### Prerequisites

- Python 3.11+
- Node.js 18+
- A running **PostgreSQL** instance with the [`pgvector`](https://github.com/pgvector/pgvector) extension enabled
- A **Google Gemini** API key
- A **TMDB** API key (for release listings)

### 1. Backend Setup

```bash
cd backend
python -m venv venv

# Windows
venv\Scripts\activate

# macOS/Linux
source venv/bin/activate

pip install -r requirements.txt
```

Copy the example env file and fill in your values:

```env
# backend/.env
GEMINI_API_KEY=your_gemini_key
DATABASE_URL=postgresql://user:password@localhost:5432/agentic_studio
TMDB_API_KEY=your_tmdb_key
API_SECRET_KEY=your_secret_key

# Optional overrides
CHAT_MODEL=gemini-3.1-flash-lite
EMBEDDING_MODEL=gemini-embedding-001
AGENT4_BASE_URL=http://localhost:8001
SUPPORTED_COUNTRIES=US,MX,GB,JP,DE
CALENDAR_MODE=service_account
GOOGLE_SERVICE_ACCOUNT_JSON=path/to/service_account.json
```

### 2. Start the Services

**Terminal 1 — Agent 4 (A2A Microservice):**
```bash
python microservices/agent4_service.py
# Starts on http://localhost:8001
```

**Terminal 2 — Main API:**
```bash
uvicorn app.main:app --port 8000
# Starts on http://localhost:8000
```

### 3. Frontend Setup

```bash
cd frontend
npm install
```

```env
# frontend/.env
NEXT_PUBLIC_API_URL=http://localhost:8000
NEXT_PUBLIC_API_KEY=your_secret_key
```

```bash
npm run dev
# Opens at http://localhost:3000
```

---

## 🧠 Backend API Reference

| Method | Endpoint | Auth | Description |
|---|---|---|---|
| `GET` | `/health` | ❌ | Liveness check with DB status |
| `POST` | `/run-agent` | ✅ | Run any agent task |
| `GET` | `/result/{id}` | ❌ | Fetch a stored result |
| `GET` | `/result/{id}/download` | ❌ | Download result as PDF |
| `POST` | `/ingest` | ✅ | Upload a PDF to the RAG store |
| `DELETE` | `/document` | ✅ | Delete a document by filename |
| `GET` | `/history/{session_id}` | ❌ | Fetch conversation history |
| `POST` | `/confirm-date/{id}` | ✅ | Confirm release date + create calendar events |
| `POST` | `/override-date/{id}` | ✅ | Override date + create calendar events |
| `POST` | `/check-conflicts/{id}` | ✅ | Check date conflicts via Agent 4 |
| `POST` | `/finalize-calendar/{id}` | ✅ | Finalize with per-country date overrides |
| `GET` | `/eval/summary` | ❌ | Evaluation score summary |
| `GET` | `/eval/chart` | ❌ | Evaluation trend chart (base64 PNG) |

**Authentication:** Pass `X-API-Key: <your_key>` header for protected routes.

**Task types** (pass as `task` form field to `/run-agent`):

| Value | Description |
|---|---|
| `compliance` | RAG compliance review against studio guidelines |
| `analyze` | Structural script analysis with comparable films |
| `release_listing` | Browse upcoming releases by genre via TMDB |
| `release_check` | Conflict-check a proposed release date |
| `greenlight` | Full Greenlight Committee multi-agent debate |

---

## 🖥️ Frontend Panels

| Panel | Description |
|---|---|
| **Agents** | Select a task, paste script text, run an agent, view results with optional faithfulness evaluation. Greenlight results render as a full "Boardroom Chat" UI with Digest, Producer Pitch, Executive Memo, and Studio Stamp. |
| **Documents** | Upload PDFs to populate the RAG store or delete existing documents by filename |
| **History** | Browse per-session conversation turns stored in Postgres |
| **Insights** | View average faithfulness scores and the evaluation score trend chart over time |

---

## 🔒 Security Notes

- **API Key:** All write operations require the `X-API-Key` header matching `API_SECRET_KEY` in `.env`.
- **Guardrails:** All inputs pass through a toxicity filter and prompt-injection detector (`app/core/guardrails.py`). Script-mode tasks (`greenlight`, `analyze`) intentionally bypass the toxicity check since R-rated content is expected.
- **Rate Limiting:** 10 requests per 60-second window per session ID, enforced in-memory.
- **Row-Level Security:** All Postgres tables have RLS enabled.

---

## 📦 Tech Stack

**Backend:** FastAPI · LangGraph · Google GenAI (Gemini) · pgvector · PostgreSQL · A2A Protocol · TMDB API · Google Calendar API · BM25 · ReportLab

**Frontend:** Next.js 16 · TypeScript · Tailwind CSS
