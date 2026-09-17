import type { SessionChatTerminalActivity } from '../session-chat';
import type { ChatLifecycle } from './lifecycle';

/** How often the local clock re-renders between server samples. */
const ACTIVITY_CLOCK_TICK_MS = 1_000;

export function formatSessionChatActivityElapsed(totalSeconds: number): string {
  const seconds = Math.max(0, Math.floor(totalSeconds));
  const hours = Math.floor(seconds / 3_600);
  const minutes = Math.floor((seconds % 3_600) / 60);
  const rest = seconds % 60;
  if (hours > 0) {
    return `${hours}h ${minutes}m ${rest}s`;
  }
  if (minutes > 0) {
    return `${minutes}m ${rest}s`;
  }
  return `${rest}s`;
}

/**
 * Seconds to show now: what the CLI last reported, plus the time since that
 * sample was taken. `detectedAt` anchors the whole run, so this keeps counting
 * smoothly across probes instead of snapping backwards on each one.
 *
 * Takes the two fields rather than the activity so the background-agent strip
 * can share it: its clocks anchor on the FLEET's `detectedAt` while the seconds
 * come off each row.
 */
export function sessionChatActivityElapsedSeconds(
  activity: { elapsedSeconds?: number; detectedAt: string },
  now: number
): number | null {
  if (activity.elapsedSeconds === undefined) {
    return null;
  }
  const anchor = Date.parse(activity.detectedAt);
  if (Number.isNaN(anchor)) {
    return activity.elapsedSeconds;
  }
  return activity.elapsedSeconds + Math.max(0, (now - anchor) / 1_000);
}

export function computeSessionChatActivity(
  activity: SessionChatTerminalActivity | null,
  { useState, useEffect }: Pick<ChatLifecycle, 'useState' | 'useEffect'>
) {
  const [now, setNow] = useState(() => Date.now());
  const hasClock = activity?.elapsedSeconds !== undefined;
  useEffect(() => {
    if (!hasClock) return;
    setNow(Date.now());
    const timer = setInterval(() => setNow(Date.now()), ACTIVITY_CLOCK_TICK_MS);
    return () => clearInterval(timer);
  }, [activity?.detectedAt, hasClock]);
  if (!activity) return null;
  const elapsed = sessionChatActivityElapsedSeconds(activity, now);
  const percent = activity.percent === undefined ? null : Math.min(100, Math.max(0, Math.round(activity.percent)));
  return {
    ...activity,
    elapsedLabel: elapsed === null ? null : formatSessionChatActivityElapsed(elapsed),
    percent,
    indeterminate: activity.kind === 'compacting' && percent === null,
    shellsRunning: activity.kind === 'shells-running',
    hint: activity.kind === 'compacting' ? 'Send or queue a message and it will be posted after compaction' : null,
  };
}
