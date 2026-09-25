/*
CDXC:RepoStructure 2026-08-22:
Split out of the single 21,861-line `gxserver-runtime.ts`. Pure move: no logic
changed. See `core.ts` for how the runtime's methods are re-attached.
*/
import type { GxserverSleepSessionResult } from '@/packages/shared/gxserver-protocol';

/*
CDXC:KeepAwake 2026-08-19:
gxserver answers a declined automatic sleep with an untouched session and a
reason, which is NOT a failure: `keptAwake` means another client is attached to
that terminal, `neverActive` means nobody has prompted it yet. The sweep treats
either as "leave this row alone" and moves on.
*/
export function gxserverSleepWasDeclined(result: GxserverSleepSessionResult | undefined): boolean {
  return result?.declined !== undefined;
}

/**
 * CDXC:FocusRouting 2026-09-19 WHY:
 * A wake takes as long as the daemon needs, and focus belongs to the Rust store, which tells this runtime every selection the user makes meanwhile. A wake that finishes after the user selected another session must not take focus back: Rust cannot refuse it by stamp, because this runtime already echoes the newest one. Focus that is still where it was when the wake started, or already on the woken session (Rust selected its tab and told us), means the user is still waiting for it.
 */
export function focusMovedElsewhereDuringWake(
  focusedSessionId: string | undefined,
  focusedSessionIdBeforeWake: string | undefined,
  wokenSessionId: string
): boolean {
  return focusedSessionId !== focusedSessionIdBeforeWake && focusedSessionId !== wokenSessionId;
}
