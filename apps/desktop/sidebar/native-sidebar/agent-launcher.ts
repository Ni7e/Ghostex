import { resolveSessionChatTranscriptAgent } from '@/packages/shared/session-chat';
import { accountHeadlineWindows, isWeeklyWindow } from '@/packages/shared/account-usage-windows';
import { accountUsageLabel } from '@/packages/shared/account-usage-label';
import { quickLaunchAccountId, type AgentAccountsState } from '@/packages/shared/agent-accounts';
import { maskAccountText } from '@/packages/shared/account-display';
import type { SidebarAgentButton } from '@/packages/shared/sidebar-agents';
import type { NativeSidebarCommand, NativeSidebarMenuItem } from '@/packages/shared/native-sidebar';
import type { WebviewApi } from '@/packages/core-ui/webview-api';
import { COLORED_AGENT_LOGOS } from '@/packages/core-ui/agent-logos';
import { readPrimaryAgentLauncherId } from '@/packages/core-ui/primary-agent-launcher';
import { sidebarStore } from '@/packages/core-ui/sidebar-store-model';

type LauncherCommand = Extract<NativeSidebarCommand, { type: 'agentAccounts' }>;
const providerFor = (agent: SidebarAgentButton) => {
  const provider = agent.icon ?? agent.agentId;
  return provider === 'claude' || provider === 'codex' ? provider : undefined;
};
const commandFor = (groupId: string, action: LauncherCommand['action'], agentId?: string): LauncherCommand => ({
  type: 'agentAccounts',
  groupId,
  action,
  agentId,
});

export function nativeAgentLauncherItems(groupId: string, data?: AgentAccountsState): NativeSidebarMenuItem[] {
  const agents = sidebarStore.getState().hud.agents;
  const primaryId = (agents.find((agent) => agent.agentId === readPrimaryAgentLauncherId()) ?? agents[0])?.agentId;
  const items: NativeSidebarMenuItem[] = agents.map((agent) => {
    const provider = providerFor(agent);
    return {
      primary: agent.agentId === primaryId,
      supportsChat: resolveSessionChatTranscriptAgent(agent.agentId, agent.icon) !== null,
      label: agent.name,
      agentIcon: agent.icon,
      imageDataUrl: agent.icon ? COLORED_AGENT_LOGOS[agent.icon] : undefined,
      icon: agent.icon ? undefined : 'code',
      keepOpen: true,
      command: commandFor(groupId, 'launch', agent.agentId),
      secondary: provider
        ? {
            icon: 'user',
            label: data
              ? String(data.accounts.filter((account) => account.registered && account.provider === provider).length)
              : '',
            command: commandFor(groupId, 'accounts', agent.agentId),
          }
        : undefined,
    };
  });
  if (items.length) items.push({ separator: true });
  items.push({ label: 'Configure', icon: 'settings', command: { type: 'projectAction', action: 'agent', groupId } });
  items[0] = {
    ...items[0],
    menuStyle: 'agentLauncher',
    menuOwner: `group:${groupId}`,
    onOpen: commandFor(groupId, 'load'),
  };
  return items;
}

export function createNativeAgentLauncherController(
  request: WebviewApi['requestGroupAccounts'],
  publish: (update: unknown) => void,
  launch: (groupId: string, agentId: string, accountId?: string) => void
) {
  let data: AgentAccountsState | undefined;
  let owner: string | undefined;
  let generation = 0;
  return async (command: LauncherCommand) => {
    if (owner !== command.groupId || command.action === 'load') {
      owner = command.groupId;
      data = undefined;
    }
    const current = ++generation;
    const agent = sidebarStore.getState().hud.agents.find((agent) => agent.agentId === command.agentId);
    const provider = agent && providerFor(agent);
    const update = (items: NativeSidebarMenuItem[], close = false) =>
      publish({ kind: 'menu', version: 1, ownerId: `group:${command.groupId}`, items, close });
    if (command.action === 'launch' && agent && (!provider || !request)) {
      launch(command.groupId, agent.agentId);
      update([], true);
      return;
    }
    const back: NativeSidebarMenuItem | undefined = agent && {
      label: agent.name,
      icon: 'chevron-left',
      menuStyle: 'agentLauncher',
      keepOpen: true,
      command: commandFor(command.groupId, 'root'),
    };
    let error: string | undefined;
    try {
      if (request && (!data || command.action === 'retry')) {
        // The React launcher opens the account page at once and shows this hint until the list arrives.
        if (back && provider && command.action === 'accounts')
          update([back, { label: 'Reading accounts…', disabled: true }]);
        const result = await request(command.groupId, {
          operation: 'list',
          ...(command.action === 'retry' ? { refresh: true } : {}),
        });
        if (generation !== current) return;
        data = result;
      }
    } catch (failure) {
      error = failure instanceof Error ? failure.message : String(failure);
    }
    if (generation !== current) return;
    if (command.action === 'launch' && agent && provider && data) {
      launch(command.groupId, agent.agentId, quickLaunchAccountId(data, provider));
      update([], true);
      return;
    }
    if (!agent || !provider || !back) {
      update(nativeAgentLauncherItems(command.groupId, data));
      return;
    }
    const format = (value: string) =>
      sidebarStore.getState().hud.settings?.hideAccountEmails ? maskAccountText(value) : value;
    const items: NativeSidebarMenuItem[] = [back];
    const accounts = data?.accounts.filter((account) => account.registered && account.provider === provider) ?? [];
    for (const account of accounts) {
      const weekly = account.usage.filter((window) => !window.model).find(isWeeklyWindow);
      const percent = (window: (typeof account.usage)[number]) =>
        `${accountUsageLabel(window)}: ${Math.round(window.usedPercent)}%`;
      const usage =
        provider === 'claude'
          ? accountHeadlineWindows(account).map(percent)
          : [weekly ? percent(weekly) : null, account.resetCredits != null ? `${account.resetCredits}rs` : null];
      items.push({
        label: format(account.name),
        detail: usage.filter(Boolean).join(' · '),
        suffix: account.id === data?.defaultAccounts[provider] ? '· Default' : undefined,
        agentIcon: provider,
        imageDataUrl: COLORED_AGENT_LOGOS[provider],
        disabled: account.status !== 'ready',
        command: {
          type: 'projectAction',
          action: 'agent',
          groupId: command.groupId,
          agentId: agent.agentId,
          accountId: account.id,
        },
      });
    }
    if (error)
      items.push(
        { label: format(error), disabled: true },
        { label: 'Try again', keepOpen: true, command: commandFor(command.groupId, 'retry', agent.agentId) }
      );
    if (!request) items.push({ label: 'Account connection unavailable.', disabled: true });
    if (data && !accounts.length)
      items.push(
        {
          label: 'Current CLI login',
          agentIcon: provider,
          imageDataUrl: COLORED_AGENT_LOGOS[provider],
          command: { type: 'projectAction', action: 'agent', groupId: command.groupId, agentId: agent.agentId },
        },
        { label: 'Uses your existing CLI sign-in. No account switcher needed.', disabled: true },
        { separator: true },
        { label: 'Add your account to see usage and reset times in Ghostex.', disabled: true },
        { label: 'Add account', command: { type: 'sidebarAction', action: 'accounts' } }
      );
    update(items);
  };
}
