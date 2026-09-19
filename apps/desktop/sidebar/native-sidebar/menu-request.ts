import { sidebarStore } from '@/packages/core-ui/sidebar-store-model';
import { nativeSidebarSettings } from './settings';
import type {
  NativeSidebarCommand,
  NativeSidebarMenuItem,
  NativeSidebarSnapshot,
} from '@/packages/shared/native-sidebar';
import { createNativeBulkMenu } from './bulk-menu';
import { createNativeSessionActions } from './session-menu';
import type { NativeSidebarUiState } from './ui-state';

/**
 * CDXC:Sidebar 2026-09-17 WHY:
 * Building every session's menus, clipboard text and Below actions on each refresh delayed pane switching.
 * Resolve only the opened menu against current shared state and the displayed row order.
 */
export function resolveNativeSessionMenu(
  ui: NativeSidebarUiState,
  snapshot: NativeSidebarSnapshot | undefined,
  command: Extract<NativeSidebarCommand, { type: 'sessionMenu' }>
): NativeSidebarMenuItem[] {
  const state = sidebarStore.getState();
  const session = state.sessionsById[command.sessionId];
  const groupId = state.groupOrder.find((id) => state.sessionIdsByGroup[id]?.includes(command.sessionId));
  const group = groupId ? state.groupsById[groupId] : undefined;
  if (!session || !group) return [];
  if (!command.action && ui.selectedSessionIds.includes(command.sessionId)) {
    const bulk = createNativeBulkMenu(ui);
    if (bulk) return bulk;
  }
  const projected = snapshot?.groups.find((item) => item.groupId === groupId);
  const visible = new Set(projected?.sections.flatMap((section) => (section.collapsed ? [] : section.sessionIds)));
  const visibleIds =
    projected?.sessions.filter((item) => visible.has(item.sessionId)).map((item) => item.sessionId) ?? [];
  const index = visibleIds.indexOf(command.sessionId);
  const below = index < 0 ? [] : visibleIds.slice(index + 1).flatMap((id) => state.sessionsById[id] ?? []);
  const settings = nativeSidebarSettings();
  const customTags = group.remoteMachineContext
    ? state.remoteCustomSessionTagsByMachineId[group.remoteMachineContext.machineId]
    : state.customSessionTags;
  const actions = createNativeSessionActions(session, settings, group, customTags, below);
  if (!command.action) return actions.menu;
  // The hover action's label and eligibility come from the same builder as the context menu.
  const lazy = createNativeSessionActions(session, settings, group, customTags, [], false);
  const placeholders = [...lazy.hoverBefore, ...lazy.hoverAfter];
  const indexInHover = placeholders.findIndex(
    (item) => item.children?.[0]?.onOpen?.type === 'sessionMenu' && item.children[0].onOpen.action === command.action
  );
  return [...actions.hoverBefore, ...actions.hoverAfter][indexInHover]?.children ?? [];
}
