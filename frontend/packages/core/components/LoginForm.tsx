"use client";

import { useState } from "react";
import { login, type SessionUser } from "@/lib/api";
import { SHELL_COPY, WELCOME_COPY } from "@/lib/content";
import { Card, ErrorAlert, Field, PrimaryButton, errorMessage, inputClass } from "@/components/ui";

// Sign-in only. There is no public sign-up endpoint — accounts come from
// seed_admin.py or the developer app's Users tab (see CLAUDE.md, "Login
// sessions and roles" and WELCOME_COPY's comment in content.ts) — so this
// page never offers to create an account, only to sign into one.
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export default function LoginForm({
  productName,
  onSuccess,
}: {
  productName: string;
  onSuccess: (user: SessionUser) => void;
}) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [touched, setTouched] = useState(false);

  const emailValid = EMAIL_RE.test(email);
  const validationError = touched && email && !emailValid ? "Enter a valid email address." : null;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setTouched(true);
    if (!emailValid || !password) return;
    setBusy(true);
    setError(null);
    try {
      onSuccess(await login(email, password));
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="relative flex min-h-screen items-center overflow-hidden bg-ink-950 px-6 py-16 text-ink-100">
      <div className="pointer-events-none fixed inset-0 overflow-hidden" aria-hidden>
        <div className="absolute -top-48 left-[15%] h-[32rem] w-[32rem] rounded-full bg-iris-500/18 blur-[140px]" />
        <div className="absolute top-1/3 -right-40 h-[28rem] w-[28rem] rounded-full bg-iris-400/8 blur-[150px]" />
      </div>

      <div className="relative mx-auto grid w-full max-w-5xl items-center gap-12 lg:grid-cols-2 lg:gap-20">
        {/* Pitch — hidden below lg so the form is what a phone sees first. */}
        <div className="hidden animate-fade-in-up space-y-6 lg:block">
          <div className="flex items-center gap-3.5">
            <div className="relative flex h-10 w-10 items-center justify-center rounded-[var(--radius-control)] bg-gradient-to-br from-iris-400 to-iris-600 text-[15px] font-semibold text-white shadow-[var(--shadow-accent)]">
              <span className="absolute inset-0 rounded-[var(--radius-control)] shadow-[inset_0_1px_0_rgb(255_255_255/0.35)]" />
              {SHELL_COPY.mark}
            </div>
            <p className="text-micro font-medium uppercase text-ink-500">{productName}</p>
          </div>
          <h1 className="max-w-md text-display text-gradient">{WELCOME_COPY.headline}</h1>
          <ul className="space-y-3">
            {WELCOME_COPY.bullets.map((b) => (
              <li key={b} className="flex gap-3 text-body text-ink-300">
                <span className="mt-2.5 h-1.5 w-1.5 shrink-0 rounded-full bg-iris-400" />
                {b}
              </li>
            ))}
          </ul>
        </div>

        {/* The one hero moment that gets the source's literal 25px radius —
            !important because Card's own rounded-[var(--radius-surface)] has
            equal utility specificity and would otherwise win on source order. */}
        <Card className="w-full max-w-sm animate-fade-in-up space-y-5 justify-self-center !rounded-[var(--radius-hero)] lg:justify-self-start">
          <div className="space-y-1 lg:hidden">
            <div className="mb-3 flex items-center gap-3">
              <div className="relative flex h-9 w-9 items-center justify-center rounded-[var(--radius-control)] bg-gradient-to-br from-iris-400 to-iris-600 text-sm font-semibold text-white shadow-[var(--shadow-accent)]">
                {SHELL_COPY.mark}
              </div>
              <h1 className="text-title font-semibold text-ink-50">{productName}</h1>
            </div>
          </div>
          <div className="hidden lg:block">
            <h2 className="text-title font-semibold text-ink-50">Sign in</h2>
          </div>
          <p className="text-label text-ink-400">
            Sign in to continue. New accounts are set up by a developer — there is no self-service sign-up.
          </p>
          <form onSubmit={submit} noValidate className="space-y-4">
            <Field label="Email" required>
              <input
                className={inputClass}
                type="email"
                autoFocus
                autoComplete="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                onBlur={() => setTouched(true)}
                aria-invalid={!!validationError}
              />
              {validationError && <p className="text-xs text-red-300">{validationError}</p>}
            </Field>
            <Field label="Password" required>
              <input
                className={inputClass}
                type="password"
                autoComplete="current-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
            </Field>
            {error && <ErrorAlert message={error} />}
            {/* No onClick: a plain <button> defaults to type="submit" inside a
                <form>, so this fires the handler above. */}
            <PrimaryButton disabled={busy || !email || !password} loading={busy} className="w-full">
              Sign in
            </PrimaryButton>
          </form>
        </Card>
      </div>
    </main>
  );
}
