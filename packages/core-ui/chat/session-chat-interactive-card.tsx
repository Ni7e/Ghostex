// Interactive prompt card (upstream chat spec §2.6 / §8.7 lifecycle, adapted
// to the normalized SessionChatInteractivePrompt wire shape). The live prompt
// status lingers after answering (the agent emits a post-tool event carrying
// the same prompt), so the card hides by CONTENT KEY until a genuinely
// different prompt arrives; the dismissed key resets whenever the prompt
// clears so an identical follow-up shows again.
//
// Two states beyond "answerable":
//   - delivery failed → the card stays with an inline notice pointing at the
//     terminal, because the keystrokes never reached the TUI;
//   - input is held elsewhere (canSend false) → the card renders READ-ONLY
//     instead of vanishing, so the question is still visible with a hint to
//     answer it in the terminal.
//
// Layout: the card takes the composer's place while a prompt is live. Since
// 2026-09-16 it is the shared status card (session-chat-status-card.tsx): a
// shield or question icon, the title, the tool name or question counter
// right-aligned on the first body row, options as full-width rows optionally
// carrying their 1-9 shortcut key, and the footer band holding the free-text
// answer, Cancel and the send button.
// CDXC:SessionChat 2026-09-16 DECISION: User: the question's X was the interrupt, an action rather than a dismiss, and sat beside the collapse chevron; it is a Cancel button in the footer instead. The approval keeps its circled X since it has no chevron.

import { IconArrowLeft, IconHelpCircle, IconShieldCheck, IconTerminal2 } from '@tabler/icons-react';
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import type {
  GxserverAnswerSessionChatPromptParams,
  SessionChatInteractivePrompt,
  SessionChatQuestionSelection,
  SessionChatTheme,
} from '../../shared/session-chat';
import { cn } from '@/packages/components/utils';
import { Button } from '../../components/ui/button';
import { SessionChatChoiceRows } from './session-chat-choice-rows';
import {
  SessionChatStatusCard,
  SessionChatStatusCardActions,
  SessionChatStatusCardLead,
  SessionChatStatusCardRow,
} from './session-chat-status-card';
import { useSessionChatQuestionDrafts } from './session-chat-question-drafts';
import { SessionChatAnswerInput } from './session-chat-answer-input';
import type { SaveSessionChatImage } from './session-chat-image-attachments';

import { sessionChatCardDismissKey, selectQuestionOption } from '@/packages/shared/session-chat-presentation/interactive';
export { sessionChatCardDismissKey };

const DELIVERY_FAILED_NOTICE = "Couldn't deliver the answer. Switch to Terminal View to answer there.";
const READ_ONLY_NOTICE = 'Switch to Terminal to answer';

export interface SessionChatInteractiveCardProps {
  sessionKey?: string;
  onPasteImage?: SaveSessionChatImage;
  theme?: SessionChatTheme;
  prompt: SessionChatInteractivePrompt | null;
  canSend: boolean;
  onAnswer: (params: Omit<GxserverAnswerSessionChatPromptParams, 'projectId' | 'sessionId'>) => Promise<void>;
  /** Cancel/close: dismisses the card and interrupts the agent prompt (ESC). */
  onInterrupt: () => void;
  /** The question card replaces the composer while showing. */
  onShowingQuestionChange?: (showing: boolean) => void;
  /**
   * Reports whether the card is on screen at all — question, approval or plan.
   * The parent needs that to keep the new-session welcome, a centered overlay
   * over the same column, from painting through the card.
   */
  onShowingChange?: (showing: boolean) => void;
  /** Host switch-back, offered by the read-only and delivery-failed notices. */
  onSwitchToTerminal?: () => void;
  /** Whether numbered keyboard shortcut badges are rendered beside choices. */
  showShortcutLabels?: boolean;
}

interface DraftAnswer {
  indices: number[];
  other: string;
}

function CardNotice({
  onSwitchToTerminal,
  text,
  tone,
}: {
  onSwitchToTerminal?: () => void;
  text: string;
  tone: 'destructive' | 'muted';
}) {
  return (
    <div
      className={cn(
        'ghostex-chat-card-content flex items-center gap-2 text-[11px]',
        tone === 'destructive' ? 'text-destructive/80' : 'text-muted-foreground'
      )}
      role='status'
    >
      <span className='min-w-0 flex-1 leading-snug'>{text}</span>
      {onSwitchToTerminal ? (
        <Button onClick={onSwitchToTerminal} size='sm' variant='outline'>
          <IconTerminal2 aria-hidden='true' stroke={2} />
          Terminal
        </Button>
      ) : null}
    </div>
  );
}

