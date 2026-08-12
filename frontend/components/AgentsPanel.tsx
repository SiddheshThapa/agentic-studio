// Script-facing agents: Compliance Check, Script Analysis, Browse Releases.
// The release-date workflow lives in ReleasePlanner.tsx because it is multi-step.
"use client";

import { useState } from "react";
import { AgentResponse, downloadResult, runAgent } from "@/lib/api";
import {
  Badge,
  BusyState,
  Card,
  EmptyState,
  ErrorAlert,
  Explain,
  Field,
  InfoNote,
  PrimaryButton,
  Spinner,
  errorMessage,
  inputClass,
} from "@/components/ui";
import { GENRES, GLOSSARY, MIN_SCRIPT_CHARS, TASK_INFO } from "@/lib/content";

type ScriptTask = "compliance" | "analyze" | "release_listing";

export default function AgentsPanel({ onGo }: { onGo: (tab: string) => void }) {
  const [task, setTask] = useState<ScriptTask>("compliance");
  const [scriptText, setScriptText] = useState("");
  const [genre, setGenre] = useState("");
  const [sessionId, setSessionId] = useState("web-session");
  const [evaluate, setEvaluate] = useState(true);

  const [result, setResult] = useState<AgentResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [error, setError] = useState("");

  const info = TASK_INFO[task];
  const isGenreTask = task === "release_listing";
  const trimmed = scriptText.trim();

  // Mirror of the backend's validation, so the user sees the problem before sending.
  const validation = isGenreTask
    ? genre
      ? null
      : "Choose a genre to continue."
    : trimmed.length === 0
    ? "Paste some script text to continue."
    : trimmed.length < MIN_SCRIPT_CHARS
    ? `Needs at least ${MIN_SCRIPT_CHARS} characters — you have ${trimmed.length}.`
    : null;

  function switchTask(next: ScriptTask) {
    setTask(next);
    setResult(null);
    setError("");
  }

  async function run() {
    setLoading(true);
    setError("");
    setResult(null);
    try {
      const input = isGenreTask ? genre : scriptText;
      setResult(await runAgent(input, task, sessionId || "default", evaluate));
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setLoading(false);
    }
  }

  async function handleDownload() {
    if (!result) return;
    setDownloading(true);
    setError("");
    try {
      await downloadResult(result.result_id);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setDownloading(false);
    }
  }

  return (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
      <div className="space-y-6">
        <Card className="space-y-5">
          <div>
            <h2 className="font-semibold">1. Choose what you want done</h2>
            <p className="mt-1 text-sm text-slate-500">
              Each option is a different agent with different inputs.
            </p>
          </div>

          <div className="space-y-2">
            {(Object.keys(TASK_INFO) as ScriptTask[]).map((key) => {
              const t = TASK_INFO[key];
              const active = task === key;
              return (
                <button
                  key={key}
                  onClick={() => switchTask(key)}
                  className={`w-full rounded-lg border px-4 py-3 text-left transition-colors ${
                    active
                      ? "border-blue-500 bg-blue-950/40"
                      : "border-slate-800 hover:border-slate-700"
                  }`}
                >
                  <div className={`text-sm font-medium ${active ? "text-blue-200" : "text-slate-300"}`}>
                    {t.label}
                  </div>
                  <div className="mt-0.5 text-xs text-slate-500">{t.tagline}</div>
                </button>
              );
            })}
          </div>

          <div className="space-y-3 rounded-lg border border-slate-800 bg-slate-950/60 p-4">
            <p className="text-sm leading-relaxed text-slate-400">{info.whatItDoes}</p>
            <div>
              <p className="text-xs font-medium uppercase tracking-wide text-slate-500">You get back</p>
              <ul className="mt-1.5 space-y-1">
                {info.youGetBack.map((line) => (
                  <li key={line} className="flex gap-2 text-xs text-slate-400">
                    <span className="text-slate-600">•</span>
                    {line}
                  </li>
                ))}
              </ul>
            </div>
            {info.requires && (
              <InfoNote tone="amber">
                {info.requires}{" "}
                <button
                  onClick={() => onGo("Documents")}
                  className="underline underline-offset-2 hover:text-amber-100"
                >
                  Go to Documents
                </button>
              </InfoNote>
            )}
          </div>
        </Card>

        <Card className="space-y-5">
          <div>
            <h2 className="font-semibold">2. Give it what it needs</h2>
            <p className="mt-1 text-sm text-slate-500">{info.youProvide}</p>
          </div>

          {isGenreTask ? (
            <Field
              label="Genre"
              required
              help="Only these genres can be looked up — the film database does not recognise anything else."
            >
              <select
                value={genre}
                onChange={(e) => setGenre(e.target.value)}
                className={inputClass}
              >
                <option value="">Select a genre…</option>
                {GENRES.map((g) => (
                  <option key={g} value={g}>
                    {g}
                  </option>
                ))}
              </select>
            </Field>
          ) : (
            <Field
              label="Script excerpt"
              required
              help={`Plain text, at least ${MIN_SCRIPT_CHARS} characters. Paste dialogue and action lines directly — a summary gives a much weaker result.`}
            >
              <textarea
                value={scriptText}
                onChange={(e) => setScriptText(e.target.value)}
                placeholder={"INT. WAREHOUSE - NIGHT\n\nMAYA edges along the catwalk, torch shaking..."}
                className={`${inputClass} h-44 resize-y font-mono text-xs leading-relaxed`}
              />
              <div className="flex justify-between text-xs">
                <span className={trimmed.length < MIN_SCRIPT_CHARS ? "text-slate-600" : "text-emerald-600"}>
                  {trimmed.length} characters
                </span>
                <span className="text-slate-600">~{Math.max(1, Math.round(trimmed.length / 5))} words</span>
              </div>
            </Field>
          )}

          <div className="space-y-4 border-t border-slate-800 pt-4">
            <Field
              label="Session ID"
              help="Groups your runs so History can show them together."
              example="web-session"
            >
              <input
                value={sessionId}
                onChange={(e) => setSessionId(e.target.value)}
                className={inputClass}
              />
            </Field>

            <label className="flex cursor-pointer items-start gap-3">
              <input
                type="checkbox"
                checked={evaluate}
                onChange={(e) => setEvaluate(e.target.checked)}
                className="mt-0.5 h-4 w-4 shrink-0 accent-blue-600"
              />
              <span className="text-sm text-slate-300">
                Score this answer for faithfulness
                <Explain term="faithfulness">{GLOSSARY.evaluate}</Explain>
              </span>
            </label>
          </div>

          <div className="space-y-2">
            <PrimaryButton
              onClick={run}
              disabled={loading || validation !== null}
              loading={loading}
              className="w-full"
            >
              {loading ? "Running…" : `Run ${info.label}`}
            </PrimaryButton>
            {validation ? (
              <p className="text-center text-xs text-slate-500">{validation}</p>
            ) : (
              <p className="text-center text-xs text-slate-600">
                Takes about {info.typicalWait.split("(")[0].trim()}. Nothing is saved outside this app.
              </p>
            )}
          </div>

          {error && <ErrorAlert message={error} />}
        </Card>
      </div>

      <Card className="lg:sticky lg:top-32 lg:self-start">
        {!result && !loading && (
          <EmptyState
            title="Your answer will appear here"
            hint={`Fill in the form on the left and press Run ${info.label}. You can keep working while it thinks.`}
          />
        )}
        {loading && <BusyState what={`${info.label} is running…`} wait={info.typicalWait} />}
        {result && !loading && (
          <div className="animate-fade-in-up space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-800 pb-3">
              <div className="flex items-center gap-1 text-xs text-slate-500">
                Result #{result.result_id}
                <Explain term="result ID">{GLOSSARY.resultId}</Explain>
              </div>
              <div className="flex flex-wrap gap-2">
                {result.from_cache ? (
                  <Badge tone="amber" title={GLOSSARY.fromCache}>
                    reused earlier answer
                  </Badge>
                ) : (
                  <Badge tone="blue">newly generated</Badge>
                )}
                {result.eval?.score != null && (
                  <Badge tone="emerald" title={GLOSSARY.evaluate}>
                    faithfulness {result.eval.score}/10
                  </Badge>
                )}
              </div>
            </div>

            <p className="whitespace-pre-wrap text-sm leading-relaxed text-slate-300">{result.result}</p>

            {result.eval?.reasoning && (
              <div className="rounded-lg border border-slate-800 bg-slate-950/60 p-3">
                <p className="text-xs font-medium text-slate-400">Why it scored that</p>
                <p className="mt-1 text-xs leading-relaxed text-slate-500">{result.eval.reasoning}</p>
              </div>
            )}

            <div className="flex items-center gap-4 border-t border-slate-800 pt-3">
              <button
                onClick={handleDownload}
                disabled={downloading}
                className="inline-flex items-center gap-2 text-xs text-slate-500 transition-colors hover:text-blue-400 disabled:opacity-40"
              >
                {downloading ? <Spinner /> : null}
                Download as PDF
              </button>
              {task === "release_listing" && (
                <button
                  onClick={() => onGo("Release Planner")}
                  className="text-xs text-blue-400 transition-colors hover:text-blue-300"
                >
                  Plan a release date for this genre →
                </button>
              )}
            </div>
          </div>
        )}
      </Card>
    </div>
  );
}
