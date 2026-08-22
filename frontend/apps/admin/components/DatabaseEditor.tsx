// Write controls for the Database tab: one form used for both adding and editing,
// and the delete confirmation.
//
// The form is built from the column metadata the API sends, so it has no compiled-in
// knowledge of any table. Fields the API flags `structural` start locked: unlocking
// one is a deliberate step with its own confirmation, and changing one adds a second
// confirmation before anything is saved. Neither blocks the edit — they just make it
// impossible to do by accident.
"use client";

import { useState } from "react";
import {
  AdminColumn,
  AdminRow,
  AdminTableName,
  createAdminRow,
  deleteAdminRow,
  updateAdminRow,
} from "@/lib/api";
import { Card, ConfirmPanel, ErrorAlert, PrimaryButton, errorMessage, inputClass } from "@/components/ui";
import { DATABASE_COPY, DATABASE_WRITE_COPY as W } from "@/lib/content";

function riskOf(table: string, column: string): string {
  return W.structuralRisks[`${table}.${column}`] ?? W.structuralRiskFallback;
}

function isNumeric(type: string): boolean {
  return /int|double|numeric|real|decimal/i.test(type);
}

function isJson(type: string): boolean {
  return /json/i.test(type);
}

/** Row value → what goes in the input. Objects are shown as formatted JSON. */
function toField(value: unknown): string {
  if (value == null) return "";
  if (typeof value === "object") return JSON.stringify(value, null, 2);
  return String(value);
}

/** Input → what goes on the wire. Throws a message the user can act on. */
function fromField(column: AdminColumn, raw: string): unknown {
  if (isJson(column.type)) {
    try {
      return JSON.parse(raw);
    } catch {
      throw new Error(`${column.name}: ${W.jsonInvalid}`);
    }
  }
  if (isNumeric(column.type)) {
    const parsed = Number(raw);
    if (raw.trim() === "" || Number.isNaN(parsed)) throw new Error(`${column.name}: ${W.numberInvalid}`);
    return parsed;
  }
  return raw;
}

