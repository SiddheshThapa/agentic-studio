// Developer-only: create accounts, change roles, remove access. No signup
// flow — the very first developer account comes from backend/seed_admin.py.
"use client";

import { useEffect, useState } from "react";
import {
  AdminUser,
  createAdminUser,
  deleteAdminUser,
  listAdminUsers,
  updateAdminUserRole,
} from "@/lib/api";
import {
  Card,
  ConfirmPanel,
  ErrorAlert,
  Field,
  PanelIntro,
  PrimaryButton,
  SecondaryButton,
  errorMessage,
  inputClass,
} from "@/components/ui";

export default function UsersPanel() {
  const [users, setUsers] = useState<AdminUser[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [reload, setReload] = useState(0);

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [role, setRole] = useState<"developer" | "client">("client");
  const [creating, setCreating] = useState(false);

  const [pendingDelete, setPendingDelete] = useState<AdminUser | null>(null);
  const [busyId, setBusyId] = useState<number | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const { users } = await listAdminUsers();
        if (!cancelled) setUsers(users);
      } catch (err) {
        if (!cancelled) setError(errorMessage(err));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [reload]);

  const create = async () => {
    setCreating(true);
    setError(null);
    try {
      await createAdminUser(email, password, role);
      setEmail("");
      setPassword("");
      setRole("client");
      setReload((n) => n + 1);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setCreating(false);
    }
  };

  const changeRole = async (user: AdminUser, next: "developer" | "client") => {
    setBusyId(user.id);
    setError(null);
    try {
      await updateAdminUserRole(user.id, next);
      setReload((n) => n + 1);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusyId(null);
    }
  };

  const remove = async (user: AdminUser) => {
    setBusyId(user.id);
    setError(null);
    try {
      await deleteAdminUser(user.id);
      setPendingDelete(null);
      setReload((n) => n + 1);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div className="space-y-6">
      <PanelIntro eyebrow="Access" title="Users">
        Who can sign in, and what they can see: &quot;client&quot; gets the client app, &quot;developer&quot;
        additionally gets this one.
      </PanelIntro>

      {error && <ErrorAlert message={error} />}

      <Card className="space-y-4">
        <p className="text-label font-medium text-ink-100">Add a user</p>
        <div className="grid gap-4 sm:grid-cols-3">
          <Field label="Email" required>
            <input
              className={inputClass}
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </Field>
          <Field label="Password" required help="At least 8 characters.">
            <input
              className={inputClass}
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </Field>
          <Field label="Role" required>
            <select
              className={inputClass}
              value={role}
              onChange={(e) => setRole(e.target.value as "developer" | "client")}
            >
              <option value="client">client</option>
              <option value="developer">developer</option>
            </select>
          </Field>
        </div>
        <PrimaryButton
          onClick={create}
          disabled={creating || !email || password.length < 8}
          loading={creating}
        >
          Create user
        </PrimaryButton>
      </Card>

      <div className="space-y-3">
        {users === null && !error && <p className="text-label text-ink-400">Loading…</p>}
        {users?.map((user) => (
          <Card key={user.id} className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="text-label font-medium text-ink-100">{user.email}</p>
              <p className="text-xs text-ink-500">
                {user.role} · added {new Date(user.created_at).toLocaleDateString()}
              </p>
            </div>
            {pendingDelete?.id === user.id ? (
              <ConfirmPanel
                title="Remove this user?"
                what={`${user.email} will no longer be able to sign in.`}
                confirmLabel="Remove"
                busy={busyId === user.id}
                onConfirm={() => remove(user)}
                onCancel={() => setPendingDelete(null)}
              />
            ) : (
              <div className="flex items-center gap-2">
                <select
                  className={`${inputClass} w-auto`}
                  value={user.role}
                  disabled={busyId === user.id}
                  onChange={(e) => changeRole(user, e.target.value as "developer" | "client")}
                >
                  <option value="client">client</option>
                  <option value="developer">developer</option>
                </select>
                <SecondaryButton onClick={() => setPendingDelete(user)} disabled={busyId === user.id}>
                  Remove
                </SecondaryButton>
              </div>
            )}
          </Card>
        ))}
      </div>
    </div>
  );
}
