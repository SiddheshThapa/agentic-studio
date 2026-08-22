// Demo Mode: a flag plus a table of canned backend responses.
//
// Why it exists: the Gemini free tier caps the backend at 20 LLM calls a day, and
// the last step of the Release Planner writes real Google Calendar events. Showing
// the app to someone should cost neither. With the flag on, lib/api.ts answers
// every call from this file and never opens a socket.
//
// The flag is module state, not localStorage — off on every load, and nothing to
// clean up. The fixtures are frozen and never written to, so demo and live mode
// cannot contaminate each other; app/page.tsx remounts the tabs on toggle so no
// panel keeps a stale result across the switch.
//
// Fixture *data* lives here. User-facing *copy* about demo mode lives in
// content.ts (DEMO_COPY), same as every other sentence in the UI.

import type {
  AgentResponse,
  ConflictCheckResponse,
  ConflictReport,
  DateConfirmationResponse,
  EvalSummary,
  HistoryTurn,
} from "@/lib/api";

// ---- The flag ------------------------------------------------------------
// Shaped for useSyncExternalStore, which is how the app reads external state
// (see DocumentsPanel.tsx) — an effect + setState would trip
// react-hooks/set-state-in-effect.

let demoOn = false;
const listeners = new Set<() => void>();

function notify() {
  listeners.forEach((fn) => fn());
}

export function isDemo(): boolean {
  return demoOn;
}

export function setDemo(next: boolean): void {
  if (next === demoOn) return;
  demoOn = next;
  // A walkthrough narrates fixture data, so it cannot outlive Demo Mode.
  if (!demoOn) {
    walkthrough = null;
    // Anything "written" during the demo is discarded here, so a later demo
    // starts from the same seed and live mode never sees any of it.
    resetAdminFixtures();
  }
  notify();
}

export function subscribeDemo(fn: () => void): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

export const getDemoSnapshot = (): boolean => demoOn;
/** Server render is always live mode, so hydration matches the default. */
export const getDemoServerSnapshot = (): boolean => false;

// ---- Which guided walkthrough is running ---------------------------------
// Same store as the flag, because the two are tied: a walkthrough can only run in
// Demo Mode, and it lives outside the tab container that app/page.tsx remounts on
// toggle, so it survives being the thing that switched Demo Mode on.

export type WalkthroughId = "compliance" | "analyze" | "release_listing" | "release_planner" | "greenlight";

let walkthrough: WalkthroughId | null = null;
let run = 0;

/** Starting a walkthrough switches Demo Mode on — it never narrates live data. */
export function startWalkthrough(id: WalkthroughId): void {
  walkthrough = id;
  run += 1; // bumped so restarting the walkthrough you are already in rewinds it to step 1
  demoOn = true;
  notify();
}

export function stopWalkthrough(): void {
  if (walkthrough === null) return;
  walkthrough = null;
  notify();
}

export const getWalkthroughSnapshot = (): WalkthroughId | null => walkthrough;
export const getWalkthroughServerSnapshot = (): WalkthroughId | null => null;

/** React key for the dock: changes on every start, so a restart remounts it at step 1. */
export const getWalkthroughRunSnapshot = (): string => (walkthrough ? `${walkthrough}#${run}` : "");
export const getWalkthroughRunServerSnapshot = (): string => "";

// ---- Fixtures ------------------------------------------------------------
// Every body starts with a DEMO DATA line. The header badge already says the app
// is in demo mode; putting it in the payload too means a screenshot, a copied
// paragraph or a pasted quote carries the label with it.

const LABEL = "DEMO DATA — canned example, not a real result.";

/** Filenames the Documents tab lists in demo mode instead of this browser's uploads. */
export const DEMO_DOCUMENTS: readonly string[] = Object.freeze([
  "demo-studio-guidelines-2026.pdf",
  "demo-past-films-2019-2025.pdf",
  "demo-broadcast-standards.pdf",
]);

