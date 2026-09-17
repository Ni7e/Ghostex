import { storageScope } from '@/packages/client-storage';
import type { SessionChatTransport } from '@/packages/core-ui/chat/session-chat-transport';
import type { SessionChatPendingModelSelection, SessionChatSelectionOptions } from '../session-chat';
import type { ModelPickerRequest, ModelPickerSelection } from '../session-chat-presentation/model-picker';
import type { ChatLifecycle } from './lifecycle';
import type { SessionChatOptionDispatchReceipt } from './option-state';

export interface ModelSelectionIntent extends ModelPickerSelection {
  id: string;
  options?: SessionChatSelectionOptions;
}

export interface ModelSelectionPersistence {
  read(key: string): ModelSelectionIntent | null;
  write(key: string, value: ModelSelectionIntent): void | Promise<void>;
  acknowledge(key: string, id: string): void | Promise<void>;
}

const storage = storageScope(['modelOutbox']);
const storageKey = (key: string) => `ghostex.model-selection-outbox.${key}`;
export function storedModelSelectionKeys(sessionKey: string): string[] {
  return storage
    .keys()
    .filter((key) => key === storageKey(sessionKey) || key.startsWith(`${storageKey(sessionKey)}#`))
    .map((key) => key.slice('ghostex.model-selection-outbox.'.length));
}
export const modelSelectionPersistence: ModelSelectionPersistence = {
  read(key) {
    try {
      const value = JSON.parse(storage.getItem(storageKey(key)) ?? 'null');
      return value &&
        typeof value.id === 'string' &&
        typeof value.model === 'string' &&
        typeof value.effort === 'string'
        ? value
        : null;
    } catch {
      return null;
    }
  },
  write(key, value) {
    storage.setItem(storageKey(key), JSON.stringify(value));
  },
  acknowledge(key, id) {
    if (modelSelectionPersistence.read(key)?.id === id) storage.removeItem(storageKey(key));
  },
};

export function queuedModelSelection(select: NonNullable<SessionChatTransport['selectSessionChatModel']>) {
  return async (params: ModelPickerSelection & { options?: SessionChatSelectionOptions }) => {
    const result = await select({ ...params, defer: true });
    if (!result.queued || !result.pendingModelSelection)
      throw new Error('The server has not accepted this selection into its queue.');
    if (
      Object.entries(params.options ?? {}).some(
        ([key, value]) => result.pendingModelSelection?.options?.[key as 'mode' | 'fastMode'] !== value
      )
    )
      throw new Error('Waiting for the server to support queued mode changes.');
    return result.pendingModelSelection;
  };
}

export function modelSelectionUnchanged(
  selection: ModelPickerSelection,
  desired: ModelPickerSelection | null | undefined,
  current: { model?: string; effort?: string },
  request: ModelPickerRequest | null
): boolean {
  if (desired) return desired.model === selection.model && desired.effort === selection.effort;
  return (
    selection.model === current.model &&
    (selection.effort === (current.effort ?? '') ||
      request?.models.find((entry) => entry.value === selection.model)?.efforts.length === 0)
  );
}

const deliveries = new Map<string, Promise<unknown>>();

/**
 * CDXC:SessionChat 2026-09-05 DECISION:
 * User: Option+P and model selection always work, including while the agent is working; an undeliverable selection waits for the next opportunity.
 * The local outbox covers disconnects until gxserver accepts the durable intent.
 * SEE-ALSO: server/src/session_chat_model_selection.rs owns delivery, coalescing and retries after the client closes.
 */
export function computeModelSelectionOutbox(
  params: {
    sessionKey?: string;
    pending?: SessionChatPendingModelSelection | null;
    beginDispatch(values: Readonly<Record<string, string>>): SessionChatOptionDispatchReceipt;
    deliver?: ReturnType<typeof queuedModelSelection>;
    persistence?: ModelSelectionPersistence;
  },
  lifecycle: ChatLifecycle
) {
  const { useState, useRef, useEffect, useCallback } = lifecycle;
  const persistence = params.persistence ?? modelSelectionPersistence;
  const key = params.sessionKey ?? '';
  const [outbox, setOutbox] = useState<ModelSelectionIntent | null>(() => persistence.read(key));
  const latest = useRef(outbox);
  const receipt = useRef<{
    id: string;
    owner: typeof params.beginDispatch;
    value: SessionChatOptionDispatchReceipt;
  } | null>(null);
  latest.current = outbox;
  const desired = outbox ?? params.pending;

  useEffect(() => {
    latest.current = persistence.read(key);
    setOutbox(latest.current);
    receipt.current = null;
  }, [key, persistence]);

  useEffect(() => {
    if (desired && (receipt.current?.id !== desired.id || receipt.current?.owner !== params.beginDispatch)) {
      receipt.current?.value.complete();
      receipt.current = {
        id: desired.id,
        owner: params.beginDispatch,
        value: params.beginDispatch({
          ...(desired.model ? { model: desired.model } : {}),
          ...(desired.effort ? { effort: desired.effort } : {}),
          ...desired.options,
        }),
      };
    } else if (!desired && receipt.current) {
      receipt.current.value.complete();
      receipt.current = null;
    }
  }, [desired, params.beginDispatch]);

  useEffect(() => {
    if (!outbox || !params.deliver) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout>;
    const deliver = async () => {
      try {
        const previous = deliveries.get(key);
        const operation = (async () => {
          await previous?.catch(() => undefined);
          if (cancelled || latest.current?.id !== outbox.id) return;
          return params.deliver!(outbox);
        })();
        deliveries.set(key, operation);
        let accepted;
        try {
          accepted = await operation;
        } finally {
          if (deliveries.get(key) === operation) deliveries.delete(key);
        }
        if (!accepted) return;
        await persistence.acknowledge(key, outbox.id);
        if (cancelled || latest.current?.id !== outbox.id) return;
        latest.current = null;
        setOutbox(null);
      } catch {
        if (!cancelled) timer = setTimeout(() => void deliver(), 5000);
      }
    };
    void deliver();
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [outbox, params.deliver, key, persistence]);

  const persist = useCallback(
    (selection: ModelPickerSelection, options?: SessionChatSelectionOptions) => {
      const next = { ...selection, options: { ...latest.current?.options, ...options }, id: crypto.randomUUID() };
      // A storage failure must not discard the pending in-memory selection.
      try {
        void Promise.resolve(persistence.write(key, next)).catch(() => undefined);
      } catch {}
      latest.current = next;
      setOutbox(next);
    },
    [key, persistence]
  );
  return {
    desired,
    outbox,
    select: persist,
    selectOptions: useCallback(
      (options: SessionChatSelectionOptions) =>
        persist(
          {
            model: latest.current?.model ?? '',
            effort: latest.current?.effort ?? '',
          },
          options
        ),
      [persist]
    ),
  };
}
