import { useEffect, useState, useSyncExternalStore } from 'react';
import {
  readSessionChatContextDetailsPreferences,
  subscribeSessionChatContextDetailsPreferences,
  type SessionChatContextDetailsPreferences,
} from '@/packages/shared/session-chat-presentation/context-details';
import type { ContextDetailsAgent } from './session-chat-context-details-agents';
export * from '@/packages/shared/session-chat-presentation/context-details';

export function useSessionChatContextDetailsPreferences(
  agent: ContextDetailsAgent = 'claude'
): SessionChatContextDetailsPreferences {
  return useSyncExternalStore(
    subscribeSessionChatContextDetailsPreferences,
    () => readSessionChatContextDetailsPreferences(agent),
    () => readSessionChatContextDetailsPreferences(agent)
  );
}

/** Wall clock that re-renders the countdowns every half minute. */
export function useSessionChatContextDetailsClock(): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 30_000);
    return () => window.clearInterval(timer);
  }, []);
  return now;
}
