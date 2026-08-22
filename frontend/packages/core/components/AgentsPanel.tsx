// Script-facing agents: Compliance Check, Script Analysis, Browse Releases,
// Greenlight Committee. The release-date workflow lives in ReleasePlanner.tsx
// because it is multi-step.
"use client";

import { useState } from "react";
import { AgentResponse, downloadResult, GreenlightVerdict, parseGreenlightVerdict, runAgent } from "@/lib/api";
import {
  Badge,
  BusyState,
  Card,
  EmptyState,
  ErrorAlert,
  Explain,
  Field,
  InfoNote,
  PanelIntro,
  PrimaryButton,
  SecondaryButton,
  errorMessage,
  inputClass,
} from "@/components/ui";
import { GENRES, GLOSSARY, MIN_SCRIPT_CHARS, PANEL_COPY, TASK_INFO } from "@/lib/content";

type ScriptTask = "compliance" | "analyze" | "release_listing" | "greenlight";

const VERDICT_TONE = { GREEN: "emerald", YELLOW: "amber", RED: "red" } as const;

/** The greenlight task answers with a JSON verdict, not prose — everything else
 * on this panel renders `result.result` directly, so this is its own view. */
function GreenlightResultView({ verdict }: { verdict: GreenlightVerdict }) {
  const fields = verdict.pitch.pitch_fields;
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <Badge tone={VERDICT_TONE[verdict.verdict.status]}>{verdict.verdict.status}</Badge>
        <Badge tone={verdict.review.is_approved ? "emerald" : "slate"}>
          {verdict.review.is_approved ? "executive approved" : "executive did not approve"}
        </Badge>
      </div>
      <p className="text-body text-ink-200">{verdict.verdict.message}</p>

      {fields.title_concept && (
        <div className="rounded-[var(--radius-control)] border border-white/8 bg-white/[0.02] p-3.5">
          <p className="text-micro font-medium uppercase text-ink-500">The pitch</p>
          <p className="mt-1.5 text-label text-ink-200">{fields.title_concept}</p>
          <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-ink-400">
            {fields.target_demographic && <span>Audience: {fields.target_demographic}</span>}
            {fields.budget_tier && <span>Budget: {fields.budget_tier}</span>}
            {fields.proposed_release_date && <span>Proposed date: {fields.proposed_release_date}</span>}
          </div>
          {fields.strengths && fields.strengths.length > 0 && (
            <ul className="mt-2 space-y-1">
              {fields.strengths.map((s) => (
                <li key={s} className="flex gap-2 text-xs leading-relaxed text-ink-300">
                  <span className="mt-1.5 h-1 w-1 shrink-0 rounded-full bg-iris-400/70" />
                  {s}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {verdict.review.concern_list.length > 0 && (
        <InfoNote tone="amber">
          <span className="font-medium">Executive concerns: </span>
          {verdict.review.concern_list.join("; ")}
        </InfoNote>
      )}

      <details className="group rounded-[var(--radius-control)] border border-white/8 bg-white/[0.02] p-3.5">
        <summary className="cursor-pointer text-micro font-medium uppercase text-ink-500">
          Debate trace ({verdict.trace.length} steps)
        </summary>
        <ol className="mt-2.5 space-y-1.5">
          {verdict.trace.map((step, i) => (
            <li key={i} className="flex gap-2.5 text-xs leading-relaxed text-ink-300">
              <span className="mt-0.5 shrink-0 text-ink-500">{i + 1}.</span>
              {step}
            </li>
          ))}
        </ol>
      </details>
    </div>
  );
}

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
    <div className="space-y-8">
      <PanelIntro eyebrow={PANEL_COPY.agents.eyebrow} title={PANEL_COPY.agents.title}>
        {PANEL_COPY.agents.intro}
      </PanelIntro>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <div className="space-y-6">
          <Card className="space-y-5">
            <div className="flex items-baseline gap-2.5">
              <span className="text-micro font-medium text-iris-300/70">01</span>
              <h3 className="text-title font-semibold text-ink-50">{PANEL_COPY.sectionChoose}</h3>
            </div>

            {/* Selected task is the only iris surface on this side of the screen,
                so what you are about to run is never ambiguous. */}
            <div className="space-y-2">
              {(Object.keys(TASK_INFO) as ScriptTask[]).map((key) => {
                const t = TASK_INFO[key];
                const active = task === key;
                return (
                  <button
                    key={key}
                    onClick={() => switchTask(key)}
                    aria-pressed={active}
                    className={`press w-full rounded-[var(--radius-control)] border px-4 py-3.5 text-left ${
                      active
                        ? "border-iris-400/50 bg-iris-400/10 shadow-[0_0_24px_-8px_rgb(47_217_196/0.55)]"
                        : "border-white/8 bg-white/[0.02] hover:border-white/15"
                    }`}
                  >
                    <div
                      className={`text-label font-medium ${active ? "text-iris-100" : "text-ink-200"}`}
                    >
                      {t.label}
                    </div>
                    <div className="mt-0.5 text-xs text-ink-400">{t.tagline}</div>
                  </button>
                );
              })}
            </div>

            <div className="space-y-3.5 rounded-[var(--radius-control)] border border-white/8 bg-white/[0.02] p-4">
              <p className="text-label leading-relaxed text-ink-300">{info.whatItDoes}</p>
              <div>
                <p className="text-micro font-medium uppercase text-ink-500">You get back</p>
                <ul className="mt-2 space-y-1.5">
                  {info.youGetBack.map((line) => (
                    <li key={line} className="flex gap-2.5 text-xs leading-relaxed text-ink-300">
                      <span className="mt-1.5 h-1 w-1 shrink-0 rounded-full bg-iris-400/70" />
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
                    className="font-medium underline underline-offset-2 hover:text-amber-100"
                  >
                    Go to Documents
                  </button>
                </InfoNote>
              )}
            </div>
          </Card>

          <Card className="space-y-5">
            <div className="flex items-baseline gap-2.5">
              <span className="text-micro font-medium text-iris-300/70">02</span>
              <div>
                <h3 className="text-title font-semibold text-ink-50">{PANEL_COPY.sectionProvide}</h3>
                <p className="mt-1 text-label leading-relaxed text-ink-400">{info.youProvide}</p>
              </div>
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
              {/* The live count is the only feedback before submitting, so it
                  earns a filling bar rather than only a number. */}
              <div className="space-y-1.5">
                <div className="h-0.5 overflow-hidden rounded-full bg-white/8">
                  <div
                    className="h-full rounded-full bg-iris-400 transition-[width,background-color] duration-[var(--duration-base)] ease-[var(--ease-out-quint)]"
                    style={{
                      width: `${Math.min(100, (trimmed.length / MIN_SCRIPT_CHARS) * 100)}%`,
                      backgroundColor:
                        trimmed.length >= MIN_SCRIPT_CHARS ? "var(--color-emerald-400)" : undefined,
                    }}
                  />
                </div>
                <div className="flex justify-between text-xs">
                  <span
                    className={trimmed.length < MIN_SCRIPT_CHARS ? "text-ink-500" : "text-emerald-400"}
                  >
                    {trimmed.length} characters
                  </span>
                  <span className="text-ink-500">
                    ~{Math.max(1, Math.round(trimmed.length / 5))} words
                  </span>
                </div>
              </div>
            </Field>
          )}

          <div className="space-y-4 border-t border-white/5 pt-5">
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

            <label className="press flex cursor-pointer items-start gap-3 rounded-[var(--radius-control)] border border-white/8 bg-white/[0.02] p-3 hover:border-white/15">
              <input
                type="checkbox"
                checked={evaluate}
                onChange={(e) => setEvaluate(e.target.checked)}
                className="mt-0.5 h-4 w-4 shrink-0 accent-iris-500"
              />
              <span className="text-label text-ink-200">
                Score this answer for faithfulness
                <Explain term="faithfulness">{GLOSSARY.evaluate}</Explain>
              </span>
            </label>
          </div>

          <div className="space-y-2.5">
            <PrimaryButton
              onClick={run}
              disabled={loading || validation !== null}
              loading={loading}
              className="w-full"
            >
              {loading ? "Running…" : `Run ${info.label}`}
            </PrimaryButton>
            {validation ? (
              <p className="text-center text-xs text-amber-300/80">{validation}</p>
            ) : (
              <p className="text-center text-xs text-ink-500">
                Takes about {info.typicalWait.split("(")[0].trim()}. Nothing is saved outside this app.
              </p>
            )}
          </div>

          {error && <ErrorAlert message={error} />}
        </Card>
      </div>

      <Card className="lg:sticky lg:top-36 lg:self-start">
        {!result && !loading && (
          <EmptyState
            title="Your answer will appear here"
            hint={`Fill in the form on the left and press Run ${info.label}. You can keep working while it thinks.`}
          />
        )}
        {loading && <BusyState what={`${info.label} is running…`} wait={info.typicalWait} />}
        {result && !loading && (
          <div className="animate-fade-in-up space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-white/5 pb-3.5">
              <div className="flex items-center gap-1 font-mono text-xs text-ink-400">
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

            {task === "greenlight" && parseGreenlightVerdict(result.result) ? (
              <GreenlightResultView verdict={parseGreenlightVerdict(result.result)!} />
            ) : (
              <p className="whitespace-pre-wrap text-body text-ink-200">{result.result}</p>
            )}

            {result.eval?.reasoning && (
              <div className="rounded-[var(--radius-control)] border border-white/8 bg-white/[0.02] p-3.5">
                <p className="text-micro font-medium uppercase text-ink-500">Why it scored that</p>
                <p className="mt-1.5 text-xs leading-relaxed text-ink-400">{result.eval.reasoning}</p>
              </div>
            )}

            <div className="flex flex-wrap items-center gap-2 border-t border-white/5 pt-4">
              <SecondaryButton onClick={handleDownload} disabled={downloading} loading={downloading}>
                Download as PDF
              </SecondaryButton>
              {task === "release_listing" && (
                <SecondaryButton tone="accent" onClick={() => onGo("Release Planner")}>
                  Plan a release date →
                </SecondaryButton>
              )}
            </div>
          </div>
        )}
        </Card>
      </div>
    </div>
  );
}
