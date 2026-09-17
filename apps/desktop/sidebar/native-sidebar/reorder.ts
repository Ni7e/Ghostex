import { applySidebarSpaceRowReorder } from '@/packages/core-ui/sidebar-space-order';
import { updateNativeProjectDropMembership } from './project-drag';
import { moveProjectsWithWorktrees } from '@/packages/shared/project-worktree-order';
import { moveSessionIdsByDropTarget } from '@/packages/core-ui/sidebar-dnd';
import { sidebarStore } from '@/packages/core-ui/sidebar-store-model';
import { reorderSidebarSpaces } from '@/packages/core-ui/spaces';
import type { NativeSidebarCommand } from '@/packages/shared/native-sidebar';
import type { NativeSidebarUiState } from './ui-state';
import type { SidebarPostMessage } from './metadata';

type ReorderCommand = Extract<NativeSidebarCommand, { type: 'moveSession' | 'moveGroup' | 'moveSpace' }>;

export function reorderNativeSidebar(
  ui: NativeSidebarUiState,
  command: ReorderCommand,
  post: SidebarPostMessage
): void {
  const state = sidebarStore.getState();
  if (command.type === 'moveSession') {
    const sourceGroup = state.groupOrder.find((id) => state.sessionIdsByGroup[id]?.includes(command.sessionId));
    const source = sourceGroup ? state.groupsById[sourceGroup] : undefined;
    const target = state.groupsById[command.groupId];
    if (!source || !target || source.remoteMachineContext || target.remoteMachineContext) return;
    const sourceSession = state.sessionsById[command.sessionId];
    const targetSession = command.targetSessionId ? state.sessionsById[command.targetSessionId] : undefined;
    if (
      !sourceSession ||
      (command.targetSessionId && !targetSession) ||
      sourceSession.sessionKind === 'browser' ||
      sourceSession.kind === 'browser'
    )
      return;
    if (sourceSession.isPinned) {
      if (sourceGroup !== command.groupId || !command.targetSessionId || !targetSession?.isPinned) return;
      const ids = state.sessionIdsByGroup[command.groupId] ?? [];
      const pinned = ids.filter((id) => state.sessionsById[id]?.isPinned && id !== command.sessionId);
      const targetIndex = pinned.indexOf(command.targetSessionId);
      if (targetIndex < 0) return;
      pinned.splice(targetIndex + (command.position === 'after' ? 1 : 0), 0, command.sessionId);
      const order = [...pinned, ...ids.filter((id) => !state.sessionsById[id]?.isPinned)];
      sidebarStore.setState({ sessionIdsByGroup: { ...state.sessionIdsByGroup, [command.groupId]: order } });
      post({ type: 'syncSessionOrder', groupId: command.groupId, sessionIds: order });
      return;
    }
    if (source.remoteMachineContext || state.hud.activeSessionsSortMode !== 'manual') return;
    const next = moveSessionIdsByDropTarget(
      state.sessionIdsByGroup,
      command.sessionId,
      command.targetSessionId
        ? {
            kind: 'session',
            groupId: command.groupId,
            sessionId: command.targetSessionId,
            position: command.position,
          }
        : {
            kind: 'group',
            groupId: command.groupId,
            position: command.position === 'after' ? 'end' : 'start',
          }
    );
    if (sourceGroup !== command.groupId) {
      post({
        type: 'moveSessionToGroup',
        groupId: command.groupId,
        sessionId: command.sessionId,
        targetIndex: next[command.groupId]?.indexOf(command.sessionId),
      });
    } else {
      sidebarStore.setState({ sessionIdsByGroup: next });
      post({ type: 'syncSessionOrder', groupId: command.groupId, sessionIds: next[command.groupId] ?? [] });
    }
  } else if (command.type === 'moveGroup') {
    const source = state.groupsById[command.groupId];
    const target = state.groupsById[command.targetGroupId];
    if (!source || !target || source.remoteMachineContext?.machineId !== target.remoteMachineContext?.machineId) return;
    const next = moveProjectsWithWorktrees(
      state.groupOrder.map((id) => ({
        orderId: id,
        projectId:
          state.groupsById[id]?.remoteMachineContext?.projectId ??
          state.groupsById[id]?.projectContext?.editor.projectId ??
          id,
        worktree: state.groupsById[id]?.projectContext?.worktree,
        isChat: state.groupsById[id]?.isChatCollection,
      })),
      command.groupId,
      { orderId: command.targetGroupId, position: command.position }
    ).map((item) => item.orderId);
    updateNativeProjectDropMembership(ui, command.groupId, command.targetGroupId, next, post);
    sidebarStore.setState({
      groupOrder: next,
      workspaceGroupIds: next.filter((id) => state.workspaceGroupIds.includes(id)),
    });
    post({ type: 'syncGroupOrder', groupIds: next });
  } else {
    const spaces = ui.metadata.spaces[ui.selectedMachineId];
    if (!spaces || command.spaceId === command.targetSpaceId) return;
    const visible = command.visibleSpaceIds.filter((id) => spaces.order.includes(id));
    if (!visible.includes(command.spaceId)) return;
    const order = visible.filter((id) => id !== command.spaceId);
    const index = order.indexOf(command.targetSpaceId);
    if (index < 0) return;
    order.splice(index + (command.position === 'after' ? 1 : 0), 0, command.spaceId);
    ui.metadata.updateSpaces(
      ui.selectedMachineId,
      reorderSidebarSpaces(spaces, applySidebarSpaceRowReorder(spaces.order, visible, order)),
      post
    );
  }
}
