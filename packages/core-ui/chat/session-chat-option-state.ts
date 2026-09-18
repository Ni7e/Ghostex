import { useMemo, useSyncExternalStore } from 'react';
import type { SessionChatSessionOptionCatalog } from './session-chat-session-options';
import { createSessionChatOptionState } from '@/packages/shared/session-chat-controller/option-state';
export {
  createSessionChatOptionState,
  type SessionChatOptionDispatchReceipt,
} from '@/packages/shared/session-chat-controller/option-state';

export function useSessionChatOptionState(
  catalog: SessionChatSessionOptionCatalog | null,
  storageKey: string | undefined,
  onUnconfirmed: () => void
) {
  const store = useMemo(
    () => createSessionChatOptionState(catalog, storageKey, onUnconfirmed),
    [catalog, storageKey, onUnconfirmed]
  );
  const state = useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot);
  return { ...store, state };
}
