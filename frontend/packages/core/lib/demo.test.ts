// Checks for Demo Mode. Plain asserts, no framework — Node 22.6+ strips the types:
//
//   cd frontend && node lib/demo.test.ts
//
// What would actually break: a call in api.ts with no matching fixture (the user
// sees an error in the middle of a demo), or a fixture that stops saying it is
// demo data.

import assert from "node:assert/strict";
import {
  DEMO_DOCUMENTS,
  demoRequest,
  getDemoSnapshot,
  getWalkthroughRunSnapshot,
  getWalkthroughSnapshot,
  isDemo,
  setDemo,
  startWalkthrough,
  stopWalkthrough,
  subscribeDemo,
  type WalkthroughId,
} from "./demo.ts";
import { WALKTHROUGHS } from "./content.ts";
import { describeRequest } from "./activity.ts";
import {
  MASK,
  clearApiLog,
  formatResponse,
  getApiLogSnapshot,
  isApiLogVisible,
  logApiEnd,
  logApiStart,
  maskSecrets,
  setApiLogVisible,
} from "./apilog.ts";

// ---- the flag ----

assert.equal(isDemo(), false, "demo mode must be off until switched on");
assert.equal(getDemoSnapshot(), false);

let notified = 0;
const unsubscribe = subscribeDemo(() => {
  notified += 1;
});
setDemo(true);
assert.equal(isDemo(), true);
assert.equal(notified, 1, "subscribers must be told when the flag flips");
setDemo(true);
assert.equal(notified, 1, "setting the same value must not notify");
setDemo(false);
assert.equal(notified, 2);
unsubscribe();
setDemo(true);
assert.equal(notified, 2, "unsubscribe must stop notifications");
setDemo(true);

// ---- every call api.ts can make has a fixture ----

const form = (fields: Record<string, string>) => ({
  method: "POST",
  body: new URLSearchParams(fields),
});

const CALLS: [string, RequestInit][] = [
  ["/health", {}],
  ["/run-agent", form({ task: "compliance", evaluate: "true" })],
  ["/run-agent", form({ task: "analyze", evaluate: "false" })],
  ["/run-agent", form({ task: "release_listing", evaluate: "false" })],
  ["/run-agent", form({ task: "release_check", evaluate: "false" })],
  ["/run-agent", form({ task: "greenlight", evaluate: "false" })],
  ["/confirm-date/4104", { method: "POST" }],
  ["/override-date/4104", form({ new_date: "2026-11-27" })],
  ["/check-conflicts/4104?session_id=web-session", { method: "POST" }],
  ["/finalize-calendar/4104?session_id=web-session", { method: "POST", body: "{}" }],
  ["/ingest", { method: "POST" }],
  ["/document?filename=x.pdf", { method: "DELETE" }],
  ["/result/4101", {}],
  ["/history/web-session", {}],
  ["/eval/summary", {}],
  ["/eval/chart", {}],
];

const answers = await Promise.all(CALLS.map(([path, options]) => demoRequest(path, options)));
answers.forEach((answer, i) => {
  assert.ok(answer && typeof answer === "object", `no fixture body for ${CALLS[i][0]}`);
});

await assert.rejects(
  () => demoRequest("/no-such-endpoint", {}),
  /no fixture/,
  "an unrouted path must fail loudly rather than resolve to nothing"
);

// ---- fixtures say they are fixtures ----

for (const task of ["compliance", "analyze", "release_listing", "release_check", "greenlight"]) {
  const res = (await demoRequest("/run-agent", form({ task, evaluate: "true" }))) as {
    task: string;
    result: string;
    eval: { reasoning: string } | null;
  };
  assert.equal(res.task, task, "the fixture must answer the task that was asked for");
  assert.match(res.result, /DEMO DATA/, `${task} fixture must label itself`);
  assert.match(res.eval!.reasoning, /DEMO DATA/);

  // greenlight answers with JSON, not prose — must parse into the shape
  // AgentsPanel.tsx's parseGreenlightVerdict() expects (digest + verdict).
  if (task === "greenlight") {
    const parsed = JSON.parse(res.result);
    assert.ok(parsed.digest && parsed.verdict, "greenlight fixture must parse into digest + verdict");
    assert.ok(["RED", "YELLOW", "GREEN"].includes(parsed.verdict.status));
  }
}

