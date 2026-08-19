// Every piece of explanatory copy in the UI lives here, so the wording that tells
// a user what to do stays in one place instead of being scattered through JSX.
//
// The values in GENRES and the min-length rules mirror the backend. If the
// backend changes, change these too:
//   GENRES          -> agents.py::GENRE_IDS
//   MIN_SCRIPT_CHARS-> main.py::run_agent_endpoint (min_length)
//   COUNTRY_NAMES   -> main.py::COUNTRY_DISPLAY_NAMES

import type { TaskType } from "@/lib/api";

/** The only genres the backend can look up. Anything else is rejected. */
export const GENRES = [
  "action",
  "adventure",
  "animation",
  "comedy",
  "crime",
  "documentary",
  "drama",
  "family",
  "fantasy",
  "history",
  "horror",
  "music",
  "mystery",
  "romance",
  "science fiction",
  "tv movie",
  "thriller",
  "war",
  "western",
] as const;

/** Friendly labels for country codes. Unknown codes fall back to the raw code. */
const COUNTRY_NAMES: Record<string, string> = {
  US: "United States",
  MX: "Mexico",
  GB: "United Kingdom",
  JP: "Japan",
  DE: "Germany",
};

export function countryName(code: string): string {
  return COUNTRY_NAMES[code] ?? code;
}

/** Backend rejects script text shorter than this (main.py, min_length=10). */
export const MIN_SCRIPT_CHARS = 10;

/** Backend rejects uploads over this size (config.py, MAX_UPLOAD_FILE_SIZE_MB). */
export const MAX_UPLOAD_MB = 10;

/** Backend allows this many requests per session per minute (resilience.py). */
export const RATE_LIMIT = { requests: 10, windowSeconds: 60 };

export interface TaskInfo {
  value: TaskType;
  label: string;
  /** One line, shown on the selector card. */
  tagline: string;
  /** What the agent actually does, in plain language. */
  whatItDoes: string;
  /** What the user has to provide, and in what shape. */
  youProvide: string;
  /** What comes back. */
  youGetBack: string[];
  /** Anything that must be true first, or null if nothing. */
  requires: string | null;
  /** Rough wait, so a slow response doesn't look broken. */
  typicalWait: string;
}

export const TASK_INFO: Record<"compliance" | "analyze" | "release_listing", TaskInfo> = {
  compliance: {
    value: "compliance",
    label: "Compliance Check",
    tagline: "Flag content that needs legal or standards review",
    whatItDoes:
      "Reads your script excerpt and flags moments that may need compliance review — violence, language, sensitive content. It then searches the studio guidelines you have uploaded and reports which specific guideline applies to each concern.",
    youProvide: "A section of script. Paste the actual dialogue and action lines, not a summary.",
    youGetBack: [
      "A list of flagged moments from your excerpt",
      "The guideline that applies to each one, quoted from your uploaded documents",
    ],
    requires:
      "Guideline documents must be uploaded first, in the Documents tab. Without them the agent will tell you it found nothing relevant and recommend manual review.",
    typicalWait: "10–30 seconds (two AI calls plus a document search)",
  },
  analyze: {
    value: "analyze",
    label: "Script Analysis",
    tagline: "Structural read plus a greenlight recommendation",
    whatItDoes:
      "Reads your excerpt and scores it on pacing and character clarity, then compares it against past films in your knowledge base to ground its advice in things the studio has actually made.",
    youProvide: "A section of script. More text gives a better read — a full scene works better than a few lines.",
    youGetBack: [
      "A one-sentence logline",
      "Pacing score out of 10, with reasons tied to specific moments",
      "Character clarity score out of 10",
      "Structural strengths and weaknesses",
      "A final verdict: Pass, Consider, or Recommend",
    ],
    requires:
      "Works without any uploads, but comparisons to past films only appear if you have uploaded past-film documents.",
    typicalWait: "15–40 seconds (two AI calls plus a document search)",
  },
  release_listing: {
    value: "release_listing",
    label: "Browse Upcoming Releases",
    tagline: "See what is already scheduled in a genre",
    whatItDoes:
      "Looks up films in your chosen genre releasing this year and next, ordered by popularity. This comes from TMDB, a public film database — it does not use your uploaded documents.",
    youProvide: "One genre, picked from the list.",
    youGetBack: ["Film titles with their release dates, most popular first"],
    requires: null,
    typicalWait: "2–5 seconds",
  },
};

/** Copy for the guided release-date planner (its own tab, not a single agent call). */
export const PLANNER_STEPS = [
  {
    title: "Pick a genre",
    why: "The planner needs to know which films yours would compete with. Choosing a genre pulls the list of everything already scheduled in it.",
  },
  {
    title: "Propose a release date",
    why: "An AI agent reads the release list and tells you which films land within two weeks of your date — the ones that would split your audience.",
  },
  {
    title: "Check holidays and events",
    why: "A second, separate agent checks your date against public holidays in each country plus major sporting events and awards ceremonies. It suggests a clear date per country.",
  },
  {
    title: "Adjust and create calendar events",
    why: "You get the final say on every country's date. Confirming writes a real event to the shared Google Calendar — one per country.",
  },
] as const;

// ---- Panel headings -------------------------------------------------------
// Every tab opens with the same three things in the same order: an eyebrow that
// names the area, a heading, and one sentence of what this screen is for. Kept
// together so the voice stays consistent across six panels written at different
// times.

