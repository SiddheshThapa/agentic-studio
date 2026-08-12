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
  PrimaryButton,
  Spinner,
  errorMessage,
  inputClass,
} from "@/components/ui";
import { GLOSSARY } from "@/lib/content";

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
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
      <Card className="space-y-5">
        <div>
          <h2 className="font-semibold">Conversation history</h2>
          <p className="mt-1 text-sm text-slate-500">
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
          <div className="max-h-96 space-y-2 overflow-y-auto pr-1">
            {history.map((h, i) => (
              <div key={i} className="animate-fade-in-up flex gap-3 border-b border-slate-800/60 pb-2">
                <span
                  className={`h-fit shrink-0 rounded-full px-2 py-0.5 text-xs ${
                    h.role === "user" ? "bg-blue-950 text-blue-400" : "bg-violet-950 text-violet-400"
                  }`}
                >
                  {h.role === "user" ? "you" : "agent"}
                </span>
                <span className="min-w-0 break-words text-sm text-slate-400">{h.content}</span>
              </div>
            ))}
          </div>
        )}
      </Card>

      <Card className="space-y-5">
        <div>
          <h2 className="font-semibold">Look up a saved answer</h2>
          <p className="mt-1 text-sm text-slate-500">
            Every answer gets a number when it is produced. Enter it here to read it again or save it as
            a PDF.
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
          <p className="text-xs text-amber-400">Result IDs are plain numbers, like 42.</p>
        )}
        {lookupError && <ErrorAlert message={lookupError} />}

        {!lookupResult && !lookupError && (
          <EmptyState
            title="No answer loaded"
            hint="Enter the number shown beside an answer on the Agents tab to pull it back up."
          />
        )}

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
