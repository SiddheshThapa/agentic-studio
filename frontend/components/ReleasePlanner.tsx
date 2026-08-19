// Guided four-step release-date workflow.
//
// The old UI made the user run "Browse Releases", read a numeric result ID off the
// screen, switch task, and retype that ID into a second form. Nothing explained
// this. Here the ID is carried between steps automatically and never shown as
// something to copy.
"use client";

import { useState } from "react";
import {
  ConflictCheckResponse,
  ConflictReport,
  DateConfirmationResponse,
  checkConflicts,
  finalizeCalendar,
  runAgent,
} from "@/lib/api";
import {
  Badge,
  Card,
  ErrorAlert,
  InfoNote,
  PanelIntro,
  PrimaryButton,
  StepHeader,
  errorMessage,
  inputClass,
} from "@/components/ui";
import { DEMO_COPY, GENRES, PANEL_COPY, PLANNER_STEPS, countryName } from "@/lib/content";
import { isDemo } from "@/lib/demo";

function todayPlus(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

export default function ReleasePlanner({ sessionId = "web-session" }: { sessionId?: string }) {
  const [genre, setGenre] = useState("");
  const [listing, setListing] = useState<{ id: number; text: string } | null>(null);

  const [proposedDate, setProposedDate] = useState("");
  const [competition, setCompetition] = useState<{ id: number; text: string } | null>(null);

  const [conflicts, setConflicts] = useState<ConflictCheckResponse | null>(null);
  const [dates, setDates] = useState<Record<string, string>>({});
  const [created, setCreated] = useState<DateConfirmationResponse | null>(null);

  const [busy, setBusy] = useState<"listing" | "competition" | "conflicts" | "finalize" | null>(null);
  const [error, setError] = useState("");

  const step = created ? 5 : conflicts ? 4 : competition ? 3 : listing ? 2 : 1;

  function reset() {
    setListing(null);
    setCompetition(null);
    setConflicts(null);
    setDates({});
    setCreated(null);
    setError("");
  }

  async function loadListing() {
    setBusy("listing");
    setError("");
    setCompetition(null);
    setConflicts(null);
    setCreated(null);
    try {
      const res = await runAgent(genre, "release_listing", sessionId, false);
      setListing({ id: res.result_id, text: res.result });
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(null);
    }
  }

  async function checkCompetition() {
    if (!listing || !proposedDate) return;
    setBusy("competition");
    setError("");
    setConflicts(null);
    setCreated(null);
    try {
      // The backend expects "<date>|<listing result id>" as one string. Assembled
      // here so the user never has to know that format exists.
      const res = await runAgent(`${proposedDate}|${listing.id}`, "release_check", sessionId, false);
      setCompetition({ id: res.result_id, text: res.result });
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(null);
    }
  }

  async function loadConflicts() {
    if (!competition) return;
    setBusy("conflicts");
    setError("");
    try {
      const res = await checkConflicts(competition.id, sessionId);
      setConflicts(res);
      setDates(res.recommended_dates);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(null);
    }
  }

  async function createEvents() {
    if (!competition || !conflicts) return;
    setBusy("finalize");
    setError("");
    try {
      const overrides = Object.fromEntries(
        Object.entries(dates).filter(([code, d]) => d !== conflicts.recommended_dates[code])
      );
      setCreated(await finalizeCalendar(competition.id, overrides, sessionId));
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <PanelIntro eyebrow={PANEL_COPY.planner.eyebrow} title={PANEL_COPY.planner.title}>
        {PANEL_COPY.planner.intro}
      </PanelIntro>

      {/* Progress rail: four dots that fill as the flow advances, so the shape of
          the process is visible before any of it has been done. */}
      <div className="flex items-center gap-2" aria-hidden>
        {[1, 2, 3, 4].map((n) => (
          <div key={n} className="flex flex-1 items-center gap-2">
            <span
              className={`h-1 flex-1 rounded-full transition-colors duration-[var(--duration-slow)] ${
                step > n ? "bg-emerald-400/70" : step === n ? "bg-iris-400" : "bg-white/8"
              }`}
            />
          </div>
        ))}
      </div>

      {error && <ErrorAlert message={error} />}

      {/* Step 1 --------------------------------------------------------- */}
      <Card className="space-y-4">
        <StepHeader
          number={1}
          title={PLANNER_STEPS[0].title}
          why={PLANNER_STEPS[0].why}
          state={listing ? "done" : "active"}
        />
        <div className="flex flex-col gap-2 pl-10 sm:flex-row">
          <select
            value={genre}
            onChange={(e) => {
              setGenre(e.target.value);
              reset();
            }}
            className={`${inputClass} sm:flex-1`}
          >
            <option value="">Select a genre…</option>
            {GENRES.map((g) => (
              <option key={g} value={g}>
                {g}
              </option>
            ))}
          </select>
          <PrimaryButton
            onClick={loadListing}
            disabled={!genre || busy !== null}
            loading={busy === "listing"}
          >
            {listing ? "Reload list" : "Find scheduled films"}
          </PrimaryButton>
        </div>

        {listing && (
          <div className="animate-fade-in-up pl-11">
            <details className="group rounded-[var(--radius-control)] border border-white/8 bg-white/[0.02]">
              <summary className="flex cursor-pointer items-center gap-2 px-3.5 py-2.5 text-xs text-ink-300 hover:text-ink-50">
                <span className="text-ink-600 transition-transform group-open:rotate-90">›</span>
                {listing.text.split("\n").length} {genre} films already scheduled
              </summary>
              <pre className="max-h-56 overflow-auto whitespace-pre-wrap px-3.5 pb-3.5 font-mono text-xs leading-relaxed text-ink-400">
                {listing.text}
              </pre>
            </details>
          </div>
        )}
      </Card>

      {/* Step 2 --------------------------------------------------------- */}
      <Card className={`space-y-4 ${step < 2 ? "opacity-50" : ""}`}>
        <StepHeader
          number={2}
          title={PLANNER_STEPS[1].title}
          why={PLANNER_STEPS[1].why}
          state={competition ? "done" : step === 2 ? "active" : "locked"}
        />
        <div className="space-y-2 pl-11">
          <div className="flex flex-col gap-2 sm:flex-row">
            <input
              type="date"
              value={proposedDate}
              min={todayPlus(0)}
              onChange={(e) => {
                setProposedDate(e.target.value);
                setCompetition(null);
                setConflicts(null);
                setCreated(null);
              }}
              disabled={!listing}
              className={`${inputClass} sm:flex-1`}
            />
            <PrimaryButton
              onClick={checkCompetition}
              disabled={!listing || !proposedDate || busy !== null}
              loading={busy === "competition"}
            >
              Check competition
            </PrimaryButton>
          </div>
          <p className="text-xs text-ink-500">
            Pick the date you would ideally release on. You can change it and re-run as often as you
            like — nothing is committed yet.
          </p>
        </div>

        {competition && (
          <div className="animate-fade-in-up pl-11">
            <div className="rounded-[var(--radius-control)] border border-white/8 bg-white/[0.02] p-3.5">
              <p className="mb-2 text-micro font-medium uppercase text-ink-500">
                Within two weeks of {proposedDate}
              </p>
              <p className="whitespace-pre-wrap text-xs leading-relaxed text-ink-300">
                {competition.text}
              </p>
            </div>
          </div>
        )}
      </Card>

      {/* Step 3 --------------------------------------------------------- */}
      <Card className={`space-y-4 ${step < 3 ? "opacity-50" : ""}`}>
        <StepHeader
          number={3}
          title={PLANNER_STEPS[2].title}
          why={PLANNER_STEPS[2].why}
          state={conflicts ? "done" : step === 3 ? "active" : "locked"}
        />
        <div className="pl-11">
          {!conflicts ? (
            <PrimaryButton
              onClick={loadConflicts}
              disabled={!competition || busy !== null}
              loading={busy === "conflicts"}
              tone="violet"
            >
              Check holidays and events
            </PrimaryButton>
          ) : (
            <div className="animate-fade-in-up">
              <ConflictFindings report={conflicts.conflict_report} />
            </div>
          )}
        </div>
      </Card>

      {/* Step 4 --------------------------------------------------------- */}
      <Card className={`space-y-4 ${step < 4 ? "opacity-50" : ""}`}>
        <StepHeader
          number={4}
          title={PLANNER_STEPS[3].title}
          why={PLANNER_STEPS[3].why}
          state={created ? "done" : step === 4 ? "active" : "locked"}
        />

        {conflicts && !created && (
          <div className="animate-fade-in-up space-y-3.5 pl-11">
            <p className="text-xs leading-relaxed text-ink-400">
              Each country gets its own date because holidays differ. A suggested date that moved away
              from your proposal is marked <span className="text-amber-300">adjusted</span>; change any
              of them if you disagree.
            </p>
            <div className="space-y-2">
              {Object.entries(conflicts.recommended_dates).map(([code, recommended]) => {
                const value = dates[code] ?? recommended;
                const editedByUser = value !== recommended;
                const movedByAgent = recommended !== conflicts.proposed_date;
                return (
                  <div
                    key={code}
                    className="flex flex-wrap items-center gap-2 rounded-[var(--radius-control)] border border-white/5 bg-white/[0.02] p-2 transition-colors duration-[var(--duration-base)] hover:border-white/10"
                  >
                    <span className="w-32 shrink-0 pl-1.5 text-label text-ink-200">
                      {countryName(code)}
                    </span>
                    <input
                      type="date"
                      value={value}
                      onChange={(e) => setDates((prev) => ({ ...prev, [code]: e.target.value }))}
                      className={`flex-1 rounded-[var(--radius-control)] border bg-ink-950/60 px-3 py-2 text-label text-ink-50 outline-none transition-colors duration-[var(--duration-base)] ${
                        editedByUser
                          ? "border-iris-400/60 focus:border-iris-400"
                          : "border-white/8 focus:border-iris-400/60"
                      }`}
                    />
                    {editedByUser ? (
                      <Badge tone="blue">your choice</Badge>
                    ) : movedByAgent ? (
                      <Badge tone="amber" title="Moved away from your proposed date to avoid a conflict">
                        adjusted
                      </Badge>
                    ) : (
                      <Badge tone="emerald">as proposed</Badge>
                    )}
                  </div>
                );
              })}
            </div>

            {isDemo() ? (
              <InfoNote tone="amber">{DEMO_COPY.calendarNote}</InfoNote>
            ) : (
              <InfoNote tone="amber">
                This is the only step that changes anything outside this app. Confirming creates one
                real event per country on the shared Google Calendar. There is no undo button here —
                you would have to delete them in Google Calendar.
              </InfoNote>
            )}

            <PrimaryButton
              onClick={createEvents}
              disabled={busy !== null}
              loading={busy === "finalize"}
              tone="emerald"
              className="w-full"
            >
              Create {Object.keys(conflicts.recommended_dates).length} calendar events
            </PrimaryButton>
          </div>
        )}

        {created && (
          <div className="animate-fade-in-up space-y-3.5 pl-11">
            <div className="flex items-center gap-2.5 rounded-[var(--radius-control)] border border-emerald-400/25 bg-emerald-400/[0.07] px-3.5 py-3">
              <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-emerald-400/15 text-xs text-emerald-300">
                ✓
              </span>
              <p className="text-label text-emerald-100">
                {Object.keys(created.events).length} events created. Click any one to open it in Google
                Calendar.
              </p>
            </div>
            <div className="space-y-2">
              {Object.entries(created.events).map(([code, info], i) => (
                <a
                  key={code}
                  href={info.calendar_event}
                  target="_blank"
                  rel="noreferrer"
                  style={{ "--i": i } as React.CSSProperties}
                  className="stagger surface-interactive flex items-center justify-between rounded-[var(--radius-control)] border border-white/8 bg-white/[0.02] px-3.5 py-2.5 text-label"
                >
                  <span className="text-ink-200">{countryName(code)}</span>
                  <span className="font-mono text-iris-300">{info.date} →</span>
                </a>
              ))}
            </div>
            <button
              onClick={reset}
              className="text-xs text-ink-400 underline underline-offset-4 transition-colors hover:text-ink-100"
            >
              Plan another release
            </button>
          </div>
        )}
      </Card>
    </div>
  );
}

function ConflictFindings({ report }: { report: ConflictReport }) {
  const globalEvents = [...report.sporting_events, ...report.awards_ceremonies];
  const holidayConflicts = Object.values(report.holidays).filter((h) => h.conflict).length;
  const eventConflicts = globalEvents.filter((e) => e.conflict).length;
  const total = holidayConflicts + eventConflicts;

  return (
    <div className="space-y-4 rounded-[var(--radius-control)] border border-white/8 bg-white/[0.02] p-4">
      <div className="flex items-center justify-between gap-2 border-b border-white/5 pb-3">
        <p className="text-label text-ink-100">
          {total === 0
            ? "No clashes found on your date."
            : `${total} clash${total === 1 ? "" : "es"} found within 3 days of your date.`}
        </p>
        <Badge tone={total === 0 ? "emerald" : "amber"}>
          {total === 0 ? "all clear" : "needs a shift"}
        </Badge>
      </div>

      <div className="space-y-2">
        <p className="text-micro font-medium uppercase text-ink-500">Public holidays</p>
        {Object.entries(report.holidays).map(([code, h]) => (
          <div key={code} className="flex items-center justify-between gap-2 text-xs">
            <span className="text-ink-300">{countryName(code)}</span>
            {h.status === "unknown" ? (
              <span className="text-ink-500" title="The holiday service could not be reached">
                could not check
              </span>
            ) : h.conflict ? (
              <span className="text-amber-300">
                {h.holiday_name} · <span className="font-mono">{h.holiday_date}</span>
              </span>
            ) : (
              <span className="text-emerald-400">clear</span>
            )}
          </div>
        ))}
      </div>

      <div className="space-y-2">
        <p className="text-micro font-medium uppercase text-ink-500">Sporting events and awards</p>
        {globalEvents.map((e) => (
          <div key={e.name} className="flex items-center justify-between gap-2 text-xs">
            <span className="text-ink-300">{e.name}</span>
            <span className={e.conflict ? "text-amber-300" : "text-emerald-400"}>
              <span className="font-mono">{e.date}</span> · {e.days_away} days away
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
