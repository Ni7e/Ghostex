import { storageFailure, subscribeStorage } from '@/packages/client-storage';
import { useCallback, useRef, useState, useSyncExternalStore } from 'react';
import { questionDraftStorageKey, readQuestionDrafts, writeQuestionDrafts, remainingQuestionDrafts, type AnswerDrafts, type SessionChatAnswerDraft } from '@/packages/shared/session-chat-controller/question-drafts';
export type { SessionChatAnswerDraft } from '@/packages/shared/session-chat-controller/question-drafts';

export function useSessionChatQuestionDrafts(sessionKey: string | undefined, promptKey: string) {
  const persistenceError = useSyncExternalStore(subscribeStorage, () => storageFailure('questionDrafts'), () => undefined);
  const scope = JSON.stringify([sessionKey, promptKey]);
  const key = sessionKey ? questionDraftStorageKey(sessionKey, promptKey) : null;
  const [state, setState] = useState(() => ({ scope, drafts: readQuestionDrafts(key), error: '' }));
  if (state.scope !== scope) setState({ scope, drafts: readQuestionDrafts(key), error: '' });
  const stateRef = useRef(state);
  stateRef.current = state;

  const saveDrafts = useCallback(
    (drafts: AnswerDrafts): void => {
      let error = '';
      if (key) {
        try {
          writeQuestionDrafts(key, drafts);
        } catch {
          error = 'Your answer could not be saved on this computer. Keep this view open until saving succeeds.';
        }
      }
      if (stateRef.current.scope === scope) {
        stateRef.current = { scope, drafts, error };
        setState(stateRef.current);
      }
    },
    [key, scope]
  );

  const clearDrafts = useCallback(
    (submitted: AnswerDrafts): void => {
      const remaining = remainingQuestionDrafts(
        key ? readQuestionDrafts(key) : stateRef.current.scope === scope ? stateRef.current.drafts : {},
        submitted
      );
      if (key) {
        try {
          writeQuestionDrafts(key, remaining);
        } catch {
          return;
        }
      }
      setState((current) => (current.scope === scope ? { scope, drafts: remaining, error: '' } : current));
    },
    [key, scope]
  );

  const updateDraft = useCallback(
    (question: string, update: (draft: SessionChatAnswerDraft) => SessionChatAnswerDraft): void => {
      const current =
        key && !stateRef.current.error
          ? readQuestionDrafts(key)
          : stateRef.current.scope === scope
            ? stateRef.current.drafts
            : {};
      saveDrafts({ ...current, [question]: update(current[question] ?? { indices: [], other: '' }) });
    },
    [key, scope, saveDrafts]
  );

  return { drafts: state.drafts, saveDrafts, updateDraft, clearDrafts, saveError: state.error || (persistenceError ? 'Your answer could not be saved on this computer. Keep this view open until saving succeeds.' : '') };
}
