type DraftSession = {
  createdAt?: string;
  isDraft?: boolean;
  isPinned?: boolean;
  hasComposerDraft?: boolean;
};

/**
 * CDXC:Drafts 2026-09-15 DECISION:
 * User: new sessions lead Sessions for 10 minutes, then move into a collapsed-by-default DRAFTS section below Pinned and above Sessions if they contain text and have not been sent yet.
 * User: pinning a draft moves it into Pinned, retaining its unsent text.
 * This replaces keeping drafts at the top of Sessions indefinitely; empty sessions stay in Sessions.
 * SEE-ALSO: packages/shared/active-sessions-sort.ts, packages/core-ui/sidebar-app/project-session-section-state.ts.
 */
export const NEW_SESSION_PRIORITY_MS = 10 * 60 * 1_000;

export function newSessionPriorityExpiresAt(session: DraftSession | undefined): number {
  return Date.parse(session?.createdAt ?? '') + NEW_SESSION_PRIORITY_MS;
}

export function isNewSidebarSession(session: DraftSession | undefined, nowMs: number = Date.now()): boolean {
  return newSessionPriorityExpiresAt(session) > nowMs;
}

export function isSidebarDraftSectionSession(
  session: DraftSession | undefined,
  nowMs: number = Date.now()
): boolean {
  return (
    session?.isDraft === true &&
    session.isPinned !== true &&
    session.hasComposerDraft === true &&
    !isNewSidebarSession(session, nowMs)
  );
}
