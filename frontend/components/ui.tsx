// Shared presentational pieces. No data fetching lives here.
"use client";

import { useState } from "react";
import { ApiError } from "@/lib/api";

export function errorMessage(err: unknown): string {
  if (err instanceof ApiError) return err.message;
  if (err instanceof Error) return err.message;
  return "Something went wrong.";
}

/**
 * The base surface. `.surface` (globals.css) carries the layered gradient, the
 * hairline and the blur; this only decides shape and padding, so a card looks
 * the same wherever it is used.
 */
export function Card({
  children,
  className = "",
  style,
}: {
  children: React.ReactNode;
  className?: string;
  /** For the --i stagger index only; not a hook for per-panel colours. */
  style?: React.CSSProperties;
}) {
  return (
    <div className={`surface rounded-[var(--radius-surface)] p-6 ${className}`} style={style}>
      {children}
    </div>
  );
}

export function Spinner({ className = "" }: { className?: string }) {
  return (
    <span
      className={`inline-block h-4 w-4 animate-spin rounded-full border-[1.5px] border-current border-t-transparent ${className}`}
    />
  );
}

export function ErrorAlert({ message }: { message: string }) {
  return (
    <div className="animate-fade-in-up rounded-[var(--radius-control)] border border-red-500/25 bg-red-500/8 px-4 py-3 text-label leading-relaxed text-red-200">
      <span className="font-medium text-red-100">That didn&apos;t work. </span>
      {message}
    </div>
  );
}

export function SuccessNote({ children }: { children: React.ReactNode }) {
  return (
    <div className="animate-fade-in-up rounded-[var(--radius-control)] border border-emerald-500/25 bg-emerald-500/8 px-4 py-3 text-label leading-relaxed text-emerald-200">
      {children}
    </div>
  );
}

export function Badge({
  tone,
  children,
  title,
}: {
  tone: "blue" | "emerald" | "amber" | "slate" | "violet";
  children: React.ReactNode;
  title?: string;
}) {
  // "blue" is the app's neutral-positive badge, so it maps onto the brand accent;
  // the semantic three keep their own hues. Tone keys are unchanged — every panel
  // that passes tone="blue" keeps working.
  const tones: Record<string, string> = {
    blue: "border-iris-500/30 bg-iris-500/10 text-iris-200",
    emerald: "border-emerald-500/25 bg-emerald-500/10 text-emerald-300",
    amber: "border-amber-500/25 bg-amber-500/10 text-amber-300",
    slate: "border-white/8 bg-white/5 text-ink-300",
    violet: "border-iris-400/30 bg-iris-400/10 text-iris-200",
  };
  return (
    <span
      title={title}
      className={`inline-flex items-center rounded-full border px-2.5 py-1 text-xs font-medium ${tones[tone]} ${
        title ? "cursor-help" : ""
      }`}
    >
      {children}
    </span>
  );
}

export function PrimaryButton({
  children,
  disabled,
  onClick,
  className = "",
  loading = false,
  tone = "blue",
  title,
}: {
  children: React.ReactNode;
  disabled?: boolean;
  onClick?: () => void;
  className?: string;
  loading?: boolean;
  tone?: "blue" | "emerald" | "violet" | "red";
  title?: string;
}) {
  // Each tone is a face plus its own shadow, so a primary action reads as lit
  // from within rather than as a flat filled rectangle.
  const tones = {
    blue: "bg-iris-500 hover:bg-iris-400 text-white shadow-[var(--shadow-accent)]",
    emerald: "bg-emerald-600 hover:bg-emerald-500 text-white shadow-[0_8px_28px_-10px_rgb(5_150_105/0.55)]",
    violet: "bg-iris-600 hover:bg-iris-500 text-white shadow-[var(--shadow-accent)]",
    red: "bg-red-600 hover:bg-red-500 text-white shadow-[0_8px_28px_-10px_rgb(220_38_38/0.5)]",
  };
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      title={title}
      className={`press sheen inline-flex items-center justify-center gap-2 rounded-[var(--radius-control)] px-4 py-2.5 text-label font-medium tracking-[-0.01em] disabled:cursor-not-allowed disabled:opacity-35 disabled:shadow-none ${tones[tone]} ${className}`}
    >
      {loading && <Spinner />}
      {children}
    </button>
  );
}

/**
 * The quiet button: cancel, refresh, "open X", anything that is not the one thing
 * the screen is for. Exists so panels stop hand-rolling a bordered <button>.
 */
