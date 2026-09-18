import { storageScope } from '@/packages/client-storage';
import { SessionChatStorageIndex } from '@/packages/core-ui/chat/session-chat-storage-index';

const clientStorage = storageScope(["questionDrafts"]);

export interface SessionChatAnswerDraft {
  indices: number[];
  other: string;
}

export type AnswerDrafts = Record<string, SessionChatAnswerDraft>;
const PREFIX = 'ghostex.sessionChat.questionDraft.';
const draftIndex = new SessionChatStorageIndex<AnswerDrafts>(
  'questionDrafts',
  PREFIX, decodeDrafts, () => '');

function decodeDrafts(raw: string): AnswerDrafts | null {
  try {
    const value = JSON.parse(raw) as AnswerDrafts;
    if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
    return Object.values(value).every(
      (answer) =>
        answer &&
        typeof answer.other === 'string' &&
        Array.isArray(answer.indices) &&
        answer.indices.every((index) => Number.isSafeInteger(index) && index >= 0)
    )
      ? value
      : null;
  } catch {
    return null;
  }
}

export function readQuestionDrafts(key: string | null): AnswerDrafts {
  if (!key) return {};
  try {
    return decodeDrafts(clientStorage.getItem(key) ?? '{}') ?? {};
  } catch {
    return {};
  }
}

/**
 * CDXC:SessionChat 2026-09-15 DECISION:
 * User: answer text in question cards must survive session switches, reusing the composer's draft storage system.
 * Save each edit through the same local storage index, scoped to the session and question, and clear only after successful delivery or explicit dismissal.
 */
export function questionDraftStorageKey(sessionKey: string | undefined, promptKey: string): string | null {
  return sessionKey ? `${PREFIX}${JSON.stringify([sessionKey, promptKey])}` : null;
}

export function writeQuestionDrafts(key: string, drafts: AnswerDrafts): void {
  if (Object.keys(drafts).length) draftIndex.set(key, drafts);
  else draftIndex.remove(key);
}

export function remainingQuestionDrafts(current: AnswerDrafts, submitted: AnswerDrafts): AnswerDrafts {
  const remaining = { ...current };
  for (const [question, answer] of Object.entries(submitted)) {
    if (JSON.stringify(remaining[question]) === JSON.stringify(answer)) delete remaining[question];
  }
  return remaining;
}
