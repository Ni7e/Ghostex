import { storageScope } from '@/packages/client-storage';
import {
  questionDraftStorageKey,
  readQuestionDrafts,
  writeQuestionDrafts,
  remainingQuestionDrafts,
} from './question-drafts';
import type { AsyncQuestionPersistence } from './async-questions';

const storage = storageScope(['retiredQuestions']);

export function asyncQuestionStorage(sessionKey: string | undefined): AsyncQuestionPersistence {
  const draftKey = questionDraftStorageKey(sessionKey, 'async');
  const retiredKey = sessionKey ? `ghostex:async-questions:${sessionKey}` : null;
  const readRetired = (): string[] => {
    if (!retiredKey) return [];
    try {
      const value: unknown = JSON.parse(storage.getItem(retiredKey) ?? '[]');
      return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];
    } catch {
      return [];
    }
  };
  return {
    async read() {
      return { drafts: readQuestionDrafts(draftKey), retired: readRetired() };
    },
    async write(drafts) {
      if (draftKey) writeQuestionDrafts(draftKey, drafts);
    },
    async retire(key, submitted) {
      if (draftKey) writeQuestionDrafts(draftKey, remainingQuestionDrafts(readQuestionDrafts(draftKey), submitted));
      if (retiredKey) storage.setItem(retiredKey, JSON.stringify([...new Set([...readRetired(), key])].slice(-1000)));
    },
  };
}
