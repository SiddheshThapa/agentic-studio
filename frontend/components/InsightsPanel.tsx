// Aggregate faithfulness scores across every evaluated run.
"use client";

import { useEffect, useState } from "react";
import { EvalSummary, getEvalChart, getEvalSummary } from "@/lib/api";
import { Card, EmptyState, ErrorAlert, Spinner, errorMessage } from "@/components/ui";
import { GLOSSARY } from "@/lib/content";

export default function InsightsPanel({ onGo }: { onGo: (tab: string) => void }) {
  const [summary, setSummary] = useState<EvalSummary | null>(null);
  const [chart, setChart] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  // Initial fetch. Written inline rather than as a shared helper so the linter can
  // see that every setState happens after an await, not synchronously on mount.
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

  async function load() {
    setLoading(true);
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

  const hasData = (summary?.count ?? 0) > 0;

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <Card className="space-y-2">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 className="font-semibold">How trustworthy have the answers been?</h2>
            <p className="mt-1 text-sm leading-relaxed text-slate-400">{GLOSSARY.faithfulness}</p>
          </div>
          <button
            onClick={load}
            disabled={loading}
            className="inline-flex shrink-0 items-center gap-2 text-xs text-slate-500 transition-colors hover:text-blue-400 disabled:opacity-40"
          >
            {loading && <Spinner />}
            Refresh
          </button>
        </div>
      </Card>

      {error && <ErrorAlert message={error} />}

      {!hasData && !loading && !error ? (
        <Card>
          <EmptyState
            title="No scores recorded yet"
            hint="Scores appear here once you run an agent with “Score this answer for faithfulness” ticked. Each run adds one point to the chart."
          />
          <div className="flex justify-center pb-4">
            <button
              onClick={() => onGo("Agents")}
              className="text-xs text-blue-400 transition-colors hover:text-blue-300"
            >
              Go to Agents →
            </button>
          </div>
        </Card>
      ) : (
        <>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Card>
              <p className="text-xs uppercase tracking-wide text-slate-500">Average faithfulness</p>
              <p className="mt-1 text-3xl font-bold">
                {summary?.average_faithfulness ?? "—"}
                {summary?.average_faithfulness != null && (
                  <span className="ml-1 text-base font-normal text-slate-600">/ 10</span>
                )}
              </p>
              <p className="mt-2 text-xs text-slate-600">
                {summary?.average_faithfulness == null
                  ? "No scores could be parsed yet."
                  : summary.average_faithfulness >= 8
                  ? "Answers have stayed closely tied to the source material."
                  : summary.average_faithfulness >= 5
                  ? "Mixed — some answers drifted from what the source supported."
                  : "Low. Answers have often claimed more than the source backs up."}
              </p>
            </Card>
            <Card>
              <p className="text-xs uppercase tracking-wide text-slate-500">Evaluated runs</p>
              <p className="mt-1 text-3xl font-bold">{summary?.count ?? 0}</p>
              <p className="mt-2 text-xs text-slate-600">
                Only runs with evaluation switched on are counted here.
              </p>
            </Card>
          </div>

          <Card>
            <p className="mb-1 text-xs uppercase tracking-wide text-slate-500">Score over time</p>
            <p className="mb-4 text-xs text-slate-600">
              Each point is one evaluated run, oldest first. A downward trend usually means the
              knowledge base is missing documents for the questions being asked.
            </p>
            {chart ? (
              // eslint-disable-next-line @next/next/no-img-element -- dynamic base64 data URI, not a static asset
              <img
                src={`data:image/png;base64,${chart}`}
                alt="Faithfulness score for each evaluated run, oldest first"
                className="w-full rounded-lg"
              />
            ) : (
              <p className="text-sm text-slate-600">No chart yet — it appears after the first scored run.</p>
            )}
          </Card>
        </>
      )}
    </div>
  );
}