export function SecondaryButton({
  children,
  onClick,
  disabled,
  loading = false,
  tone = "neutral",
  className = "",
  title,
}: {
  children: React.ReactNode;
  onClick?: () => void;
  disabled?: boolean;
  loading?: boolean;
  tone?: "neutral" | "accent" | "danger";
  className?: string;
  title?: string;
}) {
  const tones = {
    neutral: "border-white/8 bg-white/[0.03] text-ink-300 hover:border-white/15 hover:text-ink-50",
    accent: "border-iris-400/30 bg-iris-400/8 text-iris-200 hover:border-iris-400/50 hover:text-iris-100",
    danger: "border-red-500/25 bg-red-500/8 text-red-300 hover:border-red-500/45 hover:text-red-200",
  };
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      title={title}
      className={`press inline-flex items-center justify-center gap-2 rounded-[var(--radius-control)] border px-3.5 py-2 text-label font-medium disabled:cursor-not-allowed disabled:opacity-35 ${tones[tone]} ${className}`}
    >
      {loading && <Spinner className="h-3.5 w-3.5" />}
      {children}
    </button>
  );
}

/** A block where content will be. Keeps the layout from jumping when it arrives. */
export function Skeleton({ className = "" }: { className?: string }) {
  return <div className={`skeleton rounded-[var(--radius-control)] ${className}`} aria-hidden />;
}

/**
 * The heading every panel opens with. One eyebrow, one heading, one paragraph —
 * so a user landing on any tab reads the same three things in the same order.
 */
export function PanelIntro({
  eyebrow,
  title,
  children,
  action,
}: {
  eyebrow: string;
  title: string;
  children?: React.ReactNode;
  action?: React.ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-4">
      <div className="max-w-2xl space-y-2.5">
        <p className="text-micro font-medium uppercase text-iris-300/80">{eyebrow}</p>
        <h2 className="text-heading text-gradient">{title}</h2>
        {children && <p className="text-body text-ink-300">{children}</p>}
      </div>
      {action && <div className="shrink-0">{action}</div>}
    </div>
  );
}

/** A single figure with its label and a plain-language reading underneath. */
export function Stat({
  label,
  value,
  suffix,
  reading,
  tone = "neutral",
}: {
  label: string;
  value: React.ReactNode;
  suffix?: string;
  reading?: string;
  tone?: "neutral" | "good" | "mixed" | "poor";
}) {
  const tones = {
    neutral: "text-ink-50",
    good: "text-emerald-300",
    mixed: "text-amber-300",
    poor: "text-red-300",
  };
  return (
    <Card className="space-y-2">
      <p className="text-micro font-medium uppercase text-ink-500">{label}</p>
      <p className={`text-display ${tones[tone]}`}>
        {value}
        {suffix && <span className="ml-1.5 text-title font-normal text-ink-500">{suffix}</span>}
      </p>
      {reading && <p className="text-xs leading-relaxed text-ink-400">{reading}</p>}
    </Card>
  );
}

/**
 * A labelled form control with room for the two things beginners actually need:
 * what the field wants (`help`) and what a valid value looks like (`example`).
 */
export function Field({
  label,
  help,
  example,
  children,
  required = false,
}: {
  label: string;
  help?: string;
  example?: string;
  children: React.ReactNode;
  required?: boolean;
}) {
  return (
    <div className="space-y-2">
      <label className="block text-label font-medium text-ink-100">
        {label}
        {required && <span className="ml-1 text-iris-300">*</span>}
      </label>
      {help && <p className="text-xs leading-relaxed text-ink-400">{help}</p>}
      {children}
      {example && <p className="text-xs text-ink-500">Example: {example}</p>}
    </div>
  );
}

/** A short aside that explains why something exists, rather than warning about it. */
export function InfoNote({
  children,
  tone = "slate",
}: {
  children: React.ReactNode;
  tone?: "slate" | "amber" | "blue";
}) {
  const tones = {
    slate: "border-white/8 bg-white/[0.03] text-ink-300",
    amber: "border-amber-500/20 bg-amber-500/[0.07] text-amber-200/85",
    blue: "border-iris-400/25 bg-iris-400/[0.07] text-iris-200/90",
  };
  return (
    <p className={`rounded-[var(--radius-control)] border px-3 py-2.5 text-xs leading-relaxed ${tones[tone]}`}>
      {children}
    </p>
  );
}

/** Inline "what does this mean?" toggle, so jargon can be explained on demand. */
export function Explain({ term, children }: { term: string; children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <span className="inline">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="press ml-1 inline-flex h-4 w-4 items-center justify-center rounded-full border border-white/12 text-[10px] text-ink-400 hover:border-iris-400/60 hover:text-iris-300"
        aria-label={`What is ${term}?`}
        aria-expanded={open}
      >
        ?
      </button>
      {open && (
        <span className="animate-fade-in-up mt-1.5 block rounded-[var(--radius-control)] border border-iris-400/20 bg-iris-400/[0.06] px-3 py-2 text-xs leading-relaxed text-ink-300">
          {children}
        </span>
      )}
    </span>
  );
}