export const PANEL_COPY = {
  guide: {
    eyebrow: "Start here",
    title: "Studio operations, run by agents",
    intro:
      "Read scripts against your own guidelines, and plan release dates around the films, holidays and events that would compete for the same audience.",
  },
  documents: {
    eyebrow: "Knowledge base",
    title: "What the agents are allowed to read",
    intro:
      "The agents answer from your documents, not from general knowledge. What you upload here is what they can cite.",
  },
  agents: {
    eyebrow: "Agents",
    title: "Put a script in front of an agent",
    intro: "Three jobs, three different inputs. Pick one, give it what it needs, read what comes back.",
  },
  planner: {
    eyebrow: "Release planning",
    title: "Find a date that nothing else is standing on",
    intro:
      "Four steps, each feeding the next. Nothing leaves this app until the last one, which writes real calendar events.",
  },
  history: {
    eyebrow: "Archive",
    title: "Everything you have already run",
    intro: "Pull back a conversation by its session name, or a single answer by the number it was given.",
  },
  insights: {
    eyebrow: "Quality",
    title: "How much of this can you trust",
    intro:
      "Every scored answer is re-read by a second AI call and rated on how well your own material actually supports it.",
  },

  /** Shared state copy, so a loading or failed state reads the same everywhere. */
  loadingChart: "Drawing the trend…",
  loadingScores: "Adding up the scores…",
  sectionUpload: "Add a document",
  sectionRemove: "Remove a document",
  sectionHistory: "Conversation history",
  sectionLookup: "Look up a saved answer",
  sectionChart: "Score over time",
  sectionChoose: "Choose what you want done",
  sectionProvide: "Give it what it needs",
  sectionAnswer: "The answer",
} as const;

// ---- App shell ------------------------------------------------------------
// The header, the tab strip and the two status banners. Tab `id` values are also
// the switch keys in app/page.tsx, so they are identifiers as well as labels —
// change one and change the panel it selects.

export const SHELL_COPY = {
  productName: "Agentic Studio",
  mark: "A",
  tagline: "Script intelligence and release strategy",

  tabs: [
    { id: "Start here", blurb: "What this tool does" },
    { id: "Documents", blurb: "Give the agents something to read" },
    { id: "Agents", blurb: "Analyse a script" },
    { id: "Release Planner", blurb: "Pick a release date" },
    { id: "History", blurb: "Find an earlier answer" },
    { id: "Insights", blurb: "How reliable the answers were" },
    { id: "Database", blurb: "Everything the app has stored" },
  ],

  health: {
    checking: "checking",
    online: "connected",
    offline: "backend not reachable",
  },

  offline: {
    title: "The backend is not responding.",
    body: "Nothing on this page will work until it is running. Start it with",
    andFor: "and, for the Release Planner,",
    api: "uvicorn main:app --reload --port 8000",
    agent4: "python agent4_service.py",
  },
} as const;

/** Everything the UI says about Demo Mode. The fixture data itself is in lib/demo.ts. */
export const DEMO_COPY = {
  label: "Demo Mode",
  badge: "DEMO DATA",
  toggleHint:
    "Runs the whole app against canned example responses. No backend calls, no AI usage, no calendar events.",
  banner:
    "Demo Mode is on. Every answer below is a fixed example — nothing is sent to the backend, no AI quota is used, and no calendar events are created. Switch it off in the header to work with real data.",
  noDownload:
    "PDF download is turned off in Demo Mode, because the file would have to be built by the backend. Switch Demo Mode off to download a real answer.",
  documentsNote:
    "In Demo Mode this list is a fixed set of example filenames. Uploading and removing are simulated — your real knowledge base is untouched.",
  calendarNote:
    "In Demo Mode this button creates nothing. No calendar is contacted and the links below go to a plain Google Calendar day view, not to real events.",
} as const;

export const GLOSSARY = {
  sessionId:
    "A label that groups your runs together so the History tab can show them as one conversation. Any text works — use your name or the project you are working on. Requests are rate limited per session: " +
    `${RATE_LIMIT.requests} per ${RATE_LIMIT.windowSeconds} seconds.`,
  evaluate:
    "After the agent answers, a second AI call re-reads both your input and the answer and scores 1–10 how well the answer is actually supported by what you provided. Catches confident-sounding answers that were invented. Adds a few seconds, and the scores build the Insights tab.",
  fromCache:
    "This exact input has been run before, so the stored answer was returned instantly instead of calling the AI again. Change the input even slightly to force a fresh run.",
  resultId:
    "The database ID of this answer. Keep it if you want to look the answer up again later, or download it as a PDF, from the History tab.",
  faithfulness:
    "The average of every faithfulness score recorded so far. 10 means answers stayed strictly grounded in the source material; low scores mean the AI was inventing detail.",
  chunks:
    "Uploaded PDFs are split into overlapping ~300-word pieces called chunks. Each chunk is stored with a numeric fingerprint of its meaning, which is how the agents later find the relevant parts of a long document.",
  collections:
    "Every chunk is auto-sorted into one of three buckets: guidelines (compliance rules), past_films (films the studio has made), or scripts (everything else). Compliance Check searches guidelines; Script Analysis searches past_films.",
} as const;

// ---- Database tab ---------------------------------------------------------
// Describes what is stored, in the terms of the person who put it there. The
// backend's own column notes are written for engineers ("re-split on '|' by
// /check-conflicts"), so they are deliberately not shown — the API says WHICH
// fields are structural, and STRUCTURAL_LABELS below says how to put that to
// someone who does not know what an endpoint is.

