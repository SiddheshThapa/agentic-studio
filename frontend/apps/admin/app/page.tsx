// Admin app shell: everything apps/client has, plus Database, the API Log
// overlay, and Users — the three things that only belong in front of a
// developer. Panel content lives in packages/core/components (shared) except
// the admin-only ones imported from @/admin/*.
"use client";

import { useEffect, useState, useSyncExternalStore } from "react";
import { checkHealth, logout } from "@/lib/api";
import { useSession } from "@/lib/session";
import {
  getDemoServerSnapshot,
  getDemoSnapshot,
  getWalkthroughRunServerSnapshot,
  getWalkthroughRunSnapshot,
  getWalkthroughServerSnapshot,
  getWalkthroughSnapshot,
  setDemo,
  subscribeDemo,
} from "@/lib/demo";
import {
  getApiLogVisibleServerSnapshot,
  isApiLogVisible,
  setApiLogVisible,
  subscribeApiLog,
} from "@/lib/apilog";
import { API_LOG_COPY, DEMO_COPY, SHELL_COPY } from "@/lib/content";
import ActivityFeed from "@/components/ActivityFeed";
import AgentsPanel from "@/components/AgentsPanel";
import DocumentsPanel from "@/components/DocumentsPanel";
import GuidePanel from "@/components/GuidePanel";
import HistoryPanel from "@/components/HistoryPanel";
import InsightsPanel from "@/components/InsightsPanel";
import LoginForm from "@/components/LoginForm";
import ReleasePlanner from "@/components/ReleasePlanner";
import Walkthrough from "@/components/Walkthrough";
import ApiLogPanel from "@/admin/ApiLogPanel";
import DatabasePanel from "@/admin/DatabasePanel";
import UsersPanel from "@/admin/UsersPanel";

// SHELL_COPY.tabs is shared with apps/client; Users is developer-only, so it's
// appended here rather than added to the shared list.
const TABS = [...SHELL_COPY.tabs, { id: "Users" as const, blurb: "Manage developer and client accounts" }];

type Tab = (typeof TABS)[number]["id"];