/** Numbered step header for multi-step flows. */
export function StepHeader({
  number,
  title,
  why,
  state,
}: {
  number: number;
  title: string;
  why: string;
  state: "done" | "active" | "locked";
}) {
  // The active step is the only one that glows — that is the whole navigation
  // cue in a four-step flow, so nothing else in the card competes with it.
  const ring =
    state === "done"
      ? "border-emerald-400/35 bg-emerald-400/10 text-emerald-300"
      : state === "active"
      ? "border-iris-400/50 bg-iris-400/12 text-iris-200 shadow-[0_0_20px_-4px_rgb(124_107_255/0.5)]"
      : "border-white/8 bg-white/[0.02] text-ink-600";
  return (
    <div className="flex gap-3.5">
      <div
        className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full border text-xs font-semibold transition-all duration-[var(--duration-base)] ease-[var(--ease-out-quint)] ${ring}`}
      >
        {state === "done" ? "✓" : number}
      </div>
      <div className="space-y-1.5">
        <h3 className={`text-title font-semibold ${state === "locked" ? "text-ink-600" : "text-ink-50"}`}>
          {title}
        </h3>
        <p className={`text-xs leading-relaxed ${state === "locked" ? "text-ink-600" : "text-ink-400"}`}>
          {why}
        </p>
      </div>
    </div>
  );
}

/**
 * Inline "are you sure" box. Not a modal — the same shape DocumentsPanel already
 * uses for its delete step, so a confirmation always looks the same in this app.
 *
 * `what` says what the action does; `risk` says what could break if it is wrong.
 * Both are plain sentences, and neither is optional for a destructive action.
 */
export function ConfirmPanel({
  title,
  what,
  risk,
  confirmLabel,
  onConfirm,
  onCancel,
  busy = false,
  tone = "red",
}: {
  title: string;
  what: string;
  risk?: string;
  confirmLabel: string;
  onConfirm: () => void;
  onCancel: () => void;
  busy?: boolean;
  tone?: "red" | "amber";
}) {
  const tones = {
    red: "border-red-500/30 bg-red-500/[0.07] text-red-100",
    amber: "border-amber-400/30 bg-amber-400/[0.07] text-amber-50",
  };
  return (
    <div
      className={`animate-fade-in-up space-y-3 rounded-[var(--radius-surface)] border p-4 ${tones[tone]}`}
    >
      <p className="text-title font-semibold">{title}</p>
      <p className="text-label leading-relaxed opacity-90">{what}</p>
      {risk && (
        <p className="whitespace-pre-line rounded-[var(--radius-control)] border border-white/10 bg-black/25 px-3 py-2.5 text-xs leading-relaxed opacity-90">
          {risk}
        </p>
      )}
      <div className="flex flex-wrap gap-2">
        <PrimaryButton onClick={onConfirm} disabled={busy} loading={busy} tone={tone === "red" ? "red" : "blue"}>
          {confirmLabel}
        </PrimaryButton>
        <SecondaryButton onClick={onCancel} disabled={busy}>
          Cancel
        </SecondaryButton>
      </div>
    </div>
  );
}

/**
 * Placeholder that tells you how to fill the space, instead of just saying "empty".
 * The dashed ring is deliberate: it reads as a slot waiting for something rather
 * than as a failure.
 */
export function EmptyState({
  title,
  hint,
  action,
}: {
  title: string;
  hint: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-3 px-6 py-14 text-center">
      <div
        className="flex h-11 w-11 items-center justify-center rounded-full border border-dashed border-white/15 text-ink-500"
        aria-hidden
      >
        <span className="h-1.5 w-1.5 rounded-full bg-current" />
      </div>
      <p className="text-label font-medium text-ink-200">{title}</p>
      <p className="max-w-xs text-xs leading-relaxed text-ink-500">{hint}</p>
      {action}
    </div>
  );
}

/** Loading state that says what is happening and roughly how long it takes. */
export function BusyState({ what, wait }: { what: string; wait: string }) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-4 px-6 py-14 text-center">
      {/* Two rings: one breathing halo, one spinner. The halo carries the "still
          working" signal at a glance, the spinner carries the detail. */}
      <span className="relative flex h-12 w-12 items-center justify-center">
        <span className="animate-breathe absolute inset-0 rounded-full border border-iris-400/25 bg-iris-400/10" />
        <Spinner className="h-5 w-5 text-iris-300" />
      </span>
      <div className="space-y-1">
        <p className="text-label text-ink-100">{what}</p>
        <p className="text-xs text-ink-500">Usually takes {wait}</p>
      </div>
    </div>
  );
}

/**
 * Inputs are recessed rather than raised — the inverse of a button — so a form
 * reads as somewhere to put things into. Focus lifts the field's own border to
 * the accent, on top of the global :focus-visible ring.
 */
export const inputClass =
  "w-full rounded-[var(--radius-control)] border border-white/8 bg-ink-950/60 px-3 py-2.5 text-label text-ink-50 shadow-[inset_0_1px_2px_rgb(0_0_0/0.35)] outline-none transition-[border-color,background-color,box-shadow] duration-[var(--duration-base)] ease-[var(--ease-out-quint)] placeholder:text-ink-500 hover:border-white/12 focus:border-iris-400/60 focus:bg-ink-950/80";
