import { formatProjectTooltipGitStats, formatCountLabel } from '@/packages/core-ui/project-tooltip-model';
import { sidebarStore } from '@/packages/core-ui/sidebar-store-model';
import { getAwakeTerminalAndBrowserCount, getGroupSessionSummary } from '@/packages/core-ui/group-session-summary';
import { createNativeProjectHeaderActions } from './project-actions';
import { createNativeProjectMenu } from './project-menu';
import {
  getProjectSessionSection,
  DEFAULT_PROJECT_SESSION_SECTION_COLLAPSE_STATE,
} from '@/packages/core-ui/sidebar-app/project-session-section-model';
import { getVisibleProjectSessionIds } from '@/packages/core-ui/project-session-list-toggle';
import type { SidebarSessionGroup } from '@/packages/shared/session-grid-contract';
import type { ghostexSettings } from '@/packages/shared/ghostex-settings';
import type { NativeSidebarGroup, NativeSidebarSection } from '@/packages/shared/native-sidebar';
import type { NativeSidebarUiState } from './ui-state';

export function projectNativeSidebarGroup(
  group: SidebarSessionGroup,
  ui: NativeSidebarUiState,
  settings: ghostexSettings
): NativeSidebarGroup {
  const rawStorageId = group.projectContext?.editor.projectId ?? group.groupId;
  const storageId = group.remoteMachineContext?.machineId
    ? `remote:${group.remoteMachineContext.machineId}:${rawStorageId}`
    : rawStorageId;
  const sectionState =
    ui.collapse.collapsedProjectSessionSectionsById[storageId] ?? DEFAULT_PROJECT_SESSION_SECTION_COLLAPSE_STATE;
  const sectionIds: NativeSidebarSection['id'][] = ['browser', 'pinned', 'drafts', 'sessions', 'parked', 'snoozed'];
  const nowMs = Date.now();
  const sectionBySession = new Map(
    group.sessions.map((session) => [
      session.sessionId,
      getProjectSessionSection(session, settings.enableSessionParking, nowMs),
    ])
  );
  const isCollapsed = (id: string) => sectionState[sectionBySession.get(id)!];
  const expanded = !!ui.collapse.expandedProjectSessionListsById[storageId];
  const visible = new Set(
    getVisibleProjectSessionIds({
      compactCount: settings.projectSessionListCollapsedCount,
      isExpanded: expanded,
      isProjectGroup: !!group.projectContext,
      isToggleEnabled: true,
      isSessionInCollapsedSection: isCollapsed,
      sessionIds: group.sessions.map((session) => session.sessionId),
    })
  );
  const project = group.projectContext;
  const worktrees = project
    ? Object.values(sidebarStore.getState().groupsById).filter(
        (candidate) => candidate?.projectContext?.worktree?.parentProjectId === project.editor.projectId
      ).length
    : 0;
  const titleTooltip = project
    ? [
        group.title,
        project.worktree ? 'Worktree project' : 'Repository project',
        project.path,
        formatProjectTooltipGitStats(project.editor.diffStats),
        `${group.sessions.length} ${formatCountLabel(group.sessions.length, 'session')} · ${worktrees} ${formatCountLabel(worktrees, 'worktree')}`,
      ].join('\n')
    : undefined;
  return {
    ...group,
    titleTooltip,
    storageId,
    summary: { ...getGroupSessionSummary(group.sessions), awakeCount: getAwakeTerminalAndBrowserCount(group.sessions) },
    hoverActionsExpanded: !!ui.collapse.expandedSessionCardHoverActionsById[storageId],
    menu: createNativeProjectMenu(group, ui),
    headerActions: createNativeProjectHeaderActions(group),
    showListToggle:
      !!group.projectContext &&
      group.sessions.filter((session) => !isCollapsed(session.sessionId)).length >
        settings.projectSessionListCollapsedCount,
    collapsed: !!ui.collapse.collapsedGroupsById[group.groupId],
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
