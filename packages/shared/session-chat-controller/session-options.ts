import type { AgentModelCatalog } from '../agent-model-catalog';
import type { ChatLifecycle } from './lifecycle';
import { createSessionChatOptionState, type SessionChatOptionPersistence } from './option-state';
import { sessionChatSessionOptionCatalog } from '@/packages/core-ui/chat/session-chat-session-options';

export function computeSessionChatOptions(
  {
    agent,
    draftAgentId,
    sessionKey,
    agentModelCatalog,
    onUnconfirmed,
    persistence,
  }: {
    agent: string | null | undefined;
    draftAgentId?: string | null;
    sessionKey?: string;
    agentModelCatalog: AgentModelCatalog;
    onUnconfirmed: () => void;
    persistence?: SessionChatOptionPersistence;
  },
  lifecycle: ChatLifecycle
) {
  const { useMemo, useRef, useState, useLayoutEffect } = lifecycle;
  // CDXC:AgentProviders 2026-09-02: the option catalog is built from the
  // published agent model catalog, so a remote refresh rebuilds the pills.
  const catalog = useMemo(() => sessionChatSessionOptionCatalog(agent), [agent, agentModelCatalog]);

  /*
  CDXC:Drafts 2026-08-28: the option-storage key scheme.

  A session that has never been a draft in this client keeps the original key
  (`…options.<sessionKey>`), so every existing session still reads exactly what
  it stored. A draft appends `#<agentId>`, which is what makes switching its
  agent CLI start from that agent's own values instead of carrying the previous
  CLI's dispatched model , the family-level catalog cannot tell those apart.

  The suffix LATCHES for the life of this mount: promotion (the first send)
  stops the daemon sending `availableAgents`, and without the latch the key
  would move back mid-session and drop a dispatched value gxserver has not
  confirmed yet. A later reload of a promoted session lands on the plain key
  again, by which time detection is the authority anyway.
  */
  const latchedDraftAgentRef = useRef<{ agentId: string; sessionKey: string | undefined } | null>(null);
  if (draftAgentId) {
    latchedDraftAgentRef.current = { agentId: draftAgentId, sessionKey };
  }
  const latchedDraftAgent = latchedDraftAgentRef.current;
  const storageAgentId =
    latchedDraftAgent !== null && latchedDraftAgent.sessionKey === sessionKey ? latchedDraftAgent.agentId : null;
  const storageKey =
    sessionKey === undefined ? undefined : storageAgentId === null ? sessionKey : `${sessionKey}#${storageAgentId}`;

  const store = useMemo(
    () => createSessionChatOptionState(catalog, storageKey, onUnconfirmed, persistence),
    [catalog, storageKey, onUnconfirmed, persistence]
  );
  const [, updated] = useState(0);
  useLayoutEffect(() => store.subscribe(() => updated((value) => value + 1)), [store]);
  const state = store.getSnapshot();
  const { beginDispatch, recordDispatched, reconcileTypedCommand, applyDetected } = store;

  const optionDescriptors = useMemo(() => {
    if (!catalog) {
      return [];
    }
    const modelValue = state[catalog.model.id]?.value ?? catalog.model.defaultValue ?? '';
    return catalog.optionsForModel(modelValue);
  }, [catalog, state]);

  return {
    sessionKey: storageKey,
    beginDispatch,
    applyDetected,
    catalog,
    optionDescriptors,
    recordDispatched,
    reconcileTypedCommand,
    state,
  };
}
