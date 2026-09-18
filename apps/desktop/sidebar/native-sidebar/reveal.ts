import { sidebarStore } from '@/packages/core-ui/sidebar-store-model';
import { normalizeghostexSettings } from '@/packages/shared/ghostex-settings';
import { sessionMatchesSidebarTagFilters } from '@/packages/shared/session-tags';
import {
  getProjectSessionSection,
  DEFAULT_PROJECT_SESSION_SECTION_COLLAPSE_STATE,
} from '@/packages/core-ui/sidebar-app/project-session-section-model';
import { getVisibleProjectSessionIds } from '@/packages/core-ui/project-session-list-toggle';
import { createDisplaySessionLayout } from '@/packages/shared/active-sessions-sort';
import { writeSidebarUiCollapseState } from '@/packages/core-ui/sidebar-app/collapse-state';
import { describeNativeSidebarMachine, rememberNativeSidebarFocus } from './space-navigation';
import type { NativeSidebarUiState } from './ui-state';

export function applyNativeSidebarReveal(ui: NativeSidebarUiState) {
  const request = ui.revealRequest;
  if (!request || request.requestId === ui.handledRevealRequestId) return;
  const state = sidebarStore.getState();
  const groupId = state.groupOrder.find((id) => state.sessionIdsByGroup[id]?.includes(request.sessionId));
  const group = groupId ? state.groupsById[groupId] : undefined;
  const session = state.sessionsById[request.sessionId];
  if (!group || !session) return;
  rememberNativeSidebarFocus(ui, request.sessionId, true);
  const section = describeNativeSidebarMachine(ui);
  const projectId = section.resolveProjectId(group.groupId);
  const collection = section.collectionState.collections.find(
    (collection) =>
      collection.projectIds.includes(projectId ?? '') ||
      collection.projectIds.includes(group.projectContext?.worktree?.parentProjectId ?? '')
  );
  const collectionKey = collection ? `${section.sectionKey}:${collection.collectionId}` : undefined;
  if (collectionKey) delete ui.collapse.collapsedProjectCollectionsByKey[collectionKey];
  if (
    ui.hiddenItems.groupIds.includes(group.groupId) ||
    (collectionKey && ui.hiddenItems.collectionKeys.includes(collectionKey))
  )
    ui.showHidden = true;
  if (!sessionMatchesSidebarTagFilters(session, ui.selectedTagFilters)) ui.selectedTagFilters = [];
  const settings = normalizeghostexSettings(state.hud.settings);
  const rawStorageId = group.projectContext?.editor.projectId ?? group.groupId;
  const storageId = group.remoteMachineContext
    ? `remote:${group.remoteMachineContext.machineId}:${rawStorageId}`
    : rawStorageId;
  const sectionState = {
    ...(ui.collapse.collapsedProjectSessionSectionsById[storageId] ?? DEFAULT_PROJECT_SESSION_SECTION_COLLAPSE_STATE),
    [getProjectSessionSection(session, settings.enableSessionParking)]: false,
  };
  ui.collapse.collapsedProjectSessionSectionsById[storageId] = sectionState;
  const layout = createDisplaySessionLayout({
    enableSessionParking: settings.enableSessionParking,
    sessionIdsByGroup: state.sessionIdsByGroup,
    sessionsById: state.sessionsById,
    sortMode: state.hud.activeSessionsSortMode,
    workspaceGroupIds: state.workspaceGroupIds,
  });
  const visible = getVisibleProjectSessionIds({
    compactCount: settings.projectSessionListCollapsedCount,
    isExpanded: !!ui.collapse.expandedProjectSessionListsById[storageId],
    isProjectGroup: !!group.projectContext,
    isToggleEnabled: true,
    isSessionInCollapsedSection: (id) =>
      sectionState[getProjectSessionSection(state.sessionsById[id], settings.enableSessionParking)],
    sessionIds: (layout.sessionIdsByGroup[group.groupId] ?? []).filter((id) =>
      sessionMatchesSidebarTagFilters(state.sessionsById[id], ui.selectedTagFilters)
    ),
  });
  if (!visible.includes(session.sessionId) && group.projectContext)
    ui.collapse.expandedProjectSessionListsById[storageId] = true;
  ui.handledRevealRequestId = request.requestId;
  writeSidebarUiCollapseState('main', ui.collapse);
}
