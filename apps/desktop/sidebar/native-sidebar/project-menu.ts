import { createNativeProjectMembershipMenu } from './membership';
import type { NativeSidebarUiState } from './ui-state';
import {
  getSidebarSessionLifecycleState,
  type SidebarSessionGroup,
  type SidebarToExtensionMessage,
} from '@/packages/shared/session-grid-contract';
import type { NativeSidebarMenuItem } from '@/packages/shared/native-sidebar';

export function createNativeProjectMenu(group: SidebarSessionGroup, ui: NativeSidebarUiState): NativeSidebarMenuItem[] {
  const groupId = group.groupId;
  const row = (
    label: string,
    icon: string,
    message: SidebarToExtensionMessage,
    disabled = false,
    danger = false
  ): NativeSidebarMenuItem => ({ label, icon, command: { type: 'command', message }, disabled, danger });
  const project = group.projectContext;
  if (!project) {
    const sleeping = group.sessions.some((session) => getSidebarSessionLifecycleState(session) === 'sleeping');
    const running = group.sessions.some((session) => getSidebarSessionLifecycleState(session) === 'running');
    const wake = sleeping && !running;
    return [
      { label: 'Rename', icon: 'pencil', command: { type: 'renameGroup', groupId } },
      ...(group.sessions.length ? [row('Full Reload', 'refresh', { type: 'fullReloadGroup', groupId })] : []),
      row(
        wake ? 'Wake' : 'Sleep',
        wake ? 'player-play' : 'moon',
        { type: 'setGroupSleeping', groupId, sleeping: !wake },
        wake ? !sleeping : !running
      ),
      { separator: true },
      {
        label: 'Close',
        icon: 'x',
        danger: true,
        command:
          group.sessions.length > 1
            ? { type: 'confirmCloseGroup', groupId }
            : { type: 'command', message: { type: 'closeGroup', groupId } },
      },
    ];
  }
  const menu: NativeSidebarMenuItem[] = [
    row('Copy Path', 'copy', { type: 'copyWorkspaceProjectPathForGroup', groupId }),
    row('Open Folder', 'folder-open', { type: 'openWorkspaceProjectInFinderForGroup', groupId }),
  ];
  if (project.worktree) {
    menu.push(
      row('Rename Worktree', 'pencil', { type: 'promptRenameWorktreeForGroup', groupId }),
      { separator: true },
      row('Delete Worktree', 'trash', { type: 'promptDeleteWorktreeForGroup', groupId }, false, true),
      row('Remove Worktree', 'x', { type: 'removeWorkspaceProjectForGroup', groupId }, !project.canRemoveProject, true)
    );
    return menu;
  }
  if (project.gitRemoteOriginUrl)
    menu.push(
      row('Copy Remote URL', 'link', { type: 'copyWorkspaceProjectRemoteUrl', remoteUrl: project.gitRemoteOriginUrl })
    );
  menu.push(...createNativeProjectMembershipMenu(ui, groupId), { separator: true });
  if (group.canCreateSessionGroup) menu.push(row('New Group', 'plus', { type: 'createGroup', groupId }));
  menu.push({
    label: ui.hiddenItems.groupIds.includes(groupId) ? 'Unhide' : 'Hide',
    icon: 'eye-off',
    command: { type: 'projectMembership', action: 'hide', groupId },
  });
  const allSleeping =
    group.sessions.some((session) => getSidebarSessionLifecycleState(session) === 'sleeping') &&
    !group.sessions.some((session) => getSidebarSessionLifecycleState(session) === 'running');
  const hasInactive = group.sessions.some(
    (session) =>
      session.sessionKind === 'terminal' &&
      session.lifecycleState === 'running' &&
      !session.isSleeping &&
      session.activity !== 'working' &&
      session.activity !== 'attention'
  );
  menu.push(
    row(
      allSleeping ? 'Wake' : 'Sleep Inactive',
      allSleeping ? 'player-play' : 'moon',
      { type: allSleeping ? 'wakeProjectSleepingSessions' : 'sleepInactiveProjectSessions', groupId },
      !allSleeping && !hasInactive
    )
  );
  if (group.sessions.length)
    menu.push(row('Full Reload', 'refresh', { type: 'fullReloadProjectZmxSessions', groupId }));
  menu.push(
    { separator: true },
    row('Close inactive', 'x', { type: 'closeInactiveProjectSessions', groupId }, !hasInactive, true),
    row(
      'Close Project',
      'x',
      { type: 'closeWorkspaceProjectForGroup', groupId },
      !project.canRemoveProject && !group.remoteMachineContext,
      true
    )
  );
  return menu;
}
