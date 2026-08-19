// Every call into the Agentic Studio backend (main.py) lives in this file.

import { DEMO_COPY } from "@/lib/content";
import { demoRequest, isDemo } from "@/lib/demo";
import { DOWNLOAD_DESCRIPTION, narrateRequest, startActivity } from "@/lib/activity";
import { logApiEnd, logApiStart } from "@/lib/apilog";

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "";
const API_KEY = process.env.NEXT_PUBLIC_API_KEY ?? "";

export type TaskType = "compliance" | "analyze" | "release_listing" | "release_check";

export interface EvalResult {
  score: number | null;
  reasoning: string;
}

export interface AgentResponse {
  result_id: number;
  task: string;
  result: string;
  from_cache: boolean;
  eval?: EvalResult | null;
}

export interface CountryEvent {
  date: string;
  calendar_event: string;
}

export interface HolidayStatus {
  status: "ok" | "unknown";
  conflict: boolean | null;
  holiday_date: string | null;
  holiday_name: string | null;
}

export interface GlobalEventStatus {
  name: string;
  date: string;
  conflict: boolean;
  days_away: number;
}

export interface ConflictReport {
  holidays: Record<string, HolidayStatus>;
  sporting_events: GlobalEventStatus[];
  awards_ceremonies: GlobalEventStatus[];
}

export interface DateConfirmationResponse {
  result_id: number;
  confirmed: boolean;
  forced_date?: string;
  conflict_report: ConflictReport;
  events: Record<string, CountryEvent>;
}

export interface ConflictCheckResponse {
  result_id: number;
  proposed_date: string;
  conflict_report: ConflictReport;
  recommended_dates: Record<string, string>;
}

export interface HistoryTurn {
  role: string;
  content: string;
  [key: string]: unknown;
}

export interface EvalSummary {
  average_faithfulness: number | null;
  count: number;
}

// ---- Admin table browser ----
// The backend describes its own schema, so the Database tab renders any table
// without a compiled-in copy of its columns.

export type AdminTableName = "documents" | "cache" | "memory" | "results" | "eval_history";

export interface AdminColumn {
  name: string;
  type: string;
  nullable: boolean;
  /** The database's own default (a serial sequence, NOW(), …). Non-null means don't ask for it on create. */
  default: string | null;
  primary_key: boolean;
  /** Read for meaning elsewhere in the app, not just stored. Surfaced to the user. */
  structural: boolean;
  structural_note: string | null;
  /** Too large to ship in a row payload (documents.embedding). */
  omitted: boolean;
}

export interface AdminTableSummary {
  name: AdminTableName;
  primary_key: string;
  rows: number;
  structural_columns: string[];
  note: string;
}

/** Row values are whatever the column holds — never rendered raw, always by table. */
export type AdminRow = Record<string, unknown>;

export interface AdminListResponse {
  table: AdminTableName;
  primary_key: string;
  ordered_by: string;
  note: string;
  search: string | null;
  columns: AdminColumn[];
  pagination: {
    limit: number;
    offset: number;
    total: number;
    returned: number;
    has_more: boolean;
  };
  rows: AdminRow[];
}

class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
    this.name = "ApiError";
  }
}

/**
 * Every backend call in the app goes through here, which makes it the one place that
 * has to know about Demo Mode, the one place that narrates what is happening, and the
 * one place the technical log observes. Both modes take the same path below, so both
 * the activity feed and the API log report on them identically.
 */
async function request<T>(path: string, options: RequestInit = {}, authed = false): Promise<T> {
  const activity = narrateRequest(path, options);
  const logId = logApiStart(path, options, authed, isDemo());
  try {
    let body: unknown;
    if (isDemo()) {
      body = await demoRequest(path, options);
      // Fixtures have no HTTP status of their own; the entry is flagged as simulated
      // so the log never passes a made-up 200 off as a real one.
      logApiEnd(logId, { status: 200, ok: true, response: body });
    } else {
      body = await liveRequest(path, options, authed, logId);
    }
    activity?.finish(body);
    return body as T;
  } catch (err) {
    logApiEnd(logId, {
      status: err instanceof ApiError ? err.status : 0,
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    });
    activity?.fail();
    throw err;
  }
}

async function liveRequest(
  path: string,
  options: RequestInit,
  authed: boolean,
  logId: number
): Promise<unknown> {
  const headers: Record<string, string> = { ...(options.headers as Record<string, string>) };
  if (authed) headers["X-API-Key"] = API_KEY;

  let res: Response;
  try {
    res = await fetch(`${API_URL}${path}`, { ...options, headers });
  } catch {
    throw new ApiError(0, "Could not reach the backend. Is it running and is NEXT_PUBLIC_API_URL set correctly?");
  }

  const contentType = res.headers.get("content-type") ?? "";
  const body = contentType.includes("application/json") ? await res.json().catch(() => null) : null;

  if (!res.ok) {
    const detail = body?.detail ?? body?.error ?? res.statusText;
    throw new ApiError(res.status, typeof detail === "string" ? detail : JSON.stringify(detail));
  }
  // Settled here rather than in request(), because this is where the real status is.
  logApiEnd(logId, { status: res.status, ok: true, response: body });
  return body;
}

// ---- Health ----

export function checkHealth() {
  return request<{ status: string; database: string }>("/health");
}

// ---- Agents ----

