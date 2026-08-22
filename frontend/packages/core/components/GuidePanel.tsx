// First tab a new user lands on: what this tool is, and the order to do things in.
"use client";

import { useSyncExternalStore } from "react";
import { Card, InfoNote, PrimaryButton } from "@/components/ui";
import {
  DEMO_COPY,
  GLOSSARY,
  MAX_UPLOAD_MB,
  PANEL_COPY,
  WALKTHROUGHS,
  WALKTHROUGH_COPY,
} from "@/lib/content";
import {
  getWalkthroughServerSnapshot,
  getWalkthroughSnapshot,
  startWalkthrough,
  subscribeDemo,
  type WalkthroughId,
} from "@/lib/demo";

/** Order shown on the launcher: the four single-shot agents, then the multi-step flow. */
const WALKTHROUGH_ORDER: WalkthroughId[] = [
  "compliance",
  "analyze",
  "greenlight",
  "release_listing",
  "release_planner",
];

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
    body: "Paste a section of script and pick a task. Compliance Check finds moments needing legal review, Script Analysis scores the writing, and Greenlight Committee runs a full producer-vs-executive debate to a GREEN/YELLOW/RED verdict.",
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
  // Which walkthrough is running, so a card can show "in progress". Read from the
  // module store rather than an effect — same pattern as the Demo Mode flag.
  const running = useSyncExternalStore(
    subscribeDemo,
    getWalkthroughSnapshot,
    getWalkthroughServerSnapshot
  );

  return (
    <div className="mx-auto max-w-3xl space-y-10">
      {/* The one place in the app that gets display type: it is the first screen a
          new user sees, and it has one job — say what this is. */}
      <header className="space-y-4 pt-2">
        <p className="text-micro font-medium uppercase text-iris-300/80">{PANEL_COPY.guide.eyebrow}</p>
        <h2 className="text-display text-gradient max-w-xl text-balance">{PANEL_COPY.guide.title}</h2>
        <p className="max-w-2xl text-body text-ink-300">{PANEL_COPY.guide.intro}</p>
        <p className="max-w-2xl text-label leading-relaxed text-ink-400">
          The answers come from AI agents that first search your uploaded documents, so they cite your
          material instead of guessing. Nothing is created in the outside world until you explicitly
          confirm it — the one exception is the final step of the Release Planner, which writes real
          events to a shared Google Calendar.
        </p>
      </header>

      <Card className="space-y-5">
        <div className="space-y-2">
          <h3 className="text-title font-semibold text-ink-50">{WALKTHROUGH_COPY.launcherTitle}</h3>
          <p className="text-label leading-relaxed text-ink-400">{WALKTHROUGH_COPY.launcherBody}</p>
        </div>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {WALKTHROUGH_ORDER.map((id, i) => {
            const flow = WALKTHROUGHS[id];
            const active = running === id;
            return (
              <div
                key={id}
                style={{ "--i": i } as React.CSSProperties}
                className={`stagger surface-interactive flex flex-col gap-2.5 rounded-[var(--radius-control)] border p-4 ${
                  active
                    ? "border-amber-400/35 bg-amber-400/[0.07]"
                    : "border-white/8 bg-white/[0.02]"
                }`}
              >
                <div className="flex items-start justify-between gap-2">
                  <h4 className="text-label font-medium text-ink-50">{flow.label}</h4>
                  {active && (
                    <span className="shrink-0 rounded-full border border-amber-400/30 bg-amber-400/10 px-2 py-0.5 text-[10px] text-amber-300">
                      {WALKTHROUGH_COPY.running}
                    </span>
                  )}
                </div>
                <p className="flex-1 text-xs leading-relaxed text-ink-400">{flow.tagline}</p>
                <p className="text-[11px] text-ink-500">{flow.length}</p>
                <PrimaryButton
                  onClick={() => startWalkthrough(id)}
                  title={WALKTHROUGH_COPY.demoNote}
                  tone={active ? "violet" : "blue"}
                  className="w-full"
                >
                  {active ? "Restart walkthrough" : WALKTHROUGH_COPY.launcherCta}
                </PrimaryButton>
              </div>
            );
          })}
        </div>

        <InfoNote tone="amber">
          {WALKTHROUGH_COPY.demoNote}. {DEMO_COPY.toggleHint}
        </InfoNote>
      </Card>

      <div className="space-y-3">
        <h3 className="text-micro font-medium uppercase text-ink-500">Suggested order</h3>
        {WORKFLOW.map((step, i) => (
          <Card
            key={step.n}
            style={{ "--i": i } as React.CSSProperties}
            className="stagger surface-interactive !p-5"
          >
            <div className="flex gap-4">
              {/* Numerals sized against the heading rather than the body — the
                  sequence is the point of this list. */}
              <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-white/8 bg-white/[0.03] text-label font-semibold text-ink-300">
                {step.n}
              </div>
              <div className="min-w-0 flex-1 space-y-1.5">
                <div className="flex flex-wrap items-baseline gap-2.5">
                  <h4 className="text-title font-semibold text-ink-50">{step.title}</h4>
                  <button
                    onClick={() => onGo(step.tab)}
                    className="press rounded-full border border-white/8 px-2.5 py-1 text-xs text-ink-400 hover:border-iris-400/50 hover:text-iris-300"
                  >
                    open {step.tab} →
                  </button>
                </div>
                <p className="text-label leading-relaxed text-ink-300">{step.body}</p>
                {step.optional && <p className="text-xs text-ink-500">{step.optional}</p>}
              </div>
            </div>
          </Card>
        ))}
      </div>

      <Card className="space-y-4">
        <h3 className="text-title font-semibold text-ink-50">Words this app uses</h3>
        <dl className="divide-y divide-white/5">
          {[
            ["Chunk", GLOSSARY.chunks],
            ["Collection", GLOSSARY.collections],
            ["Session ID", GLOSSARY.sessionId],
            ["Faithfulness score", GLOSSARY.evaluate],
            ["Result ID", GLOSSARY.resultId],
          ].map(([term, def]) => (
            <div key={term} className="py-3 first:pt-0 last:pb-0">
              <dt className="text-label font-medium text-ink-100">{term}</dt>
              <dd className="mt-1 text-xs leading-relaxed text-ink-400">{def}</dd>
            </div>
          ))}
        </dl>
      </Card>

      <InfoNote>
        Good to know: uploads are capped at {MAX_UPLOAD_MB}MB and must be PDFs. If the status badge in
        the header says <span className="text-red-300">backend not reachable</span>, the backend is not
        running — start it before using any tab.
      </InfoNote>
    </div>
  );
}