export const DATABASE_COPY = {
  title: "What the app has stored",
  intro:
    "Everything this app remembers, in five collections. You can add, edit and delete entries here — changes are real and take effect immediately.",
  structuralChip: "used internally",
  structuralLegend:
    "Fields marked “used internally” are ones the app itself reads to work out what to do next. They look like ordinary text but the app depends on their exact shape.",
  searchPlaceholder: "Search everything in this collection…",
  searchButton: "Search",
  searchClear: "Clear",
  searching: (term: string) => `Showing matches for “${term}”.`,
  noResults: (term: string) => `Nothing in this collection matches “${term}”.`,
  empty: "Nothing stored here yet.",
  loading: "Fetching…",
  showing: (from: number, to: number, total: number) => `Showing ${from}–${to} of ${total}`,
  previous: "Previous",
  next: "Next",
  expand: "Show the full text",
  unknownTime: "no timestamp",

  /** One card per collection on the picker, in the order they are shown. */
  tables: {
    documents: {
      label: "Documents",
      unit: "chunks",
      blurb:
        "The PDFs you uploaded, cut into small searchable pieces. The agents read these when they answer.",
    },
    results: {
      label: "Answers",
      unit: "answers",
      blurb: "Every answer an agent has produced, with the input that prompted it.",
    },
    memory: {
      label: "Conversations",
      unit: "messages",
      blurb: "Your runs grouped by session name, as a back-and-forth you can read.",
    },
    cache: {
      label: "Saved answers",
      unit: "entries",
      blurb:
        "Answers kept for a day so that asking the same thing twice does not cost a second AI call.",
    },
    eval_history: {
      label: "Scores",
      unit: "scores",
      blurb: "How closely each scored answer stuck to your own material.",
    },
  },

  /** Plain-language stand-ins for the backend's structural_note, keyed table.column. */
  structuralLabels: {
    "results.script_text":
      "For release-date checks this holds the date and a reference to the film list, joined together. The Release Planner reads it back apart.",
    "memory.created_at":
      "When the message was stored. It is how the app keeps replies underneath the questions they answer.",
    "memory.id":
      "The message's position in order. Together with the time, it stops a reply appearing before its question.",
    "cache.created_at":
      "When the answer was saved. Everything older than a day is treated as expired — there is no separate expiry date.",
    "cache.question":
      "A scrambled fingerprint of the original question, not the question itself. It is how the app finds a saved answer again.",
    "documents.embedding":
      "A numeric fingerprint of the meaning of this piece of text. It is how the agents find relevant passages. Too large to show.",
    "documents.metadata":
      "Which file this piece came from. Everything from one upload shares it, which is how a document is removed in one go.",
  } as Record<string, string>,

  structuralFallback:
    "The app reads this field to decide what to do, so its exact shape matters.",

  /** documents: chunk grouping happens over the loaded page, so say so. */
  documentsGrouping: (loaded: number, total: number) =>
    loaded >= total
      ? `All ${total} pieces, grouped by the file they came from.`
      : `The most recent ${loaded} of ${total} pieces, grouped by the file they came from. Search for a filename to see the rest.`,
  documentsChunks: (n: number) => `${n} ${n === 1 ? "piece" : "pieces"} shown`,
  documentsCollection: "sorted into",

  cacheFresh: (hours: number) =>
    `Still usable for about ${hours} more ${hours === 1 ? "hour" : "hours"}`,
  cacheExpired: "Past its day — the next identical question will be answered fresh",
  cacheKey: "Internal lookup key",

  memoryYou: "you",
  memoryAgent: "agent",
  memorySession: "Session",
  memoryMessages: (n: number) => `${n} ${n === 1 ? "message" : "messages"}`,

  resultsPrompt: "What was sent in",
  resultsAnswer: "What came back",

  /** Mirrors InsightsPanel's thresholds so one score never reads two ways. */
  scoreReading: (score: number) =>
    score >= 8
      ? "Stayed closely tied to the source material"
      : score >= 5
      ? "Mixed — some of this drifted from what the source supported"
      : "Low — claimed more than the source backs up",
  scoreMissing: "No score was recorded for this run",
} as const;

// ---- Database tab: write controls -----------------------------------------
// Two rules this copy exists to serve:
//   Every destructive action says what it does before it happens.
//   Every structural field says what breaks if the new value is wrong.
// structuralRisks is the second of those, keyed table.column. A field with no
// entry falls back to structuralRiskFallback — vaguer, but never silent.

