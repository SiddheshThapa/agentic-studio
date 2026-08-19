// The activity feed: plain-language narration of what the app is doing for you.
//
// Driven from lib/api.ts::request(), which is the one function every backend call in
// the app goes through — including the Demo Mode branch. That is why the narration is
// identical in both modes without a single `if (isDemo())` below: the outcome line is
// built from whatever response came back, fixture or real.
//
// Split in two on purpose:
//   describeRequest()  pure, testable, no timers — decides what to say
//   the store          holds the visible items and owns every timer
//
// ponytail: the in-flight steps advance on a timer, not on real backend progress —
// FastAPI returns one response, not a stream. They are honest about what the system
// is doing (it really does search your guidelines during a compliance run) but not
// about exactly when each part finishes. Swap the timer for server-sent events if the
// backend ever grows them.

// Relative, with the extension, rather than the usual "@/lib/content": this module is
// exercised by `node lib/demo.test.ts`, and bare node does not know the @ alias.
import { ACTIVITY_COPY } from "./content.ts";

export interface ActivityDescription {
  steps: readonly string[];
  /** Built from the response body, so it reports what actually came back. */
  outcome: (body: unknown) => string;
}

const asRecord = (body: unknown): Record<string, unknown> =>
  body && typeof body === "object" ? (body as Record<string, unknown>) : {};

const count = (body: unknown, key: string): number => {
  const value = asRecord(body)[key];
  return typeof value === "number" ? value : 0;
};

/**
 * What to narrate for one request, or null to stay silent.
 *
 * Silence is the default for anything the user did not personally trigger: the health
 * poll runs every 30 seconds and narrating it would bury the things they did do.
 */
export function describeRequest(path: string, options: RequestInit = {}): ActivityDescription | null {
  const method = (options.method ?? "GET").toUpperCase();
  const pathname = path.split("?")[0];

  if (pathname === "/run-agent") {
    const task = new URLSearchParams(String(options.body)).get("task") ?? "compliance";
    const copy = ACTIVITY_COPY.agent[task as keyof typeof ACTIVITY_COPY.agent] ?? ACTIVITY_COPY.agent.compliance;
    return {
      steps: copy.steps,
      outcome: (body) => {
        const data = asRecord(body);
        const lines: string[] = [data.from_cache === true ? ACTIVITY_COPY.reusedAnswer : copy.done];
        const score = asRecord(data.eval).score;
        if (typeof score === "number") lines.push(ACTIVITY_COPY.scored(score));
        return lines.join(" ");
      },
    };
  }

  if (method === "POST" && pathname.startsWith("/check-conflicts/")) {
    return {
      steps: ACTIVITY_COPY.conflicts.steps,
      outcome: (body) => {
        const report = asRecord(asRecord(body).conflict_report);
        const holidays = Object.values(asRecord(report.holidays)) as { conflict?: boolean | null }[];
        const events = [
          ...((report.sporting_events as { conflict?: boolean }[]) ?? []),
          ...((report.awards_ceremonies as { conflict?: boolean }[]) ?? []),
        ];
        const clashes = [...holidays, ...events].filter((item) => item.conflict === true).length;
        return ACTIVITY_COPY.conflicts.done(holidays.length, clashes);
      },
    };
  }

  // /confirm-date and /override-date write the same events as /finalize-calendar.
  if (
    method === "POST" &&
    /^\/(finalize-calendar|confirm-date|override-date)\//.test(pathname)
  ) {
    return {
      steps: ACTIVITY_COPY.calendar.steps,
      outcome: (body) => ACTIVITY_COPY.calendar.done(Object.keys(asRecord(asRecord(body).events)).length),
    };
  }

  if (method === "POST" && pathname === "/ingest") {
    return {
      steps: ACTIVITY_COPY.upload.steps,
      outcome: (body) => ACTIVITY_COPY.upload.done(count(body, "inserted_chunks")),
    };
  }

  if (method === "DELETE" && pathname === "/document") {
    return {
      steps: ACTIVITY_COPY.remove.steps,
      outcome: (body) => ACTIVITY_COPY.remove.done(count(body, "deleted_chunks")),
    };
  }

  if (method === "GET" && /^\/result\/\d+$/.test(pathname)) {
    return {
      steps: ACTIVITY_COPY.lookup.steps,
      outcome: (body) => ACTIVITY_COPY.lookup.done(!("error" in asRecord(body))),
    };
  }

  if (method === "GET" && pathname.startsWith("/history/")) {
    return {
      steps: ACTIVITY_COPY.history.steps,
      outcome: (body) => {
        const turns = asRecord(body).history;
        return ACTIVITY_COPY.history.done(Array.isArray(turns) ? turns.length : 0);
      },
    };
  }

  // The Database tab. The index call (/admin/tables) stays silent — it is a
  // sidebar refresh the user did not ask for, and it fires alongside this one.
  if (method === "GET" && /^\/admin\/tables\/[a-z_]+$/.test(pathname)) {
    return {
      steps: ACTIVITY_COPY.stored.steps,
      outcome: (body) => {
        const page = asRecord(asRecord(body).pagination);
        const shown = typeof page.returned === "number" ? page.returned : 0;
        const total = typeof page.total === "number" ? page.total : 0;
        const term = asRecord(body).search;
        return ACTIVITY_COPY.stored.done(shown, total, typeof term === "string" ? term : null);
      },
    };
  }

  // Only the summary narrates: Insights asks for the summary and the chart together,
  // and two lines saying the same thing is noise.
  if (method === "GET" && pathname === "/eval/summary") {
    return {
      steps: ACTIVITY_COPY.scores.steps,
      outcome: (body) => ACTIVITY_COPY.scores.done(count(body, "count")),
    };
  }

  return null;
}

