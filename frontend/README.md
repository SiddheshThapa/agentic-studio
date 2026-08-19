# Agentic Studio — frontend

Next.js 16 (App Router) · React 19 · Tailwind 4. A single-page dashboard, and the only client of `main.py`'s API.

## Run it without a backend

```bash
npm install
npm run dev
```

Open <http://localhost:3000> and switch **Demo Mode** on in the header. Every tab then answers from local fixtures — no Python process, no database, no API keys, no Gemini quota, and no Google Calendar events. This is the only safe way to demo the Release Planner, whose final step writes real calendar entries.

New to the app? The **Start here** tab has four guided walkthroughs, one per pipeline. Each switches Demo Mode on and talks you through the real screens, control by control.

## Run it against the real backend

Start `main.py` (port 8000) and `agent4_service.py` (port 8001) first — see the repo root's `PROJECT_GUIDE.md`. Then:

```bash
# frontend/.env.local
NEXT_PUBLIC_API_URL=http://localhost:8000
NEXT_PUBLIC_API_KEY=<same value as the backend's API_SECRET_KEY>
```

`NEXT_PUBLIC_*` values are inlined when the dev server starts, so editing them needs a restart. Both default to `""`, which silently points every request at this app's own origin — that is what the "backend not reachable" badge usually means.

> `NEXT_PUBLIC_API_KEY` ships in the browser bundle, so the key is effectively public. Fine for local development; a route handler proxying to FastAPI would fix it for a real deployment.

## Checks

```bash
npm run lint
npx tsc --noEmit
npm run build
node lib/demo.test.ts   # plain asserts, no test runner (needs Node >= 22.6)
```

## Layout

```
app/page.tsx        shell: header, Demo Mode + API log toggles, health badge, tabs, overlays
components/         one file per tab, ui.tsx for shared pieces, three overlays
lib/api.ts          every backend call, and the one seam the features below hook into
lib/content.ts      every sentence of user-facing copy
lib/demo.ts         Demo Mode: flag, fixtures, walkthrough state
lib/activity.ts     plain-language activity feed
lib/apilog.ts       technical API log (masks the API key)
```

Two conventions worth knowing before editing:

- **All user-facing copy lives in `lib/content.ts`**, including the walkthrough scripts and the activity-feed sentences. It also mirrors backend constants — `GENRES` must match `agents.py::GENRE_IDS`, `MIN_SCRIPT_CHARS` must match `main.py`'s `min_length`.
- **No `setState` in an effect body.** The React 19 lint rule `react-hooks/set-state-in-effect` fails the build. Fetch inside an async IIFE with a `cancelled` guard (see `InsightsPanel.tsx`), or read module stores through `useSyncExternalStore` (see `DocumentsPanel.tsx`).

Adding a backend endpoint means adding a Demo Mode fixture in `lib/demo.ts` — an unrouted path throws rather than resolving to nothing.

Full detail: `PROJECT_GUIDE.md` (client-side features, troubleshooting) and `ARCHITECTURE.md` (per-file responsibilities) in the repo root.
