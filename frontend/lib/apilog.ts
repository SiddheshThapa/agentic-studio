// The technical API log: what lib/api.ts actually sent and got back, including the
// simulated calls Demo Mode answers from fixtures.
//
// Separate store from the plain-language activity feed on purpose — the two are
// independent, and a user can have either, both, or neither on screen.
//
// Passive by design. Recording builds one small object per call and keeps a reference
// to the response; nothing is serialised until an entry is expanded, and every entry
// point is wrapped so a logging bug can never fail a request that worked.
//
// No imports: this module is exercised by `node lib/demo.test.ts`.

/**
 * Read straight from the environment rather than importing it from api.ts, which
 * would be a cycle. Next inlines this at build time.
 */
const API_KEY = process.env.NEXT_PUBLIC_API_KEY ?? "";

/** What the log prints in place of a credential. Never the value itself. */
export const MASK = "••••••••";

/**
 * The key ships in the client bundle, so this is not a security boundary — it stops
 * the log from being the thing that puts a credential on someone's screen, in a
 * screenshot, or in a pasted bug report.
 */
export function maskSecrets(text: string, key: string = API_KEY): string {
  if (!key || key.length < 4) return text;
  return text.split(key).join(MASK);
}

export interface ApiLogEntry {
  id: number;
  time: string;
  method: string;
  path: string;
  /** True when Demo Mode answered from fixtures instead of the network. */
  simulated: boolean;
  headers: [string, string][];
  requestBody: string | null;
  status: number | null;
  ok: boolean | null;
  durationMs: number | null;
  /** Held as-is and stringified only when the entry is expanded. */
  response: unknown;
  error: string | null;
}

const MAX_ENTRIES = 50;

const EMPTY: ApiLogEntry[] = [];
let entries: ApiLogEntry[] = EMPTY;
let visible = false;
let nextId = 1;
const listeners = new Set<() => void>();
/** Start times, kept out of the entries so a pending call carries no half-filled duration. */
const started = new Map<number, number>();

function notify() {
  listeners.forEach((fn) => fn());
}

export function subscribeApiLog(fn: () => void): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

export const getApiLogSnapshot = (): ApiLogEntry[] => entries;
export const getApiLogServerSnapshot = (): ApiLogEntry[] => EMPTY;

export const isApiLogVisible = (): boolean => visible;
export const getApiLogVisibleServerSnapshot = (): boolean => false;

export function setApiLogVisible(next: boolean): void {
  if (next === visible) return;
  visible = next;
  notify();
}

export function clearApiLog(): void {
  entries = EMPTY;
  notify();
}

/** Turn whatever fetch was handed into something readable, with secrets masked. */
function describeBody(body: BodyInit | null | undefined): string | null {
  if (body == null) return null;

  if (typeof body === "string") return maskSecrets(body);

  if (body instanceof URLSearchParams) {
    return maskSecrets(
      [...body.entries()].map(([key, value]) => `${key}: ${value}`).join("\n")
    );
  }

  if (typeof FormData !== "undefined" && body instanceof FormData) {
    return [...body.entries()]
      .map(([key, value]) =>
        typeof value === "string"
          ? `${key}: ${maskSecrets(value)}`
          : `${key}: ${value.name} (${(value.size / 1024).toFixed(0)} KB, ${value.type || "unknown type"})`
      )
      .join("\n");
  }

  return `[${body.constructor?.name ?? "binary"}]`;
}

/** Headers as the log will show them — the API key is replaced here, at the source. */
function describeHeaders(options: RequestInit, authed: boolean): [string, string][] {
  const shown: [string, string][] = [];
  const raw = (options.headers ?? {}) as Record<string, string>;
  for (const [key, value] of Object.entries(raw)) {
    shown.push([key, /api[-_]?key|authorization/i.test(key) ? MASK : maskSecrets(String(value))]);
  }
  if (authed) shown.push(["X-API-Key", MASK]);
  return shown;
}

/** Record a call as it goes out. Returns the id used to settle it. */
export function logApiStart(
  path: string,
  options: RequestInit = {},
  authed = false,
  simulated = false
): number {
  const id = nextId++;
  try {
    const entry: ApiLogEntry = {
      id,
      time: new Date().toLocaleTimeString(),
      method: (options.method ?? "GET").toUpperCase(),
      path,
      simulated,
      headers: describeHeaders(options, authed),
      requestBody: describeBody(options.body),
      status: null,
      ok: null,
      durationMs: null,
      response: undefined,
      error: null,
    };
    entries = [...entries, entry].slice(-MAX_ENTRIES);
    started.set(id, Date.now());
    notify();
  } catch {
    // A log that cannot record itself must still not break the caller.
  }
  return id;
}

export function logApiEnd(
  id: number,
  result: { status: number | null; ok: boolean; response?: unknown; error?: string }
): void {
  try {
    const at = started.get(id);
    started.delete(id);
    let changed = false;
    entries = entries.map((entry) => {
      // Settle once: liveRequest reports the real status, and the catch in request()
      // must not overwrite it on the way past.
      if (entry.id !== id || entry.ok !== null) return entry;
      changed = true;
      return {
        ...entry,
        status: result.status,
        ok: result.ok,
        durationMs: at ? Date.now() - at : null,
        response: result.response,
        error: result.error ? maskSecrets(result.error) : null,
      };
    });
    if (changed) notify();
  } catch {
    // Same: never throw into a request that already succeeded.
  }
}

/**
 * Pretty-print a response for display. Called only when an entry is expanded, so the
 * cost of stringifying a large body is paid by the person who asked to see it.
 *
 * `key` is injectable only so the checks can exercise the masking without the build's
 * environment; callers should let it default.
 */
export function formatResponse(value: unknown, key?: string): string {
  if (value === undefined) return "(no body)";
  try {
    return maskSecrets(typeof value === "string" ? value : JSON.stringify(value, null, 2), key);
  } catch {
    return String(value);
  }
}
