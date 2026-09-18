import type { AgentAccountsState } from '../agent-accounts';
import type { UseSessionChatResult } from '@/packages/core-ui/chat/use-session-chat/state';
import type { ChatLifecycle } from './lifecycle';
import { computeAccountSwitchStatus } from './account-switch';

export function computeNativeChatControls(
  chat: UseSessionChatResult,
  rpc: <T>(method: string, params: Record<string, unknown>) => Promise<T>,
  lifecycle: ChatLifecycle
) {
  const { useState, useEffect } = lifecycle;
  const [accounts, setAccounts] = useState<AgentAccountsState | undefined>(undefined);
  const [accountError, setAccountError] = useState<string | undefined>(undefined);
  const provider =
    chat.accountSwitch?.provider ?? (chat.agent === 'claude' || chat.agent === 'codex' ? chat.agent : undefined);
  useEffect(() => {
    if (!provider) {
      setAccounts(undefined);
      return;
    }
    let disposed = false;
    let pending = false;
    const read = async () => {
      if (pending) return;
      pending = true;
      try {
        const result = await rpc<AgentAccountsState>('agentAccounts', { operation: 'session' });
        if (!disposed) {
          setAccounts(result);
          setAccountError(undefined);
        }
      } catch (error) {
        if (!disposed) setAccountError(error instanceof Error ? error.message : String(error));
      } finally {
        pending = false;
      }
    };
    void read();
    const timer = setInterval(() => void read(), 30_000);
    return () => {
      disposed = true;
      clearInterval(timer);
    };
  }, [provider, chat.sessionAgentId, chat.accountSwitch?.id, chat.accountSwitch?.phase]);
  const ready =
    (!chat.accountSwitch?.toAccountId || accounts?.session?.accountId === chat.accountSwitch.toAccountId) &&
    !chat.pendingModelSelection;
  const accountStatus = computeAccountSwitchStatus(chat.accountSwitch, undefined, ready, lifecycle);
  return { accounts, accountError, accountStatus };
}