const COMPLIANCE = `${LABEL}

FLAGGED MOMENTS (3)

1. Sustained gun violence — the warehouse shootout, pages 12–14.
   Guideline 4.2 (demo-studio-guidelines-2026.pdf): "Depictions of firearm
   discharge toward a named character require standards sign-off before the
   scene is storyboarded."
   Action: route to Standards before boards.

2. Strong language — "…" x4 in Maya's confrontation, page 17.
   Guideline 2.1 (demo-studio-guidelines-2026.pdf): "More than three instances
   of category-A language moves a title out of the PG-13 target."
   Action: either trim to three or accept the ratings shift.

3. Depiction of a minor in peril — the fire escape sequence, page 21.
   Guideline 6.4 (demo-broadcast-standards.pdf): "A minor placed in physical
   jeopardy must not be shown unattended for more than one continuous scene."
   Action: add the guardian beat the guideline asks for, or cut to the street.

NOT FLAGGED: the interrogation scene reads as tense but non-graphic and needs
no review under the uploaded guidelines.`;

const ANALYZE = `${LABEL}

LOGLINE
A night-shift dock supervisor discovers her brother's name on a smuggling
manifest and has until the morning tide to decide whether to file it.

PACING — 7/10
Strong cold open; the manifest lands on page 3, which is where it should be.
Loses momentum through the middle warehouse walk-and-talk (pages 12–16) — two
scenes deliver the same information about the shipping schedule. The last ten
pages recover.

CHARACTER CLARITY — 8/10
Maya's want (protect her brother) and need (stop covering for him) are separable
by page 6, which is early enough for an audience to feel the gap. Dockmaster
Ruiz is doing plot work rather than character work; he could be two lines.

STRENGTHS
- The manifest is a physical object that changes hands — the stakes stay visible.
- Dialogue carries subtext; nobody announces the theme.

WEAKNESSES
- Duplicated middle scenes.
- The ending resolves off-page, in a phone call we do not hear.

COMPARISONS (from demo-past-films-2019-2025.pdf)
Closest in shape to "Harbour Lights" (2021) — same single-night structure, which
tested well but needed a re-cut to fix an off-page ending. Worth reading that
post-mortem before greenlight.

VERDICT: Consider.`;

const RELEASE_LISTING = `${LABEL}
The Longest Autumn — 2026-09-18
Nightfall Protocol — 2026-10-02
Saltwater — 2026-10-30
Vermilion — 2026-11-13
The Quiet Machine — 2026-11-20
Harbour Lights: Undertow — 2026-12-11
Ash & Ember — 2027-01-15
Northbound — 2027-02-12`;

const RELEASE_CHECK = `${LABEL}

Films releasing within two weeks of 2026-11-20:

- Vermilion — 2026-11-13 (7 days before). Same genre, wide release. This is the
  real competitor for the opening weekend.
- The Quiet Machine — 2026-11-20 (same day). Limited release, ~600 screens, so
  it competes for reviews more than for seats.
- Harbour Lights: Undertow — 2026-12-11 (21 days after). Outside the window;
  listed only because it shares an audience.

Assessment: one direct clash. Moving back one week to 2026-11-27 clears
Vermilion and lands on the holiday corridor.`;

// The greenlight task answers with JSON, not prose (see supervisor.py's
// mediator_node) — the DEMO DATA label lives inside the verdict message instead
// of as a header line, so it survives being parsed and re-rendered.
const GREENLIGHT = JSON.stringify(
  {
    digest: {
      genre: "thriller",
      tone: "tense, morally ambiguous",
      rating_relevant_content: ["sustained gun violence", "strong language"],
      marketable_hooks: ["single-night structure", "a physical object that changes hands"],
    },
    pitch: {
      pitch_fields: {
        title_concept: "Harbour Lights: Undertow — a dockworker races the tide to expose her own brother",
        strengths: ["visible, physical stakes", "subtext-driven dialogue", "single-night structure tested well before"],
        target_demographic: "adults 25–44, crime/thriller audience",
        budget_tier: "mid",
        mitigation_plan: "trim category-A language to three instances to hold the PG-13 target",
        proposed_release_date: "2026-11-20",
      },
      strategy: "Position against Vermilion by leaning into the single-night structure in marketing.",
    },
    review: {
      concern_list: ["Same-day release date overlaps The Quiet Machine"],
      is_approved: true,
      message: "Approved with a scheduling note.",
    },
    verdict: {
      status: "YELLOW",
      message: `${LABEL} Approved by the executive, but shares a release date with another title — re-schedule recommended.`,
    },
    trace: [
      "Script condensed into a pitch digest",
      "Producer drafted the initial pitch",
      "Compliance checked against uploaded guidelines — one language note",
      "Release date checked — one same-day title found",
      "Executive approved with a scheduling concern",
    ],
  },
  null,
  2
);

