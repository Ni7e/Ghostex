import { storageFailure, subscribeStorage } from '@/packages/client-storage';
import { SessionChatAsyncQuestionsController } from '@/packages/shared/session-chat-controller/async-questions';
import { asyncQuestionStorage } from '@/packages/shared/session-chat-controller/async-question-storage';
import { IconChevronDown, IconChevronLeft, IconChevronRight } from '@tabler/icons-react';
import { useEffect, useId, useMemo, useSyncExternalStore } from 'react';
import { Button } from '@/packages/components/ui/button';
import type { SessionChatMessage, SessionChatTheme } from '@/packages/shared/session-chat';
import { SessionChatChoiceRows } from './session-chat-choice-rows';
import { SessionQuestionIndicator } from '../session-question-indicator';
import { SessionChatAnswerInput } from './session-chat-answer-input';
import type { SaveSessionChatImage } from './session-chat-image-attachments';
import './session-chat-async-questions.css';

/**
 * CDXC:SessionChat 2026-09-12 DECISION:
 * User: Codex questions asked while it is still working appear in a new component above the chat composer.
 * The composer keeps its draft and remains usable; choosing a suggested answer requires an explicit send.
 */
export function SessionChatAsyncQuestions({
  messages,
  canSend,
  working,
  onSend,
  onDismiss,
  sessionKey,
  onPasteImage,
  theme,
}: {
  messages: readonly SessionChatMessage[];
  canSend: boolean;
  working: boolean;
  onSend: (questionId: string, text: string) => Promise<void>;
  onDismiss: (questionId: string) => Promise<void>;
  sessionKey?: string;
  onPasteImage?: SaveSessionChatImage;
  theme?: SessionChatTheme;
}) {
  const controller = useMemo(
    () => new SessionChatAsyncQuestionsController(asyncQuestionStorage(sessionKey)),
    [sessionKey]
  );
  useSyncExternalStore(controller.subscribe, controller.version, controller.version);
  useEffect(() => {
    void controller.load();
  }, [controller]);
  const persistenceError = useSyncExternalStore(
    subscribeStorage,
    () => storageFailure('questionDrafts'),
    () => undefined
  );
  const state = controller.project(messages, canSend, working);
  const { question, draft, answer, disabled, collapsed, submitting, loading, index, count } = state;
  const error =
    state.error ||
    (persistenceError
      ? 'Your answer could not be saved on this computer. Keep this view open until saving succeeds.'
      : '');
  const panelId = useId();
  if (!question) return null;
  const submit = (skip = false) =>
    controller.submit(messages, canSend, skip, (key, text, dismiss) => (dismiss ? onDismiss(key) : onSend(key, text)));

  return (
    <section
      className='ghostex-chat-async-questions'
      aria-label='Questions from Codex'
      data-chat-async-questions='true'
    >
      <span className='sr-only' role='status'>
        {count} unanswered question{count === 1 ? '' : 's'} from Codex.
        {working ? ' The agent is still working.' : ''}
      </span>
      <button
        className='ghostex-chat-async-questions-header'
        data-slot='async-questions-header'
        type='button'
        aria-expanded={!collapsed}
        aria-controls={panelId}
        onClick={() => controller.toggle()}
      >
        <SessionQuestionIndicator working={working} />
        <span className='font-medium'>Question{count > 1 ? 's' : ''} from Codex</span>
        {/* CDXC:SessionChat 2026-09-14 DECISION: User: remove the idle "Reply when ready" label from the Codex questions card. */}
        <span className='min-w-0 flex-1 text-muted-foreground'>{working ? 'Still working' : null}</span>
        <span className='text-muted-foreground'>
          {index + 1}/{count}
        </span>
        {collapsed ? <IconChevronRight size={16} /> : <IconChevronDown size={16} />}
      </button>
      {!collapsed ? (
        <div key={question.key} id={panelId} className='ghostex-chat-async-questions-body'>
          <p className='whitespace-pre-wrap' id={`${panelId}-question`}>
            {question.title}
          </p>
          {question.options?.length ? (
            <SessionChatChoiceRows
              options={question.options.map((label) => ({ label }))}
              selected={state.selected}
              readOnly={disabled}
              onSelect={(selected) => controller.select(question.key, selected)}
            />
          ) : null}
          <SessionChatAnswerInput
            className='ghostex-chat-async-questions-answer'
            theme={theme}
            aria-label='Your answer'
            aria-describedby={`${panelId}-question`}
            placeholder={question.options?.length ? 'Or write your own answer…' : 'Write your answer…'}
            disabled={submitting || loading}
            value={draft.other}
            onPasteImage={onPasteImage}
            onPendingChange={(value) => controller.imagesPending(value)}
            onUpdate={(update) => controller.edit(question.key, update)}
            // CDXC:SessionChat 2026-09-12 DECISION: User: Enter sends a question answer; Shift+Enter inserts a newline.
            onKeyDown={(event) => {
              if (event.key !== 'Enter' || event.shiftKey || event.isComposing || event.keyCode === 229) return;
              event.preventDefault();
              if (!event.repeat) void submit();
            }}
          />
          {error ? (
            <p className='text-destructive' role='alert'>
              {error}
            </p>
          ) : null}
          {!canSend ? (
            <p className='text-muted-foreground' role='status'>
              Answers are unavailable while this chat is read-only or disconnected.
            </p>
          ) : null}
          <div className='ghostex-chat-async-questions-actions'>
            {count > 1 ? (
              <>
                <Button
                  aria-label='Previous question'
                  size='icon-sm'
                  variant='ghost'
                  disabled={state.previousDisabled}
                  onClick={() => {
                    controller.navigate(state.previousKey);
                  }}
                >
                  <IconChevronLeft size={16} />
                </Button>
                <Button
                  aria-label='Next question'
                  size='icon-sm'
                  variant='ghost'
                  disabled={state.nextDisabled}
                  onClick={() => {
                    controller.navigate(state.nextKey);
                  }}
                >
                  <IconChevronRight size={16} />
                </Button>
              </>
            ) : null}
            <Button className='ml-auto' size='sm' variant='ghost' disabled={disabled} onClick={() => void submit(true)}>
              Skip
            </Button>
            <Button
              size='sm'
              variant='outline'
              data-chat-answer-control=''
              disabled={disabled || !answer.trim()}
              onClick={() => void submit()}
            >
              {submitting ? 'Sending…' : 'Send answer'}
            </Button>
          </div>
        </div>
      ) : null}
    </section>
  );
}