const unscored = (await demoRequest("/run-agent", form({ task: "analyze", evaluate: "false" }))) as {
  eval: unknown;
};
assert.equal(unscored.eval, null, "evaluate=false must not fake a score");

// ---- the calendar step invents nothing ----

const finalized = (await demoRequest("/finalize-calendar/4104", {
  method: "POST",
  body: JSON.stringify({ US: "2026-12-04" }),
})) as { events: Record<string, { date: string; calendar_event: string }> };

assert.equal(finalized.events.US.date, "2026-12-04", "an override must show up in the response");
assert.equal(finalized.events.GB.date, "2026-11-20", "an untouched country keeps its date");
for (const event of Object.values(finalized.events)) {
  assert.match(
    event.calendar_event,
    /^https:\/\/calendar\.google\.com\/calendar\/u\/0\/r\/day\//,
    "demo links must point at a day view, never at a real event id"
  );
}

// A second call must return the same thing: the fixtures are read-only state.
const again = (await demoRequest("/finalize-calendar/4104", { method: "POST", body: "{}" })) as {
  events: Record<string, { date: string }>;
};
assert.equal(again.events.US.date, "2026-11-30", "an override must not stick to the fixture");

// ---- documents ----

assert.ok(DEMO_DOCUMENTS.length > 0);
assert.ok(
  DEMO_DOCUMENTS.every((name) => name.startsWith("demo-")),
  "example filenames must be recognisable as demo data"
);
assert.throws(
  () => (DEMO_DOCUMENTS as string[]).push("leak.pdf"),
  "the fixture list must be frozen so a panel cannot mutate it"
);

// ---- walkthroughs ----

setDemo(false);
assert.equal(getWalkthroughSnapshot(), null, "no walkthrough runs until one is started");

const IDS: WalkthroughId[] = ["compliance", "analyze", "release_listing", "release_planner", "greenlight"];

startWalkthrough("compliance");
assert.equal(isDemo(), true, "starting a walkthrough must force Demo Mode on — it narrates fixtures");
assert.equal(getWalkthroughSnapshot(), "compliance");

const firstRun = getWalkthroughRunSnapshot();
startWalkthrough("compliance");
assert.notEqual(
  getWalkthroughRunSnapshot(),
  firstRun,
  "restarting the same walkthrough must change the key, or the dock would stay on the old step"
);

setDemo(false);
assert.equal(
  getWalkthroughSnapshot(),
  null,
  "leaving Demo Mode must end the walkthrough, so it can never narrate live data"
);

startWalkthrough("release_planner");
stopWalkthrough();
assert.equal(getWalkthroughSnapshot(), null);
assert.equal(isDemo(), true, "closing the walkthrough leaves Demo Mode alone");
assert.equal(getWalkthroughRunSnapshot(), "", "no walkthrough means no dock key");

// Every pipeline is covered, and no step is text-only.
assert.deepEqual(Object.keys(WALKTHROUGHS).sort(), [...IDS].sort());
for (const id of IDS) {
  const flow = WALKTHROUGHS[id];
  assert.ok(flow.steps.length >= 3, `${id} needs enough steps to be a walkthrough`);
  for (const step of flow.steps) {
    assert.ok(step.visual, `${id} / "${step.title}" has no visual aid`);
    assert.ok(
      ["control", "beforeAfter", "flow"].includes(step.visual.kind),
      `${id} / "${step.title}" has an unrenderable visual`
    );
    assert.ok(step.visual.caption.length > 0, `${id} / "${step.title}" visual needs a caption`);
    assert.ok(step.where.length > 20, `${id} / "${step.title}" must say where the control is`);
    assert.ok(step.action.length > 0 && step.expect.length > 0);
  }
}

