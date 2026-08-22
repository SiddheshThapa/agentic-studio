// Transient narration of what the app is doing. Supplementary to the result each
// panel already shows — it says what happened on the way there, then gets out of the
// way on a timer.
//
// No effects, no local state: the store in lib/activity.ts owns the items and every
// timer, and this reads it through useSyncExternalStore. That is what keeps it clear
// of react-hooks/set-state-in-effect.
"use client";

import { useSyncExternalStore } from "react";
import {
  dismissActivity,
  getActivityServerSnapshot,
  getActivitySnapshot,
  subscribeActivity,
  type Activity,
} from "@/lib/activity";
import { Spinner } from "@/components/ui";

function StepLine({ text, state }: { text: string; state: "past" | "current" | "failed" }) {
  return (
    <li className="flex items-start gap-2">
      <span className="mt-0.5 flex h-3.5 w-3.5 shrink-0 items-center justify-center text-[10px]">
        {state === "current" ? (
          <Spinner className="h-3 w-3 text-iris-300" />
        ) : state === "failed" ? (
          <span className="text-red-400">✕</span>
        ) : (
          <span className="text-emerald-500">✓</span>
        )}
      </span>
      <span className={state === "past" ? "text-ink-500" : "text-ink-200"}>{text}</span>
    </li>
  );
}

function Item({ item }: { item: Activity }) {
  const visible = item.steps.slice(0, item.step + 1);

  return (
    <div className="surface animate-fade-in-up rounded-[var(--radius-surface)] p-3 shadow-[var(--shadow-raised)] backdrop-blur">
      <div className="flex items-start justify-between gap-2">
        <ul className="min-w-0 flex-1 space-y-1 text-xs leading-relaxed">
          {visible.map((text, i) => (
            <StepLine
              key={text}
              text={text}
              state={
                item.status === "running"
                  ? i === item.step
                    ? "current"
                    : "past"
                  : item.status === "failed" && i === visible.length - 1
                  ? "failed"
                  : "past"
              }
            />
          ))}
        </ul>
        <button
          onClick={() => dismissActivity(item.id)}
          aria-label="Dismiss"
          className="press shrink-0 rounded px-1 text-ink-600 transition-colors hover:text-ink-200"
        >
          ✕
        </button>
      </div>

      {item.outcome && (
        <p
          className={`mt-2 border-t border-white/8 pt-2 text-xs leading-relaxed ${
            item.status === "failed" ? "text-red-300" : "text-emerald-300"
          }`}
        >
          {item.outcome}
        </p>
      )}
    </div>
  );
}

export default function ActivityFeed() {
  const items = useSyncExternalStore(
    subscribeActivity,
    getActivitySnapshot,
    getActivityServerSnapshot
  );

  if (items.length === 0) return null;

  return (
    <div
      role="status"
      aria-live="polite"
      className="fixed bottom-3 left-3 z-20 w-[19rem] max-w-[calc(100vw-1.5rem)] space-y-2"
    >
      {items.map((item) => (
        <Item key={item.id} item={item} />
      ))}
    </div>
  );
}
