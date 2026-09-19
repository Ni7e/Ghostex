import type { SidebarActiveSessionsSortMode, SidebarSessionItem } from './session-grid-contract-sidebar';
import { isSidebarSessionSnoozed } from './session-snooze';
import { isNewSidebarSession, isSidebarDraftSectionSession } from './session-drafts';

export type SessionIdsByGroup = Record<string, string[]>;

export type CreateDisplaySessionLayoutOptions = {
  enableSessionParking?: boolean;
  nowMs?: number;
  sessionIdsByGroup: SessionIdsByGroup;
  sessionsById: Record<string, SidebarSessionItem>;
  sortMode: SidebarActiveSessionsSortMode;
  workspaceGroupIds: readonly string[];
};

export function createDisplaySessionLayout({
  enableSessionParking = false,
  nowMs = Date.now(),
  sessionIdsByGroup,
  sessionsById,
  sortMode,
  workspaceGroupIds,
}: CreateDisplaySessionLayoutOptions): {
  groupIds: string[];
  sessionIdsByGroup: SessionIdsByGroup;
} {
  const manualSessionIdsByGroup = Object.fromEntries(
    workspaceGroupIds.map((groupId) => [
      groupId,
      orderProjectSessionsForDisplay(sessionIdsByGroup[groupId] ?? [], sessionsById, {
        enableSessionParking,
        nowMs,
      }),
    ])
  );
  if (sortMode === 'manual') {
    /*
    CDXC:Sessions 2026-06-05-12:30:
    Manual Sorting preserves the saved non-draft, unparked order inside each session kind. Browser
    tabs are the first section, so they stay above terminals even when
    either kind contains pinned rows.
    */
    return {
      groupIds: [...workspaceGroupIds],
      sessionIdsByGroup: manualSessionIdsByGroup,
    };
  }

  const sortedSessionIdsByGroup = Object.fromEntries(
    workspaceGroupIds.map((groupId) => [
      groupId,
      orderProjectSessionsForDisplay(sessionIdsByGroup[groupId] ?? [], sessionsById, {
        enableSessionParking,
        nowMs,
        sortUnpinnedByLastActivity: true,
      }),
    ])
  );

  return {
    groupIds: [...workspaceGroupIds],
    sessionIdsByGroup: sortedSessionIdsByGroup,
  };
}

export function getDisplaySessionIdsInOrder(options: CreateDisplaySessionLayoutOptions): string[] {
  const displayLayout = createDisplaySessionLayout(options);
  return displayLayout.groupIds.flatMap((groupId) => displayLayout.sessionIdsByGroup[groupId] ?? []);
}

/**
 * CDXC:Drafts 2026-09-15 SEE-ALSO:
 * packages/shared/session-drafts.ts owns the new-session grace period and Drafts membership.
 */
function orderProjectSessionsForDisplay(
  sessionIds: readonly string[],
  sessionsById: Record<string, SidebarSessionItem>,
  options: { enableSessionParking?: boolean; sortUnpinnedByLastActivity?: boolean; nowMs?: number } = {}
): string[] {
  /**
   * CDXC:Sessions 2026-05-28-12:04:
   * Pinned sessions stay above other sessions of their kind regardless of
   * the active session sort mode. Preserve the existing order inside pinned and
   * unpinned partitions so users can rearrange pinned rows while non-pinned
   * activity/browser ordering remains predictable.
   */
  const browserSessionIds: string[] = [];
  const terminalSessionIds: string[] = [];

  for (const sessionId of sessionIds) {
    if (isBrowserSession(sessionsById[sessionId])) {
      browserSessionIds.push(sessionId);
    } else {
      terminalSessionIds.push(sessionId);
    }
  }

  return [
    ...orderSessionKindForDisplay(browserSessionIds, sessionsById, options),
    ...orderSessionKindForDisplay(terminalSessionIds, sessionsById, options),
  ];
}

function orderSessionKindForDisplay(
  sessionIds: readonly string[],
  sessionsById: Record<string, SidebarSessionItem>,
  options: { enableSessionParking?: boolean; sortUnpinnedByLastActivity?: boolean; nowMs?: number }
): string[] {
  const pinnedSessionIds: string[] = [];
  const newSessionIds: string[] = [];
  const draftSessionIds: string[] = [];
  const otherSessionIds: string[] = [];
  const parkedSessionIds: string[] = [];
  const snoozedSessionIds: string[] = [];
  const nowMs = options.nowMs ?? Date.now();
  for (const sessionId of sessionIds) {
    const session = sessionsById[sessionId];
    if (isSidebarSessionSnoozed(session, nowMs)) {
      snoozedSessionIds.push(sessionId);
    } else if (options.enableSessionParking && session?.isParked === true) {
      parkedSessionIds.push(sessionId);
    } else if (!isBrowserSession(session) && isSidebarDraftSectionSession(session, nowMs)) {
      draftSessionIds.push(sessionId);
    } else if (session?.isPinned === true) {
      pinnedSessionIds.push(sessionId);
    } else if (!isBrowserSession(session) && isNewSidebarSession(session, nowMs)) {
      newSessionIds.push(sessionId);
    } else {
      otherSessionIds.push(sessionId);
    }
  }

  return [
    ...pinnedSessionIds,
    ...draftSessionIds.sort((leftId, rightId) => {
      const leftTime = Date.parse(sessionsById[leftId]?.createdAt ?? '');
      const rightTime = Date.parse(sessionsById[rightId]?.createdAt ?? '');
      return (Number.isFinite(rightTime) ? rightTime : 0) - (Number.isFinite(leftTime) ? leftTime : 0);
    }),
    ...newSessionIds.sort((leftId, rightId) => {
      const leftTime = Date.parse(sessionsById[leftId]?.createdAt ?? '');
      const rightTime = Date.parse(sessionsById[rightId]?.createdAt ?? '');
      return (Number.isFinite(rightTime) ? rightTime : 0) - (Number.isFinite(leftTime) ? leftTime : 0);
    }),
    ...(options.sortUnpinnedByLastActivity
      ? sortSessionIdsByLastActivity(otherSessionIds, sessionsById)
      : otherSessionIds),
    ...sortParkedSessionIdsByLastActivity(parkedSessionIds, sessionsById),
    ...snoozedSessionIds,
  ];
}

