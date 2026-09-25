/*
CDXC:RepoStructure 2026-08-22:
Split out of the single 21,861-line `gxserver-runtime.ts`. Pure move: no logic
changed. See `core.ts` for how the runtime's methods are re-attached.
*/
import type { GxserverPresentationSession } from '@/packages/shared/gxserver-protocol';

export function isGpuiInactiveProjectPresentationSession(session: GxserverPresentationSession): boolean {
  /*
  Stopped history can remain in the presentation when it is pinned, tagged, or
  favorited. It is not an awake inactive terminal: sending it through Sleep
  would promote it to the active `sleeping` lifecycle and make the old row
  reappear in the sidebar.
  */
  return session.lifecycleState === 'running' && session.activity !== 'working' && session.activity !== 'attention';
}

export function formatGpuiCloseAfterDoneCountdown(remainingMs: number): string {
  const totalSeconds = Math.max(0, Math.ceil(remainingMs / 1_000));
  const hours = Math.floor(totalSeconds / 3_600);
  const minutes = Math.floor((totalSeconds % 3_600) / 60);
  const seconds = totalSeconds % 60;
  const paddedMinutes = String(minutes).padStart(2, '0');
  const paddedSeconds = String(seconds).padStart(2, '0');
  if (hours > 0) {
    return `${String(hours).padStart(2, '0')}:${paddedMinutes}:${paddedSeconds}`;
  }
  return `${paddedMinutes}:${paddedSeconds}`;
}

export function formatGpuiDelayedSendDelay(delayMs: number): string {
  const totalSeconds = Math.max(1, Math.ceil(delayMs / 1_000));
  const hours = Math.floor(totalSeconds / 3_600);
  const minutes = Math.floor((totalSeconds % 3_600) / 60);
  const seconds = totalSeconds % 60;
  return [
    hours > 0 ? `${hours}h` : undefined,
    minutes > 0 ? `${minutes}m` : undefined,
    seconds > 0 ? `${seconds}s` : undefined,
  ]
    .filter((part): part is string => part !== undefined)
    .join(' ');
}