// ---- activity narration ----
// describeRequest is pure, so these run without touching the store or its timers.

assert.equal(describeRequest("/health", {}), null, "the 30s health poll must stay silent");
assert.equal(describeRequest("/eval/chart", {}), null, "the chart must not repeat the summary line");

// Narration is built from the response, so it says the same thing in either mode —
// these are the real Demo Mode fixtures, fed through the live code path.
setDemo(true);

const narrated: [string, RequestInit, RegExp][] = [
  ["/run-agent", form({ task: "compliance", evaluate: "true" }), /Compliance report ready\..*8\/10/],
  ["/run-agent", form({ task: "release_listing", evaluate: "false" }), /^Got the list/],
  ["/check-conflicts/4104", { method: "POST" }, /Found 2 clashes.*5 countries/],
  ["/finalize-calendar/4104", { method: "POST", body: "{}" }, /Created 5 calendar events/],
  ["/ingest", { method: "POST" }, /Added 24 searchable pieces/],
  ["/document?filename=x.pdf", { method: "DELETE" }, /Removed 24 pieces/],
  ["/result/4101", {}, /Found it/],
  ["/result/9999", {}, /No saved answer/],
  ["/history/web-session", {}, /Found 8 messages/],
  ["/eval/summary", {}, /Averaged 8 scored runs/],
  ["/admin/tables/results?limit=10&offset=0", {}, /Showing 5 of 5 stored entries/],
];

for (const [path, options, expected] of narrated) {
  const description = describeRequest(path, options);
  assert.ok(description, `${path} should be narrated`);
  assert.ok(description.steps.length > 0, `${path} needs at least one in-flight step`);
  for (const step of description.steps) {
    assert.doesNotMatch(
      step,
      /hybrid|rerank|embed|vector|chunk|collection|A2A|pgvector|BM25|supervisor|endpoint/i,
      `"${step}" uses internal vocabulary a beginner has no way to read`
    );
  }
  assert.match(description.outcome(await demoRequest(path, options)), expected);
}

// A cache hit has to say so — otherwise the feed claims work that never happened.
const cached = describeRequest("/run-agent", form({ task: "analyze", evaluate: "false" }))!;
assert.match(cached.outcome({ from_cache: true }), /^This exact input had been run before/);
assert.doesNotMatch(cached.outcome({ from_cache: false }), /Scored/, "no score means no score line");

// A response in an unexpected shape must not throw out of the narration.
assert.doesNotThrow(() => cached.outcome(null));
assert.doesNotThrow(() => describeRequest("/history/x", {})!.outcome({ history: "not an array" }));

// ---- admin table browser fixtures ----
// The Database tab renders from the column metadata, so the fixtures have to carry
// the same shape the backend sends — including which columns are structural.

const TABLE_INDEX = (await demoRequest("/admin/tables", {})) as {
  tables: { name: string; rows: number; structural_columns: string[] }[];
};
assert.deepEqual(
  TABLE_INDEX.tables.map((t) => t.name).sort(),
  ["cache", "documents", "eval_history", "memory", "results"],
  "the Database tab shows all five collections"
);

for (const table of TABLE_INDEX.tables) {
  const listed = (await demoRequest(`/admin/tables/${table.name}?limit=200`, {})) as {
    columns: { name: string; structural: boolean; omitted: boolean }[];
    rows: Record<string, unknown>[];
    pagination: { total: number };
  };
  assert.ok(listed.columns.length > 0, `${table.name} must describe its own columns`);
  assert.equal(listed.pagination.total, table.rows, `${table.name} row count must agree with the index`);
  for (const row of listed.rows) {
    for (const column of listed.columns) {
      assert.equal(
        column.omitted && column.name in row,
        false,
        `${table.name}.${column.name} is omitted and must not be sent in a row`
      );
    }
  }
}

