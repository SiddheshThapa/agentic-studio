# packages/core

Code shared by `apps/client` and `apps/admin`: every backend call (`lib/api.ts`),
all user-facing copy (`lib/content.ts`), Demo Mode, the activity feed, the API
log store, design tokens (`globals.css`), and every panel that isn't
developer-only (Agents, Documents, Release Planner, History, Insights, Guide,
Walkthrough, plus the shared `ui.tsx` primitives).

Not a published or installable package — no build of its own, and nothing
here ends up in either app's `node_modules`. It does carry its own tiny
`package.json` (react/tailwind/typescript/next only), but that exists solely
so `@/lib/*` and `@/components/*` — which each app's `tsconfig.json` maps
straight into this folder as plain filesystem paths — resolve when
type-checked from outside. That's also why nothing in here imports across
apps: this folder must never import from `apps/client` or `apps/admin`, only
the other way around.

Admin-only components (`DatabasePanel`, `DatabaseEditor`, `ApiLogPanel`,
`UsersPanel`) live in `apps/admin/components` instead, under the `@/admin/*`
alias, specifically so they can never end up in the client bundle by accident.

Checks: `node lib/demo.test.ts` from this directory.