export const DATABASE_WRITE_COPY = {
  add: "Add an entry",
  edit: "Edit",
  delete: "Delete",
  save: "Save changes",
  create: "Add it",
  cancel: "Cancel",
  saving: "Saving…",
  deleting: "Deleting…",

  editTitle: (label: string) => `Editing one entry in ${label}`,
  createTitle: (label: string) => `Adding an entry to ${label}`,
  createHint:
    "Fields the app fills in itself — the entry's number and the time it was stored — are not shown; they are set for you.",
  noChanges: "Nothing has been changed yet.",
  changedFields: (n: number) => `${n} ${n === 1 ? "field" : "fields"} changed`,

  optional: "optional",
  jsonHint: "Written as JSON, for example: {\"filename\": \"guidelines.pdf\"}",
  jsonInvalid: "That is not valid JSON, so it cannot be saved. Check the quotes and brackets.",
  numberInvalid: "That field only accepts a number.",
  timestampHint: "Format: 2026-08-13 14:30:00",
  emptyCreate: "Fill in at least one field before adding an entry.",

  // ---- structural gating ----
  locked: "Locked — the app depends on this one",
  unlock: "Let me edit this anyway",
  relock: "Leave it alone",
  unlockTitle: (label: string) => `Unlock “${label}” for editing?`,
  unlockWhat:
    "This field is not just stored — the app reads it to decide what to do next. Unlocking lets you type into it. Nothing is saved until you confirm again.",
  saveStructuralTitle: "Confirm the risky part of this change",
  saveStructuralWhat: (columns: string[]) =>
    `You are about to change ${columns.length === 1 ? "a field the app depends on" : "fields the app depends on"}: ${columns.join(", ")}. The rest of your edits will be saved at the same time.`,
  saveStructuralConfirm: "Yes, save it",

  /** What actually breaks. One entry per structural column, keyed table.column. */
  structuralRisks: {
    "results.script_text":
      "For a release-date check this holds the date and a reference to the film list, joined by a bar. The Release Planner splits it back apart — if the shape is wrong, checking holidays, confirming a date and creating calendar events all stop working for this answer.",
    "memory.created_at":
      "This is how the app keeps each reply underneath the question it answers. A wrong time can make the conversation read out of order, with answers appearing before what they answered.",
    "memory.id":
      "This is the message's place in the order. Two messages stored in the same instant are separated by it, so changing it can put a reply before its question.",
    "cache.created_at":
      "This decides whether the saved answer still counts as fresh. Moving it forward brings back an answer that should have expired; moving it back throws away a good one and spends AI quota re-answering.",
    "cache.question":
      "This fingerprint is how the app finds this saved answer again. Change it and the answer becomes unreachable — nothing will ever match it, and the next identical question is answered from scratch.",
    "documents.metadata":
      "The filename in here is what groups every piece of one upload. Change it and this piece stops belonging to that file: removing the file will leave this piece behind, still searchable.",
    "documents.embedding":
      "The numeric fingerprint the agents match against. A value that no longer matches the text makes this piece either unfindable or returned for the wrong questions.",
  } as Record<string, string>,

  structuralRiskFallback:
    "The app reads this field to decide what to do. If the new value is not the shape it expects, whatever depends on it will stop working — quietly, not with an error.",

  // ---- delete ----
  deleteTitle: "Delete this for good?",
  deleteConfirm: "Yes, delete it",
  deleteRisk(table: string, target: { id: string; filename?: string; chunks?: number }): string {
    switch (table) {
      case "documents":
        return `This removes every piece that came from “${target.filename}” — ${target.chunks} in total, not just the one you clicked. Pieces are always removed a whole file at a time. The agents will no longer be able to quote anything from it. To undo this you would upload the file again.`;
      case "results":
        return `This deletes stored answer #${target.id} and the input that produced it. Looking it up by number stops working, and a release plan built on this answer will no longer find the film list it needs.`;
      case "memory":
        return "This deletes one message from a conversation. The conversation stays, but reads with a gap where this was — and deleting a question leaves its answer with nothing to answer.";
      case "cache":
        return "This deletes the saved copy of an answer. Nothing is permanently lost: the next time someone asks the same thing it is answered fresh, which takes longer and uses AI quota.";
      case "eval_history":
        return "This deletes one score. The average and the chart on the Insights tab are recalculated without it, so both will move.";
      default:
        return "This permanently removes the entry.";
    }
  },

  // ---- results ----
  created: (label: string) => `Added to ${label}.`,
  updated: (n: number) => `Saved ${n} ${n === 1 ? "change" : "changes"}.`,
  deletedOne: "Deleted.",
  deletedMany: (n: number, filename: string) => `Deleted all ${n} pieces of “${filename}”.`,
} as const;

// ---- Technical API log ----------------------------------------------------
// The opposite audience to ACTIVITY_COPY below: this panel is for someone who wants
// the method, the endpoint and the bytes. Jargon is fine here — it is the point.

export const API_LOG_COPY = {
  label: "API log",
  title: "API log",
  toggleHint:
    "Shows every request this page makes to the backend — method, endpoint, payload, status and response. Off by default; independent of the plain-language activity feed.",
  subtitle: "Newest first. Click any row to see the payload and the full response.",
  empty: "No calls yet. Run an agent, upload a document or open History, and they appear here.",
  clear: "Clear",
  close: "Close the API log",
  simulated: "simulated",
  simulatedNote:
    "Demo Mode answered this from a local fixture. Nothing left the browser; the status is what the real endpoint returns for the same call.",
  maskedNote: "The API key is never printed here, even though it ships in the page bundle.",
  requestHeading: "Request",
  responseHeading: "Response",
  headersHeading: "Headers",
  noBody: "No payload sent.",
  pending: "in flight…",
} as const;

// ---- Activity narration ---------------------------------------------------
// What the app says it is doing while it does it, and what it says when it lands.
// Rules for anything added here: describe the outcome, not the machinery. The user
// does not know what a collection, an embedding, a rerank or an agent protocol is,
// and does not need to. "Searching the guidelines you uploaded" is the same fact as
// "hybrid_search over the guidelines collection", minus the vocabulary lesson.
//
// The `steps` play while the request is in flight; the `done` line is built from the
// real response, so it says the same true thing in Demo Mode and live mode.