// The three invariants the tab has to badge as "used internally".
const structuralByTable = Object.fromEntries(
  TABLE_INDEX.tables.map((t) => [t.name, t.structural_columns])
);
assert.ok(structuralByTable.results.includes("script_text"));
assert.ok(structuralByTable.memory.includes("created_at") && structuralByTable.memory.includes("id"));
assert.ok(structuralByTable.cache.includes("created_at"));
assert.ok(
  structuralByTable.documents.includes("embedding"),
  "the embedding is flagged even though its value is never sent"
);

// Search has to filter the total too, or paging walks past the end of the results.
const searched = (await demoRequest("/admin/tables/results?limit=10&q=compliance", {})) as {
  rows: { task: string }[];
  pagination: { total: number };
  search: string | null;
};
assert.equal(searched.search, "compliance");
assert.ok(searched.rows.length > 0 && searched.rows.length < 4, "search must narrow the rows");
assert.equal(searched.pagination.total, searched.rows.length, "the total must reflect the filter");

const paged = (await demoRequest("/admin/tables/memory?limit=2&offset=2", {})) as {
  rows: { id: number }[];
  pagination: { offset: number; has_more: boolean };
};
assert.equal(paged.rows.length, 2);
assert.equal(paged.pagination.offset, 2);
assert.equal(paged.pagination.has_more, true);

// ---- admin writes ----
// The Database tab's controls are only as safe as the flags they gate on, and only
// as truthful as the refetch that follows a write.

const json = (values: Record<string, unknown>, method: string): RequestInit => ({
  method,
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(values),
});

const countRows = async (table: string) =>
  ((await demoRequest(`/admin/tables/${table}?limit=200`, {})) as { pagination: { total: number } })
    .pagination.total;

// Create: the new row has to be there on the very next read, or the UI is lying.
const scoresBefore = await countRows("eval_history");
const created = (await demoRequest(
  "/admin/tables/eval_history",
  json({ task: "compliance", faithfulness_score: 9 }, "POST")
)) as { row_id: number; row: Record<string, unknown> };

assert.equal(await countRows("eval_history"), scoresBefore + 1, "a created row must appear immediately");
assert.ok(created.row.id, "the database fills in the id, and the response carries it back");
assert.ok(created.row.created_at, "and the timestamp");

// Update: only the fields sent change, and structural ones are named in the response.
const updated = (await demoRequest(
  `/admin/tables/results/4101`,
  json({ script_text: "2026-12-04|4103" }, "PATCH")
)) as { updated: string[]; structural_warnings: { column: string }[]; row: Record<string, unknown> };

assert.deepEqual(updated.updated, ["script_text"]);
assert.deepEqual(
  updated.structural_warnings.map((w) => w.column),
  ["script_text"],
  "editing the release-date carrier must come back flagged"
);
assert.equal(updated.row.task, "compliance", "untouched columns must survive an update");
assert.equal(
  ((await demoRequest("/admin/tables/results/4101", {})) as { row: { script_text: string } }).row
    .script_text,
  "2026-12-04|4103",
  "the change must be readable straight back"
);

// An ordinary column raises no warning — otherwise the warning means nothing.
const plain = (await demoRequest(
  "/admin/tables/eval_history/57",
  json({ faithfulness_score: 6 }, "PATCH")
)) as { structural_warnings: unknown[] };
assert.deepEqual(plain.structural_warnings, []);

// A column that does not exist is refused rather than silently dropped.
await assert.rejects(
  () => demoRequest("/admin/tables/results/4101", json({ nonsense: 1 }, "PATCH")),
  /Unknown column/
);

// Delete: documents go as a whole filename group, never one chunk.
const docsBefore = await countRows("documents");
const removed = (await demoRequest("/admin/tables/documents/312", { method: "DELETE" })) as {
  deleted_rows: number;
  grouped_by: string | null;
  filename: string;
};
assert.equal(removed.grouped_by, "filename", "chunks are deleted by file, not individually");
assert.ok(removed.deleted_rows > 1, "the group is bigger than the row that was clicked");
assert.equal(removed.filename, "demo-studio-guidelines-2026.pdf");
assert.equal(
  await countRows("documents"),
  docsBefore - removed.deleted_rows,
  "the list must reflect every row the group delete removed"
);