const CONFLICT_REPORT: ConflictReport = {
  holidays: {
    US: {
      status: "ok",
      conflict: true,
      holiday_date: "2026-11-26",
      holiday_name: "Thanksgiving Day",
    },
    MX: { status: "ok", conflict: false, holiday_date: null, holiday_name: null },
    GB: { status: "ok", conflict: false, holiday_date: null, holiday_name: null },
    JP: {
      status: "ok",
      conflict: true,
      holiday_date: "2026-11-23",
      holiday_name: "Labour Thanksgiving Day",
    },
    DE: { status: "unknown", conflict: null, holiday_date: null, holiday_name: null },
  },
  sporting_events: [
    { name: "FIFA World Cup Final", date: "2026-07-19", conflict: false, days_away: 124 },
    { name: "Super Bowl LXI", date: "2027-02-07", conflict: false, days_away: 79 },
  ],
  awards_ceremonies: [
    { name: "Academy Awards", date: "2027-03-14", conflict: false, days_away: 114 },
    { name: "Golden Globes", date: "2027-01-10", conflict: false, days_away: 51 },
  ],
};

const RECOMMENDED_DATES: Record<string, string> = {
  US: "2026-11-30",
  MX: "2026-11-20",
  GB: "2026-11-20",
  JP: "2026-11-27",
  DE: "2026-11-20",
};

const HISTORY: HistoryTurn[] = [
  { role: "user", content: "compliance: INT. WAREHOUSE - NIGHT. Maya edges along the catwalk…" },
  { role: "assistant", content: "3 moments flagged; guidelines 4.2, 2.1 and 6.4 apply. [demo data]" },
  { role: "user", content: "analyze: INT. WAREHOUSE - NIGHT. Maya edges along the catwalk…" },
  { role: "assistant", content: "Pacing 7/10, character clarity 8/10, verdict Consider. [demo data]" },
  { role: "user", content: "release_listing: thriller" },
  { role: "assistant", content: "8 thriller titles scheduled between 2026-09 and 2027-02. [demo data]" },
  { role: "user", content: "release_check: 2026-11-20|4103" },
  { role: "assistant", content: "One direct clash (Vermilion, 7 days before). [demo data]" },
];

const EVAL_SUMMARY: EvalSummary = { average_faithfulness: 7.8, count: 8 };

/** 480x180 line chart, watermarked "DEMO" in the image itself so the label survives a screenshot. */
const EVAL_CHART =
  "iVBORw0KGgoAAAANSUhEUgAAAeAAAAC0CAIAAADD3miXAAAEdUlEQVR42u3du23jQBRAUUGBW3DGnDWwGQcqQV24DjfpyAKcCJJIUODvzXsHOMHC9i6g4cz1SPzs6fzxCUBAJ0MAINAACDSAQAMg0AACvbHL9fvB9Hfvf+b558e+PvbvAwi0QAO0Geixr0wndSzZ0/+CTAMCLdAAtQM9/88CDQi0QAPUCPT0KcT54RZoQKAFGsBHHAINCLRAAwi0QAMININAACDSAQAs0gEAz7uvn1yBgqgi0QIdbb/cMCKaKQAu0VYepgkAze8lZeJgqAi3QVh2tTg+zRaAF+uC1Z3xMjLcYN4Fmk+X3cGreqjMlpufA/ReVWqDZNs3OBZkJC4+4TAs0m3d54i8aRkVWaoEW6BBplmlFlmmBFug2rle10pz1dd20QAt06J2LlabINtQCLdBx14BlVvmDC5kW6NeX8hBq0ltju83wlFcfK/WmPTztfPwcm5iz3DHaaIYXuR9EpjfqoUCnOgGo0QE/qSg1sNZ7S4F+OUe7fiDssDhSC4+jCR95egecLbF20N4KxR8Bm6CF09uw+Nxjrc+4Tt4ACp9PPFac2EbGr/wVi3fwVRwVet3065KemUfT+FTeUC95QFUz10Hn21/nu45KX4yGYdwzVnFvVHENv0x7h67Uxe8qauZOwiZ6nXuTVS1StsyVBznIG/omb/UO+GFInZVc4WVKc80VFHAXmOFZHJ7E6LeRl+ZXY8r35QkfluRZ5rbSjqbDkeNKhORPs1t4POY8WsFa8qwfDjk6FR5QVetxo/MP1fO3rORkjXY0s17Tlulq3dLPg/Y/0hfMtAOauNT5FqwH9r9x7K2QpvekDmidTKd5sQLt/W/yrbQuO4so0AJNuExLs/dqAp0z0PNPExOw0bpcZIKlf40CTZ5M2zIj0AJNuP2sNCPQAk24rbQuI9ACTaxM2zIj0AJNuEZLMwIt0ITLtC4j0ALNkScPPaAKBJqgmfaAKhBo2si0LiPQewS66wcYM5ZmI0NKdtC4nwXsoAUagQaBpkKmDQIINIBACzSAQAMItEADCDSAQAs0gEADINAAAi3QAAININACDSDQAAg0gEALNIBAAwi0QAMINIBACzSAQAMg0AACLdAAAg0g0AININACDSDQAAg0gEALNIBAAwi0QAMINIBACzSAQAMg0AACLdAAAg0g0AINUCTQXT8AcGMHDWAHLdAAAg0g0AININAACDSAQAs0gEADCLRAAwg0AAININDGGkCgAQRaoAEEGkCgBRpAoAEQaACBFmgAgQYQaIEGEGgABBpAoAUaQKABBPr9QHf9AMCNHTSAHbRAAwg0gEALNIBAAyDQAAIt0AACDSDQAg0g0AAINIBAG2sAgQYQaIEGEGgAgRZoAIEGQKABBFqgAQQaQKAFGkCgARBoAIEWaACBBhBogQZIE2gA/sUKNABBd9AACDSAQAMg0AACDYBAAyDQAAINgEADCDQAAg2AQAMINAACDSDQAAg0gEADINAACDSAQAOwsj9aXpUw4vL9GQAAAABJRU5ErkJggg==";

