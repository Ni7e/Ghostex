import {
  createSelectedSidebarSpaceVisibility,
  resolveSelectedSidebarSpace,
  resolveSidebarSpaceForRevealedGroup,
} from '@/packages/core-ui/sidebar-app/space-filtering';
import {
  rememberSidebarSpaceSession,
  writeSidebarUiCollapseState,
} from '@/packages/core-ui/sidebar-app/collapse-state';
import { sidebarStore } from '@/packages/core-ui/sidebar-store-model';
import { normalizeghostexSettings } from '@/packages/shared/ghostex-settings';
import { openAppModal } from '@/packages/core-ui/app-modal-host-bridge';
import type { NativeSidebarUiState } from './ui-state';
import type { SidebarPostMessage } from './metadata';

export function describeNativeSidebarMachine(ui: NativeSidebarUiState, machineId = ui.selectedMachineId) {
  const state = sidebarStore.getState();
  const groupIds = state.groupOrder.filter(
    (id) => (state.groupsById[id]?.remoteMachineContext?.machineId ?? 'local') === machineId
  );
  const sectionKey = machineId === 'local' ? 'local' : `remote:${machineId}`;
  const spacesState = normalizeghostexSettings(state.hud.settings).sidebarSpacesEnabled
    ? ui.metadata.spaces[machineId]
    : undefined;
  const visibility = {
    groupIds,
    groupsById: state.groupsById,
    collectionState: ui.metadata.collections[machineId] ?? { collections: [], nextCollectionNumber: 1 },
    resolveProjectId: (id: string) =>
      machineId === 'local'
        ? state.groupsById[id]?.projectContext?.editor.projectId
        : state.groupsById[id]?.remoteMachineContext?.projectId,
  };
  const selection = resolveSelectedSidebarSpace(spacesState, ui.collapse.selectedSpaceIdBySectionKey[sectionKey]);
  const isVisible = selection ? createSelectedSidebarSpaceVisibility({ ...visibility, selection }) : () => true;
  return { ...visibility, sectionKey, spacesState, selection, isVisible };
}

export function switchNativeSidebarSpace(ui: NativeSidebarUiState, spaceId: string, post: SidebarPostMessage): void {
  const previous = describeNativeSidebarMachine(ui).selection?.spaceId;
  ui.apply({ type: 'selectSpace', spaceId });
  const state = sidebarStore.getState();
  if (previous === spaceId || normalizeghostexSettings(state.hud.settings).sidebarSpaceSwitchBehavior !== 'restore')
    return;
  const section = describeNativeSidebarMachine(ui);
  const visible = section.groupIds.filter(section.isVisible);
  const recent = ui.collapse.recentSessionIdsBySpace[section.sectionKey]?.[spaceId] ?? [];
  const sessionId =
    recent.find(
      (id) => state.sessionsById[id] && visible.some((groupId) => state.sessionIdsByGroup[groupId]?.includes(id))
    ) ?? visible.flatMap((id) => state.sessionIdsByGroup[id] ?? [])[0];
  if (sessionId) post({ type: 'focusSession', sessionId, keepView: true });
  else if (visible[0]) post({ type: 'focusGroup', groupId: visible[0] });
}

export function rememberNativeSidebarFocus(ui: NativeSidebarUiState, sessionId: string, reveal = false): void {
  const state = sidebarStore.getState();
  const groupId = state.groupOrder.find((id) => state.sessionIdsByGroup[id]?.includes(sessionId));
  if (!groupId || state.groupsById[groupId]?.isChatCollection) return;
  const machineId = state.groupsById[groupId]?.remoteMachineContext?.machineId ?? 'local';
  const section = describeNativeSidebarMachine(ui, machineId);
  if (reveal) {
    ui.apply({ type: 'selectMachine', machineId });
    delete ui.collapse.collapsedGroupsById[groupId];
  }
  if (section.spacesState) {
    const spaceId = resolveSidebarSpaceForRevealedGroup({
      ...section,
      spacesState: section.spacesState,
      selectedSpaceId: section.selection?.spaceId,
      targetGroupId: groupId,
    });
    ui.collapse.recentSessionIdsBySpace = rememberSidebarSpaceSession(
      ui.collapse.recentSessionIdsBySpace,
      section.sectionKey,
      spaceId,
      sessionId
    );
    if (reveal || normalizeghostexSettings(state.hud.settings).sidebarSpaceFollowActiveSession)
      ui.collapse.selectedSpaceIdBySectionKey[section.sectionKey] = spaceId;
  }
  writeSidebarUiCollapseState('main', ui.collapse);
}

export function editNativeSidebarSpace(ui: NativeSidebarUiState, spaceId?: string): void {
  const space = spaceId ? ui.metadata.spaces[ui.selectedMachineId]?.spaces[spaceId] : undefined;
  openAppModal({
    type: 'open',
    modal: 'sidebarSpaceEditor',
    mode: space ? 'edit' : 'create',
    sectionKey: ui.sectionKey,
    ...(ui.selectedMachineId !== 'local' ? { remoteMachineId: ui.selectedMachineId } : {}),
    ...(space ? { spaceId: space.spaceId, spaceName: space.name, spaceIcon: space.icon, spaceColor: space.color } : {}),
  });
}
