// The technical API log drawer. Off unless switched on from the header.
//
// Each row is a native <details>: the browser already does collapsible, so there is no
// open-state to store, no ids to track, and nothing to keep in sync with the list.
// Reads the store through useSyncExternalStore — no effects.
"use client";

import { useSyncExternalStore } from "react";
import {
  clearApiLog,
  formatResponse,
  getApiLogServerSnapshot,
  getApiLogSnapshot,
  getApiLogVisibleServerSnapshot,
  isApiLogVisible,
  setApiLogVisible,
  subscribeApiLog,
  type ApiLogEntry,
} from "@/lib/apilog";
import { API_LOG_COPY } from "@/lib/content";

const METHOD_TONE: Record<string, string> = {
  GET: "border-slate-700 bg-slate-900 text-slate-300",
  POST: "border-blue-800 bg-blue-950/60 text-blue-300",
  DELETE: "border-red-900 bg-red-950/60 text-red-300",
};

function statusTone(entry: ApiLogEntry): string {
  if (entry.ok === null) return "text-slate-500";
  return entry.ok ? "text-emerald-400" : "text-red-400";
}

function Block({ heading, children }: { heading: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1">
      <p className="text-[10px] font-medium uppercase tracking-wide text-slate-600">{heading}</p>
      {children}
    </div>
  );
}

function Pre({ children }: { children: string }) {
  return (
    <pre className="max-h-56 overflow-auto rounded-lg border border-slate-800 bg-slate-950 p-2.5 text-[11px] leading-relaxed text-slate-300">
      {children}
    </pre>
  );
}

function Row({ entry }: { entry: ApiLogEntry }) {
  return (
    <details className="group rounded-lg border border-slate-800 bg-slate-900/60">
      <summary className="flex cursor-pointer flex-wrap items-center gap-2 px-3 py-2 text-xs hover:bg-slate-800/40">
        <span className="text-slate-600 transition-transform group-open:rotate-90" aria-hidden>
          ›
        </span>
        <span
          className={`rounded border px-1.5 py-0.5 font-mono text-[10px] font-medium ${
            METHOD_TONE[entry.method] ?? METHOD_TONE.GET
          }`}
        >
          {entry.method}
        </span>
        <span className="min-w-0 flex-1 truncate font-mono text-slate-300">{entry.path}</span>
        {entry.simulated && (
          <span
            className="rounded-full border border-amber-800 bg-amber-950/50 px-2 py-0.5 text-[10px] text-amber-400"
            title={API_LOG_COPY.simulatedNote}
          >
            {API_LOG_COPY.simulated}
          </span>
        )}
        <span className={`font-mono ${statusTone(entry)}`}>
          {entry.status ?? API_LOG_COPY.pending}
        </span>
        {entry.durationMs != null && (
          <span className="font-mono text-slate-600">{entry.durationMs}ms</span>
        )}
        <span className="font-mono text-slate-700">{entry.time}</span>
      </summary>

      <div className="space-y-3 border-t border-slate-800 px-3 py-3">
        <Block heading={API_LOG_COPY.headersHeading}>
          <Pre>
            {entry.headers.length === 0
              ? "(none set by the client)"
              : entry.headers.map(([key, value]) => `${key}: ${value}`).join("\n")}
          </Pre>
          <p className="text-[10px] text-slate-600">{API_LOG_COPY.maskedNote}</p>
        </Block>

        <Block heading={API_LOG_COPY.requestHeading}>
          {entry.requestBody ? (
            <Pre>{entry.requestBody}</Pre>
          ) : (
            <p className="text-[11px] text-slate-600">{API_LOG_COPY.noBody}</p>
          )}
        </Block>

        <Block heading={API_LOG_COPY.responseHeading}>
          {entry.error ? (
            <Pre>{entry.error}</Pre>
          ) : entry.ok === null ? (
            <p className="text-[11px] text-slate-600">{API_LOG_COPY.pending}</p>
          ) : (
            <Pre>{formatResponse(entry.response)}</Pre>
          )}
          {entry.simulated && <p className="text-[10px] text-amber-600">{API_LOG_COPY.simulatedNote}</p>}
        </Block>
      </div>
    </details>
  );
}

export default function ApiLogPanel() {
  const visible = useSyncExternalStore(
    subscribeApiLog,
    isApiLogVisible,
    getApiLogVisibleServerSnapshot
  );
  const entries = useSyncExternalStore(
    subscribeApiLog,
    getApiLogSnapshot,
    getApiLogServerSnapshot
  );

  if (!visible) return null;

  return (
    <aside
      aria-label={API_LOG_COPY.title}
      className="fixed inset-x-0 bottom-0 z-40 flex h-[45vh] flex-col border-t border-slate-800 bg-slate-950/95 shadow-2xl shadow-black/60 backdrop-blur"
    >
      <header className="flex shrink-0 items-center justify-between gap-3 border-b border-slate-800 px-4 py-2.5">
        <div className="min-w-0">
          <h2 className="text-sm font-medium text-slate-100">
            {API_LOG_COPY.title}
            <span className="ml-2 text-xs font-normal text-slate-600">{entries.length}</span>
          </h2>
          <p className="truncate text-[11px] text-slate-600">{API_LOG_COPY.subtitle}</p>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          <button
            onClick={clearApiLog}
            className="rounded-lg border border-slate-800 px-2.5 py-1 text-xs text-slate-400 transition-colors hover:border-slate-700 hover:text-slate-200"
          >
            {API_LOG_COPY.clear}
          </button>
          <button
            onClick={() => setApiLogVisible(false)}
            aria-label={API_LOG_COPY.close}
            title={API_LOG_COPY.close}
            className="rounded-lg px-2 py-1 text-slate-500 transition-colors hover:bg-slate-800 hover:text-slate-200"
          >
            ✕
          </button>
        </div>
      </header>

      <div className="min-h-0 flex-1 space-y-1.5 overflow-y-auto px-4 py-3">
        {entries.length === 0 ? (
          <p className="py-8 text-center text-xs text-slate-600">{API_LOG_COPY.empty}</p>
        ) : (
          // Newest first: the call you just made is the one you opened this for.
          [...entries].reverse().map((entry) => <Row key={entry.id} entry={entry} />)
        )}
      </div>
    </aside>
  );
}
