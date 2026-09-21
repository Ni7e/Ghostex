import type { ExtensionToSidebarMessage } from '@/packages/shared/session-grid-contract';
import { sidebarStore } from '@/packages/core-ui/sidebar-store-model';

/**
 * CDXC:Sidebar 2026-09-21 WHY:
 * This is the only feed of the zustand `sidebarStore`, and Quick Access, native chat settings and
 * the runtime facts channel's HUD all read that store. It used to live inside the TypeScript
 * sidebar page, which is deleted, so it moved out here unchanged rather than dying with the list it
 * used to project.
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

/**
 * Subscribes the store to the runtime's message source. This is all that is left of the sidebar
 * page's `connectNativeSidebar`: the list, its menus, its projection and its publisher are the Rust
 * store's since M4d part 2, and the store fed here is only what Quick Access, native chat settings
 * and the runtime facts channel read.
 */
export function connectSidebarStoreFeed(messageSource: {
  addEventListener: (type: string, listener: (event: Event) => void) => void;
  removeEventListener: (type: string, listener: (event: Event) => void) => void;
}): () => void {
  const receive = (event: Event) => {
    if (!(event instanceof MessageEvent)) return;
    applyNativeSidebarMessage(event.data as ExtensionToSidebarMessage);
  };
  messageSource.addEventListener('message', receive);
  return () => messageSource.removeEventListener('message', receive);
}