export function RowEditor({
  table,
  label,
  columns,
  row,
  primaryKey,
  onCancel,
  onSaved,
}: {
  table: AdminTableName;
  label: string;
  columns: AdminColumn[];
  /** null when adding. */
  row: AdminRow | null;
  primaryKey: string;
  onCancel: () => void;
  onSaved: (message: string) => void;
}) {
  const creating = row === null;

  // Adding: hide the columns the database fills in itself (serial ids, NOW()
  // defaults). Editing: show everything readable, including those, so a
  // structural column is never unreachable — only locked.
  const fields = columns.filter((c) => !c.omitted && (!creating || !c.default));

  const initial = Object.fromEntries(fields.map((c) => [c.name, toField(row?.[c.name])]));
  const [values, setValues] = useState<Record<string, string>>(initial);
  const [unlocked, setUnlocked] = useState<string[]>([]);
  const [askingUnlock, setAskingUnlock] = useState<AdminColumn | null>(null);
  const [confirmingSave, setConfirmingSave] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const changed = fields.filter((c) => values[c.name] !== initial[c.name]).map((c) => c.name);
  const structuralChanged = changed.filter((name) => fields.some((c) => c.name === name && c.structural));

  /** Collect the payload, or surface the first field that cannot be converted. */
  function payload(): Record<string, unknown> | null {
    const include = creating ? fields.filter((c) => values[c.name].trim() !== "") : fields.filter((c) => changed.includes(c.name));
    try {
      return Object.fromEntries(include.map((c) => [c.name, fromField(c, values[c.name])]));
    } catch (err) {
      setError(errorMessage(err));
      return null;
    }
  }

  async function save() {
    setError("");
    const body = payload();
    if (body === null) return;
    if (Object.keys(body).length === 0) {
      setError(creating ? W.emptyCreate : W.noChanges);
      return;
    }

    // The extra step: changing something the app depends on is never one click.
    if (structuralChanged.length > 0 && !confirmingSave) {
      setConfirmingSave(true);
      return;
    }

    setBusy(true);
    try {
      if (creating) {
        await createAdminRow(table, body);
        onSaved(W.created(label));
      } else {
        const res = await updateAdminRow(table, String(row[primaryKey]), body);
        onSaved(W.updated(res.updated?.length ?? Object.keys(body).length));
      }
    } catch (err) {
      setError(errorMessage(err));
      setConfirmingSave(false);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card className="space-y-5">
      <div>
        <h3 className="font-semibold">{creating ? W.createTitle(label) : W.editTitle(label)}</h3>
        {creating ? (
          <p className="mt-1 text-sm text-ink-400">{W.createHint}</p>
        ) : (
          <p className="mt-1 text-sm text-ink-400">
            {changed.length === 0 ? W.noChanges : W.changedFields(changed.length)}
          </p>
        )}
      </div>

      <div className="space-y-4">
        {fields.map((column) => {
          const locked = column.structural && !unlocked.includes(column.name);
          const edited = changed.includes(column.name);

          return (
            <div key={column.name} className="space-y-1.5">
              <div className="flex flex-wrap items-center gap-2">
                <label className="text-sm font-medium text-ink-100">{column.name}</label>
                <span className="text-[10px] uppercase tracking-wide text-ink-600">{column.type}</span>
                {column.nullable && <span className="text-[10px] text-ink-600">{W.optional}</span>}
                {column.structural && (
                  <span className="rounded-full border border-iris-500/30 bg-iris-500/10 px-2 py-0.5 text-[10px] font-medium text-iris-200">
                    {DATABASE_COPY.structuralChip}
                  </span>
                )}
                {edited && (
                  <span className="rounded-full border border-emerald-500/25 bg-emerald-500/10 px-2 py-0.5 text-[10px] text-emerald-300">
                    changed
                  </span>
                )}
              </div>

              {column.structural && (
                <p className="text-xs leading-relaxed text-ink-400">
                  {DATABASE_COPY.structuralLabels[`${table}.${column.name}`] ??
                    DATABASE_COPY.structuralFallback}
                </p>
              )}

              {isJson(column.type) || /text/i.test(column.type) ? (
                <textarea
                  value={values[column.name]}
                  disabled={locked}
                  onChange={(e) => setValues({ ...values, [column.name]: e.target.value })}
                  className={`${inputClass} h-24 resize-y font-mono text-xs leading-relaxed disabled:cursor-not-allowed disabled:opacity-50`}
                />
              ) : (
                <input
                  value={values[column.name]}
                  disabled={locked}
                  placeholder={/timestamp/i.test(column.type) ? W.timestampHint : undefined}
                  onChange={(e) => setValues({ ...values, [column.name]: e.target.value })}
                  className={`${inputClass} disabled:cursor-not-allowed disabled:opacity-50`}
                />
              )}

              {isJson(column.type) && <p className="text-xs text-ink-600">{W.jsonHint}</p>}

              {column.structural && (
                <div className="flex flex-wrap items-center gap-2">
                  {locked ? (
                    <>
                      <span className="text-xs text-iris-300">{W.locked}</span>
                      <button
                        onClick={() => setAskingUnlock(column)}
                        className="press text-xs text-ink-400 underline underline-offset-2 transition-colors hover:text-ink-100"
                      >
                        {W.unlock}
                      </button>
                    </>
                  ) : (
                    <button
                      onClick={() => {
                        setUnlocked(unlocked.filter((n) => n !== column.name));
                        setValues({ ...values, [column.name]: initial[column.name] });
                      }}
                      className="press text-xs text-ink-500 underline underline-offset-2 hover:text-ink-300"
                    >
                      {W.relock}
                    </button>
                  )}
                </div>
              )}

              {askingUnlock?.name === column.name && (
                <ConfirmPanel
                  tone="amber"
                  title={W.unlockTitle(column.name)}
                  what={W.unlockWhat}
                  risk={riskOf(table, column.name)}
                  confirmLabel={W.unlock}
                  onConfirm={() => {
                    setUnlocked([...unlocked, column.name]);
                    setAskingUnlock(null);
                  }}
                  onCancel={() => setAskingUnlock(null)}
                />
              )}
            </div>
          );
        })}
      </div>

      {error && <ErrorAlert message={error} />}

      {confirmingSave ? (
        <ConfirmPanel
          tone="amber"
          title={W.saveStructuralTitle}
          what={W.saveStructuralWhat(structuralChanged)}
          risk={structuralChanged.map((name) => riskOf(table, name)).join("\n\n")}
          confirmLabel={W.saveStructuralConfirm}
          busy={busy}
          onConfirm={save}
          onCancel={() => setConfirmingSave(false)}
        />
      ) : (
        <div className="flex flex-wrap gap-2 border-t border-white/8 pt-4">
          <PrimaryButton onClick={save} disabled={busy} loading={busy}>
            {busy ? W.saving : creating ? W.create : W.save}
          </PrimaryButton>
          <button
            onClick={onCancel}
            disabled={busy}
            className="press rounded-[var(--radius-control)] border border-white/8 px-4 text-sm text-ink-400 transition-colors hover:text-ink-100 disabled:opacity-40"
          >
            {W.cancel}
          </button>
        </div>
      )}
    </Card>
  );
}

export function DeleteConfirm({
  table,
  rowId,
  filename,
  chunks,
  onCancel,
  onDeleted,
}: {
  table: AdminTableName;
  rowId: string;
  /** documents only: the file whose whole chunk group goes with this row. */
  filename?: string;
  chunks?: number;
  onCancel: () => void;
  onDeleted: (message: string) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function remove() {
    setBusy(true);
    setError("");
    try {
      const res = await deleteAdminRow(table, rowId);
      onDeleted(
        res.grouped_by === "filename"
          ? W.deletedMany(res.deleted_rows, res.filename ?? filename ?? "")
          : W.deletedOne
      );
    } catch (err) {
      setError(errorMessage(err));
      setBusy(false);
    }
  }

  return (
    <div className="space-y-3">
      <ConfirmPanel
        title={W.deleteTitle}
        what={W.deleteRisk(table, { id: rowId, filename, chunks })}
        confirmLabel={W.deleteConfirm}
        busy={busy}
        onConfirm={remove}
        onCancel={onCancel}
      />
      {error && <ErrorAlert message={error} />}
    </div>
  );
}
