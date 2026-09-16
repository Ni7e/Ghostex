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
  snapshot: NativeSidebarSnapshot,
  command: Extract<NativeSidebarCommand, { type: 'selectSession' }>,
  post: SidebarPostMessage
): void {
  const state = sidebarStore.getState();
  const visibleSessionIds = renderedNativeSidebarSessionIds(snapshot);
  if (command.mode === 'clear') {
    ui.selectedSessionIds = [];
    return;
  }
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
  } else {
    ui.selectedSessionIds = [];
    closeAppModal('SettingsDismissal:focusSession');
    const groupId = snapshot.groups.find((group) =>
      group.sessions.some((session) => session.sessionId === command.sessionId)
    )?.groupId;
    state.clearFocusedSessionScrollSuppression();
    if (groupId) state.applyLocalFocus(groupId, command.sessionId);
    post({ type: 'focusSession', sessionId: command.sessionId });
  }
}