export const ACTIVITY_COPY = {
  failed: "That step didn't finish. Nothing was saved.",

  agent: {
    compliance: {
      steps: [
        "Sending your script to the compliance agent…",
        "Searching the guidelines you uploaded for rules that apply…",
        "Writing up each concern with the rule behind it…",
      ],
      done: "Compliance report ready.",
    },
    analyze: {
      steps: [
        "Sending your script to the analysis agent…",
        "Looking through your past-film write-ups for comparable titles…",
        "Scoring the writing and drafting a verdict…",
      ],
      done: "Script analysis ready.",
    },
    release_listing: {
      steps: ["Looking up films already scheduled in that genre…"],
      done: "Got the list of films you would be releasing alongside.",
    },
    release_check: {
      steps: [
        "Comparing your date against every film already scheduled…",
        "Picking out the ones close enough to split your audience…",
      ],
      done: "Competition check ready.",
    },
  },
  reusedAnswer: "This exact input had been run before, so the stored answer came back instantly — no AI was used.",
  scored: (score: number) =>
    `Scored ${score}/10 for how closely the answer sticks to your own material.`,

  conflicts: {
    steps: [
      "Checking public holidays in each country…",
      "Checking major sporting events and awards ceremonies…",
      "Working out a clear date for each country…",
    ],
    done: (countries: number, clashes: number) =>
      clashes === 0
        ? `No clashes found. Suggested a date for each of the ${countries} countries.`
        : `Found ${clashes} clash${clashes === 1 ? "" : "es"} and suggested a clear date for each of the ${countries} countries.`,
  },

  calendar: {
    steps: ["Creating one calendar entry per country…"],
    done: (count: number) =>
      `Created ${count} calendar event${count === 1 ? "" : "s"}, one per country.`,
  },

  upload: {
    steps: [
      "Reading the text out of your PDF…",
      "Splitting it into searchable pieces…",
      "Sorting each piece into guidelines, past films or scripts…",
    ],
    done: (chunks: number) =>
      chunks === 0
        ? "That document was already in the knowledge base — nothing new was added."
        : `Added ${chunks} searchable pieces. The agents can use this document now.`,
  },

  remove: {
    steps: ["Taking that document out of what the agents can see…"],
    done: (chunks: number) =>
      chunks === 0
        ? "Nothing matched that filename, so nothing was removed."
        : `Removed ${chunks} pieces. The agents can no longer see that document.`,
  },

  lookup: {
    steps: ["Looking up that saved answer…"],
    done: (found: boolean) =>
      found ? "Found it — the full answer is on the right." : "No saved answer has that number.",
  },

  history: {
    steps: ["Fetching everything run under that session name…"],
    done: (turns: number) =>
      turns === 0
        ? "Nothing has been run under that session name yet."
        : `Found ${turns} messages from earlier runs.`,
  },

  scores: {
    steps: ["Adding up the faithfulness scores from every evaluated run…"],
    done: (count: number) =>
      count === 0
        ? "No runs have been scored yet."
        : `Averaged ${count} scored run${count === 1 ? "" : "s"}.`,
  },

  download: {
    steps: ["Building a PDF of that answer…"],
    done: "Saved to your downloads.",
  },

  stored: {
    steps: ["Reading what the app has stored…"],
    done: (shown: number, total: number, term: string | null) =>
      total === 0
        ? term
          ? `Nothing stored matches “${term}”.`
          : "Nothing stored in this collection yet."
        : term
        ? `Found ${total} matching ${total === 1 ? "entry" : "entries"} for “${term}”.`
        : `Showing ${shown} of ${total} stored ${total === 1 ? "entry" : "entries"}.`,
  },
} as const;

// ---- Guided walkthroughs --------------------------------------------------
// Four narrated tours, one per pipeline, driven by components/Walkthrough.tsx and
// run entirely against Demo Mode fixtures. Each step names the exact control to
// touch (`where`), what to do with it (`action`), what the fixtures will show
// (`expect`), and carries a visual aid — there is no text-only step.

export type StepVisual =
  /** A mock of the real control, ringed and arrowed. `value` fills it in as it will look. */
  | {
      kind: "control";
      control: "tab" | "select" | "textarea" | "input" | "date" | "button" | "checkbox" | "toggle";
      label: string;
      value?: string;
      caption: string;
    }
  /** Two states side by side, for a step whose point is what changes. */
  | { kind: "beforeAfter"; before: string; after: string; caption: string }
  /** The four-stage planner sequence, with one stage lit. Labels come from PLANNER_STEPS. */
  | { kind: "flow"; active: 1 | 2 | 3 | 4; caption: string };

export interface WalkthroughStep {
  title: string;
  /** Tab this step happens on, for the "open it" shortcut. Null when it is header chrome. */
  tab: string | null;
  /** Where the control physically is. Must be specific enough to point at. */
  where: string;
  action: string;
  /** What the fixture data will do, so a beginner can tell success from failure. */
  expect: string;
  visual: StepVisual;
}

export interface Walkthrough {
  label: string;
  tagline: string;
  /** Rough time, so nobody starts one expecting thirty seconds. */
  length: string;
  steps: WalkthroughStep[];
}

export const WALKTHROUGH_COPY = {
  launcherTitle: "Learn a pipeline by doing it",
  launcherBody:
    "Four guided walkthroughs, one per thing this app can do. Each one switches Demo Mode on and then talks you through the real screens, control by control, using example data. Nothing you click during a walkthrough reaches the backend, the AI, or the calendar.",
  launcherCta: "Start walkthrough",
  running: "in progress",
  demoNote: "Starts Demo Mode automatically",
  dockTitle: "Guided walkthrough",
  hereNow: "Where to look",
  doThis: "What to do",
  youWillSee: "What you should see",
  openTab: "Take me to",
  back: "Back",
  next: "Next",
  finish: "Finish",
  close: "Close walkthrough",
  collapse: "Collapse",
  expand: "Expand walkthrough",
  doneTitle: "That is the whole pipeline",
  doneBody:
    "Switch Demo Mode off in the header when you want to run the same steps against your real documents and the real backend. The screens are identical — only the data changes.",
} as const;

