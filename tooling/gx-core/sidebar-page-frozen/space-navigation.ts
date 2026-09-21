/**
 * FROZEN copy of the TypeScript sidebar page, which was deleted on 2026-09-21 (M4d part 2). It is
 * kept only so the parity gates beside it still have the behaviour the app shipped on that date to
 * compare the Rust store against: a clean run proves Rust still matches THAT, not that it matches
 * the app. Never edit this file to make a gate pass; change the Rust and re-record, or delete the
 * gate.
 */
import {
  createSelectedSidebarSpaceVisibility,
  resolveSelectedSidebarSpace,
  resolveSidebarSpaceForRevealedGroup,
} from '@/packages/core-ui/sidebar-app/space-filtering';
import { rememberSidebarSpaceSession } from '@/packages/core-ui/sidebar-app/collapse-state';
import { sidebarStore } from '@/packages/core-ui/sidebar-store-model';
import { nativeSidebarSettings } from './settings';
import { openAppModal } from '@/packages/core-ui/app-modal-host-bridge';
import type { NativeSidebarUiState } from './ui-state';
import type { SidebarPostMessage } from './metadata';

export function describeNativeSidebarMachine(ui: NativeSidebarUiState, machineId = ui.selectedMachineId) {
  const state = sidebarStore.getState();
  const groupIds = state.groupOrder.filter(
    (id) => (state.groupsById[id]?.remoteMachineContext?.machineId ?? 'local') === machineId
  );
  const sectionKey = machineId === 'local' ? 'local' : `remote:${machineId}`;
  const spacesState = nativeSidebarSettings().sidebarSpacesEnabled ? ui.metadata.spaces[machineId] : undefined;
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

/*
CDXC:Spaces 2026-09-21 WHY:
The restore is gone for EVERY machine: the app reads the Space's remembered row off the list it
draws, which is the selected machine's whichever machine that is, and posts the same `focusSession`
(apps/desktop/src/app/gx_store/space_switch.rs), so doing it here as well would send two focus
messages for one click. The selection itself still moves here, because this page draws its own
projection until that projection is deleted.
*/
export function switchNativeSidebarSpace(ui: NativeSidebarUiState, spaceId: string): void {
  ui.apply({ type: 'selectSpace', spaceId });
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
    if (reveal || nativeSidebarSettings().sidebarSpaceFollowActiveSession)
      ui.collapse.selectedSpaceIdBySectionKey[section.sectionKey] = spaceId;
  }
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
