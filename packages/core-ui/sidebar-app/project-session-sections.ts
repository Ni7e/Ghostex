import type { SidebarSessionGroup } from '@/packages/shared/session-grid-contract';
import type { NativeSidebarSection } from '@/packages/shared/native-sidebar';
import { getVisibleProjectSessionIds } from '../project-session-list-toggle';
import {
  getProjectSessionSection,
  DEFAULT_PROJECT_SESSION_SECTION_COLLAPSE_STATE,
  type ProjectSessionSectionCollapseState,
} from './project-session-section-model';

/** CDXC:Sessions 2026-09-17 DECISION:
 * User: the standalone terminal debugger and its Herdr wrapper must show exactly the GPUI session sections and order.
 * GPUI and the TUI use this same section and compact-list projection after createDisplaySessionLayout.
 */
export function projectSessionSections(
  group: SidebarSessionGroup,
  {
    enableSessionParking,
    compactCount,
    expanded,
    sectionState = DEFAULT_PROJECT_SESSION_SECTION_COLLAPSE_STATE,
    nowMs = Date.now(),
  }: {
    enableSessionParking: boolean;
    compactCount: number;
    expanded: boolean;
    sectionState?: ProjectSessionSectionCollapseState;
    nowMs?: number;
  }
) {
  const sectionIds: NativeSidebarSection['id'][] = [
    'browser',
    'pinned',
    'drafts',
    'sessions',
    'parked',
    'snoozed',
  ];
  const sectionBySession = new Map(
    group.sessions.map((session) => [
      session.sessionId,
      getProjectSessionSection(session, enableSessionParking, nowMs),
    ])
  );
  const isCollapsed = (id: string) => sectionState[sectionBySession.get(id)!];
  const visible = new Set(
    getVisibleProjectSessionIds({
      compactCount,
      isExpanded: expanded,
      isProjectGroup: !!group.projectContext,
      isToggleEnabled: true,
      isSessionInCollapsedSection: isCollapsed,
      sessionIds: group.sessions.map((session) => session.sessionId),
    })
  );
  return {
    showListToggle:
      !!group.projectContext &&
      group.sessions.filter((session) => !isCollapsed(session.sessionId)).length > compactCount,
    expanded,
    hiddenSessionCount: group.sessions.filter(
      (session) => !isCollapsed(session.sessionId) && !visible.has(session.sessionId)
    ).length,
    sections: sectionIds.flatMap((id) => {
      const sessions = group.sessions.filter((session) => sectionBySession.get(session.sessionId) === id);
      return sessions.length
        ? [
            {
              id,
              collapsed: sectionState[id],
              count: sessions.length,
              containsActiveSession: group.isActive && sessions.some((session) => session.isFocused),
              workingCount: sessions.filter((session) => session.activity === 'working').length,
              attentionCount: sessions.filter(
                (session) => session.activity === 'attention' && !session.pendingQuestionCount
              ).length,
              questionCount: sessions.filter((session) => (session.pendingQuestionCount ?? 0) > 0).length,
              sessionIds: sessions
                .filter((session) => visible.has(session.sessionId))
                .map((session) => session.sessionId),
            },
          ]
        : [];
    }),
  };
}
