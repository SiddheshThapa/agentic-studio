"use client";

import { useEffect, useState } from "react";
import {
  ApiError,
  AgentResponse,
  ConflictCheckResponse,
  ConflictReport,
  DateConfirmationResponse,
  EvalSummary,
  HistoryTurn,
  TaskType,
  checkConflicts,
  checkHealth,
  confirmDate,
  deleteDocument,
  downloadResult,
  finalizeCalendar,
  getEvalChart,
  getEvalSummary,
  getHistory,
  getResult,
  ingestDocument,
  overrideDate,
  runAgent,
} from "@/lib/api";

type Tab = "agents" | "documents" | "history" | "insights";

const TABS: { id: Tab; label: string }[] = [
  { id: "agents", label: "Agents" },
  { id: "documents", label: "Documents" },
  { id: "history", label: "History & Results" },
  { id: "insights", label: "Insights" },
];

const TASKS: { value: TaskType; label: string; hint: string }[] = [
  { value: "compliance", label: "Compliance Check", hint: "RAG against studio guidelines" },
  { value: "analyze", label: "Script Analysis", hint: "Structural analysis + comparables" },
  { value: "release_listing", label: "Browse Releases", hint: "Upcoming titles by genre" },
  { value: "release_check", label: "Check Release Date", hint: "Conflict-check a proposed date" },
];

function errorMessage(err: unknown): string {
  if (err instanceof ApiError) return err.message;
  if (err instanceof Error) return err.message;
  return "Something went wrong.";
}

export default function Home() {
  const [tab, setTab] = useState<Tab>("agents");
  const [healthy, setHealthy] = useState<boolean | null>(null);
  const [checkedAt, setCheckedAt] = useState<Date | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function poll() {
      try {
        const r = await checkHealth();
        if (!cancelled) setHealthy(r.status === "ok");
      } catch {
        if (!cancelled) setHealthy(false);
      } finally {
        if (!cancelled) setCheckedAt(new Date());
      }
    }
    poll();
    const id = setInterval(poll, 30_000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, []);

  return (
    <main className="relative min-h-screen overflow-x-hidden bg-slate-950 text-slate-100">
      <div className="pointer-events-none fixed inset-0 overflow-hidden">
        <div className="absolute -top-40 left-1/4 h-96 w-96 rounded-full bg-blue-600/20 blur-[120px]" />
        <div className="absolute top-1/3 -right-32 h-96 w-96 rounded-full bg-violet-600/10 blur-[120px]" />
      </div>

      <header className="sticky top-0 z-20 border-b border-slate-800/60 bg-slate-950/80 backdrop-blur">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-5">
          <div className="flex items-center gap-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-gradient-to-br from-blue-500 to-violet-600 font-bold shadow-lg shadow-blue-950/50">
              A
            </div>
            <div>
              <h1 className="text-lg font-semibold tracking-tight">Agentic Studio</h1>
              <p className="text-xs text-slate-500">AI Studio Operations Platform</p>
            </div>
          </div>
          <div
            title={checkedAt ? `Last checked ${checkedAt.toLocaleTimeString()}` : undefined}
            className={`flex items-center gap-2 rounded-full border px-3 py-1.5 text-xs transition-colors ${
              healthy
                ? "border-emerald-800 bg-emerald-950/50 text-emerald-400"
                : healthy === false
                ? "border-red-800 bg-red-950/50 text-red-400"
                : "border-slate-800 bg-slate-900/50 text-slate-400"
            }`}
          >
            <span
              className={`h-1.5 w-1.5 rounded-full ${
                healthy ? "bg-emerald-400" : healthy === false ? "bg-red-400" : "bg-slate-500"
              } ${healthy !== null ? "animate-pulse" : ""}`}
            />
            {healthy === null ? "checking system status" : healthy ? "system online" : "system offline"}
          </div>
        </div>

        <nav className="mx-auto flex max-w-6xl gap-1 px-6">
          {TABS.map((t) => (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className={`border-b-2 px-4 py-2.5 text-sm font-medium transition-colors ${
                tab === t.id
                  ? "border-blue-500 text-white"
                  : "border-transparent text-slate-500 hover:text-slate-300"
              }`}
            >
              {t.label}
            </button>
          ))}
        </nav>
      </header>

      <div className="relative mx-auto max-w-6xl px-6 py-8">
        {tab === "agents" && <AgentsPanel />}
        {tab === "documents" && <DocumentsPanel />}
        {tab === "history" && <HistoryPanel />}
        {tab === "insights" && <InsightsPanel />}
      </div>
    </main>
  );
}

