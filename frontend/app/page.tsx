// App shell: header, health badge, tab switching. Each tab's content lives in
// its own file under components/.
"use client";

import { useEffect, useState } from "react";
import { checkHealth } from "@/lib/api";
import AgentsPanel from "@/components/AgentsPanel";
import DocumentsPanel from "@/components/DocumentsPanel";
import GuidePanel from "@/components/GuidePanel";
import HistoryPanel from "@/components/HistoryPanel";
import InsightsPanel from "@/components/InsightsPanel";
import ReleasePlanner from "@/components/ReleasePlanner";

const TABS = [
  { id: "Start here", blurb: "What this tool does" },
  { id: "Documents", blurb: "Give the agents something to read" },
  { id: "Agents", blurb: "Analyse a script" },
  { id: "Release Planner", blurb: "Pick a release date" },
  { id: "History", blurb: "Find an earlier answer" },
  { id: "Insights", blurb: "How reliable the answers were" },
] as const;

type Tab = (typeof TABS)[number]["id"];

export default function Home() {
  const [tab, setTab] = useState<Tab>("Start here");
  const [healthy, setHealthy] = useState<boolean | null>(null);

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
  }, []);

  const go = (next: string) => {
    setTab(next as Tab);
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const active = TABS.find((t) => t.id === tab);

  return (
    <main className="relative min-h-screen overflow-x-hidden bg-slate-950 text-slate-100">
      <div className="pointer-events-none fixed inset-0 overflow-hidden">
        <div className="absolute -top-40 left-1/4 h-96 w-96 rounded-full bg-blue-600/20 blur-[120px]" />
        <div className="absolute top-1/3 -right-32 h-96 w-96 rounded-full bg-violet-600/10 blur-[120px]" />
      </div>

      <header className="sticky top-0 z-20 border-b border-slate-800/60 bg-slate-950/80 backdrop-blur">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-6 py-4">
          <div className="flex items-center gap-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-gradient-to-br from-blue-500 to-violet-600 font-bold shadow-lg shadow-blue-950/50">
              A
            </div>
            <div>
              <h1 className="text-lg font-semibold tracking-tight">Agentic Studio</h1>
              <p className="text-xs text-slate-500">Script review and release planning</p>
            </div>
          </div>

          <div
            className={`flex items-center gap-2 rounded-full border px-3 py-1.5 text-xs ${
              healthy
                ? "border-emerald-800 bg-emerald-950/50 text-emerald-400"
                : healthy === false
                ? "border-red-800 bg-red-950/50 text-red-400"
                : "border-slate-800 bg-slate-900/50 text-slate-400"
            }`}
          >
            <span
              className={`h-1.5 w-1.5 rounded-full ${
                healthy ? "bg-emerald-400" : healthy === false ? "bg-red-400" : "bg-slate-500"
              } ${healthy !== null ? "animate-pulse" : ""}`}
            />
            {healthy === null ? "checking…" : healthy ? "connected" : "backend not reachable"}
          </div>
        </div>

        <nav className="mx-auto flex max-w-6xl gap-1 overflow-x-auto px-6">
          {TABS.map((t) => (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              title={t.blurb}
              className={`shrink-0 border-b-2 px-3 py-2.5 text-sm font-medium transition-colors ${
                tab === t.id
                  ? "border-blue-500 text-white"
                  : "border-transparent text-slate-500 hover:text-slate-300"
              }`}
            >
              {t.id}
            </button>
          ))}
        </nav>
      </header>

      {healthy === false && (
        <div className="border-b border-red-900/60 bg-red-950/30">
          <div className="mx-auto max-w-6xl px-6 py-3 text-sm text-red-200">
            <span className="font-medium">The backend is not responding.</span> Nothing on this page
            will work until it is running. Start it with{" "}
            <code className="rounded bg-red-950/60 px-1.5 py-0.5 text-xs">
              uvicorn main:app --reload --port 8000
            </code>{" "}
            and, for the Release Planner,{" "}
            <code className="rounded bg-red-950/60 px-1.5 py-0.5 text-xs">python agent4_service.py</code>.
          </div>
        </div>
      )}

      <div className="relative mx-auto max-w-6xl px-6 py-8">
        {active && tab !== "Start here" && (
          <p className="mb-5 text-sm text-slate-500">{active.blurb}</p>
        )}
        {tab === "Start here" && <GuidePanel onGo={go} />}
        {tab === "Documents" && <DocumentsPanel />}
        {tab === "Agents" && <AgentsPanel onGo={go} />}
        {tab === "Release Planner" && <ReleasePlanner />}
        {tab === "History" && <HistoryPanel />}
        {tab === "Insights" && <InsightsPanel onGo={go} />}
      </div>
    </main>
  );
}
