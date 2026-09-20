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
  if (message.type === 'assignAddedProjectToSelectedSpace') {
    const machineId = message.remoteMachineId ?? 'local';
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