const RESULTS: Record<number, { task: string; result: string }> = {
  4101: { task: "compliance", result: COMPLIANCE },
  4102: { task: "analyze", result: ANALYZE },
  4103: { task: "release_listing", result: RELEASE_LISTING },
  4104: { task: "release_check", result: RELEASE_CHECK },
  4105: { task: "greenlight", result: GREENLIGHT },
};

const AGENT_RESULTS: Record<string, { id: number; text: string }> = {
  compliance: { id: 4101, text: COMPLIANCE },
  analyze: { id: 4102, text: ANALYZE },
  release_listing: { id: 4103, text: RELEASE_LISTING },
  release_check: { id: 4104, text: RELEASE_CHECK },
  greenlight: { id: 4105, text: GREENLIGHT },
};

const EVAL_REASONING =
  "Every claim traces back to a retrieved chunk, and the two guideline quotes match the source text verbatim. Marked down because the greenlight comparison generalises beyond what the retrieved past-film write-up states.";

/**
 * Calendar links point at google.com/calendar with no event id — a real-looking
 * destination that cannot resolve to, or modify, an actual event.
 */
const DEMO_EVENTS: Record<string, { date: string; calendar_event: string }> = {
  US: { date: "2026-11-30", calendar_event: "https://calendar.google.com/calendar/u/0/r/day/2026/11/30" },
  MX: { date: "2026-11-20", calendar_event: "https://calendar.google.com/calendar/u/0/r/day/2026/11/20" },
  GB: { date: "2026-11-20", calendar_event: "https://calendar.google.com/calendar/u/0/r/day/2026/11/20" },
  JP: { date: "2026-11-27", calendar_event: "https://calendar.google.com/calendar/u/0/r/day/2026/11/27" },
  DE: { date: "2026-11-20", calendar_event: "https://calendar.google.com/calendar/u/0/r/day/2026/11/20" },
};

// ---- Admin table browser -------------------------------------------------
// Column metadata mirrors what information_schema returns for the real tables,
// including which columns the backend flags as structural — the Database tab
// reads those flags rather than hardcoding them.

const NOW = Date.parse("2026-08-13T11:20:00Z");
const hoursAgo = (h: number) => new Date(NOW - h * 3600_000).toISOString().replace("T", " ").slice(0, 19);

function column(
  name: string,
  type: string,
  extra: Partial<{
    primary_key: boolean;
    structural: boolean;
    omitted: boolean;
    nullable: boolean;
    default: string | null;
  }> = {}
) {
  return {
    name,
    type,
    nullable: extra.nullable ?? true,
    // Mirrors information_schema: serial ids and NOW() columns carry a default,
    // which is what tells the editor not to ask for them when adding a row.
    default:
      extra.default ??
      (extra.primary_key && type === "integer"
        ? "nextval('seq'::regclass)"
        : name === "created_at"
        ? "now()"
        : null),
    primary_key: extra.primary_key ?? false,
    structural: extra.structural ?? false,
    structural_note: extra.structural ? "Demo fixture — see the app's own note." : null,
    omitted: extra.omitted ?? false,
  };
}