export default function Home() {
  const [tab, setTab] = useState<Tab>("Start here");
  const [healthy, setHealthy] = useState<boolean | null>(null);

  // Demo Mode lives in a module-level store (lib/demo.ts) because lib/api.ts has to
  // read it outside React. Read through useSyncExternalStore, not an effect.
  const demo = useSyncExternalStore(subscribeDemo, getDemoSnapshot, getDemoServerSnapshot);
  const { checked, user, refresh } = useSession(demo);

  // The walkthrough dock is mounted by the shell, not by GuidePanel: the launcher
  // switches Demo Mode on, which remounts the tab container below, and the dock has
  // to survive that and stay up while the user works in other tabs.
  const walkthrough = useSyncExternalStore(
    subscribeDemo,
    getWalkthroughSnapshot,
    getWalkthroughServerSnapshot
  );
  const walkthroughRun = useSyncExternalStore(
    subscribeDemo,
    getWalkthroughRunSnapshot,
    getWalkthroughRunServerSnapshot
  );

  // The API log is its own store: it and the activity feed are independent, so either,
  // both or neither can be on screen.
  const apiLogOpen = useSyncExternalStore(
    subscribeApiLog,
    isApiLogVisible,
    getApiLogVisibleServerSnapshot
  );

  // `demo` is a dependency so toggling re-polls immediately instead of leaving a
  // stale "backend not reachable" banner up for the rest of the 30s interval.
  useEffect(() => {
    let cancelled = false;
    async function poll() {
      try {
        const r = await checkHealth();
        if (!cancelled) setHealthy(r.status === "ok");
      } catch {
        if (!cancelled) setHealthy(false);
      }
    }
    poll();
    const id = setInterval(poll, 30_000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [demo]);

  const go = (next: string) => {
    setTab(next as Tab);
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const active = TABS.find((t) => t.id === tab);

  if (!checked) {
    return <div className="flex min-h-screen items-center justify-center bg-ink-950 text-ink-400">Loading…</div>;
  }
  if (!user) {
    return <LoginForm productName={`${SHELL_COPY.productName} — Admin`} onSuccess={refresh} />;
  }
  if (user.role !== "developer") {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-4 bg-ink-950 px-6 text-center text-ink-100">
        <p className="text-title font-semibold">This account doesn&apos;t have developer access.</p>
        <p className="max-w-sm text-label text-ink-400">
          Signed in as {user.email}. Use the client app instead, or sign in here with a developer account.
        </p>
        <button
          onClick={async () => {
            await logout();
            refresh();
          }}
          className="press rounded-full border border-white/8 bg-white/[0.03] px-3.5 py-2 text-xs font-medium text-ink-400 hover:border-white/15 hover:text-ink-100"
        >
          Sign out
        </button>
      </div>
    );
  }

  return (
    <main className="relative min-h-screen overflow-x-hidden bg-ink-950 text-ink-100">
      {/* The field everything else is layered over. Fixed, so surfaces move
          against it as the page scrolls and the glass has something to refract. */}
      <div className="pointer-events-none fixed inset-0 overflow-hidden" aria-hidden>
        <div className="absolute -top-48 left-[15%] h-[32rem] w-[32rem] rounded-full bg-iris-500/18 blur-[140px]" />
        <div className="absolute top-1/3 -right-40 h-[28rem] w-[28rem] rounded-full bg-iris-400/8 blur-[150px]" />
        <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-iris-400/40 to-transparent" />
      </div>

      <header className="header-condense sticky top-0 z-20 border-b border-white/5 bg-ink-950/55 backdrop-blur-xl">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-6 px-6 py-5">
          <div className="flex items-center gap-3.5">
            <div className="relative flex h-10 w-10 items-center justify-center rounded-[var(--radius-control)] bg-gradient-to-br from-iris-400 to-iris-600 text-[15px] font-semibold text-white shadow-[var(--shadow-accent)]">
              <span className="absolute inset-0 rounded-[var(--radius-control)] shadow-[inset_0_1px_0_rgb(255_255_255/0.35)]" />
              {SHELL_COPY.mark}
            </div>
            <div>
              <h1 className="text-title font-semibold text-ink-50">{SHELL_COPY.productName}</h1>
              <p className="mt-0.5 text-micro font-medium uppercase text-ink-500">
                {SHELL_COPY.tagline} — admin
              </p>
            </div>
          </div>

          {/* Status cluster. Every control keeps its exact behaviour; only the
              surface treatment changed — one pill shape, one hairline, one hover. */}
          <div className="flex items-center gap-2">
            <button
              onClick={() => setApiLogVisible(!apiLogOpen)}
              title={API_LOG_COPY.toggleHint}
              aria-pressed={apiLogOpen}
              className={`press hidden items-center gap-2 rounded-full border px-3.5 py-2 text-xs font-medium sm:flex ${
                apiLogOpen
                  ? "border-white/15 bg-white/10 text-ink-100"
                  : "border-white/8 bg-white/[0.03] text-ink-400 hover:border-white/15 hover:text-ink-100"
              }`}
            >
              <span className="font-mono text-[10px] opacity-60">{"{ }"}</span>
              {API_LOG_COPY.label}
            </button>

            {demo && (
              <span className="animate-fade-in-up rounded-full border border-amber-400/30 bg-amber-400/10 px-3 py-1.5 text-micro font-semibold uppercase text-amber-300">
                {DEMO_COPY.badge}
              </span>
            )}

            <button
              onClick={() => setDemo(!demo)}
              title={DEMO_COPY.toggleHint}
              aria-pressed={demo}
              className={`press flex items-center gap-2.5 rounded-full border px-3.5 py-2 text-xs font-medium ${
                demo
                  ? "border-amber-400/35 bg-amber-400/10 text-amber-200"
                  : "border-white/8 bg-white/[0.03] text-ink-400 hover:border-white/15 hover:text-ink-100"
              }`}
            >
              <span
                className={`relative h-3.5 w-6 shrink-0 rounded-full transition-colors duration-[var(--duration-base)] ease-[var(--ease-out-quint)] ${
                  demo ? "bg-amber-400" : "bg-ink-600"
                }`}
              >
                <span
                  className={`absolute top-0.5 h-2.5 w-2.5 rounded-full bg-ink-950 transition-[left] duration-[var(--duration-base)] ease-[var(--ease-out-quint)] ${
                    demo ? "left-3" : "left-0.5"
                  }`}
                />
              </span>
              {DEMO_COPY.label}
            </button>

            {!demo && (
              <div
                className={`flex items-center gap-2 rounded-full border px-3.5 py-2 text-xs font-medium transition-colors duration-[var(--duration-base)] ${
                  healthy
                    ? "border-emerald-400/25 bg-emerald-400/8 text-emerald-300"
                    : healthy === false
                    ? "border-red-400/30 bg-red-400/10 text-red-300"
                    : "border-white/8 bg-white/[0.03] text-ink-400"
                }`}
              >
                <span
                  className={`h-1.5 w-1.5 rounded-full ${
                    healthy ? "bg-emerald-400" : healthy === false ? "bg-red-400" : "bg-ink-400"
                  } ${healthy === null ? "animate-breathe" : ""}`}
                />
                {healthy === null
                  ? SHELL_COPY.health.checking
                  : healthy
                  ? SHELL_COPY.health.online
                  : SHELL_COPY.health.offline}
              </div>
            )}

            {!demo && (
              <button
                onClick={async () => {
                  await logout();
                  refresh();
                }}
                title={user.email}
                className="press flex items-center gap-2 rounded-full border border-white/8 bg-white/[0.03] px-3.5 py-2 text-xs font-medium text-ink-400 hover:border-white/15 hover:text-ink-100"
              >
                Sign out
              </button>
            )}
          </div>
        </div>

        <nav className="mx-auto flex max-w-6xl gap-0.5 overflow-x-auto px-6">
          {TABS.map((t, i) => (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              title={t.blurb}
              data-active={tab === t.id}
              aria-current={tab === t.id ? "page" : undefined}
              style={{ "--i": i } as React.CSSProperties}
              className={`stagger group relative shrink-0 px-3.5 pb-3 pt-1 text-label font-medium transition-colors duration-[var(--duration-base)] ${
                tab === t.id ? "text-ink-50" : "text-ink-400 hover:text-ink-100"
              }`}
            >
              {t.id}
              {/* Wipes in from the left on select, and previews at low opacity on
                  hover. Sized by the button itself, so nothing is measured. */}
              <span className="tab-underline absolute inset-x-2.5 bottom-0 h-[2px] rounded-full bg-iris-400 shadow-[0_0_12px_rgb(47_217_196/0.6)]" />
            </button>
          ))}
        </nav>
      </header>

      {demo && (
        <div className="relative border-b border-amber-400/15 bg-amber-400/[0.06]">
          <div className="mx-auto max-w-6xl px-6 py-3.5 text-label leading-relaxed text-amber-100/85">
            <span className="font-semibold text-amber-200">{DEMO_COPY.badge}. </span>
            {DEMO_COPY.banner}
          </div>
        </div>
      )}

      {!demo && healthy === false && (
        <div className="relative border-b border-red-400/15 bg-red-400/[0.06]">
          <div className="mx-auto max-w-6xl px-6 py-3.5 text-label leading-relaxed text-red-100/85">
            <span className="font-semibold text-red-200">{SHELL_COPY.offline.title}</span>{" "}
            {SHELL_COPY.offline.body}{" "}
            <code className="rounded-md border border-white/8 bg-ink-950/60 px-1.5 py-0.5 font-mono text-xs text-red-200">
              {SHELL_COPY.offline.api}
            </code>{" "}
            {SHELL_COPY.offline.andFor}{" "}
            <code className="rounded-md border border-white/8 bg-ink-950/60 px-1.5 py-0.5 font-mono text-xs text-red-200">
              {SHELL_COPY.offline.agent4}
            </code>
            .
          </div>
        </div>
      )}

      {/* Keyed on the mode: flipping the toggle remounts every panel, so a demo
          answer can never be left on screen in live mode, or the reverse. */}
      <div key={demo ? "demo" : "live"} className="relative mx-auto max-w-6xl px-6 py-12">
        {active && tab !== "Start here" && (
          <p className="mb-8 text-micro font-medium uppercase text-ink-500">{active.blurb}</p>
        )}
        {tab === "Start here" && <GuidePanel onGo={go} />}
        {tab === "Documents" && <DocumentsPanel />}
        {tab === "Agents" && <AgentsPanel onGo={go} />}
        {tab === "Release Planner" && <ReleasePlanner />}
        {tab === "History" && <HistoryPanel />}
        {tab === "Insights" && <InsightsPanel onGo={go} />}
        {tab === "Database" && <DatabasePanel />}
        {tab === "Users" && <UsersPanel />}
      </div>

      {/* Both live outside the keyed container: the feed narrates calls from every tab
          and must not be torn down when the mode flips, and the walkthrough dock is
          what flips it. Keyed on the run so restarting rewinds to step 1. */}
      <ActivityFeed />
      {walkthrough && <Walkthrough key={walkthroughRun} id={walkthrough} onGo={go} />}
      <ApiLogPanel />
    </main>
  );
}
