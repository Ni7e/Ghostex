import { maskAccountText } from '@/packages/shared/account-display';
import { COLORED_AGENT_LOGOS } from '@/packages/core-ui/agent-logos';
import { sidebarStore } from '@/packages/core-ui/sidebar-store-model';
import type { WebviewApi } from '@/packages/core-ui/webview-api';
import type { NativeSidebarCommand, NativeSidebarMenuItem } from '@/packages/shared/native-sidebar';

export function createNativeAccountMenuController(
  request: WebviewApi['requestSessionAccounts'],
  publish: (update: unknown) => void
) {
  let generation = 0;
  return async (command: Extract<NativeSidebarCommand, { type: 'sessionAccounts' }>) => {
    if (!request) return;
    const current = ++generation;
    const intent = (action: 'load' | 'retry' | 'select', accountId?: string): NativeSidebarCommand => ({
      type: 'sessionAccounts',
      sessionId: command.sessionId,
      action,
      accountId,
    });
    const format = (value: string) =>
      sidebarStore.getState().hud.settings?.hideAccountEmails ? maskAccountText(value) : value;
    let items: NativeSidebarMenuItem[];
    try {
      const data = await request(
        command.sessionId,
        command.action === 'select'
          ? { operation: 'select', accountId: command.accountId! }
          : { operation: 'session', ...(command.action === 'retry' ? { refresh: true } : {}) }
      );
      if (generation !== current) return;
      if (command.action === 'select') {
        publish({ kind: 'menu', version: 1, ownerId: command.sessionId, close: true, items: [] });
        return;
      }
      const working = sidebarStore.getState().sessionsById[command.sessionId]?.activity === 'working';
      items = data.accounts
        .filter((account) => account.registered && account.provider === data.session?.provider)
        .map((account) => ({
          label: format(account.name),
          agentIcon: account.provider,
          imageDataUrl: COLORED_AGENT_LOGOS[account.provider],
          checked: account.id === data.session?.accountId,
          disabled: working || account.id === data.session?.accountId || account.status !== 'ready',
          keepOpen: true,
          command: intent('select', account.id),
        }));
      if (!items.length) items.push({ label: 'No saved accounts.', disabled: true });
    } catch (error) {
      if (generation !== current) return;
      items = [
        { label: format(error instanceof Error ? error.message : String(error)), disabled: true },
        { label: 'Try again', keepOpen: true, command: intent('retry') },
      ];
    }
    items.push(
      { separator: true },
      { label: 'Manage accounts', icon: 'settings', command: { type: 'sidebarAction', action: 'accounts' } }
    );
    publish({ kind: 'menu', version: 1, ownerId: command.sessionId, close: false, items });
  };
}