const ADMIN_TABLES_FIXTURE: Record<string, { note: string; ordered_by: string; pk: string; columns: ReturnType<typeof column>[]; rows: Record<string, unknown>[] }> = {
  documents: {
    pk: "id",
    ordered_by: "id DESC",
    note: "One row per chunk, not per document.",
    columns: [
      column("id", "integer", { primary_key: true, nullable: false }),
      column("collection", "text", { nullable: false }),
      column("text", "text", { nullable: false }),
      column("metadata", "jsonb", { structural: true }),
      column("embedding", "USER-DEFINED", { structural: true, omitted: true }),
    ],
    rows: [
      { id: 312, collection: "guidelines", text: "4.2 Depictions of firearm discharge toward a named character require standards sign-off before the scene is storyboarded.", metadata: { filename: "demo-studio-guidelines-2026.pdf" } },
      { id: 311, collection: "guidelines", text: "2.1 More than three instances of category-A language moves a title out of the PG-13 target audience.", metadata: { filename: "demo-studio-guidelines-2026.pdf" } },
      { id: 310, collection: "guidelines", text: "6.4 A minor placed in physical jeopardy must not be shown unattended for more than one continuous scene.", metadata: { filename: "demo-broadcast-standards.pdf" } },
      { id: 309, collection: "past_films", text: "Harbour Lights (2021) — single-night structure, tested well, needed a re-cut to fix an off-page ending.", metadata: { filename: "demo-past-films-2019-2025.pdf" } },
      { id: 308, collection: "past_films", text: "Northbound (2023) — ensemble road picture; the second act was rebuilt in the edit after previews.", metadata: { filename: "demo-past-films-2019-2025.pdf" } },
      { id: 307, collection: "scripts", text: "INT. WAREHOUSE - NIGHT. MAYA edges along the catwalk, torch shaking.", metadata: { filename: "demo-past-films-2019-2025.pdf" } },
    ],
  },
  results: {
    pk: "id",
    ordered_by: "id DESC",
    note: "One row per agent run.",
    columns: [
      column("id", "integer", { primary_key: true, nullable: false }),
      column("task", "text", { nullable: false }),
      column("script_text", "text", { nullable: false, structural: true }),
      column("result", "text", { nullable: false }),
      column("created_at", "timestamp without time zone"),
    ],
    rows: [
      { id: 4105, task: "greenlight", script_text: "INT. DOCK OFFICE - NIGHT\n\nMAYA finds her brother's name on the manifest…", result: GREENLIGHT, created_at: hoursAgo(1) },
      { id: 4104, task: "release_check", script_text: "2026-11-20|4103", result: RELEASE_CHECK, created_at: hoursAgo(1) },
      { id: 4103, task: "release_listing", script_text: "thriller", result: RELEASE_LISTING, created_at: hoursAgo(2) },
      { id: 4102, task: "analyze", script_text: "INT. DOCK OFFICE - NIGHT\n\nMAYA finds her brother's name on the manifest…", result: ANALYZE, created_at: hoursAgo(20) },
      { id: 4101, task: "compliance", script_text: "INT. WAREHOUSE - NIGHT\n\nMAYA edges along the catwalk, torch shaking…", result: COMPLIANCE, created_at: hoursAgo(26) },
    ],
  },
  memory: {
    pk: "id",
    ordered_by: "created_at DESC, id DESC",
    note: "Conversation turns, two per agent run.",
    columns: [
      column("id", "integer", { primary_key: true, nullable: false, structural: true }),
      column("session_id", "text", { nullable: false }),
      column("role", "text", { nullable: false }),
      column("content", "text", { nullable: false }),
      column("created_at", "timestamp without time zone", { structural: true }),
    ],
    rows: [
      { id: 908, session_id: "web-session", role: "assistant", content: "One direct clash (Vermilion, 7 days before). [demo data]", created_at: hoursAgo(1) },
      { id: 907, session_id: "web-session", role: "user", content: "[release_check] 2026-11-20|4103", created_at: hoursAgo(1) },
      { id: 906, session_id: "web-session", role: "assistant", content: "8 thriller titles scheduled between 2026-09 and 2027-02. [demo data]", created_at: hoursAgo(2) },
      { id: 905, session_id: "web-session", role: "user", content: "[release_listing] thriller", created_at: hoursAgo(2) },
      { id: 904, session_id: "marketing-review", role: "assistant", content: "Pacing 7/10, character clarity 8/10, verdict Consider. [demo data]", created_at: hoursAgo(20) },
      { id: 903, session_id: "marketing-review", role: "user", content: "[analyze] INT. DOCK OFFICE - NIGHT. MAYA finds her brother's name…", created_at: hoursAgo(20) },
      { id: 902, session_id: "marketing-review", role: "assistant", content: "3 moments flagged; guidelines 4.2, 2.1 and 6.4 apply. [demo data]", created_at: hoursAgo(26) },
      { id: 901, session_id: "marketing-review", role: "user", content: "[compliance] INT. WAREHOUSE - NIGHT. Maya edges along the catwalk…", created_at: hoursAgo(26) },
    ],
  },
  cache: {
    pk: "question",
    ordered_by: "created_at DESC, question DESC",
    note: "Answers keyed by a hash of their input.",
    columns: [
      column("question", "text", { primary_key: true, nullable: false, structural: true }),
      column("answer", "text", { nullable: false }),
      column("created_at", "timestamp without time zone", { structural: true }),
    ],
    rows: [
      { question: "9f2b41c7a08e5d6431ff0c2ba7e4d5190c3a8be27d41f6905ab3c7e2d81f4460", answer: RELEASE_CHECK, created_at: hoursAgo(1) },
      { question: "1c84fa07be395d2ca6f0b71d8e430295cbb7146f8d0e35a29417cf6b0d8e2a53", answer: RELEASE_LISTING, created_at: hoursAgo(2) },
      { question: "7ad30fe1b95c62480ac1f37e05d9b26438fa7c1de0946b53827fc0a41e6d9b72", answer: ANALYZE, created_at: hoursAgo(20) },
      { question: "44e9c0b7182fa63d5e07bc94a1f38d260e5b7ca9038f14e6b27d5901ca3f8b16", answer: COMPLIANCE, created_at: hoursAgo(26) },
    ],
  },
  eval_history: {
    pk: "id",
    ordered_by: "id DESC",
    note: "Faithfulness scores.",
    columns: [
      column("id", "integer", { primary_key: true, nullable: false }),
      column("task", "text", { nullable: false }),
      column("faithfulness_score", "double precision"),
      column("created_at", "timestamp without time zone"),
    ],
    rows: [
      { id: 58, task: "analyze", faithfulness_score: 8, created_at: hoursAgo(20) },
      { id: 57, task: "compliance", faithfulness_score: 9, created_at: hoursAgo(26) },
      { id: 56, task: "compliance", faithfulness_score: 7, created_at: hoursAgo(30) },
      { id: 55, task: "analyze", faithfulness_score: 6, created_at: hoursAgo(48) },
      { id: 54, task: "compliance", faithfulness_score: 9, created_at: hoursAgo(52) },
      { id: 53, task: "analyze", faithfulness_score: 8, created_at: hoursAgo(70) },
      { id: 52, task: "compliance", faithfulness_score: 7, created_at: hoursAgo(74) },
      { id: 51, task: "analyze", faithfulness_score: 8, created_at: hoursAgo(96) },
    ],
  },
};

