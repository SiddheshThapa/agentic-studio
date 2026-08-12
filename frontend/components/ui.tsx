// Shared presentational pieces. No data fetching lives here.
"use client";

import { useState } from "react";
import { ApiError } from "@/lib/api";

export function errorMessage(err: unknown): string {
  if (err instanceof ApiError) return err.message;
  if (err instanceof Error) return err.message;
  return "Something went wrong.";
}

export function Card({
  children,
  className = "",
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={`rounded-xl border border-slate-800 bg-slate-900/60 p-6 shadow-xl shadow-black/20 ${className}`}
    >
      {children}
    </div>
  );
}

export function Spinner({ className = "" }: { className?: string }) {
  return (
    <span
      className={`inline-block h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent ${className}`}
    />
  );
}

export function ErrorAlert({ message }: { message: string }) {
  return (
    <div className="animate-fade-in-up rounded-lg border border-red-900 bg-red-950/40 px-4 py-3 text-sm text-red-300">
      <span className="font-medium">That didn&apos;t work. </span>
      {message}
    </div>
  );
}

export function SuccessNote({ children }: { children: React.ReactNode }) {
  return (
    <div className="animate-fade-in-up rounded-lg border border-emerald-900 bg-emerald-950/30 px-4 py-3 text-sm text-emerald-300">
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
  const tones: Record<string, string> = {
    blue: "border-blue-900 bg-blue-950/50 text-blue-300",
    emerald: "border-emerald-900 bg-emerald-950/50 text-emerald-400",
    amber: "border-amber-900 bg-amber-950/50 text-amber-400",
    slate: "border-slate-800 bg-slate-950/60 text-slate-400",
    violet: "border-violet-900 bg-violet-950/50 text-violet-300",
  };
  return (
    <span
      title={title}
      className={`rounded-full border px-2.5 py-1 text-xs font-medium ${tones[tone]} ${
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
}: {
  children: React.ReactNode;
  disabled?: boolean;
  onClick?: () => void;
  className?: string;
  loading?: boolean;
  tone?: "blue" | "emerald" | "violet" | "red";
}) {
  const tones = {
    blue: "bg-blue-600 hover:bg-blue-500",
    emerald: "bg-emerald-700 hover:bg-emerald-600",
    violet: "bg-violet-700 hover:bg-violet-600",
    red: "bg-red-700 hover:bg-red-600",
  };
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={`inline-flex items-center justify-center gap-2 rounded-lg px-4 py-2.5 text-sm font-medium text-white transition-colors disabled:cursor-not-allowed disabled:opacity-40 ${tones[tone]} ${className}`}
    >
      {loading && <Spinner />}
      {children}
    </button>
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
    <div className="space-y-1.5">
      <label className="block text-sm font-medium text-slate-200">
        {label}
        {required && <span className="ml-1 text-red-400">*</span>}
      </label>
      {help && <p className="text-xs leading-relaxed text-slate-500">{help}</p>}
      {children}
      {example && <p className="text-xs text-slate-600">Example: {example}</p>}
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
    slate: "border-slate-800 bg-slate-950/60 text-slate-400",
    amber: "border-amber-900/60 bg-amber-950/20 text-amber-200/80",
    blue: "border-blue-900/60 bg-blue-950/20 text-blue-200/80",
  };
  return (
    <p className={`rounded-lg border px-3 py-2.5 text-xs leading-relaxed ${tones[tone]}`}>
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
        className="ml-1 inline-flex h-4 w-4 items-center justify-center rounded-full border border-slate-700 text-[10px] text-slate-500 transition-colors hover:border-blue-600 hover:text-blue-400"
        aria-label={`What is ${term}?`}
        aria-expanded={open}
      >
        ?
      </button>
      {open && (
        <span className="mt-1.5 block rounded-lg border border-slate-800 bg-slate-950/80 px-3 py-2 text-xs leading-relaxed text-slate-400">
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
  const ring =
    state === "done"
      ? "border-emerald-700 bg-emerald-950 text-emerald-400"
      : state === "active"
      ? "border-blue-600 bg-blue-950 text-blue-300"
      : "border-slate-800 bg-slate-950 text-slate-600";
  return (
    <div className="flex gap-3">
      <div
        className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full border text-xs font-semibold ${ring}`}
      >
        {state === "done" ? "✓" : number}
      </div>
      <div className="space-y-1">
        <h3
          className={`text-sm font-semibold ${
            state === "locked" ? "text-slate-600" : "text-slate-100"
          }`}
        >
          {title}
        </h3>
        <p className={`text-xs leading-relaxed ${state === "locked" ? "text-slate-700" : "text-slate-500"}`}>
          {why}
        </p>
      </div>
    </div>
  );
}

/** Placeholder that tells you how to fill the space, instead of just saying "empty". */
export function EmptyState({ title, hint }: { title: string; hint: string }) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-2 px-6 py-16 text-center">
      <p className="text-sm font-medium text-slate-400">{title}</p>
      <p className="max-w-xs text-xs leading-relaxed text-slate-600">{hint}</p>
    </div>
  );
}

/** Loading state that says what is happening and roughly how long it takes. */
export function BusyState({ what, wait }: { what: string; wait: string }) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-3 px-6 py-16 text-center">
      <Spinner className="h-6 w-6 text-blue-400" />
      <p className="text-sm text-slate-300">{what}</p>
      <p className="text-xs text-slate-600">Usually takes {wait}</p>
    </div>
  );
}

export const inputClass =
  "w-full rounded-lg border border-slate-800 bg-slate-950 p-2.5 text-sm text-slate-100 outline-none transition-colors placeholder:text-slate-600 focus:border-blue-600";
