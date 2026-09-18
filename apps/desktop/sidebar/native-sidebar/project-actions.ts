import { nativeAgentLauncherItems } from './agent-launcher';
import { sidebarStore } from '@/packages/core-ui/sidebar-store-model';
import { openAppModal, openQuickAccess } from '@/packages/core-ui/app-modal-host-bridge';
import { getQuickAccessSessionProjectId } from '@/packages/core-ui/quick-access-session-scope';
import { readPrimaryAgentLauncherId, writePrimaryAgentLauncherId } from '@/packages/core-ui/primary-agent-launcher';
import { COLORED_AGENT_LOGOS } from '@/packages/core-ui/agent-logos';
import type { NativeSidebarCommand, NativeSidebarMenuItem } from '@/packages/shared/native-sidebar';
import type { SidebarSessionGroup, SidebarToExtensionMessage } from '@/packages/shared/session-grid-contract';

export function createNativeProjectHeaderActions(group: SidebarSessionGroup): NativeSidebarMenuItem[] {
  const { hud } = sidebarStore.getState();
  const groupId = group.groupId;
  const runtime = (label: string, icon: string, message: SidebarToExtensionMessage): NativeSidebarMenuItem => ({
    label,
    icon,
    command: { type: 'command', message },
  });
  if (!group.projectContext) return [runtime('Create a Terminal', 'plus', { type: 'createSessionInGroup', groupId })];
  const actions: NativeSidebarMenuItem[] = [
    group.projectContext.worktree
      ? runtime('Create PR', 'git-pull-request', { type: 'runSidebarGitAction', groupId, action: 'pr' })
      : { label: 'Add Worktree', icon: 'git-branch', command: { type: 'projectAction', action: 'worktree', groupId } },
    { label: 'History', icon: 'history', command: { type: 'projectAction', action: 'history', groupId } },
  ];
  if (!hud.settings?.browserViewTabHidden)
    actions.push(runtime('New Browser Tab', 'world', { type: 'openBrowserPaneInGroup', groupId }));
  actions.push(runtime('Create Terminal', 'terminal-2', { type: 'createProjectTerminal', groupId }));
  const globalCommands = group.remoteMachineContext
    ? hud.remoteGlobalCommandsByMachineId?.[group.remoteMachineContext.machineId]
    : hud.globalCommands;
  for (const scope of ['global', 'project'] as const) {
    const commands =
      scope === 'global' ? globalCommands : hud.commandsByProject?.[group.projectContext.editor.projectId];
    for (const command of commands ?? [])
      if (command.showOnProjectRow)
        actions.push(
          runtime(command.name.trim() || 'Run Action', command.icon ?? 'bolt', {
            type: 'runSidebarCommand',
            commandId: command.commandId,
            scope,
            groupId,
          })
        );
  }
  const agents = hud.agents;
  const primary = agents.find((agent) => agent.agentId === readPrimaryAgentLauncherId()) ?? agents[0];
  /**
   * CDXC:AgentLauncher 2026-09-18 DECISION:
   * User: remove the gap between the last-used agent button and the Select agent button in the project header. Both halves render as the one split button the React header shows.
   */
  actions.push({
    label: `Create ${primary?.name ?? 'Agent'}`,
    icon: 'sparkles',
    agentIcon: primary?.icon,
    imageDataUrl: primary?.icon ? COLORED_AGENT_LOGOS[primary.icon] : undefined,
    command: { type: 'projectAction', action: 'agent', groupId, agentId: primary?.agentId },
    split: 'start',
  });
  actions.push({
    label: 'Select Agent',
    icon: 'chevron-down',
    children: nativeAgentLauncherItems(groupId),
    split: 'end',
  });
  return actions;
}

export function runNativeProjectAction(
  command: Extract<NativeSidebarCommand, { type: 'projectAction' }>,
  post: (message: SidebarToExtensionMessage) => void
): void {
  const group = sidebarStore.getState().groupsById[command.groupId];
  const project = group?.projectContext;
  if (!group || !project) return;
  switch (command.action) {
    case 'worktree':
      openAppModal({
        modal: 'worktree',
        type: 'open',
        projectId: project.editor.projectId,
        projectName: group.title,
        projectPath: project.path,
        remoteMachineId: group.remoteMachineContext?.machineId,
        remoteMachineName: group.remoteMachineContext?.machineName,
      });
      break;
    case 'history':
      openQuickAccess('recentSessions', { projectId: getQuickAccessSessionProjectId(group), sessionScope: 'closed' });
      break;
    case 'agent':
      if (!command.agentId) openAppModal({ modal: 'configureAgents', type: 'open' });
      else {
        writePrimaryAgentLauncherId(command.agentId);
        post({
          type: 'runSidebarAgent',
          groupId: group.groupId,
          agentId: command.agentId,
          accountId: command.accountId,
        });
      }
      break;
  }
}
