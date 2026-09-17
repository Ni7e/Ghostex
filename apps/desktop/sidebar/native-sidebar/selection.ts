import {
  resolveRenderedSidebarSessionAdditiveSelection,
  resolveRenderedSidebarSessionRangeSelection,
} from '@/packages/core-ui/sidebar-visible-session-slots';
import { closeAppModal } from '@/packages/core-ui/app-modal-host-bridge';
import { sidebarStore } from '@/packages/core-ui/sidebar-store-model';
import type { NativeSidebarSnapshot, NativeSidebarCommand } from '@/packages/shared/native-sidebar';
import type { NativeSidebarUiState } from './ui-state';
import type { SidebarPostMessage } from './metadata';

export function renderedNativeSidebarSessionIds(snapshot: NativeSidebarSnapshot): string[] {
  const groupIds = snapshot.order.flatMap((item) =>
    item.kind === 'project'
      ? [item.id]
      : (snapshot.collections.find((collection) => collection.collectionId === item.id && !collection.collapsed)
          ?.groupIds ?? [])
  );
  return groupIds.flatMap((id) => {
    const group = snapshot.groups.find((group) => group.groupId === id);
    return !group || group.collapsed
      ? []
      : group.sections.flatMap((section) => (section.collapsed ? [] : section.sessionIds));
  });
}

export function selectNativeSidebarSession(
  ui: NativeSidebarUiState,
  getSnapshot: () => NativeSidebarSnapshot,
  command: Extract<NativeSidebarCommand, { type: 'selectSession' }>,
  post: SidebarPostMessage
): void {
  const state = sidebarStore.getState();
  if (command.mode === 'clear') {
    ui.selectedSessionIds = [];
    return;
  }
  if (command.mode === 'focus') {
    // CDXC:Sidebar 2026-09-17 WHY:
    // A normal row click only needs its owning group, not a rebuild of every display row and context menu.
    const groupId = state.groupOrder.find((id) => state.sessionIdsByGroup[id]?.includes(command.sessionId));
    ui.selectedSessionIds = [];
    closeAppModal('SettingsDismissal:focusSession');
    state.clearFocusedSessionScrollSuppression();
    if (groupId) state.applyLocalFocus(groupId, command.sessionId);
    post({ type: 'focusSession', sessionId: command.sessionId });
    return;
  }
  const visibleSessionIds = renderedNativeSidebarSessionIds(getSnapshot());
  if (command.mode === 'additive') {
    ui.selectedSessionIds = resolveRenderedSidebarSessionAdditiveSelection({
      clickedSessionId: command.sessionId,
      currentSelection: ui.selectedSessionIds,
      visibleSessionIds,
    });
  } else if (command.mode === 'range') {
    ui.selectedSessionIds = resolveRenderedSidebarSessionRangeSelection({
      clickedSessionId: command.sessionId,
      activeSessionId: Object.values(state.sessionsById).find((session) => session.isFocused)?.sessionId,
      visibleSessionIds,
    });
  }
}
