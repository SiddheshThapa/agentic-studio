"use client";
// Whether anyone is signed in, and as which role. Used by both app shells to
// decide between showing LoginForm and showing the app.

import { useEffect, useState } from "react";
import { getCurrentUser, type SessionUser } from "./api";

const DEMO_USER: SessionUser = { email: "demo@studio.example", role: "developer" };

export interface SessionState {
  /** False until the first check (real or demo) has resolved. */
  checked: boolean;
  user: SessionUser | null;
  /** Call after login/logout to re-check immediately. */
  refresh: () => void;
}

export function useSession(demo: boolean): SessionState {
  const [user, setUser] = useState<SessionUser | null>(null);
  const [checked, setChecked] = useState(false);
  const [tick, setTick] = useState(0);

  // Async IIFE + cancelled guard, not a bare setState in the effect body (see
  // InsightsPanel.tsx) — react-hooks/set-state-in-effect rejects the latter.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      // Demo Mode never reaches the network (see demo.ts) — session included,
      // rather than adding fixtures for a login system that isn't the point
      // of a demo.
      if (demo) {
        if (!cancelled) {
          setUser(DEMO_USER);
          setChecked(true);
        }
        return;
      }
      try {
        const me = await getCurrentUser();
        if (!cancelled) setUser(me);
      } catch {
        if (!cancelled) setUser(null);
      } finally {
        if (!cancelled) setChecked(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [demo, tick]);

  return { checked, user, refresh: () => setTick((n) => n + 1) };
}
