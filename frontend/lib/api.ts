// Every call into the Agentic Studio backend (main.py) lives in this file.

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

class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
    this.name = "ApiError";
  }
}

async function request<T>(path: string, options: RequestInit = {}, authed = false): Promise<T> {
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
  return body as T;
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
  const res = await fetch(`${API_URL}/result/${resultId}/download`);
  if (!res.ok) throw new ApiError(res.status, "Could not download this result.");
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `result_${resultId}.pdf`;
  anchor.click();
  URL.revokeObjectURL(url);
}

// ---- History ----

export function getHistory(sessionId: string) {
  return request<{ history: HistoryTurn[] }>(`/history/${encodeURIComponent(sessionId)}`);
}

// ---- Evaluation ----

export function getEvalSummary() {
  return request<EvalSummary>("/eval/summary");
}

export function getEvalChart() {
  return request<{ chart_base64: string | null }>("/eval/chart");
}

export { ApiError };
