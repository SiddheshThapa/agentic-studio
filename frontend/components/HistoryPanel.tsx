// Past conversation turns, and lookup of any stored answer by its ID.
"use client";

import { useState } from "react";
import { HistoryTurn, downloadResult, getHistory, getResult } from "@/lib/api";
import {
  Badge,
  Card,
  EmptyState,
  ErrorAlert,
  Explain,
  Field,
  PanelIntro,
  PrimaryButton,
  SecondaryButton,
  Skeleton,
  errorMessage,
  inputClass,
} from "@/components/ui";
import { GLOSSARY, PANEL_COPY } from "@/lib/content";

export default function HistoryPanel() {
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

  const idIsValid = /^\d+$/.test(lookupId.trim());

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
    if (!idIsValid) return;
    setLookupLoading(true);
    setLookupError("");
    setLookupResult(null);
    try {
      const res = await getResult(Number(lookupId));
      if ("error" in res) {
        setLookupError(`No stored answer has ID ${lookupId}. IDs are shown next to every answer when it is produced.`);
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
    if (!idIsValid) return;
    setDownloading(true);
    setLookupError("");
    try {
      await downloadResult(Number(lookupId));
    } catch (err) {
      setLookupError(errorMessage(err));
    } finally {
      setDownloading(false);
    }
  }

  return (
    <div className="space-y-8">
      <PanelIntro eyebrow={PANEL_COPY.history.eyebrow} title={PANEL_COPY.history.title}>
        {PANEL_COPY.history.intro}
      </PanelIntro>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <Card className="space-y-5">
          <div>
            <h3 className="text-title font-semibold text-ink-50">{PANEL_COPY.sectionHistory}</h3>
            <p className="mt-1.5 text-label leading-relaxed text-ink-400">
              Everything run under one session ID
              <Explain term="session ID">{GLOSSARY.sessionId}</Explain>
            </p>
          </div>

        <Field
          label="Session ID"
          help="Use the same value you ran the agents under. If you never changed it, it is web-session."
        >
          <div className="flex gap-2">
            <input
              value={sessionId}
              onChange={(e) => setSessionId(e.target.value)}
              className={inputClass}
              placeholder="web-session"
            />
            <PrimaryButton onClick={loadHistory} disabled={historyLoading} loading={historyLoading}>
              Load
            </PrimaryButton>
          </div>
        </Field>

        {historyError && <ErrorAlert message={historyError} />}

        {!historyLoaded && !historyError && (
          <EmptyState
            title="Nothing loaded yet"
            hint="Enter a session ID and press Load to see the runs recorded under it."
          />
        )}

        {historyLoaded && history.length === 0 && !historyError && (
          <EmptyState
            title={`No history under "${sessionId}"`}
            hint="Either nothing has been run with this session ID, or it was spelled differently. Session IDs are case sensitive."
          />
        )}

        {history.length > 0 && (
          <div className="max-h-96 space-y-2.5 overflow-y-auto pr-1">
            {history.map((h, i) => (
              <div
                key={i}
                style={{ "--i": Math.min(i, 8) } as React.CSSProperties}
                className="stagger flex gap-3 rounded-[var(--radius-control)] border border-white/5 bg-white/[0.02] p-3"
              >
                <span
                  className={`h-fit shrink-0 rounded-full border px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide ${
                    h.role === "user"
                      ? "border-white/10 bg-white/5 text-ink-300"
                      : "border-iris-400/25 bg-iris-400/10 text-iris-200"
                  }`}
                >
                  {h.role === "user" ? "you" : "agent"}
                </span>
                <span className="min-w-0 break-words text-label leading-relaxed text-ink-300">
                  {h.content}
                </span>
              </div>
            ))}
          </div>
        )}
        </Card>

        <Card className="space-y-5">
          <div>
            <h3 className="text-title font-semibold text-ink-50">{PANEL_COPY.sectionLookup}</h3>
            <p className="mt-1.5 text-label leading-relaxed text-ink-400">
              Every answer gets a number when it is produced. Enter it here to read it again or save it
              as a PDF.
            </p>
          </div>

        <Field label="Result ID" help="Digits only — the number shown as “Result #42” next to an answer." example="42">
          <div className="flex gap-2">
            <input
              value={lookupId}
              onChange={(e) => setLookupId(e.target.value)}
              placeholder="42"
              inputMode="numeric"
              className={inputClass}
            />
            <PrimaryButton onClick={loadResult} disabled={!idIsValid || lookupLoading} loading={lookupLoading}>
              Fetch
            </PrimaryButton>
          </div>
        </Field>

        {lookupId && !idIsValid && (
            <p className="text-xs text-amber-300">Result IDs are plain numbers, like 42.</p>
          )}
          {lookupError && <ErrorAlert message={lookupError} />}

          {/* Fetching shows the shape of the answer that is coming, not a spinner
              in an empty box — the panel does not resize when it lands. */}
          {lookupLoading && (
            <div className="space-y-2.5">
              <Skeleton className="h-6 w-24" />
              <Skeleton className="h-3 w-full" />
              <Skeleton className="h-3 w-11/12" />
              <Skeleton className="h-3 w-4/5" />
            </div>
          )}

          {!lookupResult && !lookupError && !lookupLoading && (
            <EmptyState
              title="No answer loaded"
              hint="Enter the number shown beside an answer on the Agents tab to pull it back up."
            />
          )}

          {lookupResult && !lookupLoading && (
            <div className="animate-fade-in-up space-y-3.5">
              <Badge tone="blue">{lookupResult.task}</Badge>
              <p className="max-h-64 overflow-y-auto whitespace-pre-wrap text-body text-ink-200">
                {lookupResult.result}
              </p>
              <SecondaryButton onClick={handleDownload} disabled={downloading} loading={downloading}>
                Download as PDF
              </SecondaryButton>
            </div>
          )}
        </Card>
      </div>
    </div>
  );
}
