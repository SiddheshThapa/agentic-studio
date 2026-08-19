// Aggregate faithfulness scores across every evaluated run.
"use client";

import { useEffect, useState } from "react";
import { EvalSummary, getEvalChart, getEvalSummary } from "@/lib/api";
import {
  Card,
  EmptyState,
  ErrorAlert,
  InfoNote,
  PanelIntro,
  SecondaryButton,
  Skeleton,
  Stat,
  errorMessage,
} from "@/components/ui";
import { GLOSSARY, PANEL_COPY } from "@/lib/content";

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
    <div className="mx-auto max-w-3xl space-y-8">
      <PanelIntro
        eyebrow={PANEL_COPY.insights.eyebrow}
        title={PANEL_COPY.insights.title}
        action={
          <SecondaryButton onClick={load} disabled={loading} loading={loading}>
            Refresh
          </SecondaryButton>
        }
      >
        {PANEL_COPY.insights.intro}
      </PanelIntro>

      <InfoNote>{GLOSSARY.faithfulness}</InfoNote>

      {error && <ErrorAlert message={error} />}

      {/* Loading gets the real layout in skeleton form: two tiles and a chart
          block, so nothing moves when the numbers arrive. */}
      {loading && !summary && (
        <div className="space-y-4">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Skeleton className="h-32" />
            <Skeleton className="h-32" />
          </div>
          <Card className="space-y-3">
            <p className="text-micro font-medium uppercase text-ink-500">
              {PANEL_COPY.loadingChart}
            </p>
            <Skeleton className="h-48 w-full" />
          </Card>
        </div>
      )}

      {!hasData && !loading && !error ? (
        <Card>
          <EmptyState
            title="No scores recorded yet"
            hint="Scores appear here once you run an agent with “Score this answer for faithfulness” ticked. Each run adds one point to the chart."
            action={
              <SecondaryButton tone="accent" onClick={() => onGo("Agents")}>
                Go to Agents →
              </SecondaryButton>
            }
          />
        </Card>
      ) : (
        hasData && (
          <>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <Stat
                label="Average faithfulness"
                value={summary?.average_faithfulness ?? "—"}
                suffix={summary?.average_faithfulness != null ? "/ 10" : undefined}
                tone={
                  summary?.average_faithfulness == null
                    ? "neutral"
                    : summary.average_faithfulness >= 8
                    ? "good"
                    : summary.average_faithfulness >= 5
                    ? "mixed"
                    : "poor"
                }
                reading={
                  summary?.average_faithfulness == null
                    ? "No scores could be parsed yet."
                    : summary.average_faithfulness >= 8
                    ? "Answers have stayed closely tied to the source material."
                    : summary.average_faithfulness >= 5
                    ? "Mixed — some answers drifted from what the source supported."
                    : "Low. Answers have often claimed more than the source backs up."
                }
              />
              <Stat
                label="Evaluated runs"
                value={summary?.count ?? 0}
                reading="Only runs with evaluation switched on are counted here."
              />
            </div>

            <Card className="space-y-3">
              <div>
                <p className="text-micro font-medium uppercase text-ink-500">
                  {PANEL_COPY.sectionChart}
                </p>
                <p className="mt-2 text-label leading-relaxed text-ink-400">
                  Each point is one evaluated run, oldest first. A downward trend usually means the
                  knowledge base is missing documents for the questions being asked.
                </p>
              </div>
              {chart ? (
                <div className="overflow-hidden rounded-[var(--radius-control)] border border-white/8 bg-ink-950/40 p-2">
                  {/* eslint-disable-next-line @next/next/no-img-element -- dynamic base64 data URI, not a static asset */}
                  <img
                    src={`data:image/png;base64,${chart}`}
                    alt="Faithfulness score for each evaluated run, oldest first"
                    className="w-full rounded-md"
                  />
                </div>
              ) : (
                <p className="rounded-[var(--radius-control)] border border-dashed border-white/10 px-4 py-8 text-center text-label text-ink-500">
                  No chart yet — it appears after the first scored run.
                </p>
              )}
            </Card>
          </>
        )
      )}
    </div>
  );
}