// Writes in Demo Mode land in this in-memory copy and nowhere else. It exists so
// that "add an entry" followed by the refresh actually shows the entry — a write
// UI demoed against frozen fixtures looks broken. Reset whenever Demo Mode is
// switched off, so nothing survives into a live session or a reload.
let adminRows: Record<string, Record<string, unknown>[]> = {};

export function resetAdminFixtures(): void {
  adminRows = Object.fromEntries(
    Object.entries(ADMIN_TABLES_FIXTURE).map(([name, spec]) => [name, spec.rows.map((r) => ({ ...r }))])
  );
}
resetAdminFixtures();

function adminSpec(table: string) {
  const spec = ADMIN_TABLES_FIXTURE[table];
  if (!spec) throw new Error(`Demo Mode has no fixture for table ${table}.`);
  return spec;
}

function structuralWarnings(table: string, columns: string[]) {
  const spec = adminSpec(table);
  return columns
    .filter((name) => spec.columns.some((c) => c.name === name && c.structural))
    .map((column) => ({ column, note: "Demo fixture — the app's own note explains what depends on this." }));
}

/** Match a row by its primary key, comparing as text so "4101" finds 4101. */
function findRow(table: string, rowId: string) {
  const pk = adminSpec(table).pk;
  return adminRows[table].find((row) => String(row[pk]) === String(rowId));
}

