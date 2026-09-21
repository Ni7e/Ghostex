import { openAppModal } from '@/packages/core-ui/app-modal-host-bridge';
import { addSpaceProjectMember } from '@/packages/core-ui/spaces';
import { moveProjectGroupFamilyToStart } from '@/packages/core-ui/sidebar-app/drag-drop-geometry';
import { sidebarStore } from '@/packages/core-ui/sidebar-store-model';
import type { ExtensionToSidebarMessage } from '@/packages/shared/session-grid-contract';
import type { NativeSidebarUiState } from './ui-state';
import type { SidebarPostMessage } from './metadata';
import { describeNativeSidebarMachine } from './space-navigation';

export function receiveNativeSidebarEvent(
  ui: NativeSidebarUiState,
  message: ExtensionToSidebarMessage,
  post: SidebarPostMessage
) {
  if (message.type === 'applySidebarSpaceEditorResult' && message.mode === 'delete') {
    const key = message.remoteMachineId ? `remote:${message.remoteMachineId}` : 'local';
    if (ui.collapse.selectedSpaceIdBySectionKey[key] === message.spaceId)
      delete ui.collapse.selectedSpaceIdBySectionKey[key];
  }
  if (message.type === 'promptGitCommit') openAppModal({ type: 'open', modal: 'gitCommit', gitCommitDraft: message });
  /*
  CDXC:Spaces 2026-09-21 WHY:
  THIS COMPUTER's leg is gone: the app writes the Space membership and holds the project id until
  the daemon lists it, then posts the same `syncGroupOrder`
  (apps/desktop/src/app/gx_store/added_project.rs). Doing it here as well would push the Spaces
  document a second time and post a second order for one added project. A REMOTE machine is
  unchanged, because `updateRemoteSidebarSpaces` is a direct call down that machine's tunnel.
  */
  if (message.type === 'assignAddedProjectToSelectedSpace' && message.remoteMachineId) {
    const machineId = message.remoteMachineId;
    const section = describeNativeSidebarMachine(ui, machineId);
    const projectId = message.projectId.trim();
    if (!projectId) return;
    if (section.spacesState && section.selection?.kind === 'space') {
      const groupId = section.groupIds.find((id) => section.resolveProjectId(id) === projectId);
      if (!groupId || !section.isVisible(groupId))
        ui.metadata.updateSpaces(
          machineId,
          addSpaceProjectMember(section.spacesState, section.selection.spaceId, projectId),
          post
        );
    }
    ui.pendingAddedProject = { machineId, projectId };
  }
  const pending = ui.pendingAddedProject;
  if (pending) {
    const section = describeNativeSidebarMachine(ui, pending.machineId);
    const groupId = section.groupIds.find((id) => section.resolveProjectId(id) === pending.projectId);
    if (groupId) {
      ui.pendingAddedProject = undefined;
      const groupIds = moveProjectGroupFamilyToStart(section.groupIds, groupId, sidebarStore.getState().groupsById);
      if (groupIds.some((id, index) => id !== section.groupIds[index])) post({ type: 'syncGroupOrder', groupIds });
    }
  }
}
