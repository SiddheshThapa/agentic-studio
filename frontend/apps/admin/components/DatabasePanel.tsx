// A window onto everything the app has stored, for someone who does not think in
// tables. Each collection gets the shape its contents actually have — files as
// files, conversations as conversations — rather than a grid of cells.
//
// Read-only by design at this step: no edit, delete or create controls exist here.
"use client";

import { useEffect, useState } from "react";
import {
  AdminColumn,
  AdminListResponse,
  AdminRow,
  AdminTableName,
  AdminTableSummary,
  getAdminRows,
  getAdminTables,
} from "@/lib/api";
import {
  Badge,
  Card,
  EmptyState,
  ErrorAlert,
  PrimaryButton,
  Spinner,
  SuccessNote,
  errorMessage,
  inputClass,
} from "@/components/ui";
import { DeleteConfirm, RowEditor } from "@/admin/DatabaseEditor";
import { DATABASE_COPY, DATABASE_WRITE_COPY } from "@/lib/content";

/** What the user is doing instead of browsing. Null means the list is on screen. */
type Pending =
  | { kind: "create" }
  | { kind: "edit"; row: AdminRow }
  | { kind: "delete"; row: AdminRow; filename?: string; chunks?: number };

/** Edit/delete buttons for one entry. Delete is always the quieter of the two. */
function RowActions({ onEdit, onDelete }: { onEdit: () => void; onDelete: () => void }) {
  return (
    <div className="flex shrink-0 gap-1">
      <button
        onClick={onEdit}
        className="press rounded-[var(--radius-control)] border border-white/8 px-2.5 py-1 text-xs text-ink-300 transition-colors hover:border-iris-400/50 hover:text-iris-200"
      >
        {DATABASE_WRITE_COPY.edit}
      </button>
      <button
        onClick={onDelete}
        className="press rounded-[var(--radius-control)] border border-white/8 px-2.5 py-1 text-xs text-ink-400 transition-colors hover:border-red-800 hover:text-red-300"
      >
        {DATABASE_WRITE_COPY.delete}
      </button>
    </div>
  );
}

/** Passed down to every collection view so each can raise the same two actions. */
interface RowActionHandlers {
  onEdit: (row: AdminRow) => void;
  onDelete: (row: AdminRow, extra?: { filename?: string; chunks?: number }) => void;
}

/** Order shown in the picker: what you put in, then what came out, then the plumbing. */
const TABLE_ORDER: AdminTableName[] = ["documents", "results", "memory", "cache", "eval_history"];

/**
 * Documents are fetched in a bigger page than the rest because they are shown
 * grouped by the file they came from, and grouping half a file reads as a bug.
 * 200 is the backend's cap; beyond that the grouping note says what is missing.
 */
const PAGE_SIZE: Record<AdminTableName, number> = {
  documents: 200,
  results: 10,
  memory: 40,
  cache: 10,
  eval_history: 25,
};

const CACHE_TTL_HOURS = 24;

// ---- small shared pieces -------------------------------------------------

/** The plain-language "this one matters to the app" marker. */
function StructuralChip({ table, column }: { table: string; column: string }) {
  return (
    <span
      title={DATABASE_COPY.structuralLabels[`${table}.${column}`] ?? DATABASE_COPY.structuralFallback}
      className="cursor-help rounded-full border border-iris-500/30 bg-iris-500/10 px-2 py-0.5 text-[10px] font-medium text-iris-200"
    >
      {DATABASE_COPY.structuralChip}
    </span>
  );
}

function isStructural(columns: AdminColumn[], name: string): boolean {
  return columns.some((c) => c.name === name && c.structural);
}

function text(row: AdminRow, key: string): string {
  const value = row[key];
  return value == null ? "" : String(value);
}

/** Timestamps arrive as Postgres strings; show them as something readable. */
function when(row: AdminRow, key = "created_at"): string {
  const raw = text(row, key);
  if (!raw) return DATABASE_COPY.unknownTime;
  const parsed = new Date(raw.includes("T") ? raw : raw.replace(" ", "T") + "Z");
  return Number.isNaN(parsed.getTime()) ? raw : parsed.toLocaleString();
}

