import { getghostexHotkeyActionById } from '@/packages/shared/ghostex-hotkeys';
import { nativeSidebarSettings } from './settings';
import { getSidebarSessionLifecycleState } from '@/packages/shared/session-grid-contract';
import { sidebarStore } from '@/packages/core-ui/sidebar-store-model';
import {
  resolveAdjacentRenderedSidebarSessionSlotId,
  resolveVisibleSidebarSessionSlotId,
} from '@/packages/core-ui/sidebar-visible-session-slots';
import { renderedNativeSidebarSessionIds, selectNativeSidebarSession } from './selection';
import { createNativeSidebarSnapshot } from './model';
import { runNativeSidebarAction } from './navigation';
import type { NativeSidebarUiState } from './ui-state';
import type { SidebarPostMessage } from './metadata';

export function runNativeSidebarHotkey(ui: NativeSidebarUiState, actionId: string, post: SidebarPostMessage) {
  const action = getghostexHotkeyActionById(actionId);
  if (!action) return;
  const state = sidebarStore.getState();
  switch (action.kind) {
    case 'focusSessionSlot': {
      const snapshot = createNativeSidebarSnapshot(ui);
      const visibleSessionIds = renderedNativeSidebarSessionIds(snapshot);
      const focusedSessionId = Object.values(state.sessionsById).find((session) => session.isFocused)?.sessionId;
      const sessionId =
        action.slotNumber <= 0
          ? resolveAdjacentRenderedSidebarSessionSlotId({
              direction: action.slotNumber === 0 ? 1 : -1,
              focusedSessionId,
              slots: visibleSessionIds.flatMap((sessionId) => {
                const session = state.sessionsById[sessionId];
                return session?.isVisible
                  ? [{ sessionId, isSleeping: getSidebarSessionLifecycleState(session) === 'sleeping' }]
                  : [];
              }),
            })
          : resolveVisibleSidebarSessionSlotId({ focusedSessionId, slotNumber: action.slotNumber, visibleSessionIds });
      if (sessionId) {
        selectNativeSidebarSession(ui, () => snapshot, { type: 'selectSession', sessionId, mode: 'focus' }, post);
        ui.requestReveal(sessionId);
      }
      break;
    }
    case 'createSession':
      post({ type: 'createSession' });
      break;
    case 'openCommandPalette':
      runNativeSidebarAction(ui, 'commands', post);
      break;
    case 'openSessionSearchPalette':
      runNativeSidebarAction(ui, 'sessions', post);
      break;
    case 'openSettings':
      runNativeSidebarAction(ui, 'settings', post);
      break;
    case 'openHotkeys':
      runNativeSidebarAction(ui, 'hotkeys', post);
      break;
    case 'toggleSidebarCollapsed':
      post({ type: 'toggleSidebarCollapsed' });
      break;
    case 'focusAdjacentGroup':
    case 'focusDirection':
    case 'focusedPaneAction':
    case 'jumpToProject':
    case 'navigateHistory':
    case 'notificationFeed':
    case 'openCommandsPanel':
    case 'openNewThreadPalette':
    case 'renameActiveSession':
    case 'runActionSlot':
    case 'setViewMode':
    case 'splitFocusedPane':
    case 'switchWorkareaView':
    case 'switchTitlebarView':
    case 'terminalToolbarAction':
    case 'toggleCompanionPane':
      post({ type: 'runGhostexHotkeyAction', actionId: action.id });
      break;
  }
}

export function runNativeProjectSlotHotkey(ui: NativeSidebarUiState, slotNumber: number, post: SidebarPostMessage) {
  if (!Number.isInteger(slotNumber) || slotNumber < 1 || slotNumber > 9) return;
  const snapshot = createNativeSidebarSnapshot(ui);
  const group = snapshot.groups.filter((group) => !group.remoteMachineContext)[slotNumber - 1];
  if (!group?.projectContext) return;
  const settings = nativeSidebarSettings();
  const collapsed = ui.collapse.collapsedGroupsById[group.groupId];
  if (collapsed && settings.expandCollapsedProjectsOnJump) {
    delete ui.collapse.collapsedGroupsById[group.groupId];
    if (settings.showLessForExpandedProjectJumps) delete ui.collapse.expandedProjectSessionListsById[group.storageId];
  }
  const session = group.sessions.find((session) => session.isFocused) ?? group.sessions[0];
  if (session) {
    selectNativeSidebarSession(
      ui,
      () => snapshot,
      { type: 'selectSession', sessionId: session.sessionId, mode: 'focus' },
      post
    );
    if (!collapsed || settings.expandCollapsedProjectsOnJump) ui.requestReveal(session.sessionId);
  }
}