// ---------------------------------------------------------------------------
// Shared UI atoms
// ---------------------------------------------------------------------------

function Card({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return (
    <div className={`rounded-xl border border-slate-800 bg-slate-900/60 p-6 shadow-xl shadow-black/20 ${className}`}>
      {children}
    </div>
  );
}

function Spinner({ className = "" }: { className?: string }) {
  return (
    <span
      className={`inline-block h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent ${className}`}
    />
  );
}

function ErrorAlert({ message }: { message: string }) {
  return (
    <div className="animate-fade-in-up rounded-lg border border-red-900 bg-red-950/40 px-4 py-3 text-sm text-red-300">
      {message}
    </div>
  );
}

function Badge({ tone, children }: { tone: "blue" | "emerald" | "amber" | "slate"; children: React.ReactNode }) {
  const tones: Record<string, string> = {
    blue: "border-blue-900 bg-blue-950/50 text-blue-300",
    emerald: "border-emerald-900 bg-emerald-950/50 text-emerald-400",
    amber: "border-amber-900 bg-amber-950/50 text-amber-400",
    slate: "border-slate-800 bg-slate-950/60 text-slate-400",
  };
  return (
    <span className={`rounded-full border px-2.5 py-1 text-xs font-medium ${tones[tone]}`}>{children}</span>
  );
}

function PrimaryButton({
  children,
  disabled,
  onClick,
  className = "",
  loading = false,
}: {
  children: React.ReactNode;
  disabled?: boolean;
  onClick?: () => void;
  className?: string;
  loading?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={`inline-flex items-center justify-center gap-2 rounded-lg bg-blue-600 py-2.5 text-sm font-medium text-white transition-colors hover:bg-blue-500 disabled:cursor-not-allowed disabled:opacity-40 ${className}`}
    >
      {loading && <Spinner />}
      {children}
    </button>
  );
}

function ConflictFindings({ report }: { report: ConflictReport }) {
  const globalEvents = [...report.sporting_events, ...report.awards_ceremonies];
  const hasConflict =
    Object.values(report.holidays).some((h) => h.conflict) || globalEvents.some((e) => e.conflict);

  return (
    <div className="space-y-2 rounded-lg border border-slate-800 bg-slate-950/60 p-3">
      <div className="flex items-center justify-between">
        <p className="text-xs font-medium text-slate-400">Conflict Findings</p>
        <Badge tone={hasConflict ? "amber" : "emerald"}>
          {hasConflict ? "conflicts found" : "no conflicts"}
        </Badge>
      </div>
      <div className="space-y-1">
        {Object.entries(report.holidays).map(([code, h]) => (
          <div key={code} className="flex items-center justify-between text-xs">
            <span className="text-slate-500">{code} holiday</span>
            {h.status === "unknown" ? (
              <span className="text-slate-600">status unknown</span>
            ) : h.conflict ? (
              <span className="text-amber-400">
                {h.holiday_name} ({h.holiday_date})
              </span>
            ) : (
              <span className="text-emerald-500">clear</span>
            )}
          </div>
        ))}
        {globalEvents.map((e) => (
          <div key={e.name} className="flex items-center justify-between text-xs">
            <span className="text-slate-500">{e.name}</span>
            <span className={e.conflict ? "text-amber-400" : "text-emerald-500"}>
              {e.date} ({e.days_away}d away)
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Agents
// ---------------------------------------------------------------------------

function AgentsPanel() {
  const [task, setTask] = useState<TaskType>("compliance");
  const [scriptText, setScriptText] = useState("");
  const [genre, setGenre] = useState("");
  const [proposedDate, setProposedDate] = useState("");
  const [listingId, setListingId] = useState("");
  const [sessionId, setSessionId] = useState("web-session");
  const [evaluate, setEvaluate] = useState(true);

  const [result, setResult] = useState<AgentResponse | null>(null);
  const [dateResult, setDateResult] = useState<DateConfirmationResponse | null>(null);
  const [conflictCheck, setConflictCheck] = useState<ConflictCheckResponse | null>(null);
  const [editedDates, setEditedDates] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(false);
  const [actionLoading, setActionLoading] = useState<
    "confirm" | "override" | "download" | "check" | "finalize" | null
  >(null);
  const [overrideVal, setOverrideVal] = useState("");
  const [error, setError] = useState("");

  const inputValue =
    task === "release_listing" ? genre : task === "release_check" ? `${proposedDate}|${listingId}` : scriptText;

  const canRun =
    task === "release_listing"
      ? genre.trim().length > 0
      : task === "release_check"
      ? proposedDate.trim().length > 0 && listingId.trim().length > 0
      : scriptText.trim().length > 0;

  async function run() {
    setLoading(true);
    setError("");
    setResult(null);
    setDateResult(null);
    setConflictCheck(null);
    setEditedDates({});
    try {
      setResult(await runAgent(inputValue, task, sessionId || "default", evaluate));
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setLoading(false);
    }
  }

  async function handleConfirm() {
    if (!result) return;
    setActionLoading("confirm");
    setError("");
    try {
      setDateResult(await confirmDate(result.result_id));
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setActionLoading(null);
    }
  }

  async function handleOverride() {
    if (!result || !overrideVal) return;
    setActionLoading("override");
    setError("");
    try {
      setDateResult(await overrideDate(result.result_id, overrideVal));
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setActionLoading(null);
    }
  }

  async function handleCheckConflicts() {
    if (!result) return;
    setActionLoading("check");
    setError("");
    try {
      const res = await checkConflicts(result.result_id, sessionId || "default");
      setConflictCheck(res);
      setEditedDates(res.recommended_dates);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setActionLoading(null);
    }
  }

  async function handleFinalize() {
    if (!result || !conflictCheck) return;
    setActionLoading("finalize");
    setError("");
    try {
      const overrides = Object.fromEntries(
        Object.entries(editedDates).filter(([code, date]) => date !== conflictCheck.recommended_dates[code])
      );
      setDateResult(await finalizeCalendar(result.result_id, overrides, sessionId || "default"));
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setActionLoading(null);
    }
  }

  async function handleDownload() {
    if (!result) return;
    setActionLoading("download");
    setError("");
    try {
      await downloadResult(result.result_id);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setActionLoading(null);
    }
  }

  return (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
      <Card className="space-y-4">
        <div>
          <h2 className="font-semibold">Run an Agent</h2>
          <p className="text-sm text-slate-500">Select a task and provide input</p>
        </div>

        <div className="grid grid-cols-2 gap-2">
          {TASKS.map((t) => (
            <button
              key={t.value}
              onClick={() => {
                setTask(t.value);
                setResult(null);
                setDateResult(null);
                setConflictCheck(null);
                setEditedDates({});
                setError("");
              }}
              className={`rounded-lg border px-3 py-2.5 text-left text-sm transition-colors ${
                task === t.value
                  ? "border-blue-500 bg-blue-950/40 text-blue-300"
                  : "border-slate-800 text-slate-400 hover:border-slate-700"
              }`}
            >
              <div className="font-medium">{t.label}</div>
              <div className="text-xs text-slate-500">{t.hint}</div>
            </button>
          ))}
        </div>

        {(task === "compliance" || task === "analyze") && (
          <textarea
            value={scriptText}
            onChange={(e) => setScriptText(e.target.value)}
            placeholder="Paste script excerpt here..."
            className="h-36 w-full resize-none rounded-lg border border-slate-800 bg-slate-950 p-3 text-sm outline-none transition-colors focus:border-blue-600"
          />
        )}

        {task === "release_listing" && (
          <input
            value={genre}
            onChange={(e) => setGenre(e.target.value)}
            placeholder="Enter a genre, e.g. horror"
            className="w-full rounded-lg border border-slate-800 bg-slate-950 p-3 text-sm outline-none transition-colors focus:border-blue-600"
          />
        )}

        {task === "release_check" && (
          <div className="space-y-2">
            <div>
              <label className="mb-1 block text-xs text-slate-500">Proposed release date</label>
              <input
                type="date"
                value={proposedDate}
                onChange={(e) => setProposedDate(e.target.value)}
                className="w-full rounded-lg border border-slate-800 bg-slate-950 p-2.5 text-sm outline-none transition-colors focus:border-blue-600"
              />
            </div>
            <div>
              <label className="mb-1 block text-xs text-slate-500">
                Listing result ID <span className="text-slate-600">(from a Browse Releases run)</span>
              </label>
              <input
                value={listingId}
                onChange={(e) => setListingId(e.target.value)}
                placeholder="e.g. 24"
                className="w-full rounded-lg border border-slate-800 bg-slate-950 p-2.5 text-sm outline-none transition-colors focus:border-blue-600"
              />
            </div>
          </div>
        )}

        <div className="flex items-center justify-between gap-4">
          <div className="flex-1">
            <label className="mb-1 block text-xs text-slate-500">Session ID</label>
            <input
              value={sessionId}
              onChange={(e) => setSessionId(e.target.value)}
              className="w-full rounded-lg border border-slate-800 bg-slate-950 p-2 text-sm outline-none transition-colors focus:border-blue-600"
            />
          </div>
          <label className="flex cursor-pointer items-center gap-2 pt-4 text-xs text-slate-400">
            <input
              type="checkbox"
              checked={evaluate}
              onChange={(e) => setEvaluate(e.target.checked)}
              className="h-3.5 w-3.5 accent-blue-600"
            />
            Evaluate faithfulness
          </label>
        </div>

        <PrimaryButton onClick={run} disabled={loading || !canRun} loading={loading} className="w-full">
          {loading ? "Running..." : "Run Agent"}
        </PrimaryButton>

        {error && <ErrorAlert message={error} />}
      </Card>

      <Card>
        {!result && !loading && (
          <div className="flex h-full items-center justify-center py-12 text-sm text-slate-600">
            Results will appear here
          </div>
        )}
        {loading && (
          <div className="flex h-full flex-col items-center justify-center gap-2 py-12 text-sm text-slate-500">
            <Spinner className="h-6 w-6" />
            Processing...
          </div>
        )}
        {result && (
          <div className="animate-fade-in-up space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="text-xs text-slate-500">Result #{result.result_id}</span>
              <div className="flex flex-wrap gap-2">
                <Badge tone={result.from_cache ? "amber" : "blue"}>
                  {result.from_cache ? "from cache" : "freshly generated"}
                </Badge>
                {result.eval?.score != null && (
                  <Badge tone="emerald">Faithfulness: {result.eval.score}/10</Badge>
                )}
              </div>
            </div>

            <p className="whitespace-pre-wrap text-sm leading-relaxed text-slate-300">{result.result}</p>

            {result.eval?.reasoning && (
              <p className="rounded-lg border border-slate-800 bg-slate-950/60 p-3 text-xs text-slate-500">
                <span className="font-medium text-slate-400">Eval reasoning: </span>
                {result.eval.reasoning}
              </p>
            )}

            <button
              onClick={handleDownload}
              disabled={actionLoading === "download"}
              className="inline-flex items-center gap-2 text-xs text-slate-500 transition-colors hover:text-blue-400 disabled:opacity-40"
            >
              {actionLoading === "download" ? <Spinner /> : null}
              Download as PDF
            </button>

            {task === "release_check" && !dateResult && (
              <div className="space-y-5 border-t border-slate-800 pt-4">
                <div className="space-y-3">
                  <div>
                    <p className="text-xs font-medium text-slate-400">Quick Confirm</p>
                    <p className="text-xs text-slate-600">
                      Skip the review — create calendar events immediately using Agent 4&apos;s recommendation.
                    </p>
                  </div>
                  <PrimaryButton
                    onClick={handleConfirm}
                    disabled={actionLoading !== null}
                    loading={actionLoading === "confirm"}
                    className="w-full !bg-emerald-700 hover:!bg-emerald-600"
                  >
                    Confirm Proposed Date
                  </PrimaryButton>
                  <div className="flex gap-2">
                    <input
                      type="date"
                      value={overrideVal}
                      onChange={(e) => setOverrideVal(e.target.value)}
                      className="flex-1 rounded-lg border border-slate-800 bg-slate-950 px-3 text-sm outline-none focus:border-orange-600"
                    />
                    <button
                      onClick={handleOverride}
                      disabled={actionLoading !== null || !overrideVal}
                      className="inline-flex items-center gap-2 rounded-lg bg-orange-700 px-4 text-sm font-medium transition-colors hover:bg-orange-600 disabled:cursor-not-allowed disabled:opacity-40"
                    >
                      {actionLoading === "override" && <Spinner />}
                      Override
                    </button>
                  </div>
                </div>

                <div className="space-y-3 border-t border-dashed border-slate-800 pt-4">
                  <div>
                    <p className="text-xs font-medium text-violet-300">Review Before Confirming</p>
                    <p className="text-xs text-slate-600">
                      See Agent 4&apos;s holiday/event findings and adjust each country&apos;s date before anything
                      is created.
                    </p>
                  </div>

                  {!conflictCheck && (
                    <PrimaryButton
                      onClick={handleCheckConflicts}
                      disabled={actionLoading !== null}
                      loading={actionLoading === "check"}
                      className="w-full !bg-violet-700 hover:!bg-violet-600"
                    >
                      Check Holiday &amp; Event Conflicts
                    </PrimaryButton>
                  )}

                  {conflictCheck && (
                    <div className="animate-fade-in-up space-y-4">
                      <ConflictFindings report={conflictCheck.conflict_report} />

                      <div className="space-y-2">
                        <p className="text-xs font-medium text-slate-400">Per-Country Dates</p>
                        {Object.entries(conflictCheck.recommended_dates).map(([code, recommended]) => {
                          const edited = editedDates[code] ?? recommended;
                          const isChanged = edited !== recommended;
                          return (
                            <div key={code} className="flex items-center gap-2">
                              <span className="w-10 shrink-0 text-sm text-slate-300">{code}</span>
                              <input
                                type="date"
                                value={edited}
                                onChange={(e) =>
                                  setEditedDates((prev) => ({ ...prev, [code]: e.target.value }))
                                }
                                className={`flex-1 rounded-lg border bg-slate-950 px-3 py-1.5 text-sm outline-none transition-colors ${
                                  isChanged
                                    ? "border-amber-700 focus:border-amber-600"
                                    : "border-slate-800 focus:border-blue-600"
                                }`}
                              />
                              {isChanged && <Badge tone="amber">edited</Badge>}
                            </div>
                          );
                        })}
                      </div>

                      <PrimaryButton
                        onClick={handleFinalize}
                        disabled={actionLoading !== null}
                        loading={actionLoading === "finalize"}
                        className="w-full !bg-emerald-700 hover:!bg-emerald-600"
                      >
                        Confirm &amp; Create Calendar Events
                      </PrimaryButton>
                    </div>
                  )}
                </div>
              </div>
            )}

            {dateResult && (
              <div className="animate-fade-in-up space-y-4 border-t border-slate-800 pt-4">
                <div className="flex items-center justify-between">
                  <p className="text-xs font-medium text-slate-400">
                    {dateResult.forced_date ? `Overridden to ${dateResult.forced_date}` : "Date confirmed"}
                  </p>
                  <Badge tone="emerald">events created</Badge>
                </div>

                <div className="space-y-2">
                  {Object.entries(dateResult.events).map(([country, info]) => (
                    <a
                      key={country}
                      href={info.calendar_event}
                      target="_blank"
                      rel="noreferrer"
                      className="flex items-center justify-between rounded-lg border border-slate-800 bg-slate-950 px-3 py-2 text-sm transition-colors hover:border-blue-700"
                    >
                      <span className="text-slate-300">{country}</span>
                      <span className="text-blue-400">{info.date} →</span>
                    </a>
                  ))}
                </div>

                <details className="text-xs text-slate-500">
                  <summary className="cursor-pointer text-slate-400 hover:text-slate-300">
                    Conflict report details
                  </summary>
                  <pre className="mt-2 max-h-48 overflow-auto rounded-lg border border-slate-800 bg-slate-950/60 p-3 text-[11px] leading-relaxed text-slate-500">
                    {JSON.stringify(dateResult.conflict_report, null, 2)}
                  </pre>
                </details>
              </div>
            )}
          </div>
        )}
      </Card>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Documents
// ---------------------------------------------------------------------------

function DocumentsPanel() {
  const [file, setFile] = useState<File | null>(null);
  const [uploadStatus, setUploadStatus] = useState("");
  const [uploadError, setUploadError] = useState("");
  const [uploading, setUploading] = useState(false);

  const [filename, setFilename] = useState("");
  const [deleteStatus, setDeleteStatus] = useState("");
  const [deleteError, setDeleteError] = useState("");
  const [deleting, setDeleting] = useState(false);

  async function handleUpload() {
    if (!file) return;
    setUploading(true);
    setUploadStatus("");
    setUploadError("");
    try {
      const res = await ingestDocument(file);
      setUploadStatus(`Inserted ${res.inserted_chunks} chunks into the knowledge base`);
      setFile(null);
    } catch (err) {
      setUploadError(errorMessage(err));
    } finally {
      setUploading(false);
    }
  }

  async function handleDelete() {
    setDeleting(true);
    setDeleteStatus("");
    setDeleteError("");
    try {
      const res = await deleteDocument(filename);
      setDeleteStatus(`Removed ${res.deleted_chunks} chunks matching "${filename}"`);
    } catch (err) {
      setDeleteError(errorMessage(err));
    } finally {
      setDeleting(false);
    }
  }

  return (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
      <Card className="space-y-4">
        <div>
          <h2 className="font-semibold">Upload Reference Document</h2>
          <p className="text-sm text-slate-500">PDF gets classified and stored automatically</p>
        </div>
        <label className="flex cursor-pointer flex-col items-center justify-center rounded-lg border-2 border-dashed border-slate-800 py-8 transition-colors hover:border-slate-700">
          <input type="file" accept=".pdf" onChange={(e) => setFile(e.target.files?.[0] || null)} className="hidden" />
          <span className="text-sm text-slate-400">{file ? file.name : "Click to select a PDF"}</span>
        </label>
        <PrimaryButton onClick={handleUpload} disabled={!file || uploading} loading={uploading} className="w-full">
          {uploading ? "Uploading..." : "Upload & Ingest"}
        </PrimaryButton>
        {uploadStatus && <p className="animate-fade-in-up text-sm text-emerald-400">{uploadStatus}</p>}
        {uploadError && <ErrorAlert message={uploadError} />}
      </Card>

      <Card className="space-y-4">
        <div>
          <h2 className="font-semibold">Remove Document</h2>
          <p className="text-sm text-slate-500">Removes all chunks matching an exact filename</p>
        </div>
        <input
          value={filename}
          onChange={(e) => setFilename(e.target.value)}
          placeholder="exact filename, e.g. guidelines.pdf"
          className="w-full rounded-lg border border-slate-800 bg-slate-950 p-2.5 text-sm outline-none transition-colors focus:border-red-700"
        />
        <button
          onClick={handleDelete}
          disabled={!filename || deleting}
          className="inline-flex w-full items-center justify-center gap-2 rounded-lg bg-red-700 py-2.5 text-sm font-medium transition-colors hover:bg-red-600 disabled:cursor-not-allowed disabled:opacity-40"
        >
          {deleting && <Spinner />}
          Delete Document
        </button>
        {deleteStatus && <p className="animate-fade-in-up text-sm text-red-400">{deleteStatus}</p>}
        {deleteError && <ErrorAlert message={deleteError} />}
      </Card>
    </div>
  );
}

// ---------------------------------------------------------------------------
// History & Results
// ---------------------------------------------------------------------------

function HistoryPanel() {
  const [sessionId, setSessionId] = useState("web-session");
  const [history, setHistory] = useState<HistoryTurn[]>([]);
  const [historyLoaded, setHistoryLoaded] = useState(false);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyError, setHistoryError] = useState("");

  const [lookupId, setLookupId] = useState("");
  const [lookupResult, setLookupResult] = useState<{ task: string; result: string } | null>(null);
  const [lookupLoading, setLookupLoading] = useState(false);
  const [lookupError, setLookupError] = useState("");
  const [downloading, setDownloading] = useState(false);

  async function loadHistory() {
    setHistoryLoading(true);
    setHistoryError("");
    try {
      const res = await getHistory(sessionId);
      setHistory(res.history);
      setHistoryLoaded(true);
    } catch (err) {
      setHistoryError(errorMessage(err));
    } finally {
      setHistoryLoading(false);
    }
  }

  async function loadResult() {
    const id = Number(lookupId);
    if (!Number.isFinite(id)) return;
    setLookupLoading(true);
    setLookupError("");
    setLookupResult(null);
    try {
      const res = await getResult(id);
      if ("error" in res) {
        setLookupError("No stored result with that ID.");
      } else {
        setLookupResult(res);
      }
    } catch (err) {
      setLookupError(errorMessage(err));
    } finally {
      setLookupLoading(false);
    }
  }

  async function handleDownload() {
    const id = Number(lookupId);
    if (!Number.isFinite(id)) return;
    setDownloading(true);
    setLookupError("");
    try {
      await downloadResult(id);
    } catch (err) {
      setLookupError(errorMessage(err));
    } finally {
      setDownloading(false);
    }
  }

  return (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
      <Card className="space-y-4">
        <div>
          <h2 className="font-semibold">Conversation History</h2>
          <p className="text-sm text-slate-500">Stored turns for a session</p>
        </div>
        <div className="flex gap-2">
          <input
            value={sessionId}
            onChange={(e) => setSessionId(e.target.value)}
            className="flex-1 rounded-lg border border-slate-800 bg-slate-950 p-2.5 text-sm outline-none focus:border-blue-600"
            placeholder="session id"
          />
          <button
            onClick={loadHistory}
            disabled={historyLoading}
            className="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-5 text-sm font-medium transition-colors hover:bg-blue-500 disabled:opacity-40"
          >
            {historyLoading && <Spinner />}
            Load
          </button>
        </div>
        {historyError && <ErrorAlert message={historyError} />}
        {historyLoaded && history.length === 0 && !historyError && (
          <p className="text-sm text-slate-600">No history for this session</p>
        )}
        <div className="max-h-96 space-y-2 overflow-y-auto">
          {history.map((h, i) => (
            <div key={i} className="flex animate-fade-in-up gap-3 border-b border-slate-800/60 pb-2 text-sm">
              <span
                className={`h-fit shrink-0 rounded-full px-2 py-0.5 text-xs ${
                  h.role === "user" ? "bg-blue-950 text-blue-400" : "bg-violet-950 text-violet-400"
                }`}
              >
                {h.role}
              </span>
              <span className="text-slate-400">{h.content}</span>
            </div>
          ))}
        </div>
      </Card>

      <Card className="space-y-4">
        <div>
          <h2 className="font-semibold">Look Up a Stored Result</h2>
          <p className="text-sm text-slate-500">Fetch by result ID or download it as a PDF</p>
        </div>
        <div className="flex gap-2">
          <input
            value={lookupId}
            onChange={(e) => setLookupId(e.target.value)}
            placeholder="result id, e.g. 24"
            className="flex-1 rounded-lg border border-slate-800 bg-slate-950 p-2.5 text-sm outline-none focus:border-blue-600"
          />
          <button
            onClick={loadResult}
            disabled={!lookupId || lookupLoading}
            className="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-5 text-sm font-medium transition-colors hover:bg-blue-500 disabled:opacity-40"
          >
            {lookupLoading && <Spinner />}
            Fetch
          </button>
        </div>
        {lookupError && <ErrorAlert message={lookupError} />}
        {lookupResult && (
          <div className="animate-fade-in-up space-y-3">
            <Badge tone="blue">{lookupResult.task}</Badge>
            <p className="max-h-64 overflow-y-auto whitespace-pre-wrap text-sm leading-relaxed text-slate-300">
              {lookupResult.result}
            </p>
            <button
              onClick={handleDownload}
              disabled={downloading}
              className="inline-flex items-center gap-2 text-xs text-slate-500 transition-colors hover:text-blue-400 disabled:opacity-40"
            >
              {downloading && <Spinner />}
              Download as PDF
            </button>
          </div>
        )}
      </Card>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Insights
// ---------------------------------------------------------------------------

function InsightsPanel() {
  const [summary, setSummary] = useState<EvalSummary | null>(null);
  const [chart, setChart] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  async function fetchInsights() {
    try {
      const [s, c] = await Promise.all([getEvalSummary(), getEvalChart()]);
      setSummary(s);
      setChart(c.chart_base64);
      setError("");
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setLoading(false);
    }
  }

  function refresh() {
    setLoading(true);
    fetchInsights();
  }

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [s, c] = await Promise.all([getEvalSummary(), getEvalChart()]);
        if (cancelled) return;
        setSummary(s);
        setChart(c.chart_base64);
      } catch (err) {
        if (!cancelled) setError(errorMessage(err));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="font-semibold">Evaluation Insights</h2>
        <button
          onClick={refresh}
          disabled={loading}
          className="inline-flex items-center gap-2 text-xs text-slate-500 transition-colors hover:text-blue-400 disabled:opacity-40"
        >
          {loading && <Spinner />}
          Refresh
        </button>
      </div>

      {error && <ErrorAlert message={error} />}

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <Card>
          <p className="mb-1 text-xs uppercase tracking-wide text-slate-500">Avg Faithfulness</p>
          <p className="text-3xl font-bold">{summary?.average_faithfulness ?? "—"}</p>
        </Card>
        <Card>
          <p className="mb-1 text-xs uppercase tracking-wide text-slate-500">Avg Context Precision</p>
          <p className="text-3xl font-bold">{summary?.average_context_precision ?? "—"}</p>
        </Card>
        <Card>
          <p className="mb-1 text-xs uppercase tracking-wide text-slate-500">Evaluated Runs</p>
          <p className="text-3xl font-bold">{summary?.count ?? 0}</p>
        </Card>
      </div>

      <Card>
        <p className="mb-4 text-xs uppercase tracking-wide text-slate-500">Score Trend</p>
        {chart ? (
          // eslint-disable-next-line @next/next/no-img-element -- dynamic base64 data URI, not a static asset
          <img src={`data:image/png;base64,${chart}`} alt="Evaluation score trend" className="w-full rounded-lg" />
        ) : (
          <p className="text-sm text-slate-600">No evaluation data yet — run an agent with evaluation enabled</p>
        )}
      </Card>
    </div>
  );
}