export function runAgent(scriptText: string, task: TaskType, sessionId: string, evaluate: boolean) {
  const form = new URLSearchParams({
    script_text: scriptText,
    task,
    session_id: sessionId,
    evaluate: String(evaluate),
  });
  return request<AgentResponse>(
    "/run-agent",
    { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: form },
    true
  );
}

export function confirmDate(resultId: number) {
  return request<DateConfirmationResponse>(`/confirm-date/${resultId}`, { method: "POST" }, true);
}

export function overrideDate(resultId: number, newDate: string) {
  const form = new URLSearchParams({ new_date: newDate });
  return request<DateConfirmationResponse>(
    `/override-date/${resultId}`,
    { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: form },
    true
  );
}

export function checkConflicts(resultId: number, sessionId: string = "default") {
  return request<ConflictCheckResponse>(
    `/check-conflicts/${resultId}?session_id=${encodeURIComponent(sessionId)}`,
    { method: "POST" },
    true
  );
}

export function finalizeCalendar(resultId: number, overrides: Record<string, string>, sessionId: string = "default") {
  return request<DateConfirmationResponse>(
    `/finalize-calendar/${resultId}?session_id=${encodeURIComponent(sessionId)}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(overrides),
    },
    true
  );
}

// ---- Documents ----

export function ingestDocument(file: File) {
  const form = new FormData();
  form.append("file", file);
  return request<{ inserted_chunks: number; ids: number[] }>("/ingest", { method: "POST", body: form }, true);
}

export function deleteDocument(filename: string) {
  return request<{ deleted_chunks: number }>(
    `/document?filename=${encodeURIComponent(filename)}`,
    { method: "DELETE" },
    true
  );
}

// ---- Results ----

export function getResult(resultId: number) {
  return request<{ task: string; result: string } | { error: string }>(`/result/${resultId}`);
}

export async function downloadResult(resultId: number): Promise<void> {
  // The only call that bypasses request(), because it wants a blob rather than JSON.
  // The PDF is rendered by the backend, so there is nothing to fake — say so instead.
  if (isDemo()) throw new ApiError(0, DEMO_COPY.noDownload);

  const activity = startActivity(DOWNLOAD_DESCRIPTION);
  const logId = logApiStart(`/result/${resultId}/download`);
  try {
    const res = await fetch(`${API_URL}/result/${resultId}/download`);
    if (!res.ok) throw new ApiError(res.status, "Could not download this result.");
    const blob = await res.blob();
    logApiEnd(logId, {
      status: res.status,
      ok: true,
      response: `PDF file, ${(blob.size / 1024).toFixed(0)} KB`,
    });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `result_${resultId}.pdf`;
    anchor.click();
    URL.revokeObjectURL(url);
    activity.finish(null);
  } catch (err) {
    logApiEnd(logId, {
      status: err instanceof ApiError ? err.status : 0,
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    });
    activity.fail();
    throw err;
  }
}

// ---- History ----

export function getHistory(sessionId: string) {
  return request<{ history: HistoryTurn[] }>(`/history/${encodeURIComponent(sessionId)}`);
}

// ---- Admin ----
// Authenticated even though they only read: one of these returns every stored
// conversation, which is not the same exposure as /result/{id}.

export function getAdminTables() {
  return request<{ tables: AdminTableSummary[] }>("/admin/tables", {}, true);
}

export interface AdminStructuralWarning {
  column: string;
  note: string;
}

export interface AdminWriteResponse {
  table: AdminTableName;
  row_id: string | number;
  row: AdminRow | null;
  /** Present on update: which columns the statement actually set. */
  updated?: string[];
  structural_warnings: AdminStructuralWarning[];
}

export interface AdminDeleteResponse {
  table: AdminTableName;
  row_id: string;
  deleted_rows: number;
  /** "filename" when the backend removed a whole chunk group instead of one row. */
  grouped_by: string | null;
  filename?: string | null;
}

const jsonBody = (values: Record<string, unknown>): RequestInit => ({
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(values),
});

export function createAdminRow(table: AdminTableName, values: Record<string, unknown>) {
  return request<AdminWriteResponse>(
    `/admin/tables/${table}`,
    { method: "POST", ...jsonBody(values) },
    true
  );
}

export function updateAdminRow(
  table: AdminTableName,
  rowId: string,
  values: Record<string, unknown>
) {
  return request<AdminWriteResponse>(
    `/admin/tables/${table}/${encodeURIComponent(rowId)}`,
    { method: "PATCH", ...jsonBody(values) },
    true
  );
}

export function deleteAdminRow(table: AdminTableName, rowId: string) {
  return request<AdminDeleteResponse>(
    `/admin/tables/${table}/${encodeURIComponent(rowId)}`,
    { method: "DELETE" },
    true
  );
}

export function getAdminRows(
  table: AdminTableName,
  { limit, offset = 0, query = "" }: { limit: number; offset?: number; query?: string }
) {
  const params = new URLSearchParams({ limit: String(limit), offset: String(offset) });
  if (query.trim()) params.set("q", query.trim());
  return request<AdminListResponse>(`/admin/tables/${table}?${params}`, {}, true);
}

// ---- Evaluation ----

export function getEvalSummary() {
  return request<EvalSummary>("/eval/summary");
}

export function getEvalChart() {
  return request<{ chart_base64: string | null }>("/eval/chart");
}

export { ApiError };