export function SessionChatInteractiveCard({
  canSend,
  onAnswer,
  onInterrupt,
  onShowingChange,
  onShowingQuestionChange,
  onSwitchToTerminal,
  prompt,
  showShortcutLabels = true,
  sessionKey,
  onPasteImage,
  theme,
}: SessionChatInteractiveCardProps) {
  const [dismissedKey, setDismissedKey] = useState<string | null>(null);
  const [activeQuestion, setActiveQuestion] = useState(0);
  const [collapsed, setCollapsed] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [savingImages, setSavingImages] = useState(false);
  const [deliveryFailed, setDeliveryFailed] = useState(false);
  const submittingRef = useRef(false);

  const cardKey = sessionChatCardDismissKey(prompt);
  const promptContentKey = prompt === null ? null : JSON.stringify(prompt);
  const {
    drafts: savedDrafts,
    saveDrafts,
    updateDraft,
    clearDrafts,
    saveError,
  } = useSessionChatQuestionDrafts(sessionKey, `interactive:${promptContentKey}`);
  const showing = prompt !== null && cardKey !== dismissedKey;
  const showingQuestion = showing && prompt?.kind === 'question';
  const readOnly = !canSend;

  const questions = prompt?.kind === 'question' ? prompt.questions : [];
  const drafts = questions.map((_, index) => savedDrafts[index] ?? { indices: [], other: '' });
  const setDrafts = useCallback(
    (answers: DraftAnswer[]): void => {
      saveDrafts(Object.fromEntries(answers.map((answer, index) => [index, answer])));
    },
    [saveDrafts]
  );
  const questionIndex = Math.min(activeQuestion, Math.max(questions.length - 1, 0));
  const question = questions[questionIndex];

  // Reset the dismissed key whenever the prompt clears so an identical
  // follow-up prompt shows again.
  useEffect(() => {
    if (prompt === null) {
      setDismissedKey(null);
    }
  }, [prompt]);

  // Restore drafts per prompt content; cancel a stale in-flight submit gate
  // during commit so an old answer can't act on a new prompt.
  useLayoutEffect(() => {
    submittingRef.current = false;
    setSubmitting(false);
    setDeliveryFailed(false);
    setActiveQuestion(0);
    setCollapsed(false);
  }, [promptContentKey, sessionKey]);

  useEffect(() => {
    onShowingQuestionChange?.(showingQuestion === true);
  }, [onShowingQuestionChange, showingQuestion]);

  useEffect(() => {
    onShowingChange?.(showing);
    return () => onShowingChange?.(false);
  }, [onShowingChange, showing]);

  const submitAnswer = useCallback(
    (
      params: Omit<GxserverAnswerSessionChatPromptParams, 'projectId' | 'sessionId'>,
      submittedDrafts = savedDrafts
    ): void => {
      if (submittingRef.current || readOnly || savingImages) {
        return;
      }
      submittingRef.current = true;
      setSubmitting(true);
      setDeliveryFailed(false);
      const keyAtSubmit = cardKey;
      void onAnswer(params)
        .then(() => {
          clearDrafts(submittedDrafts);
          setDismissedKey(keyAtSubmit);
        })
        .catch(() => {
          // The keystrokes never reached the TUI: keep the card and say so.
          setDeliveryFailed(true);
        })
        .finally(() => {
          submittingRef.current = false;
          setSubmitting(false);
        });
    },
    [cardKey, clearDrafts, onAnswer, readOnly, savedDrafts, savingImages]
  );

  const submitQuestions = useCallback(
    (answerDrafts: DraftAnswer[]): void => {
      const selections: SessionChatQuestionSelection[] = answerDrafts.map((entry) => ({
        indices: entry.indices,
        ...(entry.other.trim() ? { other: entry.other.trim() } : {}),
      }));
      submitAnswer(
        { kind: 'question', selections },
        Object.fromEntries(answerDrafts.map((answer, index) => [index, answer]))
      );
    },
    [submitAnswer]
  );

  const selectOption = useCallback(
    (optionIndex: number): void => {
      if (!question || readOnly || submitting || savingImages) {
        return;
      }
      const nextDrafts = selectQuestionOption(drafts, questionIndex, question.multiSelect, optionIndex);
      setDrafts(nextDrafts);

      if (question.multiSelect) {
        return;
      }
      if (questionIndex >= questions.length - 1) {
        submitQuestions(nextDrafts);
      } else {
        setActiveQuestion(questionIndex + 1);
      }
    },
    [drafts, question, questionIndex, questions.length, readOnly, submitQuestions, submitting, savingImages, setDrafts]
  );

  // Number keys 1-9 pick the matching option while focus sits outside an
  // editable field. A collapsed panel opts out: the numbers it refers to are
  // not on screen.
  useEffect(() => {
    if (!question || readOnly || submitting || collapsed || !showingQuestion) {
      return;
    }
    const handler = (event: KeyboardEvent): void => {
      if (event.metaKey || event.ctrlKey || event.altKey) {
        return;
      }
      const target = event.target;
      if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement) {
        return;
      }
      if (target instanceof HTMLElement && target.closest('[contenteditable]:not([contenteditable="false"])')) {
        return;
      }
      const digit = Number.parseInt(event.key, 10);
      if (Number.isNaN(digit) || digit < 1 || digit > 9) {
        return;
      }
      const optionIndex = digit - 1;
      if (optionIndex >= question.options.length) {
        return;
      }
      event.preventDefault();
      selectOption(optionIndex);
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [collapsed, question, readOnly, selectOption, showingQuestion, submitting]);

  if (!showing || !prompt) {
    return null;
  }

  const dismiss = (): void => {
    clearDrafts(savedDrafts);
    setDismissedKey(cardKey);
    onInterrupt();
  };

  const notice = saveError ? (
    <CardNotice text={saveError} tone='destructive' />
  ) : deliveryFailed ? (
    <CardNotice
      text={DELIVERY_FAILED_NOTICE}
      tone='destructive'
      {...(onSwitchToTerminal ? { onSwitchToTerminal } : {})}
    />
  ) : readOnly ? (
    <CardNotice text={READ_ONLY_NOTICE} tone='muted' {...(onSwitchToTerminal ? { onSwitchToTerminal } : {})} />
  ) : null;

  // The notice (save error, failed delivery, read-only) is a full-width line
  // in the footer above the controls.
  const footerNotice = notice ? <div className='basis-full'>{notice}</div> : null;

  if (prompt.kind === 'approval') {
    return (
      <SessionChatStatusCard
        className='ghostex-chat-question-card'
        data-kind='approval'
        footer={
          <>
            {footerNotice}
            <SessionChatStatusCardActions>
              <Button
                data-chat-answer-control=''
                disabled={submitting || readOnly}
                onClick={() => {
                  submitAnswer({ approvalSend: '', kind: 'approval' });
                }}
                size='sm'
                variant='outline'
              >
                Deny
              </Button>
              <Button
                data-chat-answer-control=''
                disabled={submitting || readOnly}
                onClick={() => {
                  submitAnswer({ approvalSend: '1', kind: 'approval' });
                }}
                size='sm'
                variant='outline'
              >
                Allow
              </Button>
            </SessionChatStatusCardActions>
          </>
        }
        lead={<SessionChatStatusCardLead icon={IconShieldCheck} />}
        title='Approval request'
        {...(readOnly ? {} : { onClose: dismiss })}
      >
        <SessionChatStatusCardRow annotation={prompt.tool}>
          <p className='text-foreground/90'>Allow this command?</p>
        </SessionChatStatusCardRow>
        {prompt.summary ? (
          <div className='min-w-0 rounded-lg border border-border/65 bg-background/70 p-3'>
            <pre className='max-h-40 min-w-0 overflow-auto font-mono text-xs leading-relaxed whitespace-pre-wrap text-foreground [overflow-wrap:anywhere]'>
              {prompt.summary}
            </pre>
          </div>
        ) : null}
      </SessionChatStatusCard>
    );
  }

  const draft = drafts[questionIndex] ?? { indices: [], other: '' };
  const isLastQuestion = questionIndex >= questions.length - 1;
  const customAnswerActive = draft.other.trim().length > 0;

  const questionAnswered = (index: number): boolean => {
    const entry = drafts[index];
    return entry !== undefined && (entry.indices.length > 0 || entry.other.trim().length > 0);
  };

  const hasAnswer = drafts.some((entry) => entry.indices.length > 0 || entry.other.trim().length > 0);

  const advance = (): void => {
    if (readOnly || submitting || savingImages) {
      return;
    }
    if (isLastQuestion) {
      if (hasAnswer) {
        submitQuestions(drafts);
      }
      return;
    }
    setActiveQuestion(questionIndex + 1);
  };

  // Trailing button cycles Skip → Next → Send answer → Sending… (§2.6).
  // Single-select options advance immediately, including submitting the final
  // question; multi-select questions keep the explicit trailing action.
  const trailingLabel = submitting
    ? 'Sending…'
    : isLastQuestion
      ? 'Send answer'
      : questionAnswered(questionIndex)
        ? 'Next'
        : 'Skip';
  const counter = questions.length > 1 ? `question ${questionIndex + 1} of ${questions.length}` : undefined;
  const canDismiss = !(readOnly || savingImages);

  return (
    <SessionChatStatusCard
      className='ghostex-chat-question-card'
      data-kind='question'
      footer={
        <>
          {footerNotice}
          {questionIndex > 0 ? (
            <Button
              aria-label='Previous question'
              disabled={submitting || savingImages}
              onClick={() => setActiveQuestion(questionIndex - 1)}
              size='icon-sm'
              variant='ghost'
            >
              <IconArrowLeft aria-hidden='true' stroke={2} />
            </Button>
          ) : null}
          {question?.allowCustom === false ? (
            // The asking tool takes no free-text answer (Pi's cursor_ask_question
            // with allowCustom: false), so only the options are offered.
            <div aria-hidden='true' className='min-w-0 flex-1' />
          ) : (
            <SessionChatAnswerInput
              key={`${promptContentKey}:${questionIndex}`}
              className='w-full min-w-0 flex-1 resize-none bg-transparent text-sm leading-6 text-foreground outline-none placeholder:text-muted-foreground disabled:cursor-default'
              disabled={readOnly || submitting}
              onPasteImage={onPasteImage}
              onPendingChange={setSavingImages}
              onUpdate={(update) =>
                updateDraft(String(questionIndex), (current) => ({ ...current, other: update(current.other) }))
              }
              onKeyDown={(event) => {
                if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) {
                  event.preventDefault();
                  if (!event.repeat) advance();
                }
              }}
              placeholder='Write a custom answer…'
              theme={theme}
              value={draft.other}
            />
          )}
          {canDismiss ? (
            <Button data-chat-answer-control='' onClick={dismiss} size='sm' variant='ghost'>
              Cancel
            </Button>
          ) : null}
          <Button
            className='min-w-24'
            data-chat-answer-control=''
            disabled={readOnly || submitting || savingImages || (isLastQuestion && !hasAnswer)}
            onClick={advance}
            size='sm'
            variant='outline'
          >
            {trailingLabel}
          </Button>
        </>
      }
      lead={<SessionChatStatusCardLead icon={IconHelpCircle} />}
      // A collapsed card still says what is being asked.
      meta={collapsed && question ? question.question : undefined}
      onOpenChange={(open) => setCollapsed(!open)}
      open={!collapsed}
      title={question?.header ?? (questions.length === 1 ? 'Question' : 'Questions')}
      toggleTitle={{ open: 'Hide the question and its options', closed: 'Show the question and its options' }}
    >
      {question ? (
        <>
          <SessionChatStatusCardRow annotation={counter}>
            <p className='text-foreground/90'>{question.question}</p>
          </SessionChatStatusCardRow>
          {question.multiSelect ? <p className='text-xs text-muted-foreground'>Select one or more options.</p> : null}
          <SessionChatChoiceRows
            onSelect={selectOption}
            options={question.options}
            readOnly={readOnly || submitting || savingImages}
            selected={customAnswerActive ? [] : draft.indices}
            showShortcuts={showShortcutLabels}
          />
        </>
      ) : null}
    </SessionChatStatusCard>
  );
}
