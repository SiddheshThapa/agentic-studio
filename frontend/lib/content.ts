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
