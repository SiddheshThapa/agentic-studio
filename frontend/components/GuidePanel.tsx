// First tab a new user lands on: what this tool is, and the order to do things in.
"use client";

import { Card, InfoNote } from "@/components/ui";
import { GLOSSARY, MAX_UPLOAD_MB } from "@/lib/content";

const WORKFLOW = [
  {
    n: 1,
    tab: "Documents",
    title: "Upload what the studio knows",
    body: "Upload your compliance guidelines and past-film write-ups as PDFs. The agents search these documents to ground their answers in your studio's actual rules rather than generic AI opinion.",
    optional: "Skip this and the agents still run, but Compliance Check will have no guidelines to cite.",
  },
  {
    n: 2,
    tab: "Agents",
    title: "Ask an agent about a script",
    body: "Paste a section of script and pick a task. Compliance Check finds moments needing legal review. Script Analysis scores the writing and gives a greenlight verdict.",
    optional: null,
  },
  {
    n: 3,
    tab: "Release Planner",
    title: "Plan a release date",
    body: "A guided four-step flow: pick a genre, propose a date, let the agents check it against competing films, public holidays, and major events, then create the calendar entries.",
    optional: null,
  },
  {
    n: 4,
    tab: "History",
    title: "Find an earlier answer",
    body: "Every answer is stored with an ID. Look one up again here, or download it as a PDF to share.",
    optional: null,
  },
];

export default function GuidePanel({ onGo }: { onGo: (tab: string) => void }) {
  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <Card className="space-y-4">
        <div className="space-y-2">
          <h2 className="text-xl font-semibold">What this tool does</h2>
          <p className="text-sm leading-relaxed text-slate-400">
            Agentic Studio is an assistant for film studio operations. It reads scripts against your
            studio&apos;s own guidelines, and it plans release dates around films, holidays, and events that
            would compete for the same audience.
          </p>
          <p className="text-sm leading-relaxed text-slate-400">
            The answers come from AI agents that first search your uploaded documents, so they cite your
            material instead of guessing. Nothing is created in the outside world until you explicitly
            confirm it — the one exception is the final step of the Release Planner, which writes real
            events to a shared Google Calendar.
          </p>
        </div>
      </Card>

      <div className="space-y-3">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500">
          Suggested order
        </h2>
        {WORKFLOW.map((step) => (
          <Card key={step.n} className="!p-5">
            <div className="flex gap-4">
              <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-slate-700 bg-slate-950 text-sm font-semibold text-slate-400">
                {step.n}
              </div>
              <div className="min-w-0 flex-1 space-y-1.5">
                <div className="flex flex-wrap items-baseline gap-2">
                  <h3 className="font-medium text-slate-100">{step.title}</h3>
                  <button
                    onClick={() => onGo(step.tab)}
                    className="rounded-full border border-slate-800 px-2 py-0.5 text-xs text-slate-500 transition-colors hover:border-blue-700 hover:text-blue-400"
                  >
                    open {step.tab} →
                  </button>
                </div>
                <p className="text-sm leading-relaxed text-slate-400">{step.body}</p>
                {step.optional && <p className="text-xs text-slate-600">{step.optional}</p>}
              </div>
            </div>
          </Card>
        ))}
      </div>

      <Card className="space-y-3">
        <h2 className="font-semibold">Words this app uses</h2>
        <dl className="space-y-3 text-sm">
          {[
            ["Chunk", GLOSSARY.chunks],
            ["Collection", GLOSSARY.collections],
            ["Session ID", GLOSSARY.sessionId],
            ["Faithfulness score", GLOSSARY.evaluate],
            ["Result ID", GLOSSARY.resultId],
          ].map(([term, def]) => (
            <div key={term}>
              <dt className="font-medium text-slate-300">{term}</dt>
              <dd className="mt-0.5 text-xs leading-relaxed text-slate-500">{def}</dd>
            </div>
          ))}
        </dl>
      </Card>

      <InfoNote>
        Good to know: uploads are capped at {MAX_UPLOAD_MB}MB and must be PDFs. If the status badge in
        the header says <span className="text-red-400">system offline</span>, the backend is not running —
        start it before using any tab.
      </InfoNote>
    </div>
  );
}