function hoursSince(raw: string): number | null {
  if (!raw) return null;
  const parsed = new Date(raw.includes("T") ? raw : raw.replace(" ", "T") + "Z");
  if (Number.isNaN(parsed.getTime())) return null;
  return (Date.now() - parsed.getTime()) / 3600_000;
}

// ---- one renderer per collection ----------------------------------------

/** documents: chunks are noise on their own; the file they came from is the unit. */
function DocumentFiles({ data, actions }: { data: AdminListResponse; actions: RowActionHandlers }) {
  const files = new Map<string, { collections: Set<string>; chunks: AdminRow[] }>();
  for (const row of data.rows) {
    const metadata = (row.metadata ?? {}) as Record<string, unknown>;
    const filename = typeof metadata.filename === "string" ? metadata.filename : "(no file recorded)";
    const entry = files.get(filename) ?? { collections: new Set<string>(), chunks: [] };
    entry.collections.add(text(row, "collection"));
    entry.chunks.push(row);
    files.set(filename, entry);
  }

  return (
    <div className="space-y-3">
      <p className="text-xs text-ink-400">
        {DATABASE_COPY.documentsGrouping(data.rows.length, data.pagination.total)}
      </p>

      {[...files.entries()].map(([filename, entry]) => (
        <Card key={filename} className="!p-4">
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div className="min-w-0">
              <p className="truncate font-medium text-ink-50">{filename}</p>
              <p className="mt-0.5 text-xs text-ink-400">
                {DATABASE_COPY.documentsChunks(entry.chunks.length)} · {DATABASE_COPY.documentsCollection}{" "}
                {[...entry.collections].join(", ")}
              </p>
            </div>
            <div className="flex items-center gap-2">
              <StructuralChip table="documents" column="metadata" />
              {/* Delete lives on the file, not the chunk: the backend removes the
                  whole group and the label has to say so before it happens. */}
              <button
                onClick={() =>
                  actions.onDelete(entry.chunks[0], { filename, chunks: entry.chunks.length })
                }
                className="press rounded-[var(--radius-control)] border border-white/8 px-2.5 py-1 text-xs text-ink-400 transition-colors hover:border-red-800 hover:text-red-300"
              >
                Delete this file
              </button>
            </div>
          </div>

          <details className="group mt-3">
            <summary className="cursor-pointer text-xs text-iris-300 hover:text-iris-200">
              {DATABASE_COPY.expand}
            </summary>
            <div className="mt-2 space-y-2">
              {entry.chunks.map((chunk) => (
                <div
                  key={String(chunk.id)}
                  className="flex items-start justify-between gap-2 rounded-[var(--radius-control)] border border-white/8 bg-ink-950/60 p-2.5"
                >
                  <p className="text-xs leading-relaxed text-ink-300">{text(chunk, "text")}</p>
                  <button
                    onClick={() => actions.onEdit(chunk)}
                    className="shrink-0 rounded-[var(--radius-control)] border border-white/8 px-2 py-0.5 text-xs text-ink-400 transition-colors hover:border-iris-400/50 hover:text-iris-200"
                  >
                    {DATABASE_WRITE_COPY.edit}
                  </button>
                </div>
              ))}
            </div>
          </details>
        </Card>
      ))}
    </div>
  );
}

