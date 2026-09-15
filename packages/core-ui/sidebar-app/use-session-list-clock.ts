import { useEffect, useMemo, useState } from 'react';
import type { SidebarSessionItem } from '../../shared/session-grid-contract';
import { newSessionPriorityExpiresAt } from '../../shared/session-drafts';

/** Refresh ordering at the next creation-time deadline even when the server is idle. */
export function useSessionListClock(sessionsById: Readonly<Record<string, SidebarSessionItem>>): number {
  const [clockTick, setClockTick] = useState(Date.now);
  const nowMs = useMemo(() => Date.now(), [sessionsById, clockTick]);
  useEffect(() => {
    const now = Date.now();
    const nextExpiry = Object.values(sessionsById).reduce((next, session) => {
      const expiry = newSessionPriorityExpiresAt(session);
      return expiry > nowMs ? Math.min(next, expiry) : next;
    }, Infinity);
    if (!Number.isFinite(nextExpiry)) return;
    const delay = Math.max(0, Math.min(nextExpiry - now, 2_147_483_647));
    const timeout = window.setTimeout(() => setClockTick(Date.now()), delay);
    return () => window.clearTimeout(timeout);
  }, [sessionsById, nowMs]);
  return nowMs;
}
