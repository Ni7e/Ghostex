import type { AccountProvider, AgentAccountsRequest, AgentAccountsState } from '../agent-accounts';
import type { UseSessionChatResult } from '@/packages/core-ui/chat/use-session-chat/state';
import type { ChatLifecycle } from './lifecycle';
import { computeAccountSwitchStatus } from './account-switch';
import { nativeAccountPanel, nativeAccountSwitchCard } from './native-accounts';

export function computeNativeChatControls(
  chat: UseSessionChatResult,
  rpc: <T>(method: string, params: Record<string, unknown>) => Promise<T>,
  lifecycle: ChatLifecycle
) {
  const { useState, useEffect, useRef } = lifecycle;
  const [accounts, setAccounts] = useState<AgentAccountsState | undefined>(undefined);
  const [accountError, setAccountError] = useState<string | undefined>(undefined);
  const [accountsBusy, setAccountsBusy] = useState(false);
  const generation = useRef(0);
  const pending = useRef(false);
  const provider =
    chat.accountSwitch?.provider ?? (chat.agent === 'claude' || chat.agent === 'codex' ? chat.agent : undefined);
  /*
  The family React's chat view keys Switch Account on: a draft's base agent (a
  custom agent built on Claude still manages Claude accounts), else the
  transcript family.
  */
  const family =
    chat.availableAgents?.find((row) => row.agentId === chat.sessionAgentId)?.baseAgentId ?? chat.agent ?? undefined;
  const panelProvider: AccountProvider | undefined = family === 'claude' || family === 'codex' ? family : undefined;
  /*
  One request path for the periodic session read and the panel's own requests,
  like useAccounts: a newer request wins, and polls skip while one is pending so
  an older read cannot land after a switch or policy change.
  */
  const requestAccounts = async (params: AgentAccountsRequest): Promise<boolean> => {
    const id = ++generation.current;
    pending.current = true;
    setAccountsBusy(true);
    setAccountError(undefined);
    try {
      const result = await rpc<AgentAccountsState>('agentAccounts', params);
      if (generation.current === id) setAccounts(result);
      return true;
    } catch (error) {
      if (generation.current === id) setAccountError(error instanceof Error ? error.message : String(error));
      return false;
    } finally {
      if (generation.current === id) {
        pending.current = false;
        setAccountsBusy(false);
      }
    }
  };
  useEffect(() => {
    if (!provider && !panelProvider) {
      setAccounts(undefined);
      return;
    }
    void requestAccounts({ operation: 'session' });
    const timer = setInterval(() => {
      if (!pending.current) void requestAccounts({ operation: 'session' });
    }, 30_000);
    return () => {
      clearInterval(timer);
      generation.current++;
      pending.current = false;
    };
  }, [provider, panelProvider, chat.sessionAgentId, chat.accountSwitch?.id, chat.accountSwitch?.phase]);
  const ready =
    (!chat.accountSwitch?.toAccountId || accounts?.session?.accountId === chat.accountSwitch.toAccountId) &&
    !chat.pendingModelSelection;
  const accountStatus = computeAccountSwitchStatus(chat.accountSwitch, undefined, ready, lifecycle);
  return {
    accounts,
    accountError,
    accountStatus,
    requestAccounts,
    accountPanel: panelProvider
      ? nativeAccountPanel(accounts, accountError, accountsBusy, chat.selectedOptions?.contextUsage)
      : null,
    accountSwitchCard: accountStatus.visible
      ? nativeAccountSwitchCard(accountStatus.visible, accounts, accountError, ready, accountsBusy, accountStatus.now)
      : null,
  };
}