export const WALKTHROUGHS: Record<
  "compliance" | "analyze" | "release_listing" | "release_planner",
  Walkthrough
> = {
  // ---- Pipeline 1: Compliance Check --------------------------------------
  compliance: {
    label: "Compliance Check",
    tagline: "Flag script moments that need legal review, and cite the guideline behind each one",
    length: "7 steps, about 4 minutes",
    steps: [
      {
        title: "Confirm you are in Demo Mode",
        tab: null,
        where:
          "Top-right of the dark header bar, next to the app name. It is the pill with a small sliding switch, labelled Demo Mode.",
        action:
          "Nothing to do — starting this walkthrough already switched it on. Check that the switch is amber and that a DEMO DATA badge sits to its left.",
        expect:
          "An amber strip under the header saying every answer is a fixed example. That strip is your guarantee that nothing on screen is real or is costing anything.",
        visual: {
          kind: "control",
          control: "toggle",
          label: "Demo Mode",
          value: "on",
          caption: "Header, top-right — amber means fixtures, not the real backend.",
        },
      },
      {
        title: "Open the Agents tab",
        tab: "Agents",
        where:
          "The row of six tabs directly under the app name: Start here, Documents, Agents, Release Planner, History, Insights. Agents is the third.",
        action: "Click Agents. The active tab is the one with a blue underline.",
        expect:
          "A two-column screen. The left column is the form you fill in; the right column is empty and says your answer will appear here.",
        visual: {
          kind: "control",
          control: "tab",
          label: "Agents",
          caption: "Third tab along, under the app name.",
        },
      },
      {
        title: "Choose the Compliance Check agent",
        tab: "Agents",
        where:
          "Left column, the card headed “1. Choose what you want done”. Three stacked buttons; Compliance Check is the first.",
        action:
          "Click the Compliance Check button. A selected task turns blue-bordered with a blue tint.",
        expect:
          "The grey box below the three buttons rewrites itself: what the agent does, what you get back, and an amber note saying guideline documents must be uploaded first.",
        visual: {
          kind: "control",
          control: "button",
          label: "Compliance Check",
          value: "Flag content that needs legal or standards review",
          caption: "First of the three task buttons, top of the left column.",
        },
      },
      {
        title: "Paste a script excerpt",
        tab: "Agents",
        where:
          "Left column, card “2. Give it what it needs”. The large monospaced box labelled Script excerpt, with a red asterisk.",
        action:
          "Click into it and paste any scene — dialogue and action lines, not a summary. At least 10 characters, or the Run button stays greyed out.",
        expect:
          "A live character count under the box turns from grey to green once you pass 10 characters. In Demo Mode the fixture answer comes back whatever you type.",
        visual: {
          kind: "control",
          control: "textarea",
          label: "Script excerpt *",
          value: "INT. WAREHOUSE - NIGHT\n\nMAYA edges along the catwalk, torch shaking…",
          caption: "Big monospaced box in the middle of the left column.",
        },
      },
      {
        title: "Set the two options underneath",
        tab: "Agents",
        where:
          "Below the horizontal divider in the same card: a Session ID text box (pre-filled with web-session), and a tick box reading “Score this answer for faithfulness”.",
        action:
          "Leave the Session ID as web-session — it is just a label that groups your runs so the History tab can show them together. Leave the tick box ticked.",
        expect:
          "Ticked means a second AI call re-reads the answer and scores 1–10 how well the source actually supports it. That score is what fills the Insights tab.",
        visual: {
          kind: "control",
          control: "checkbox",
          label: "Score this answer for faithfulness",
          value: "ticked",
          caption: "Under the divider, below the Session ID box.",
        },
      },
      {
        title: "Run it",
        tab: "Agents",
        where:
          "The full-width blue button at the bottom of the left column, reading “Run Compliance Check”.",
        action: "Click it once. It greys out and shows a spinner while the agent works.",
        expect:
          "The right column swaps from the empty placeholder to a spinner saying Compliance Check is running, then to the answer. Against the real backend this takes 10–30 seconds; the demo fixture takes under a second.",
        visual: {
          kind: "beforeAfter",
          before: "Right column:\n\n“Your answer will appear here”",
          after: "Right column:\n\nResult #4101\n3 flagged moments\nfaithfulness 8/10",
          caption: "What the right-hand column does when you press Run.",
        },
      },
      {
        title: "Read the answer",
        tab: "Agents",
        where:
          "Right column. Result #4101 sits top-left of the answer card; the badges sit top-right; the flagged moments fill the body.",
        action:
          "Read the three flagged moments. Each names a guideline number and quotes it. Hover the amber “faithfulness 8/10” badge to see what the score means.",
        expect:
          "Every line starts with DEMO DATA, because it is a fixture. Result #4101 is the ID you would type into the History tab to pull this answer back up later. PDF download is switched off while Demo Mode is on.",
        visual: {
          kind: "control",
          control: "button",
          label: "Result #4101 · faithfulness 8/10",
          value: "DEMO DATA — canned example, not a real result.",
          caption: "Top of the answer card, right column.",
        },
      },
    ],
  },

  // ---- Pipeline 2: Script Analysis ---------------------------------------
  analyze: {
    label: "Script Analysis",
    tagline: "Score pacing and character clarity, compare against past films, get a greenlight verdict",
    length: "6 steps, about 3 minutes",
    steps: [
      {
        title: "Open the Agents tab",
        tab: "Agents",
        where: "Third tab in the row under the app name, between Documents and Release Planner.",
        action: "Click Agents.",
        expect: "The same two-column screen as Compliance Check — same form, different agent.",
        visual: {
          kind: "control",
          control: "tab",
          label: "Agents",
          caption: "Third tab along, under the app name.",
        },
      },
      {
        title: "Choose the Script Analysis agent",
        tab: "Agents",
        where:
          "Left column, card “1. Choose what you want done”. Script Analysis is the middle of the three buttons.",
        action: "Click Script Analysis. Any answer already on the right is cleared when you switch task.",
        expect:
          "The description box now lists five things you get back: a logline, a pacing score, a character-clarity score, strengths and weaknesses, and a verdict.",
        visual: {
          kind: "control",
          control: "button",
          label: "Script Analysis",
          value: "Structural read plus a greenlight recommendation",
          caption: "Middle of the three task buttons.",
        },
      },
      {
        title: "Give it more text than you think it needs",
        tab: "Agents",
        where: "The Script excerpt box in card “2. Give it what it needs”.",
        action:
          "Paste a whole scene rather than a few lines. Unlike Compliance Check, this agent is judging structure, so a fragment gives a thin read.",
        expect:
          "The word count beside the character count is the quick sanity check — a full scene is usually 300 words or more.",
        visual: {
          kind: "control",
          control: "textarea",
          label: "Script excerpt *",
          value: "INT. DOCK OFFICE - NIGHT\n\nMAYA finds her brother's name on the manifest…",
          caption: "Same box as Compliance Check; the agent reading it is what changed.",
        },
      },
      {
        title: "Run it",
        tab: "Agents",
        where: "Full-width blue button at the bottom of the left column, now reading “Run Script Analysis”.",
        action: "Click it. The button label always matches the task you picked, so it is worth a glance before clicking.",
        expect: "Right column shows the running state, then Result #4102.",
        visual: {
          kind: "control",
          control: "button",
          label: "Run Script Analysis",
          caption: "Bottom of the left column; the label tracks the selected task.",
        },
      },
      {
        title: "Read the verdict, not just the scores",
        tab: "Agents",
        where: "Right column, in the body of the answer card. The verdict is the last line.",
        action:
          "Read down: logline, pacing 7/10, character clarity 8/10, strengths, weaknesses, comparisons, then VERDICT: Consider.",
        expect:
          "Pass / Consider / Recommend is the studio-standard verdict. The comparisons section cites a past-film document — with no uploads in the Documents tab, that section would be missing on a real run.",
        visual: {
          kind: "beforeAfter",
          before: "No documents uploaded:\n\nscores and verdict only",
          after: "Past-film PDFs uploaded:\n\n+ COMPARISONS section\ncites “Harbour Lights” (2021)",
          caption: "What uploading past-film write-ups adds to this same answer.",
        },
      },
      {
        title: "See where the score went",
        tab: "Insights",
        where: "The last tab in the row, Insights. Then the two number cards at the top of that screen.",
        action:
          "Click Insights. Read Average faithfulness and Evaluated runs, then look at the chart underneath.",
        expect:
          "Demo fixtures show 7.8 average across 8 runs, and a chart watermarked DEMO. Every run you tick the faithfulness box on adds one point to that line.",
        visual: {
          kind: "control",
          control: "tab",
          label: "Insights",
          caption: "Sixth and last tab — where every faithfulness score ends up.",
        },
      },
    ],
  },

  // ---- Pipeline 3: Browse Upcoming Releases ------------------------------
  release_listing: {
    label: "Browse Upcoming Releases",
    tagline: "See every film already scheduled in a genre — the input for release planning",
    length: "6 steps, about 3 minutes",
    steps: [
      {
        title: "Open the Agents tab",
        tab: "Agents",
        where: "Third tab in the row under the app name.",
        action: "Click Agents.",
        expect: "The two-column agent screen again.",
        visual: {
          kind: "control",
          control: "tab",
          label: "Agents",
          caption: "Third tab along, under the app name.",
        },
      },
      {
        title: "Choose Browse Upcoming Releases",
        tab: "Agents",
        where: "Left column, card “1. Choose what you want done”. It is the third and last button.",
        action: "Click it, then look at card 2 — the input control has changed shape.",
        expect:
          "The big script box is replaced by a single dropdown. This is the only task that does not read a script, and the only one that does not use your uploaded documents.",
        visual: {
          kind: "beforeAfter",
          before: "Card 2 shows:\n\nScript excerpt\n[ large text box ]",
          after: "Card 2 shows:\n\nGenre\n[ dropdown ▾ ]",
          caption: "Switching to this task swaps the input control.",
        },
      },
      {
        title: "Pick a genre",
        tab: "Agents",
        where:
          "Left column, card “2. Give it what it needs”, the dropdown labelled Genre with a red asterisk.",
        action:
          "Click the dropdown and choose thriller. Only the 19 genres in this list can be looked up — the film database recognises nothing else.",
        expect: "The Run button stops being greyed out the moment a genre is chosen.",
        visual: {
          kind: "control",
          control: "select",
          label: "Genre *",
          value: "thriller",
          caption: "Dropdown replaces the script box for this task.",
        },
      },
      {
        title: "Untick the faithfulness score",
        tab: "Agents",
        where: "Below the divider in the same card: “Score this answer for faithfulness”.",
        action: "Click the tick box to clear it.",
        expect:
          "This answer is a list of dates from a public film database, not a summary of your documents — there is nothing for a faithfulness score to be faithful to. Unticking also saves an AI call, which matters on a capped quota.",
        visual: {
          kind: "control",
          control: "checkbox",
          label: "Score this answer for faithfulness",
          value: "cleared",
          caption: "Worth clearing for this task only.",
        },
      },
      {
        title: "Run it",
        tab: "Agents",
        where: "Full-width blue button at the bottom of the left column: “Run Browse Upcoming Releases”.",
        action: "Click it. This is the fastest task in the app — 2–5 seconds on the real backend.",
        expect:
          "Result #4103: eight thriller titles with dates, most popular first, running from September 2026 to February 2027.",
        visual: {
          kind: "beforeAfter",
          before: "Right column:\n\n“Your answer will appear here”",
          after: "Result #4103\n\nVermilion — 2026-11-13\nThe Quiet Machine — 2026-11-20\n…6 more",
          caption: "A dated competitor list, not prose.",
        },
      },
      {
        title: "Hand the list to the planner",
        tab: "Release Planner",
        where:
          "Bottom of the answer card in the right column, next to Download as PDF: a blue link reading “Plan a release date for this genre →”.",
        action: "Click it.",
        expect:
          "You land on the Release Planner tab. That list you just produced is exactly what its step 1 fetches — the next walkthrough picks up from here.",
        visual: {
          kind: "flow",
          active: 1,
          caption: "This task is stage 1 of the four-stage planner.",
        },
      },
    ],
  },

  // ---- Pipeline 4: the four-step Release Planner -------------------------
  release_planner: {
    label: "Release Planner",
    tagline: "Genre → competing films → holidays and events → one calendar date per country",
    length: "6 steps, about 5 minutes",
    steps: [
      {
        title: "Open the Release Planner tab",
        tab: "Release Planner",
        where: "Fourth tab in the row under the app name, between Agents and History.",
        action:
          "Click it. Read the four numbered cards down the page before touching anything — steps 2, 3 and 4 start greyed out and unlock in order.",
        expect:
          "Each card has a numbered circle that turns from grey to blue when it becomes active, and to a green tick when it is done.",
        visual: {
          kind: "control",
          control: "tab",
          label: "Release Planner",
          caption: "Fourth tab along. The whole flow lives on this one screen.",
        },
      },
      {
        title: "Step 1 — pick a genre",
        tab: "Release Planner",
        where:
          "Card 1, “Pick a genre”. A dropdown on the left and a blue button reading “Find scheduled films” on the right.",
        action: "Choose thriller in the dropdown, then click Find scheduled films.",
        expect:
          "A collapsed grey strip appears saying “8 thriller films already scheduled — click to view”. Click it to expand. This is the same agent as the Browse Upcoming Releases task, run for you.",
        visual: {
          kind: "flow",
          active: 1,
          caption: "Stage 1 of 4. Its output is the input to stage 2.",
        },
      },
      {
        title: "Step 2 — propose your date",
        tab: "Release Planner",
        where:
          "Card 2, now unlocked. A date picker on the left, a blue “Check competition” button on the right.",
        action:
          "Set the date picker to 20 November 2026 and click Check competition. Nothing is committed — change it and re-run as often as you like.",
        expect:
          "A grey box listing films releasing within two weeks of your date. The fixture finds one direct clash, Vermilion on 13 November, and suggests moving back a week.",
        visual: {
          kind: "control",
          control: "date",
          label: "Proposed release date",
          value: "2026-11-20",
          caption: "Card 2, left of the Check competition button.",
        },
      },
      {
        title: "Step 3 — check holidays and world events",
        tab: "Release Planner",
        where: "Card 3. A single violet button reading “Check holidays and events”.",
        action: "Click it. This calls a second, separate agent from the one in step 2.",
        expect:
          "A findings box: a clash count with a badge, then public holidays per country, then sporting events and awards. The fixture shows US Thanksgiving and Japan's Labour Thanksgiving Day clashing, and Germany as “could not check” — that means the holiday service was unreachable, not that the date is clear.",
        visual: {
          kind: "flow",
          active: 3,
          caption: "Stage 3 of 4 — a different agent from stage 2.",
        },
      },
      {
        title: "Step 4 — adjust the per-country dates",
        tab: "Release Planner",
        where:
          "Card 4. One row per country: the country name, a date box, and a coloured badge on the right.",
        action:
          "Read the badges before changing anything. Then edit any date box you disagree with — try changing the United States row.",
        expect:
          "Each country gets its own date because holidays differ. An amber “adjusted” badge means the agent moved that date away from your proposal to dodge a clash; edit it yourself and the badge turns blue and reads “your choice”; untouched matches read green, “as proposed”.",
        visual: {
          kind: "beforeAfter",
          before: "United States  2026-11-30\n[ adjusted ]",
          after: "United States  2026-12-04\n[ your choice ]",
          caption: "The badge tells you who chose that date — the agent, or you.",
        },
      },
      {
        title: "Create the events — the one step with real consequences",
        tab: "Release Planner",
        where:
          "Bottom of card 4: an amber warning note, then a full-width green button reading “Create 5 calendar events”.",
        action:
          "Read the amber note first, then click the green button. In Demo Mode the note says so and nothing is created.",
        expect:
          "Five links, one per country. Outside Demo Mode this is the only action in the whole app that changes something in the outside world, it writes one real Google Calendar event per country, and there is no undo — you would have to delete them in Google Calendar by hand.",
        visual: {
          kind: "flow",
          active: 4,
          caption: "Stage 4 of 4. Live, this is the irreversible one.",
        },
      },
    ],
  },
};
