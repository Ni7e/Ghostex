import type { SessionChatDeferredWork, SessionChatMessage } from '../session-chat';
import type { SessionChatTransport } from '@/packages/core-ui/chat/session-chat-transport';
export type HistoryReader = NonNullable<SessionChatTransport['readHistory']>;
const caches = new WeakMap<HistoryReader, Map<string, { messages: SessionChatMessage[]; bytes: number }>>();

export function invalidateDeferredSessionChatWork(read: SessionChatTransport['readHistory']): void {
  if (read) caches.delete(read);
}

export async function readWork(read: HistoryReader, work: SessionChatDeferredWork): Promise<SessionChatMessage[]> {
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

