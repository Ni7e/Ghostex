import { formatProjectTooltipGitStats, formatCountLabel } from '@/packages/core-ui/project-tooltip-model';
import { sidebarStore } from '@/packages/core-ui/sidebar-store-model';
import {
  getAwakeTerminalAndBrowserCount,
  getGroupSessionSummary,
} from '@/packages/core-ui/group-session-summary';
import { createNativeProjectHeaderActions } from './project-actions';
import { createNativeProjectMenu } from './project-menu';
import { projectSessionSections } from '@/packages/core-ui/sidebar-app/project-session-sections';
import type { SidebarSessionGroup } from '@/packages/shared/session-grid-contract';
import type { ghostexSettings } from '@/packages/shared/ghostex-settings';
import type { NativeSidebarGroup } from '@/packages/shared/native-sidebar';
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
    summary: {
      ...getGroupSessionSummary(group.sessions),
      awakeCount: getAwakeTerminalAndBrowserCount(group.sessions),
    },
    hoverActionsExpanded: !!ui.collapse.expandedSessionCardHoverActionsById[storageId],
    menu: createNativeProjectMenu(group, ui),
    headerActions: createNativeProjectHeaderActions(group),
    collapsed: !!ui.collapse.collapsedGroupsById[group.groupId],
    ...projectSessionSections(group, {
      enableSessionParking: settings.enableSessionParking,
      compactCount: settings.projectSessionListCollapsedCount,
      expanded: !!ui.collapse.expandedProjectSessionListsById[storageId],
      sectionState: ui.collapse.collapsedProjectSessionSectionsById[storageId],
    }),
  };
}
