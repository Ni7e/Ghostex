import { sidebarStore } from '@/packages/core-ui/sidebar-store-model';
import { getSessionCardTimerTrailingLabel } from '@/packages/core-ui/session-card-presentation';
import { formatRelativeTime } from '@/packages/core-ui/relative-time';
import type { NativeSidebarClockRow } from '@/packages/shared/native-sidebar';

export function createNativeSidebarClock() {
  let previous = new Map<string, string>();
  return (): NativeSidebarClockRow[] => {
    const next = new Map<string, string>();
    const rows: NativeSidebarClockRow[] = [];
    const nowMs = Date.now();
    for (const session of Object.values(sidebarStore.getState().sessionsById)) {
      const row = {
        sessionId: session.sessionId,
        timerLabel: getSessionCardTimerTrailingLabel(session, nowMs),
        lastInteractionLabel: session.lastInteractionAt
          ? formatRelativeTime(session.lastInteractionAt, { allowJustNow: false, nowMs }).value
          : undefined,
      };
      const key = JSON.stringify(row);
      next.set(row.sessionId, key);
      if (previous.get(row.sessionId) !== key) rows.push(row);
    }
    previous = next;
    return rows;
  };
}