// ---- Router --------------------------------------------------------------

type Handler = (match: RegExpMatchArray, body: unknown, search: URLSearchParams) => unknown;

const ROUTES: [string, RegExp, Handler][] = [
  ["GET", /^\/health$/, () => ({ status: "ok", database: "demo fixtures" })],

  [
    "POST",
    /^\/run-agent$/,
    (_m, body) => {
      const form = new URLSearchParams(String(body));
      const task = form.get("task") ?? "compliance";
      const canned = AGENT_RESULTS[task] ?? AGENT_RESULTS.compliance;
      const response: AgentResponse = {
        result_id: canned.id,
        task,
        result: canned.text,
        from_cache: false,
        eval:
          form.get("evaluate") === "true"
            ? { score: 8, reasoning: `${LABEL} ${EVAL_REASONING}` }
            : null,
      };
      return response;
    },
  ],

  [
    "POST",
    /^\/check-conflicts\/(\d+)$/,
    (m): ConflictCheckResponse => ({
      result_id: Number(m[1]),
      proposed_date: "2026-11-20",
      conflict_report: CONFLICT_REPORT,
      recommended_dates: { ...RECOMMENDED_DATES },
    }),
  ],

  // /finalize-calendar, /confirm-date and /override-date all return the same
  // shape. Nothing is written anywhere — the "events" are the fixture links.
  [
    "POST",
    /^\/(?:finalize-calendar|confirm-date|override-date)\/(\d+)$/,
    (m, body): DateConfirmationResponse => {
      const overrides =
        typeof body === "string" && body.startsWith("{")
          ? (JSON.parse(body) as Record<string, string>)
          : {};
      const events = Object.fromEntries(
        Object.entries(DEMO_EVENTS).map(([code, info]) => [
          code,
          overrides[code] ? { ...info, date: overrides[code] } : info,
        ])
      );
      return {
        result_id: Number(m[1]),
        confirmed: true,
        conflict_report: CONFLICT_REPORT,
        events,
      };
    },
  ],

  ["POST", /^\/ingest$/, () => ({ inserted_chunks: 24, ids: [9001, 9002, 9003] })],
  ["DELETE", /^\/document$/, () => ({ deleted_chunks: 24 })],

  [
    "GET",
    /^\/admin\/tables$/,
    () => ({
      tables: Object.entries(ADMIN_TABLES_FIXTURE).map(([name, spec]) => ({
        name,
        primary_key: spec.pk,
        rows: adminRows[name].length,
        structural_columns: spec.columns.filter((c) => c.structural).map((c) => c.name).sort(),
        note: spec.note,
      })),
    }),
  ],

  [
    "GET",
    /^\/admin\/tables\/([a-z_]+)$/,
    (m, _body, search) => {
      const spec = adminSpec(m[1]);
      const rows = adminRows[m[1]];

      const query = (search.get("q") ?? "").trim().toLowerCase();
      const limit = Number(search.get("limit") ?? 25);
      const offset = Number(search.get("offset") ?? 0);

      // Same substring-over-every-column behaviour the backend implements, so
      // searching in Demo Mode behaves the way it will against real data.
      const matched = query
        ? rows.filter((row) => JSON.stringify(row).toLowerCase().includes(query))
        : rows;
      const page = matched.slice(offset, offset + limit);

      return {
        table: m[1],
        primary_key: spec.pk,
        ordered_by: spec.ordered_by,
        note: spec.note,
        search: query || null,
        columns: spec.columns,
        pagination: {
          limit,
          offset,
          total: matched.length,
          returned: page.length,
          has_more: offset + page.length < matched.length,
        },
        rows: page,
      };
    },
  ],

  [
    "GET",
    /^\/admin\/tables\/([a-z_]+)\/(.+)$/,
    (m) => {
      const table = m[1];
      const spec = adminSpec(table);
      const row = findRow(table, decodeURIComponent(m[2]));
      if (!row) throw new Error(`No row ${m[2]} in '${table}'.`);
      return { table, row_id: row[spec.pk], columns: spec.columns, row };
    },
  ],

  [
    "POST",
    /^\/admin\/tables\/([a-z_]+)$/,
    (m, body) => {
      const table = m[1];
      const spec = adminSpec(table);
      const values = JSON.parse(String(body)) as Record<string, unknown>;

      const unknown = Object.keys(values).filter((k) => !spec.columns.some((c) => c.name === k));
      if (unknown.length) throw new Error(`Unknown column(s) for '${table}': ${unknown.join(", ")}.`);

      // Stand-in for the columns the real database fills in itself.
      const row: Record<string, unknown> = { ...values };
      if (spec.pk === "id" && row.id == null) {
        row.id = Math.max(0, ...adminRows[table].map((r) => Number(r.id) || 0)) + 1;
      }
      if (spec.columns.some((c) => c.name === "created_at") && row.created_at == null) {
        row.created_at = new Date().toISOString().replace("T", " ").slice(0, 19);
      }

      adminRows[table] = [row, ...adminRows[table]]; // ordered newest-first, like the real tables
      return {
        table,
        row_id: row[spec.pk],
        row,
        structural_warnings: structuralWarnings(table, Object.keys(values)),
      };
    },
  ],

  [
    "PATCH",
    /^\/admin\/tables\/([a-z_]+)\/(.+)$/,
    (m, body) => {
      const table = m[1];
      const spec = adminSpec(table);
      const values = JSON.parse(String(body)) as Record<string, unknown>;

      const unknown = Object.keys(values).filter((k) => !spec.columns.some((c) => c.name === k));
      if (unknown.length) throw new Error(`Unknown column(s) for '${table}': ${unknown.join(", ")}.`);

      const row = findRow(table, decodeURIComponent(m[2]));
      if (!row) throw new Error(`No row ${m[2]} in '${table}'.`);
      Object.assign(row, values);

      return {
        table,
        row_id: row[spec.pk],
        row,
        updated: Object.keys(values),
        structural_warnings: structuralWarnings(table, Object.keys(values)),
      };
    },
  ],

  [
    "DELETE",
    /^\/admin\/tables\/([a-z_]+)\/(.+)$/,
    (m) => {
      const table = m[1];
      const spec = adminSpec(table);
      const rowId = decodeURIComponent(m[2]);
      const row = findRow(table, rowId);
      if (!row) return { table, row_id: rowId, deleted_rows: 0, grouped_by: null };

      // documents delete by filename group, exactly as the backend does.
      if (table === "documents") {
        const filename = (row.metadata as { filename?: string } | null)?.filename;
        if (!filename) throw new Error(`documents row ${rowId} has no metadata.filename.`);
        const before = adminRows.documents.length;
        adminRows.documents = adminRows.documents.filter(
          (r) => (r.metadata as { filename?: string } | null)?.filename !== filename
        );
        return {
          table,
          row_id: rowId,
          deleted_rows: before - adminRows.documents.length,
          grouped_by: "filename",
          filename,
        };
      }

      adminRows[table] = adminRows[table].filter((r) => String(r[spec.pk]) !== String(rowId));
      return { table, row_id: rowId, deleted_rows: 1, grouped_by: null };
    },
  ],

  ["GET", /^\/result\/(\d+)$/, (m) => RESULTS[Number(m[1])] ?? { error: "not found" }],
  ["GET", /^\/history\/(.+)$/, () => ({ history: HISTORY })],
  ["GET", /^\/eval\/summary$/, () => EVAL_SUMMARY],
  ["GET", /^\/eval\/chart$/, () => ({ chart_base64: EVAL_CHART })],
];

/** Milliseconds of fake latency, so loading states are visible in a demo. */
const DEMO_LATENCY_MS = 400;

/**
 * Resolve one request against the fixtures. Throws for a path with no fixture,
 * which is a bug in this file rather than something a user can cause — a
 * silently-empty response would be worse than a visible error.
 */
export async function demoRequest(path: string, options: RequestInit = {}): Promise<unknown> {
  const method = (options.method ?? "GET").toUpperCase();
  const [pathname, queryString = ""] = path.split("?");
  const search = new URLSearchParams(queryString);

  for (const [routeMethod, pattern, handler] of ROUTES) {
    if (routeMethod !== method) continue;
    const match = pathname.match(pattern);
    if (match) {
      await new Promise((resolve) => setTimeout(resolve, DEMO_LATENCY_MS));
      return handler(match, options.body, search);
    }
  }
  throw new Error(`Demo Mode has no fixture for ${method} ${pathname}.`);
}
