import { createContext, useContext, useEffect, useState } from 'react';
import type { SessionChatDeferredWork, SessionChatMessage } from '@/packages/shared/session-chat';
import type { SessionChatTransport } from './session-chat-transport';

type HistoryReader = NonNullable<SessionChatTransport['readHistory']>;
export const SessionChatHistoryReaderContext = createContext<HistoryReader | undefined>(undefined);
const caches = new WeakMap<HistoryReader, Map<string, { messages: SessionChatMessage[]; bytes: number }>>();

export function invalidateDeferredSessionChatWork(read: SessionChatTransport['readHistory']): void {
  if (read) caches.delete(read);
}

async function readWork(read: HistoryReader, work: SessionChatDeferredWork): Promise<SessionChatMessage[]> {
  const key = JSON.stringify([work.beforeOffset, work.startId, work.endId]);
  let cache = caches.get(read);
  if (!cache) caches.set(read, (cache = new Map()));
  const cached = cache.get(key);
  if (cached) {
    cache.delete(key);
    cache.set(key, cached);
    return cached.messages;
  }
  let cursor = work.beforeOffset;
  let foundEnd = false;
  const messages: SessionChatMessage[] = [];
  const seen = new Set<number>();
  while (!seen.has(cursor)) {
    seen.add(cursor);
    const page = await read({ beforeOffset: cursor, limit: 200, detail: true });
    if (page.status === 'error') throw new Error(page.error ?? 'Work history could not be loaded.');
    for (const message of [...page.messages].reverse()) {
      if (message.id === work.startId) {
        if (!foundEnd) throw new Error('This work section changed. Refresh the conversation.');
        messages.reverse();
        const bytes = JSON.stringify(messages).length * 2;
        if (bytes <= 2 * 1024 * 1024) {
          cache.set(key, { messages, bytes });
          let total = [...cache.values()].reduce((sum, entry) => sum + entry.bytes, 0);
          while (cache.size > 8 || total > 2 * 1024 * 1024) {
            const oldest = cache.keys().next().value!;
            total -= cache.get(oldest)!.bytes;
            cache.delete(oldest);
          }
        }
        return messages;
      }
      if (message.id === work.endId) foundEnd = true;
      if (foundEnd) messages.push(message);
    }
    if (!page.hasMore) break;
    cursor = page.beforeOffset;
  }
  throw new Error('The original work section is no longer available. Refresh the conversation.');
}

export function useDeferredSessionChatWork(work: SessionChatDeferredWork | undefined, enabled: boolean) {
  const read = useContext(SessionChatHistoryReaderContext);
  const [state, setState] = useState<{
    key?: SessionChatDeferredWork;
    messages?: SessionChatMessage[];
    error?: string;
  }>({});
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    if (!work || !enabled) {
      setState({});
      return;
    }
    let active = true;
    setState({ key: work });
    if (!read) {
      setState({ key: work, error: 'This host cannot load deferred work.' });
      return;
    }
    void readWork(read, work).then(
      (messages) => {
        if (active) setState({ key: work, messages });
      },
      (error: unknown) => {
        if (active) setState({ key: work, error: error instanceof Error ? error.message : String(error) });
      }
    );
    return () => {
      active = false;
    };
  }, [read, work, enabled, attempt]);
  return { ...(state.key === work ? state : {}), retry: () => setAttempt((value) => value + 1) };
}

export function DeferredWorkLoading({ error, retry }: { error?: string; retry: () => void }) {
  return (
    <div role='status' className='px-3 py-2 text-sm text-muted-foreground'>
      {error ? (
        <>
          {error}{' '}
          <button type='button' className='underline' onClick={retry}>
            Retry
          </button>
        </>
      ) : (
        'Loading work details…'
      )}
    </div>
  );
}
