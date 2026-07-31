// Session Chat cross-source assembler (orca §6.2–§6.4 port).
// The real dedup: id first, then a text-derived turn key that merges ONLY
// across different sources. Two identical same-source prompts ("continue"
// twice) must stay distinct.
//
// Correctness invariant (locked by session-chat-assembler.test.ts):
// applyAppends output deep-equals a full rebuild over base ++ all-appends for
// every prefix.

import {
  SESSION_CHAT_SOURCE_PRIORITY,
  type SessionChatMessage,
} from "../../shared/session-chat";

const STREAMING_ID = "streaming";
const PENDING_PREFIX = "pending:";
const LAUNCH_PENDING_PREFIX = "launch-pending:";

function stableStringify(value: unknown): string {
  if (typeof value === "string") {
    return value;
  }
  try {
    return JSON.stringify(value) ?? String(value);
  } catch {
    return String(value);
  }
}

function nonTextBlockDigest(message: SessionChatMessage): string {
  const parts: string[] = [];
  for (const block of message.blocks) {
    if (block.type === "tool-call") {
      parts.push(`call:${block.name}:${stableStringify(block.input)}`);
    } else if (block.type === "tool-result") {
      parts.push(`result:${block.output}`);
    } else if (block.type === "image-ref") {
      parts.push(`image:${block.path ?? block.url ?? block.alt ?? ""}`);
    }
  }
  return parts.join("|");
}

export function sessionChatTurnKey(message: SessionChatMessage): string {
  if (message.turnId) {
    return `turn:${message.turnId}`;
  }
  const text = message.blocks
    .filter((block) => block.type === "text")
    .map((block) => block.text)
    .join(" ")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
  return `${message.role}:${text}:${nonTextBlockDigest(message)}`;
}

/** Strict >: an equal-priority cross-source duplicate never replaces. */
function supersedes(candidate: SessionChatMessage, existing: SessionChatMessage): boolean {
  return (
    SESSION_CHAT_SOURCE_PRIORITY[candidate.source] >
    SESSION_CHAT_SOURCE_PRIORITY[existing.source]
  );
}

function replaceEntry(
  byId: Map<string, SessionChatMessage>,
  byTurn: Map<string, SessionChatMessage>,
  previous: SessionChatMessage,
  next: SessionChatMessage,
): void {
  byId.delete(previous.id);
  byTurn.delete(sessionChatTurnKey(previous));
  byId.set(next.id, next);
  byTurn.set(sessionChatTurnKey(next), next);
}

function mergeOne(
  byId: Map<string, SessionChatMessage>,
  byTurn: Map<string, SessionChatMessage>,
  message: SessionChatMessage,
): void {
  const existingById = byId.get(message.id);
  if (existingById) {
    if (supersedes(message, existingById)) {
      replaceEntry(byId, byTurn, existingById, message);
    }
    return;
  }
  const key = sessionChatTurnKey(message);
  const existingByTurn = byTurn.get(key);
  // CROSS-SOURCE ONLY: same-source identical turns stay distinct.
  if (existingByTurn && existingByTurn.source !== message.source) {
    if (supersedes(message, existingByTurn)) {
      replaceEntry(byId, byTurn, existingByTurn, message);
    }
    return;
  }
  byId.set(message.id, message);
  byTurn.set(key, message);
}

// --- Sort order (§6.3): three tiers, then timestamp, then id -----------------
// Tiering exists because the streaming preview has timestamp: null (would sort
// to the FRONT without a tier) and optimistic echoes carry a real sentAt
// (would sort past the preview).

export function sessionChatMessageSortRank(message: SessionChatMessage): number {
  if (message.id === STREAMING_ID) {
    return 1;
  }
  if (
    message.id.startsWith(PENDING_PREFIX) ||
    message.id.startsWith(LAUNCH_PENDING_PREFIX)
  ) {
    return 2;
  }
  return 0;
}