/** memory: turns grouped into the conversation they belong to, oldest first. */
function Conversations({ data, actions }: { data: AdminListResponse; actions: RowActionHandlers }) {
  const sessions = new Map<string, AdminRow[]>();
  // Rows arrive newest-first; reverse so a reply sits under its question.
  for (const row of [...data.rows].reverse()) {
    const id = text(row, "session_id");
    sessions.set(id, [...(sessions.get(id) ?? []), row]);
  }

  return (
    <div className="space-y-4">
      {[...sessions.entries()].map(([session, turns]) => (
        <Card key={session} className="!p-4">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2 border-b border-white/8 pb-2">
            <p className="text-sm font-medium text-ink-100">
              <span className="text-ink-400">{DATABASE_COPY.memorySession}: </span>
              {session}
            </p>
            <span className="text-xs text-ink-500">{DATABASE_COPY.memoryMessages(turns.length)}</span>
          </div>

          <div className="space-y-2">
            {turns.map((turn) => {
              const mine = text(turn, "role") === "user";
              return (
                <div
                  key={String(turn.id)}
                  className={`group/turn flex items-center gap-2 ${mine ? "justify-start" : "justify-end"}`}
                >
                  {!mine && (
                    <div className="opacity-0 transition-opacity group-hover/turn:opacity-100">
                      <RowActions
                        onEdit={() => actions.onEdit(turn)}
                        onDelete={() => actions.onDelete(turn)}
                      />
                    </div>
                  )}
                  <div
                    className={`max-w-[85%] rounded-[var(--radius-surface)] px-3.5 py-2 ${
                      mine
                        ? "rounded-tl-sm border border-white/8 bg-ink-950 text-ink-200"
                        : "rounded-tr-sm border border-iris-500/30 bg-iris-500/10 text-iris-200"
                    }`}
                  >
                    <p className="mb-0.5 text-[10px] uppercase tracking-wide text-ink-400">
                      {mine ? DATABASE_COPY.memoryYou : DATABASE_COPY.memoryAgent} · {when(turn)}
                    </p>
                    <p className="whitespace-pre-wrap text-xs leading-relaxed">{text(turn, "content")}</p>
                  </div>
                  {mine && (
                    <div className="opacity-0 transition-opacity group-hover/turn:opacity-100">
                      <RowActions
                        onEdit={() => actions.onEdit(turn)}
                        onDelete={() => actions.onDelete(turn)}
                      />
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </Card>
      ))}
    </div>
  );
}

/** results: a summary you can skim, expandable to the whole thing. */
function ResultCards({ data, actions }: { data: AdminListResponse; actions: RowActionHandlers }) {
  const promptIsStructural = isStructural(data.columns, "script_text");

  return (
    <div className="space-y-3">
      {data.rows.map((row) => (
        <Card key={String(row.id)} className="!p-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex flex-wrap items-center gap-2">
              <Badge tone="blue">{text(row, "task")}</Badge>
              <span className="text-xs text-ink-500">#{text(row, "id")}</span>
            </div>
            <div className="flex items-center gap-3">
              <span className="text-xs text-ink-500">{when(row)}</span>
              <RowActions onEdit={() => actions.onEdit(row)} onDelete={() => actions.onDelete(row)} />
            </div>
          </div>

          <p className="mt-2.5 line-clamp-3 text-sm leading-relaxed text-ink-300">
            {text(row, "result").slice(0, 260)}
            {text(row, "result").length > 260 ? "…" : ""}
          </p>

          <details className="group mt-3">
            <summary className="cursor-pointer text-xs text-iris-300 hover:text-iris-200">
              {DATABASE_COPY.expand}
            </summary>
            <div className="mt-3 space-y-3">
              <div>
                <div className="mb-1 flex flex-wrap items-center gap-2">
                  <p className="text-[10px] font-medium uppercase tracking-wide text-ink-400">
                    {DATABASE_COPY.resultsPrompt}
                  </p>
                  {promptIsStructural && <StructuralChip table="results" column="script_text" />}
                </div>
                <p className="max-h-40 overflow-y-auto whitespace-pre-wrap rounded-[var(--radius-control)] border border-white/8 bg-ink-950/60 p-2.5 font-mono text-xs leading-relaxed text-ink-400">
                  {text(row, "script_text")}
                </p>
              </div>
              <div>
                <p className="mb-1 text-[10px] font-medium uppercase tracking-wide text-ink-400">
                  {DATABASE_COPY.resultsAnswer}
                </p>
                <p className="max-h-72 overflow-y-auto whitespace-pre-wrap text-sm leading-relaxed text-ink-200">
                  {text(row, "result")}
                </p>
              </div>
            </div>
          </details>
        </Card>
      ))}
    </div>
  );
}

/** cache: the useful facts are how old it is and whether it still counts. */
function CacheEntries({ data, actions }: { data: AdminListResponse; actions: RowActionHandlers }) {
  return (
    <div className="space-y-3">
      {data.rows.map((row) => {
        const age = hoursSince(text(row, "created_at"));
        const expired = age == null || age >= CACHE_TTL_HOURS;
        const remaining = age == null ? 0 : Math.max(1, Math.round(CACHE_TTL_HOURS - age));

        return (
          <Card key={text(row, "question")} className="!p-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <Badge tone={expired ? "slate" : "emerald"}>
                {expired ? DATABASE_COPY.cacheExpired : DATABASE_COPY.cacheFresh(remaining)}
              </Badge>
              <div className="flex items-center gap-3">
                <span className="text-xs text-ink-500">{when(row)}</span>
                <RowActions onEdit={() => actions.onEdit(row)} onDelete={() => actions.onDelete(row)} />
              </div>
            </div>

            <div className="mt-2.5 flex flex-wrap items-center gap-2">
              <span className="text-[10px] uppercase tracking-wide text-ink-500">
                {DATABASE_COPY.cacheKey}
              </span>
              <code className="truncate rounded bg-ink-950 px-1.5 py-0.5 font-mono text-[10px] text-ink-400">
                {text(row, "question").slice(0, 16)}…
              </code>
              <StructuralChip table="cache" column="question" />
            </div>

            <p className="mt-2 line-clamp-2 text-sm leading-relaxed text-ink-300">
              {text(row, "answer").slice(0, 200)}
              {text(row, "answer").length > 200 ? "…" : ""}
            </p>
          </Card>
        );
      })}
    </div>
  );
}

/** eval_history: a score means nothing on its own, so it never appears alone. */
function ScoreEntries({ data, actions }: { data: AdminListResponse; actions: RowActionHandlers }) {
  return (
    <div className="space-y-2">
      {data.rows.map((row) => {
        const raw = row.faithfulness_score;
        const score = typeof raw === "number" ? raw : null;
        return (
          <Card key={String(row.id)} className="!p-4">
            <div className="flex items-start gap-4">
              <div className="w-14 shrink-0 text-center">
                <p
                  className={`text-2xl font-bold ${
                    score == null
                      ? "text-ink-600"
                      : score >= 8
                      ? "text-emerald-400"
                      : score >= 5
                      ? "text-amber-400"
                      : "text-red-400"
                  }`}
                >
                  {score ?? "—"}
                </p>
                <p className="text-[10px] text-ink-500">out of 10</p>
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-sm text-ink-200">
                  {score == null ? DATABASE_COPY.scoreMissing : DATABASE_COPY.scoreReading(score)}
                </p>
                <p className="mt-1 flex flex-wrap items-center gap-2 text-xs text-ink-500">
                  <Badge tone="slate">{text(row, "task")}</Badge>
                  {when(row)}
                </p>
              </div>
              <RowActions onEdit={() => actions.onEdit(row)} onDelete={() => actions.onDelete(row)} />
            </div>
          </Card>
        );
      })}
    </div>
  );
}

function Collection({ data, actions }: { data: AdminListResponse; actions: RowActionHandlers }) {
  switch (data.table) {
    case "documents":
      return <DocumentFiles data={data} actions={actions} />;
    case "memory":
      return <Conversations data={data} actions={actions} />;
    case "results":
      return <ResultCards data={data} actions={actions} />;
    case "cache":
      return <CacheEntries data={data} actions={actions} />;
    case "eval_history":
      return <ScoreEntries data={data} actions={actions} />;
  }
}

// ---- the tab -------------------------------------------------------------

export default function DatabasePanel() {
  const [tables, setTables] = useState<AdminTableSummary[] | null>(null);
  const [table, setTable] = useState<AdminTableName>("documents");
  const [offset, setOffset] = useState(0);

  // Committed on submit rather than debounced: no timer, and no request per keypress.
  const [searchInput, setSearchInput] = useState("");
  const [query, setQuery] = useState("");

  /** Bumped after every write. In the request key, so a write forces a refetch. */
  const [reload, setReload] = useState(0);
  const [pending, setPending] = useState<Pending | null>(null);
  const [done, setDone] = useState("");

  const [loaded, setLoaded] = useState<{ res: AdminListResponse; key: string } | null>(null);
  /** Tied to the request that failed, so changing anything clears it by itself. */
  const [failure, setFailure] = useState<{ key: string; message: string } | null>(null);

  const requestKey = `${table}|${offset}|${query}|${reload}`;
  const data = loaded?.res ?? null;
  const error = failure?.key === requestKey ? failure.message : "";
  // Derived rather than a setLoading(true) at the top of the effect: that is a
  // synchronous setState in an effect body, which the build rejects — and this
  // needs no second state to fall out of sync with what is on screen.
  const loading = loaded?.key !== requestKey && !error;

  // Async IIFE with a cancelled guard — a bare setState in an effect body fails
  // the react-hooks/set-state-in-effect rule the build enforces.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await getAdminTables();
        if (!cancelled) setTables(res.tables);
      } catch {
        // The row counts are a nicety; a failure here is reported by the row fetch.
        if (!cancelled) setTables([]);
      }
    })();
    return () => {
      cancelled = true;
    };
    // `reload` is a dependency so the per-collection counts move after a write.
  }, [reload]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await getAdminRows(table, { limit: PAGE_SIZE[table], offset, query });
        if (!cancelled) setLoaded({ res, key: requestKey });
      } catch (err) {
        if (!cancelled) setFailure({ key: requestKey, message: errorMessage(err) });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [table, offset, query, requestKey]);

  function pick(next: AdminTableName) {
    setTable(next);
    setOffset(0);
    setSearchInput("");
    setQuery("");
    setPending(null);
    setDone("");
  }

  /**
   * Every write ends here: close the form, refetch the list and the counts. The
   * refetch is not optional — the row the user just changed is on screen, and
   * showing the old value after a save is how a UI teaches people not to trust it.
   */
  function afterWrite(message: string, wasCreate = false) {
    setPending(null);
    setDone(message);
    if (wasCreate) {
      // New rows sort to the front; a search or a later page would hide it.
      setOffset(0);
      setSearchInput("");
      setQuery("");
    }
    setReload((n) => n + 1);
  }

  const actions: RowActionHandlers = {
    onEdit: (row) => {
      setDone("");
      setPending({ kind: "edit", row });
    },
    onDelete: (row, extra) => {
      setDone("");
      setPending({ kind: "delete", row, ...extra });
    },
  };

  function submitSearch(e: React.FormEvent) {
    e.preventDefault();
    setOffset(0);
    // Trimmed to match what the backend echoes back in `search`, which is what
    // the staleness check above compares against.
    setQuery(searchInput.trim());
  }

  const page = data?.pagination;
  const from = page && page.returned > 0 ? page.offset + 1 : 0;
  const to = page ? page.offset + page.returned : 0;
  const info = DATABASE_COPY.tables[table];

  return (
    <div className="space-y-6">
      <Card className="space-y-2">
        <h2 className="font-semibold">{DATABASE_COPY.title}</h2>
        <p className="text-sm leading-relaxed text-ink-300">{DATABASE_COPY.intro}</p>
      </Card>

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5">
        {TABLE_ORDER.map((name) => {
          const summary = tables?.find((t) => t.name === name);
          const active = name === table;
          return (
            <button
              key={name}
              onClick={() => pick(name)}
              className={`press rounded-[var(--radius-surface)] border p-3 text-left transition-colors ${
                active ? "border-iris-400 bg-iris-500/10" : "border-white/8 bg-white/[0.03] hover:border-white/15"
              }`}
            >
              <p className={`text-sm font-medium ${active ? "text-iris-200" : "text-ink-100"}`}>
                {DATABASE_COPY.tables[name].label}
              </p>
              <p className="mt-0.5 text-xs text-ink-400">
                {summary ? `${summary.rows} ${DATABASE_COPY.tables[name].unit}` : "…"}
              </p>
            </button>
          );
        })}
      </div>

      <Card className="space-y-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="space-y-1">
            <h3 className="font-medium text-ink-50">{info.label}</h3>
            <p className="text-sm leading-relaxed text-ink-300">{info.blurb}</p>
          </div>
          {data && !pending && (
            <PrimaryButton
              onClick={() => {
                setDone("");
                setPending({ kind: "create" });
              }}
              className="shrink-0"
            >
              {DATABASE_WRITE_COPY.add}
            </PrimaryButton>
          )}
        </div>

        <form onSubmit={submitSearch} className="flex gap-2">
          <input
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            placeholder={DATABASE_COPY.searchPlaceholder}
            className={inputClass}
          />
          {/* No onClick: a button inside a form submits it, which runs submitSearch. */}
          <PrimaryButton className="shrink-0">{DATABASE_COPY.searchButton}</PrimaryButton>
          {query && (
            <button
              type="button"
              onClick={() => {
                setSearchInput("");
                setQuery("");
                setOffset(0);
              }}
              className="press shrink-0 rounded-[var(--radius-control)] border border-white/8 px-3 text-sm text-ink-300 transition-colors hover:text-ink-100"
            >
              {DATABASE_COPY.searchClear}
            </button>
          )}
        </form>

        <p className="rounded-[var(--radius-control)] border border-iris-500/25 bg-iris-500/8 px-3 py-2 text-xs leading-relaxed text-iris-200/80">
          {DATABASE_COPY.structuralLegend}
        </p>
      </Card>

      {error && <ErrorAlert message={error} />}
      {done && !pending && <SuccessNote>{done}</SuccessNote>}

      {/* A create, edit or delete takes over the view. There is no way to be
          half-in a destructive action while still clicking around the list. */}
      {pending && data && (
        <div className="animate-fade-in-up">
          {pending.kind === "delete" ? (
            <DeleteConfirm
              table={table}
              rowId={String(pending.row[data.primary_key])}
              filename={pending.filename}
              chunks={pending.chunks}
              onCancel={() => setPending(null)}
              onDeleted={(message) => afterWrite(message)}
            />
          ) : (
            <RowEditor
              table={table}
              label={info.label}
              columns={data.columns}
              primaryKey={data.primary_key}
              row={pending.kind === "edit" ? pending.row : null}
              onCancel={() => setPending(null)}
              onSaved={(message) => afterWrite(message, pending.kind === "create")}
            />
          )}
        </div>
      )}

      {loading && !pending && (
        <div className="flex items-center justify-center gap-2 py-10 text-sm text-ink-400">
          <Spinner /> {DATABASE_COPY.loading}
        </div>
      )}

      {!loading && !pending && data && data.rows.length === 0 && (
        <Card>
          <EmptyState
            title={query ? DATABASE_COPY.noResults(query) : DATABASE_COPY.empty}
            hint={info.blurb}
          />
        </Card>
      )}

      {!loading && !pending && data && data.rows.length > 0 && (
        <div className="animate-fade-in-up space-y-4">
          {query && <p className="text-xs text-ink-400">{DATABASE_COPY.searching(query)}</p>}

          <Collection data={data} actions={actions} />

          {page && (page.offset > 0 || page.has_more) && (
            <div className="flex items-center justify-between gap-3 border-t border-white/8 pt-3">
              <button
                onClick={() => setOffset(Math.max(0, offset - PAGE_SIZE[table]))}
                disabled={page.offset === 0}
                className="press rounded-[var(--radius-control)] border border-white/8 px-3 py-1.5 text-xs text-ink-300 transition-colors hover:text-ink-100 disabled:cursor-not-allowed disabled:opacity-30"
              >
                {DATABASE_COPY.previous}
              </button>
              <span className="text-xs text-ink-500">
                {DATABASE_COPY.showing(from, to, page.total)}
              </span>
              <button
                onClick={() => setOffset(offset + PAGE_SIZE[table])}
                disabled={!page.has_more}
                className="press rounded-[var(--radius-control)] border border-white/8 px-3 py-1.5 text-xs text-ink-300 transition-colors hover:text-ink-100 disabled:cursor-not-allowed disabled:opacity-30"
              >
                {DATABASE_COPY.next}
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
