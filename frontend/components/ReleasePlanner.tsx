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
  PrimaryButton,
  StepHeader,
  errorMessage,
  inputClass,
} from "@/components/ui";
import { GENRES, PLANNER_STEPS, countryName } from "@/lib/content";

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
    <div className="mx-auto max-w-3xl space-y-4">
      <Card className="space-y-2">
        <h2 className="font-semibold">Release Date Planner</h2>
        <p className="text-sm leading-relaxed text-slate-400">
          Four steps. Each one feeds the next, so work down the page. Nothing leaves this app until the
          final step, which creates real Google Calendar events.
        </p>
      </Card>

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
          <div className="animate-fade-in-up pl-10">
            <details className="rounded-lg border border-slate-800 bg-slate-950/60">
              <summary className="cursor-pointer px-3 py-2 text-xs text-slate-400 hover:text-slate-200">
                {listing.text.split("\n").length} {genre} films already scheduled — click to view
              </summary>
              <pre className="max-h-56 overflow-auto whitespace-pre-wrap px-3 pb-3 text-xs leading-relaxed text-slate-500">
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
        <div className="space-y-2 pl-10">
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
          <p className="text-xs text-slate-600">
            Pick the date you would ideally release on. You can change it and re-run as often as you
            like — nothing is committed yet.
          </p>
        </div>

        {competition && (
          <div className="animate-fade-in-up pl-10">
            <div className="rounded-lg border border-slate-800 bg-slate-950/60 p-3">
              <p className="mb-1.5 text-xs font-medium text-slate-400">
                Films releasing within two weeks of {proposedDate}
              </p>
              <p className="whitespace-pre-wrap text-xs leading-relaxed text-slate-400">
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
        <div className="pl-10">
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
          <div className="animate-fade-in-up space-y-3 pl-10">
            <p className="text-xs text-slate-500">
              Each country gets its own date because holidays differ. A suggested date that moved away
              from your proposal is marked <span className="text-amber-400">adjusted</span>; change any
              of them if you disagree.
            </p>
            <div className="space-y-2">
              {Object.entries(conflicts.recommended_dates).map(([code, recommended]) => {
                const value = dates[code] ?? recommended;
                const editedByUser = value !== recommended;
                const movedByAgent = recommended !== conflicts.proposed_date;
                return (
                  <div key={code} className="flex flex-wrap items-center gap-2">
                    <span className="w-32 shrink-0 text-sm text-slate-300">{countryName(code)}</span>
                    <input
                      type="date"
                      value={value}
                      onChange={(e) => setDates((prev) => ({ ...prev, [code]: e.target.value }))}
                      className={`flex-1 rounded-lg border bg-slate-950 px-3 py-1.5 text-sm text-slate-100 outline-none transition-colors ${
                        editedByUser
                          ? "border-blue-600 focus:border-blue-500"
                          : "border-slate-800 focus:border-blue-600"
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

            <InfoNote tone="amber">
              This is the only step that changes anything outside this app. Confirming creates one real
              event per country on the shared Google Calendar. There is no undo button here — you would
              have to delete them in Google Calendar.
            </InfoNote>

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
          <div className="animate-fade-in-up space-y-3 pl-10">
            <p className="text-sm text-emerald-400">
              Done — {Object.keys(created.events).length} events created. Click any one to open it in
              Google Calendar.
            </p>
            <div className="space-y-2">
              {Object.entries(created.events).map(([code, info]) => (
                <a
                  key={code}
                  href={info.calendar_event}
                  target="_blank"
                  rel="noreferrer"
                  className="flex items-center justify-between rounded-lg border border-slate-800 bg-slate-950 px-3 py-2 text-sm transition-colors hover:border-blue-700"
                >
                  <span className="text-slate-300">{countryName(code)}</span>
                  <span className="text-blue-400">{info.date} →</span>
                </a>
              ))}
            </div>
            <button
              onClick={reset}
              className="text-xs text-slate-500 underline underline-offset-2 hover:text-slate-300"
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
    <div className="space-y-3 rounded-lg border border-slate-800 bg-slate-950/60 p-4">
      <div className="flex items-center justify-between gap-2">
        <p className="text-sm text-slate-300">
          {total === 0
            ? "No clashes found on your date."
            : `${total} clash${total === 1 ? "" : "es"} found within 3 days of your date.`}
        </p>
        <Badge tone={total === 0 ? "emerald" : "amber"}>{total === 0 ? "all clear" : "needs a shift"}</Badge>
      </div>

      <div className="space-y-1.5">
        <p className="text-xs font-medium uppercase tracking-wide text-slate-600">Public holidays</p>
        {Object.entries(report.holidays).map(([code, h]) => (
          <div key={code} className="flex items-center justify-between gap-2 text-xs">
            <span className="text-slate-500">{countryName(code)}</span>
            {h.status === "unknown" ? (
              <span className="text-slate-600" title="The holiday service could not be reached">
                could not check
              </span>
            ) : h.conflict ? (
              <span className="text-amber-400">
                {h.holiday_name} · {h.holiday_date}
              </span>
            ) : (
              <span className="text-emerald-500">clear</span>
            )}
          </div>
        ))}
      </div>

      <div className="space-y-1.5">
        <p className="text-xs font-medium uppercase tracking-wide text-slate-600">
          Sporting events and awards
        </p>
        {globalEvents.map((e) => (
          <div key={e.name} className="flex items-center justify-between gap-2 text-xs">
            <span className="text-slate-500">{e.name}</span>
            <span className={e.conflict ? "text-amber-400" : "text-emerald-500"}>
              {e.date} · {e.days_away} days away
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
