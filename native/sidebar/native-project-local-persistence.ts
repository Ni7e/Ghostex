import {
  DEFAULT_TERMINAL_SESSION_TITLE,
  type SessionRecord,
  type TerminalSessionRecord,
} from "../../shared/session-grid-contract";

const GXSERVER_LOCAL_SESSION_ID_PATTERN = /^G[0-9][a-z0-9]{3}$/u;
const GXSERVER_LOCAL_SESSION_PLACEHOLDER_CREATED_AT = "1970-01-01T00:00:00.000Z";

export function isGxserverBackedLocalPersistedSession(sessionId: string): boolean {
  return GXSERVER_LOCAL_SESSION_ID_PATTERN.test(sessionId);
}

export function createLocalPersistableSessionRecord<T extends SessionRecord>(session: T): T {
  if (session.kind !== "terminal" || !isGxserverBackedLocalPersistedSession(session.sessionId)) {
    return session;
  }
  /*
  CDXC:ProjectSidebarOwnership 2026-06-02-15:18:
  WK project storage is a macOS pane/layout cache after the gxserver cutoff. For canonical G terminal rows, persist only the fields needed to place a native tab; gxserver owns titles, aliases, lifecycle/activity, provider metadata, favorite/pin state, agent metadata, and durable timestamps.

  CDXC:DelayedSend 2026-06-02-19:07:
  Delayed Send timers are still macOS current-window behavior: gxserver can shape launch plans from delayed-send input, but live timer scheduling and restart re-arming remain in the native sidebar until a gxserver timer API exists. Keep `delayedSendDeadlineAt` as a local timer field, not shared session identity.

  CDXC:CloseAfterDone 2026-06-15-21:00:
  Close After Done is also macOS current-window timer behavior. Preserve only
  the armed flag locally so restart can re-arm the three-minute Done watcher
  without persisting gxserver-owned titles, activity, or provider identity.

  CDXC:SessionTags 2026-06-05-12:30:
  Session tags are gxserver-owned shared metadata beside pinned/favorite state. Do not persist them in the macOS pane/layout cache for canonical G sessions, or stale localStorage could override the tag shown after gxserver presentation loads.
  */
  const sanitized: TerminalSessionRecord = {
    alias: DEFAULT_TERMINAL_SESSION_TITLE,
    column: session.column,
    closeAfterDone: session.closeAfterDone === true ? true : undefined,
    createdAt: GXSERVER_LOCAL_SESSION_PLACEHOLDER_CREATED_AT,
    delayedSendDeadlineAt: session.delayedSendDeadlineAt,
    displayId: session.sessionId,
    isPoppedOut: session.isPoppedOut,
    kind: "terminal",
    row: session.row,
    sessionId: session.sessionId,
    slotIndex: session.slotIndex,
    surface: session.surface,
    terminalEngine: session.terminalEngine,
    title: DEFAULT_TERMINAL_SESSION_TITLE,
    titleSource: "placeholder",
  };
  return sanitized as T;
}
