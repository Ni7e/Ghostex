import type { AgentAccountsState } from '@/packages/shared/agent-accounts';
import type { SessionChatDetectedOptions } from '@/packages/shared/session-chat';

export interface SessionChatPresentationState {
  accounts?: { sessionAgentId: string | null; data: AgentAccountsState };
  selectedOptions?: SessionChatDetectedOptions;
  sessionAgentId?: string | null;
  agentSessionId?: string | null;
  agent?: string;
  statusLineReady?: boolean;
  sessionTitle?: string;
}

export interface SessionChatPresentationStore {
  getSnapshot(): SessionChatPresentationState;
  update(patch: Partial<SessionChatPresentationState>): void;
}

/**
 * CDXC:SessionChat 2026-09-14 DECISION:
 * User: returning to a chat should immediately restore its account, context usage, and status line, then refresh them in the background; initial waiting belongs only to a chat that has not loaded yet.
 * Keep this small state independent of transcript retention so releasing a large conversation's page does not reset its bottom bar.
 */
export function createSessionChatPresentationStore(
  initial: SessionChatPresentationState = {},
  onChange?: (state: SessionChatPresentationState) => void
): SessionChatPresentationStore {
  let snapshot = initial;
  let serialized = JSON.stringify(snapshot);
  return {
    getSnapshot: () => snapshot,
    update(patch) {
      if (
        Object.entries(patch).every(([key, value]) =>
          Object.is(snapshot[key as keyof SessionChatPresentationState], value)
        )
      )
        return;
      const next = { ...snapshot, ...patch };
      const nextSerialized = JSON.stringify(next);
      if (nextSerialized === serialized) return;
      snapshot = next;
      serialized = nextSerialized;
      onChange?.(snapshot);
    },
  };
}