// Every other table deletes exactly one row.
const memoryBefore = await countRows("memory");
const one = (await demoRequest("/admin/tables/memory/901", { method: "DELETE" })) as {
  deleted_rows: number;
  grouped_by: string | null;
};
assert.equal(one.deleted_rows, 1);
assert.equal(one.grouped_by, null);
assert.equal(await countRows("memory"), memoryBefore - 1);

// Leaving Demo Mode throws all of that away, so none of it reaches a live session.
setDemo(false);
setDemo(true);
assert.equal(await countRows("eval_history"), scoresBefore, "demo writes must not survive the mode");
assert.equal(await countRows("documents"), docsBefore, "including the grouped delete");
assert.equal(
  ((await demoRequest("/admin/tables/results/4101", {})) as { row: { script_text: string } }).row
    .script_text,
  "INT. WAREHOUSE - NIGHT\n\nMAYA edges along the catwalk, torch shaking…",
  "and including edits"
);

// ---- technical API log ----

assert.equal(isApiLogVisible(), false, "the API log is off until asked for");
setApiLogVisible(true);
assert.equal(isApiLogVisible(), true);

clearApiLog();

const SECRET = "super-secret-api-key-value";

// The key must not survive into anything the panel can print, wherever it appears.
assert.equal(maskSecrets(`key=${SECRET}&x=1`, SECRET), `key=${MASK}&x=1`);
assert.doesNotMatch(maskSecrets(SECRET, SECRET), new RegExp(SECRET));
assert.equal(maskSecrets("nothing to hide", SECRET), "nothing to hide");
assert.equal(maskSecrets("abc", ""), "abc", "an unset key must not mask everything");

const logged = logApiStart(
  "/run-agent",
  {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", "X-API-Key": SECRET },
    body: new URLSearchParams({ task: "compliance", script_text: "INT. WAREHOUSE" }),
  },
  true,
  true
);

const pending = getApiLogSnapshot().at(-1)!;
assert.equal(pending.method, "POST");
assert.equal(pending.path, "/run-agent");
assert.equal(pending.simulated, true);
assert.equal(pending.status, null, "an in-flight call has no status yet");
assert.match(pending.requestBody ?? "", /task: compliance/, "the payload must be readable");

const headerText = pending.headers.map(([k, v]) => `${k}: ${v}`).join("\n");
assert.doesNotMatch(headerText, new RegExp(SECRET), "the key must never reach the headers view");
assert.equal(headerText.split(MASK).length - 1, 2, "both the sent and the added key header are masked");

logApiEnd(logged, { status: 200, ok: true, response: { result_id: 4101, token: SECRET } });
const settled = getApiLogSnapshot().at(-1)!;
assert.equal(settled.status, 200);
assert.equal(settled.ok, true);
assert.doesNotMatch(
  formatResponse(settled.response, SECRET),
  new RegExp(SECRET),
  "a key echoed back in a response body must be masked on display too"
);
assert.match(formatResponse(settled.response, SECRET), /"result_id": 4101/, "the rest stays readable");

// Settling twice must not overwrite the real status with the catch handler's.
logApiEnd(logged, { status: 500, ok: false, error: "later failure" });
assert.equal(getApiLogSnapshot().at(-1)!.status, 200, "an entry settles once");

for (let i = 0; i < 60; i++) logApiStart(`/spam/${i}`, {});
assert.equal(getApiLogSnapshot().length, 50, "the log is a ring buffer, not a leak");

clearApiLog();
assert.equal(getApiLogSnapshot().length, 0);
setApiLogVisible(false);

setDemo(false);
assert.equal(isDemo(), false);

console.log("demo.test.ts: all checks passed");
