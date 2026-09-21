import { openAppModal } from '@/packages/core-ui/app-modal-host-bridge';
import type { ExtensionToSidebarMessage } from '@/packages/shared/session-grid-contract';
import type { NativeSidebarUiState } from './ui-state';

export function receiveNativeSidebarEvent(ui: NativeSidebarUiState, message: ExtensionToSidebarMessage) {
  if (message.type === 'applySidebarSpaceEditorResult' && message.mode === 'delete') {
    const key = message.remoteMachineId ? `remote:${message.remoteMachineId}` : 'local';
    if (ui.collapse.selectedSpaceIdBySectionKey[key] === message.spaceId)
      delete ui.collapse.selectedSpaceIdBySectionKey[key];
  }
  if (message.type === 'promptGitCommit') openAppModal({ type: 'open', modal: 'gitCommit', gitCommitDraft: message });
  /*
  CDXC:Spaces 2026-09-21 WHY:
  BOTH legs of `assignAddedProjectToSelectedSpace` are gone. The app writes the Space membership and
  holds the project id until the daemon lists it, then posts the same `syncGroupOrder`
  (apps/desktop/src/app/gx_store/added_project.rs); for a project added to a REMOTE machine the
  membership goes down that machine's tunnel instead
  (apps/desktop/src/app/gx_store/remote_project_docs.rs). Doing it here as well would push the
  Spaces document a second time and post a second order for one added project.
  */
}
