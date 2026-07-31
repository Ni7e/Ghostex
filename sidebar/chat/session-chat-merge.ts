// Session Chat id-dedup merger (orca §6.1 port).
// Used for the append stream: id-only dedup with in-place replacement that
// preserves first-seen order. Source priority uses >= so an equal-priority
// re-emit still refreshes content.

import {
  SESSION_CHAT_SOURCE_PRIORITY,
  type SessionChatMessage,
  type SessionChatSource,
} from "../../shared/session-chat";

export type SessionChatSourcePriority = Record<SessionChatSource, number>;

function applyIncoming(
  list: SessionChatMessage[],
  indexById: Map<string, number>,
  incoming: readonly SessionChatMessage[],
  priority: SessionChatSourcePriority,
): void {
  for (const message of incoming) {
    const at = indexById.get(message.id);
    if (at === undefined) {
      indexById.set(message.id, list.length);
      list.push(message);
      continue;
    }
    const existing = list[at];
    if (existing && priority[message.source] >= priority[existing.source]) {
      list[at] = message;
    }
  }
}

export function mergeSessionChatMessagesWith(
  existing: readonly SessionChatMessage[],
  incoming: readonly SessionChatMessage[],
  priority: SessionChatSourcePriority = SESSION_CHAT_SOURCE_PRIORITY,
): readonly SessionChatMessage[] {
  if (incoming.length === 0) {
    return existing;
  }
  const list = [...existing];
  const indexById = new Map<string, number>();
  for (let i = 0; i < list.length; i += 1) {
    const entry = list[i];
    if (entry) {
      indexById.set(entry.id, i);
    }
  }
  applyIncoming(list, indexById, incoming, priority);
  return list;
}

export function boundSessionChatWindow(
  messages: readonly SessionChatMessage[],
  limit: number,
): readonly SessionChatMessage[] {
  if (limit <= 0 || messages.length <= limit) {
    return messages;
  }
  return messages.slice(messages.length - limit);
}

export interface SessionChatMerger {
  list: SessionChatMessage[];
  indexById: Map<string, number>;
  priority: SessionChatSourcePriority;
}

export function createSessionChatMerger(
  priority: SessionChatSourcePriority = SESSION_CHAT_SOURCE_PRIORITY,
): SessionChatMerger {
  return { indexById: new Map(), list: [], priority };
}

export function replaceSessionChatMergerList(
  merger: SessionChatMerger,
  list: readonly SessionChatMessage[],
): void {
  merger.list = [...list];
  merger.indexById = new Map();
  for (let i = 0; i < merger.list.length; i += 1) {
    const entry = merger.list[i];
    if (entry) {
      merger.indexById.set(entry.id, i);
    }
  }
}

export function applySessionChatMergerAppend(
  merger: SessionChatMerger,
  incoming: readonly SessionChatMessage[],
  limit?: number,
): SessionChatMessage[] {
  const next = [...merger.list];
  applyIncoming(next, merger.indexById, incoming, merger.priority);
  const bounded = limit === undefined ? next : boundSessionChatWindow(next, limit);
  if (bounded !== next) {
    // Trimming shifts every index; rebuild.
    replaceSessionChatMergerList(merger, bounded);
    return merger.list;
  }
  merger.list = next;
  return next;
}
