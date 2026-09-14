import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { AccountsTransport, AgentAccountsRequest, AgentAccountsState } from '@/packages/shared/agent-accounts';
import { requestSharedAccounts } from './shared-requests';

export interface AccountsSnapshotCache {
  getSnapshot(sessionAgentId: string | null): AgentAccountsState | undefined;
  update(data: AgentAccountsState, sessionAgentId: string | null): void;
}

export function useAccounts(
  transport: AccountsTransport | undefined,
  session = false,
  active = true,
  refreshOnOpen = false,
  sessionAgentId?: string | null,
  retained?: AccountsSnapshotCache
) {
  const [data, setData] = useState<AgentAccountsState | undefined>(() =>
    active ? retained?.getSnapshot(sessionAgentId ?? null) : undefined
  );
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const generation = useRef(0);
  const pending = useRef(false);
  const load = useCallback(
    async (params: AgentAccountsRequest) => {
      if (!transport) return undefined;
      const id = ++generation.current;
      pending.current = true;
      setBusy(true);
      setRefreshing('refresh' in params && params.refresh === true);
      setError('');
      try {
        const result = await requestSharedAccounts(transport, params, sessionAgentId);
        if (generation.current === id) {
          retained?.update(result, sessionAgentId ?? null);
          setData(result);
        }
        return result;
      } catch (e) {
        if (generation.current === id) setError(e instanceof Error ? e.message : 'Account request failed.');
        return undefined;
      } finally {
        if (generation.current === id) {
          setBusy(false);
          setRefreshing(false);
          pending.current = false;
        }
      }
    },
    [transport, sessionAgentId, retained]
  );
  const request = useCallback(async (params: AgentAccountsRequest) => Boolean(await load(params)), [load]);
  useLayoutEffect(() => {
    setData(active ? retained?.getSnapshot(sessionAgentId ?? null) : undefined);
  }, [active, transport, sessionAgentId, retained]);
  /** CDXC:AgentProviders 2026-09-10 WHY: Switching a draft's agent keeps its transport and can leave account management enabled. Reload on agent identity changes so the menu cannot retain the previous provider's accounts until the next poll. */
  useEffect(() => {
    if (!active || !transport) {
      setBusy(false);
      setRefreshing(false);
      return;
    }
    void request({ operation: session ? 'session' : 'list', refresh: refreshOnOpen });
    const refresh = () => {
      if (!document.hidden && !pending.current) void request({ operation: session ? 'session' : 'list' });
    };
    const timer = setInterval(refresh, 30000);
    window.addEventListener('focus', refresh);
    document.addEventListener('visibilitychange', refresh);
    return () => {
      clearInterval(timer);
      window.removeEventListener('focus', refresh);
      document.removeEventListener('visibilitychange', refresh);
      generation.current++;
      pending.current = false;
    };
  }, [active, transport, session, request, refreshOnOpen, sessionAgentId]);
  return { data, error, busy, refreshing, load, request };
}
