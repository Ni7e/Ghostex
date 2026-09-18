import type { SidebarSessionItem } from '../../shared/session-grid-contract';

/**
 * CDXC:Projects 2026-09-16 DECISION:
 * User: closing a project in a Space stays in that Space and selects a non-sleeping session from the next project in the list.
 * The successor is resolved from the list the user is looking at (the section's Space-filtered, collection-ordered rows), so the focus never leaves the Space. Projects after the closed one are tried first, then the ones before it nearest first, and only an awake agent or terminal session counts. With no awake session in the section nothing is chosen and the host keeps its ordinary behaviour, because focusing a sleeping session would wake it.
 */
export function resolveCloseProjectSuccessorSessionId({
  closingGroupId,
  orderedGroupIds,
  sessionIdsByGroup,
  sessionsById,
}: {
  closingGroupId: string;
  orderedGroupIds: readonly string[];
  sessionIdsByGroup: Readonly<Record<string, readonly string[] | undefined>>;
  sessionsById: Readonly<Record<string, SidebarSessionItem | undefined>>;
}): string | undefined {
  const closingIndex = orderedGroupIds.indexOf(closingGroupId);
  if (closingIndex === -1) {
    return undefined;
  }
  const candidates = [...orderedGroupIds.slice(closingIndex + 1), ...orderedGroupIds.slice(0, closingIndex).reverse()];
  for (const groupId of candidates) {
    const sessionId = (sessionIdsByGroup[groupId] ?? []).find((candidate) =>
      isAwakeWorkspaceSession(sessionsById[candidate])
    );
    if (sessionId) {
      return sessionId;
    }
  }
  return undefined;
}

function isAwakeWorkspaceSession(session: SidebarSessionItem | undefined): boolean {
  return (
    session !== undefined &&
    session.kind !== 'browser' &&
    session.sessionKind !== 'browser' &&
    session.isSleeping !== true &&
    session.lifecycleState !== 'sleeping'
  );
}