export function compareSessionChatMessages(
  a: SessionChatMessage,
  b: SessionChatMessage,
): number {
  const rankA = sessionChatMessageSortRank(a);
  const rankB = sessionChatMessageSortRank(b);
  if (rankA !== rankB) {
    return rankA - rankB;
  }
  const at = a.timestamp ?? Number.NEGATIVE_INFINITY;
  const bt = b.timestamp ?? Number.NEGATIVE_INFINITY;
  if (at !== bt) {
    return at - bt;
  }
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

export function orderSessionChatMessages(
  messages: readonly SessionChatMessage[],
): SessionChatMessage[] {
  return [...messages].sort(compareSessionChatMessages);
}

// --- One-shot assembly (§6.2) ------------------------------------------------

export interface SessionChatAssemblySources {
  /** Server-decoded transcript messages (highest priority). */
  transcript?: readonly SessionChatMessage[];
  /** Live hook-derived messages (streaming preview etc.). */
  hook?: readonly SessionChatMessage[];
  /** Client-local synthetic messages (pending sends, markers). */
  client?: readonly SessionChatMessage[];
}

export function assembleSessionChatMessages(
  sources: SessionChatAssemblySources,
): SessionChatMessage[] {
  // Highest priority FIRST so a later lower-priority duplicate is dropped,
  // not applied.
  const ordered = [
    ...(sources.transcript ?? []),
    ...(sources.hook ?? []),
    ...(sources.client ?? []),
  ];
  const byId = new Map<string, SessionChatMessage>();
  const byTurn = new Map<string, SessionChatMessage>();
  for (const message of ordered) {
    mergeOne(byId, byTurn, message);
  }
  return [...byId.values()].sort(compareSessionChatMessages);
}

// --- Incremental assembler (§6.4) --------------------------------------------

export interface IncrementalSessionChatAssembler {
  byId: Map<string, SessionChatMessage>;
  byTurn: Map<string, SessionChatMessage>;
  messages: SessionChatMessage[];
}

export function createIncrementalSessionChatAssembler(): IncrementalSessionChatAssembler {
  return { byId: new Map(), byTurn: new Map(), messages: [] };
}

/** Canonical rebuild; byte-for-byte equals assembleSessionChatMessages. */
export function resetIncrementalSessionChatAssembler(
  assembler: IncrementalSessionChatAssembler,
  base: readonly SessionChatMessage[],
): void {
  assembler.byId = new Map();
  assembler.byTurn = new Map();
  for (const message of base) {
    mergeOne(assembler.byId, assembler.byTurn, message);
  }
  assembler.messages = [...assembler.byId.values()].sort(compareSessionChatMessages);
}

function isTailAppend(
  current: readonly SessionChatMessage[],
  incoming: readonly SessionChatMessage[],
): boolean {
  const last = current.at(-1);
  if (!last) {
    return true;
  }
  for (const message of incoming) {
    if (message.timestamp === null) {
      // null sorts to the FRONT: never a tail append.
      return false;
    }
    if (compareSessionChatMessages(message, last) < 0) {
      return false;
    }
  }
  return true;
}

export function applySessionChatAppends(
  assembler: IncrementalSessionChatAssembler,
  incoming: readonly SessionChatMessage[],
): SessionChatMessage[] {
  if (incoming.length === 0) {
    return assembler.messages;
  }
  const sizeBefore = assembler.byId.size;
  for (const message of incoming) {
    mergeOne(assembler.byId, assembler.byTurn, message);
  }
  const grewByBatch = assembler.byId.size === sizeBefore + incoming.length;
  if (grewByBatch && isTailAppend(assembler.messages, incoming)) {
    const tail = [...incoming].sort(compareSessionChatMessages);
    assembler.messages = [...assembler.messages, ...tail];
    return assembler.messages;
  }
  assembler.messages = [...assembler.byId.values()].sort(compareSessionChatMessages);
  return assembler.messages;
}

/**
 * Reference-identity prefix check for the base-vs-append axis (§6.4 client
 * wiring): the transcript list is a suffix extension of what the assembler
 * already applied only when every already-applied element is the SAME object.
 */
export function sessionChatSharesPrefix(
  transcript: readonly SessionChatMessage[],
  applied: readonly SessionChatMessage[],
  length: number,
): boolean {
  for (let i = 0; i < length; i += 1) {
    if (transcript[i] !== applied[i]) {
      return false;
    }
  }
  return true;
}
