// The guided-walkthrough dock. Renders one step of one pipeline at a time.
//
// Deliberately not a modal: no backdrop, no focus trap, fixed to a corner. The tab
// underneath stays fully usable, which is the point — the user is meant to work the
// real controls while this narrates them.
//
// It renders nothing itself about *what* to do; every sentence and every visual spec
// comes from WALKTHROUGHS in lib/content.ts. app/page.tsx mounts it outside the
// container it keys on Demo Mode, so switching modes cannot unmount it mid-step.
"use client";

import { useState } from "react";
import {
  PLANNER_STEPS,
  WALKTHROUGHS,
  WALKTHROUGH_COPY,
  type StepVisual,
} from "@/lib/content";
import { stopWalkthrough, type WalkthroughId } from "@/lib/demo";

// ---- Visual aids ---------------------------------------------------------

function Arrow({ direction = "right" }: { direction?: "right" | "down" }) {
  return (
    <svg
      viewBox="0 0 24 12"
      aria-hidden
      className={`shrink-0 text-amber-400 ${direction === "right" ? "h-3 w-6" : "h-3 w-6 rotate-90"}`}
    >
      <path
        d="M1 6h17M14 1.5 18.5 6 14 10.5"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

/** Screenshot-ish frame, so a mock control reads as "a bit of the app" and not as decoration. */
function Frame({ children }: { children: React.ReactNode }) {
  return (
    <div className="rounded-lg border border-slate-800 bg-slate-950 p-2.5">
      <div className="mb-2 flex gap-1" aria-hidden>
        <span className="h-1 w-1 rounded-full bg-slate-700" />
        <span className="h-1 w-1 rounded-full bg-slate-700" />
        <span className="h-1 w-1 rounded-full bg-slate-700" />
      </div>
      {children}
    </div>
  );
}

function Caption({ children }: { children: React.ReactNode }) {
  return <p className="mt-2 text-[11px] leading-relaxed text-amber-300/80">▲ {children}</p>;
}

/** The ring that says "this one". Applied to whichever mock the step points at. */
const HIGHLIGHT = "rounded-lg ring-2 ring-amber-400/80 ring-offset-2 ring-offset-slate-950";

function MockControl({ visual }: { visual: Extract<StepVisual, { kind: "control" }> }) {
  const { control, label, value } = visual;

  if (control === "tab") {
    return (
      <div className="flex items-end gap-2 text-xs">
        <span className="h-1.5 w-8 rounded-full bg-slate-800" aria-hidden />
        <span className={`${HIGHLIGHT} border-b-2 border-blue-500 px-2 pb-1 font-medium text-white`}>
          {label}
        </span>
        <span className="h-1.5 w-6 rounded-full bg-slate-800" aria-hidden />
        <span className="h-1.5 w-10 rounded-full bg-slate-800" aria-hidden />
      </div>
    );
  }

  if (control === "toggle") {
    return (
      <div className={`${HIGHLIGHT} inline-flex items-center gap-2 rounded-full border border-amber-700 bg-amber-950/50 px-3 py-1.5 text-xs text-amber-300`}>
        <span className="relative h-3.5 w-6 rounded-full bg-amber-500">
          <span className="absolute left-3 top-0.5 h-2.5 w-2.5 rounded-full bg-slate-950" />
        </span>
        {label}
        {value && <span className="text-amber-500/70">· {value}</span>}
      </div>
    );
  }

  if (control === "checkbox") {
    const ticked = value !== "cleared";
    return (
      <div className={`${HIGHLIGHT} flex items-start gap-2 p-1`}>
        <span
          className={`mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded border text-[10px] ${
            ticked ? "border-blue-500 bg-blue-600 text-white" : "border-slate-700 bg-slate-950 text-transparent"
          }`}
        >
          ✓
        </span>
        <span className="text-xs leading-snug text-slate-300">{label}</span>
      </div>
    );
  }

  if (control === "button") {
    return (
      <div className={`${HIGHLIGHT} rounded-lg border border-blue-600 bg-blue-950/40 px-3 py-2`}>
        <p className="text-xs font-medium text-blue-200">{label}</p>
        {value && <p className="mt-0.5 text-[11px] leading-snug text-slate-400">{value}</p>}
      </div>
    );
  }

  // select / input / date / textarea all render as a labelled box.
  return (
    <div className="space-y-1">
      <p className="text-[11px] font-medium text-slate-300">{label}</p>
      <div
        className={`${HIGHLIGHT} flex items-start justify-between gap-2 rounded-lg border border-slate-800 bg-slate-950 px-2.5 py-2`}
      >
        <span
          className={`text-[11px] ${value ? "text-slate-200" : "text-slate-600"} ${
            control === "textarea" ? "whitespace-pre-line font-mono leading-relaxed" : ""
          }`}
        >
          {value ?? "empty"}
        </span>
        {control === "select" && <span className="text-slate-500">▾</span>}
        {control === "date" && <span className="text-slate-500">📅</span>}
      </div>
    </div>
  );
}

function BeforeAfter({ visual }: { visual: Extract<StepVisual, { kind: "beforeAfter" }> }) {
  return (
    <div className="space-y-1.5">
      {(
        [
          ["before", visual.before, "border-slate-800 text-slate-500"],
          ["after", visual.after, "border-amber-700/60 text-amber-100/90"],
        ] as const
      ).map(([tag, body, tone], i) => (
        <div key={tag}>
          {i === 1 && (
            <div className="flex justify-center py-1">
              <Arrow direction="down" />
            </div>
          )}
          <div className={`rounded-lg border bg-slate-950 p-2.5 ${tone}`}>
            <p className="mb-1 text-[10px] uppercase tracking-wide opacity-70">{tag}</p>
            <p className="whitespace-pre-line text-[11px] leading-relaxed">{body}</p>
          </div>
        </div>
      ))}
    </div>
  );
}

/** The four planner stages, one lit. Stage names are reused from PLANNER_STEPS. */
function Flow({ visual }: { visual: Extract<StepVisual, { kind: "flow" }> }) {
  return (
    <div className="space-y-0">
      {PLANNER_STEPS.map((planner, i) => {
        const n = i + 1;
        const active = n === visual.active;
        const past = n < visual.active;
        return (
          <div key={planner.title}>
            {i > 0 && <div className="ml-3 h-3 w-px bg-slate-800" aria-hidden />}
            <div className={`flex items-center gap-2 ${active ? HIGHLIGHT : ""} rounded-lg p-1`}>
              <span
                className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full border text-[10px] font-semibold ${
                  active
                    ? "border-blue-500 bg-blue-950 text-blue-300"
                    : past
                    ? "border-emerald-800 bg-emerald-950 text-emerald-500"
                    : "border-slate-800 bg-slate-950 text-slate-600"
                }`}
              >
                {past ? "✓" : n}
              </span>
              <span
                className={`text-[11px] ${
                  active ? "font-medium text-slate-100" : past ? "text-slate-500" : "text-slate-600"
                }`}
              >
                {planner.title}
              </span>
            </div>
          </div>
        );
      })}
    </div>
  );
}

function Visual({ visual }: { visual: StepVisual }) {
  return (
    <div>
      <Frame>
        {visual.kind === "control" && (
          <div className="flex items-center gap-2">
            <Arrow />
            <div className="min-w-0 flex-1">
              <MockControl visual={visual} />
            </div>
          </div>
        )}
        {visual.kind === "beforeAfter" && <BeforeAfter visual={visual} />}
        {visual.kind === "flow" && <Flow visual={visual} />}
      </Frame>
      <Caption>{visual.caption}</Caption>
    </div>
  );
}

// ---- The dock ------------------------------------------------------------

export default function Walkthrough({
  id,
  onGo,
}: {
  id: WalkthroughId;
  onGo: (tab: string) => void;
}) {
  const flow = WALKTHROUGHS[id];
  const [index, setIndex] = useState(0);
  const [collapsed, setCollapsed] = useState(false);

  const done = index >= flow.steps.length;
  const step = done ? null : flow.steps[index];

  if (collapsed) {
    return (
      <button
        onClick={() => setCollapsed(false)}
        aria-label={WALKTHROUGH_COPY.expand}
        className="fixed bottom-4 right-4 z-30 flex items-center gap-2 rounded-full border border-amber-700 bg-slate-900/95 px-4 py-2.5 text-xs text-amber-200 shadow-xl shadow-black/40 backdrop-blur transition-colors hover:border-amber-500"
      >
        <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-amber-400" />
        {flow.label} · {done ? WALKTHROUGH_COPY.finish : `${index + 1}/${flow.steps.length}`}
      </button>
    );
  }

  return (
    <aside
      aria-label={WALKTHROUGH_COPY.dockTitle}
      className="fixed inset-x-3 bottom-3 z-30 max-h-[75vh] overflow-y-auto rounded-xl border border-amber-800/70 bg-slate-900/95 shadow-2xl shadow-black/50 backdrop-blur sm:inset-x-auto sm:right-4 sm:bottom-4 sm:w-[23rem]"
    >
      <header className="sticky top-0 flex items-center justify-between gap-2 border-b border-slate-800 bg-slate-900/95 px-4 py-3 backdrop-blur">
        <div className="min-w-0">
          <p className="text-[10px] uppercase tracking-wide text-amber-400/80">
            {WALKTHROUGH_COPY.dockTitle}
          </p>
          <p className="truncate text-sm font-medium text-slate-100">{flow.label}</p>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          <button
            onClick={() => setCollapsed(true)}
            title={WALKTHROUGH_COPY.collapse}
            aria-label={WALKTHROUGH_COPY.collapse}
            className="rounded-lg px-2 py-1 text-slate-500 transition-colors hover:bg-slate-800 hover:text-slate-200"
          >
            —
          </button>
          <button
            onClick={stopWalkthrough}
            title={WALKTHROUGH_COPY.close}
            aria-label={WALKTHROUGH_COPY.close}
            className="rounded-lg px-2 py-1 text-slate-500 transition-colors hover:bg-slate-800 hover:text-slate-200"
          >
            ✕
          </button>
        </div>
      </header>

      {/* Progress: one segment per step, so the length is visible from step 1. */}
      <div className="flex gap-1 px-4 pt-3" aria-hidden>
        {flow.steps.map((s, i) => (
          <span
            key={s.title}
            className={`h-1 flex-1 rounded-full transition-colors ${
              i < index ? "bg-emerald-600" : i === index ? "bg-amber-400" : "bg-slate-800"
            }`}
          />
        ))}
      </div>

      {step ? (
        <div className="space-y-3 px-4 py-3">
          <div>
            <p className="text-[11px] text-slate-500">
              Step {index + 1} of {flow.steps.length}
            </p>
            <h3 className="text-sm font-semibold text-slate-100">{step.title}</h3>
          </div>

          <Visual visual={step.visual} />

          <div className="space-y-2.5 text-xs leading-relaxed">
            <div>
              <p className="text-[10px] font-medium uppercase tracking-wide text-slate-500">
                {WALKTHROUGH_COPY.hereNow}
              </p>
              <p className="text-slate-300">{step.where}</p>
            </div>
            <div>
              <p className="text-[10px] font-medium uppercase tracking-wide text-slate-500">
                {WALKTHROUGH_COPY.doThis}
              </p>
              <p className="text-slate-300">{step.action}</p>
            </div>
            <div className="rounded-lg border border-slate-800 bg-slate-950/60 px-2.5 py-2">
              <p className="text-[10px] font-medium uppercase tracking-wide text-slate-500">
                {WALKTHROUGH_COPY.youWillSee}
              </p>
              <p className="mt-0.5 text-slate-400">{step.expect}</p>
            </div>
          </div>

          {step.tab && (
            <button
              onClick={() => onGo(step.tab as string)}
              className="w-full rounded-lg border border-slate-700 px-3 py-2 text-xs text-slate-300 transition-colors hover:border-blue-600 hover:text-blue-300"
            >
              {WALKTHROUGH_COPY.openTab} {step.tab} →
            </button>
          )}
        </div>
      ) : (
        <div className="space-y-2 px-4 py-4">
          <h3 className="text-sm font-semibold text-emerald-400">{WALKTHROUGH_COPY.doneTitle}</h3>
          <p className="text-xs leading-relaxed text-slate-400">{WALKTHROUGH_COPY.doneBody}</p>
        </div>
      )}

      <footer className="sticky bottom-0 flex items-center gap-2 border-t border-slate-800 bg-slate-900/95 px-4 py-3 backdrop-blur">
        <button
          onClick={() => setIndex((i) => Math.max(0, i - 1))}
          disabled={index === 0}
          className="rounded-lg border border-slate-700 px-3 py-2 text-xs text-slate-400 transition-colors hover:text-slate-200 disabled:cursor-not-allowed disabled:opacity-30"
        >
          {WALKTHROUGH_COPY.back}
        </button>
        {done ? (
          <button
            onClick={stopWalkthrough}
            className="flex-1 rounded-lg bg-emerald-700 px-3 py-2 text-xs font-medium text-white transition-colors hover:bg-emerald-600"
          >
            {WALKTHROUGH_COPY.close}
          </button>
        ) : (
          <button
            onClick={() => setIndex((i) => i + 1)}
            className="flex-1 rounded-lg bg-blue-600 px-3 py-2 text-xs font-medium text-white transition-colors hover:bg-blue-500"
          >
            {index === flow.steps.length - 1 ? WALKTHROUGH_COPY.finish : WALKTHROUGH_COPY.next}
          </button>
        )}
      </footer>
    </aside>
  );
}