/** CDXC:Sessions 2026-09-12 DECISION:
 * User: every sidebar and session list on GPUI, mobile and web shows parked sessions from latest active to oldest, regardless of the active-session sort mode.
 * Parked rows use the activity timestamp alone, without attention or working priority.
 * SEE-ALSO: apps/mobile/app/src/contract/grouping.ts mirrors this ordering.
 */
function sortParkedSessionIdsByLastActivity(
  sessionIds: readonly string[],
  sessionsById: Record<string, SidebarSessionItem>
): string[] {
  return sessionIds
    .map((sessionId) => ({ sessionId, time: getSessionLastActivityTime(sessionsById[sessionId]) }))
    .sort((left, right) => right.time - left.time || left.sessionId.localeCompare(right.sessionId))
    .map((entry) => entry.sessionId);
}

/**
 * CDXC:Sessions 2026-09-19 WHY:
 * The comparators parsed every timestamp again on every comparison, so one sidebar projection ran a few thousand `Date.parse` calls; in the desktop's QuickJS service thread that was most of the projection's fixed cost.
 * Each session's priority and time are computed once, then the keys are sorted; the order, including the index tie-break, is unchanged.
 */
function sortSessionIdsByLastActivity(
  sessionIds: readonly string[],
  sessionsById: Record<string, SidebarSessionItem>
): string[] {
  return sessionIds
    .map((sessionId, index) => {
      const session = sessionsById[sessionId];
      const priority = getSessionActivitySortPriority(session);
      return { sessionId, index, priority, time: getSessionActivitySortTime(session, priority) };
    })
    .sort((left, right) => right.priority - left.priority || right.time - left.time || left.index - right.index)
    .map((entry) => entry.sessionId);
}

function isBrowserSession(session: SidebarSessionItem | undefined): boolean {
  return session?.kind === 'browser' || session?.sessionKind === 'browser';
}

function getSessionActivitySortPriority(session: SidebarSessionItem | undefined): number {
  switch (session?.activity) {
    case 'attention':
      return 2;
    case 'working':
      return isMeaningfulWorkingStint(session) ? 1 : 0;
    default:
      return 0;
  }
}

/**
 * CDXC:AgentScreenDetection 2026-07-29-12:00:
 * A working session only earns activity-sort priority once gxserver's
 * meaningful-activity clock has caught up with the current stint
 * (lastInteractionAt >= workingStartedAt). Short working blips from tiny
 * commands or wake redraws therefore never move a row, not even briefly.
 * Rows without both timestamps (older daemons, native-host sessions) keep the
 * legacy immediate priority.
 */
function isMeaningfulWorkingStint(session: SidebarSessionItem): boolean {
  if (!session.workingStartedAt || !session.lastInteractionAt) {
    return true;
  }
  const workingStartedTime = Date.parse(session.workingStartedAt);
  const recencyTime = Date.parse(session.lastInteractionAt);
  if (!Number.isFinite(workingStartedTime) || !Number.isFinite(recencyTime)) {
    return true;
  }
  return recencyTime >= workingStartedTime;
}

/**
 * CDXC:SessionStatus 2026-07-30-07:50:
 * A meaningful working stint sorts by when it STARTED, never by the
 * meaningful-activity recency clock. gxserver keeps bumping
 * lastInteractionAt (~10s cadence) for every working session while it runs,
 * and those bumps land as separate presentation deltas, so ranking working
 * rows by recency made concurrently-working sessions leapfrog each other on
 * every tick. workingStartedAt is frozen for the whole stint, so a row moves
 * once when its stint earns priority and holds that slot until the stint
 * ends. Legacy working rows without a stint stamp keep the recency ordering.
 */
function getSessionActivitySortTime(session: SidebarSessionItem | undefined, activityPriority: number): number {
  if (activityPriority === 1 && session?.workingStartedAt) {
    const workingStartedTime = Date.parse(session.workingStartedAt);
    if (Number.isFinite(workingStartedTime)) {
      return workingStartedTime;
    }
  }
  return getSessionLastActivityTime(session);
}

/** Parsed once per session object and revalidated against the string, since every projection sorts every row. */
const parsedLastActivity = new WeakMap<SidebarSessionItem, { source: string; timeMs: number }>();

function getSessionLastActivityTime(session: SidebarSessionItem | undefined): number {
  if (!session?.lastInteractionAt) {
    return 0;
  }
  const cached = parsedLastActivity.get(session);
  if (cached && cached.source === session.lastInteractionAt) {
    return cached.timeMs;
  }
  const timestamp = Date.parse(session.lastInteractionAt);
  const timeMs = Number.isFinite(timestamp) ? timestamp : 0;
  parsedLastActivity.set(session, { source: session.lastInteractionAt, timeMs });
  return timeMs;
}
