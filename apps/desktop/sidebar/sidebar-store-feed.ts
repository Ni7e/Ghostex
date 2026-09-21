import type { ExtensionToSidebarMessage } from '@/packages/shared/session-grid-contract';
import { sidebarStore } from '@/packages/core-ui/sidebar-store-model';

/**
 * CDXC:Sidebar 2026-09-21 WHY:
 * This is the only feed of the zustand `sidebarStore`, and Quick Access and native chat settings
 * read that store. It used to live in `native-sidebar/model.ts`, which is deleted with the
 * TypeScript sidebar, so it moved out here unchanged rather than dying with the list it used to
 * project.
 */
export function applyNativeSidebarMessage(message: ExtensionToSidebarMessage): void {
  const state = sidebarStore.getState();
  switch (message.type) {
    case 'hydrate':
    case 'sessionState':
      state.applySidebarMessage(message);
      break;
    case 'sessionPresentationChanged':
      state.applySessionPresentationMessage(message);
      break;
    case 'sidebarGroupsChanged':
      state.applyGroupsChangedMessage(message);
      break;
    case 'sidebarHudChanged':
      state.applyHudChangedMessage(message);
      break;
    case 'sidebarCommandRunStateChanged':
      state.applyCommandRunStateMessage(message);
      break;
    case 'sidebarCommandRunStateCleared':
      state.applyCommandRunStateClearedMessage(message);
      break;
    case 'customSessionTagsChanged':
      state.applyCustomSessionTagsChangedMessage(message);
      break;
    case 'sidebarOrderSyncResult':
      state.applyOrderSyncResultMessage(message);
      break;
    case 'daemonSessionsState':
      state.setDaemonSessionsState(message);
      break;
  }
}