/** Narration for the PDF download, which fetches a blob rather than going through request(). */
export const DOWNLOAD_DESCRIPTION: ActivityDescription = {
  steps: ACTIVITY_COPY.download.steps,
  outcome: () => ACTIVITY_COPY.download.done,
};

// ---- The store -----------------------------------------------------------

export interface Activity {
  id: number;
  steps: readonly string[];
  /** Index of the step being shown. Everything before it is drawn as finished. */
  step: number;
  status: "running" | "done" | "failed";
  outcome: string;
}

/** How long each in-flight step is shown before the next one takes over. */
const STEP_MS = 1400;
/** How long a finished item stays on screen. It is feedback, not a log. */
const KEEP_MS = 6000;
/** Never stack more than this many; the newest matter most. */
const MAX_ITEMS = 3;

const EMPTY: Activity[] = [];
let items: Activity[] = EMPTY;
let nextId = 1;
const listeners = new Set<() => void>();

function publish(next: Activity[]) {
  items = next.slice(-MAX_ITEMS);
  listeners.forEach((fn) => fn());
}

function patch(id: number, changes: Partial<Activity>) {
  if (!items.some((item) => item.id === id)) return;
  publish(items.map((item) => (item.id === id ? { ...item, ...changes } : item)));
}

export function subscribeActivity(fn: () => void): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

export const getActivitySnapshot = (): Activity[] => items;
export const getActivityServerSnapshot = (): Activity[] => EMPTY;

export function dismissActivity(id: number): void {
  publish(items.filter((item) => item.id !== id));
}

export interface ActivityHandle {
  finish: (body: unknown) => void;
  fail: () => void;
}

/**
 * Put one narration on screen and return the handle that ends it. Timers live here
 * rather than in a component, so no panel needs an effect to drive this.
 */
export function startActivity(description: ActivityDescription): ActivityHandle {
  const id = nextId++;
  publish([...items, { id, steps: description.steps, step: 0, status: "running", outcome: "" }]);

  const ticker = setInterval(() => {
    const current = items.find((item) => item.id === id);
    if (!current || current.status !== "running" || current.step >= current.steps.length - 1) return;
    patch(id, { step: current.step + 1 });
  }, STEP_MS);

  const settle = (changes: Partial<Activity>) => {
    clearInterval(ticker);
    patch(id, { step: description.steps.length - 1, ...changes });
    setTimeout(() => dismissActivity(id), KEEP_MS);
  };

  return {
    finish: (body) => {
      let outcome: string;
      try {
        outcome = description.outcome(body);
      } catch {
        // A response shaped unexpectedly must not take the request down with it.
        outcome = "";
      }
      settle({ status: "done", outcome });
    },
    // The panel already shows the error in full; the feed only stops pretending to work.
    fail: () => settle({ status: "failed", outcome: ACTIVITY_COPY.failed }),
  };
}

/** Convenience for api.ts: describe and start in one call, or do nothing. */
export function narrateRequest(path: string, options: RequestInit = {}): ActivityHandle | null {
  const description = describeRequest(path, options);
  return description ? startActivity(description) : null;
}
