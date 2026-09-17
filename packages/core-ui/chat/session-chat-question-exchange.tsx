/*
CDXC:AgentScreenDetection 2026-08-22:
Answered agent questions (AskUserQuestion / request_user_input /
cursor_ask_question / Hermes' clarify / omp's ask) rendered as a first-class
card in the chat log instead of a generic tool row with raw JSON.
The tool call's input carries the questions and options; the tool result's text
carries the user's answers in the harness envelope
  The user answered: "q"="a", "q2"="a2". Read the answers carefully …
  Your questions have been answered: "q"="a". You can now continue …
The question texts are known exactly from the input, so answers are recovered
by locating each `"question"="` marker in order — the envelope does not escape
quotes, so quote-aware parsing is impossible and marker slicing is the only
reliable read. Anything that fails to parse falls back to the raw result text
inside the card, and a pair that is not recognizably an answered question at
all keeps the generic tool row (the caller decides that via
`answeredSessionChatQuestionExchange` returning null).
*/

import { IconCheck, IconChevronRight } from '@tabler/icons-react';
import { useSessionChatDisclosureState } from './session-chat-interaction-state';
import type { SessionChatQuestion } from '../../shared/session-chat';
import { cn } from '@/packages/components/utils';
import { SessionChatChoiceRows } from './session-chat-choice-rows';
import type { SessionChatToolPair } from './session-chat-tool-fold';

import { answeredSessionChatQuestionExchange, parseSessionChatQuestionsInput, isSessionChatQuestionToolName, type SessionChatQuestionExchange, type SessionChatQuestionExchangeAnswer } from '@/packages/shared/session-chat-presentation/questions';
export { answeredSessionChatQuestionExchange, parseSessionChatQuestionsInput, isSessionChatQuestionToolName, type SessionChatQuestionExchange, type SessionChatQuestionExchangeAnswer };

function MicroLabel({ text }: { text: string }) {
  return <span className='text-[11px] font-semibold tracking-widest text-muted-foreground uppercase'>{text}</span>;
}

/** A chosen option, in the selected choice-row's visual language. */
function SelectedAnswerRow({ description, label }: { description?: string | undefined; label: string }) {
  return (
    <div className='flex w-full items-start gap-3 rounded-lg border border-primary/30 bg-primary/10 px-3 py-2'>
      <IconCheck aria-hidden='true' className='ghostex-chat-glyph-semantic mt-0.5 text-primary' />
      <span className='flex min-w-0 flex-1 flex-col gap-0.5'>
        <span className='text-sm leading-snug font-medium text-foreground'>{label}</span>
        {description && description !== label ? (
          <span className='text-xs leading-snug text-muted-foreground'>{description}</span>
        ) : null}
      </span>
    </div>
  );
}

/** The user's own words: an "Other" answer or notes beyond the option labels. */
function CustomAnswerRow({ label, text }: { label: string; text: string }) {
  return (
    <div className='flex w-full items-start gap-3 rounded-lg border border-primary/30 bg-primary/10 px-3 py-2'>
      <IconCheck aria-hidden='true' className='ghostex-chat-glyph-semantic mt-0.5 text-primary' />
      <span className='flex min-w-0 flex-1 flex-col gap-0.5'>
        <span className='text-[10px] font-semibold tracking-widest text-muted-foreground uppercase'>{label}</span>
        <span className='text-sm leading-snug whitespace-pre-wrap text-foreground [overflow-wrap:anywhere]'>
          {text}
        </span>
      </span>
    </div>
  );
}

function MutedAnswerRow({ text }: { text: string }) {
  return <div className='rounded-lg bg-foreground/[0.045] px-3 py-2 text-xs text-muted-foreground'>{text}</div>;
}

function QuestionSection({
  answer,
  hasParsedAnswers,
  index,
  question,
  total,
}: {
  answer: SessionChatQuestionExchangeAnswer | null;
  /** False when the whole result fell back to one blob (no per-question data). */
  hasParsedAnswers: boolean;
  index: number;
  question: SessionChatQuestion;
  total: number;
}) {
  const [showOptions, setShowOptions] = useSessionChatDisclosureState(
    `question-options:${index}:${question.question}`,
    false
  );
  const selectedIndices = answer?.selectedIndices ?? [];
  const selectedOptions = selectedIndices
    .map((optionIndex) => question.options[optionIndex])
    .filter((option) => option !== undefined);
  const unansweredLabel = answer?.dismissed ? 'Dismissed without answering' : hasParsedAnswers ? 'Skipped' : null;
  const showUnanswered = selectedOptions.length === 0 && !answer?.otherText && unansweredLabel !== null;

  return (
    <div className={cn('min-w-0 px-4 py-3.5 sm:px-5', index > 0 && 'border-t border-border/65')}>
      <div className='flex items-center gap-3'>
        <MicroLabel text={question.header ?? 'Question'} />
        {total > 1 ? (
          <span className='flex h-5 shrink-0 items-center rounded-md bg-muted/60 px-1.5 text-[10px] font-medium text-muted-foreground tabular-nums'>
            {index + 1}/{total}
          </span>
        ) : null}
      </div>
      {question.question.length > 0 ? <p className='mt-1.5 text-sm text-foreground/90'>{question.question}</p> : null}
      {selectedOptions.length > 0 || answer?.otherText || showUnanswered ? (
        <div className='mt-3 space-y-1.5'>
          {selectedOptions.map((option, selectionIndex) => (
            <SelectedAnswerRow
              description={option.description}
              key={`${selectionIndex}:${option.label}`}
              label={option.label}
            />
          ))}
          {answer?.otherText ? (
            <CustomAnswerRow
              label={selectedOptions.length > 0 ? 'Added note' : 'Custom answer'}
              text={answer.otherText}
            />
          ) : null}
          {showUnanswered && unansweredLabel ? <MutedAnswerRow text={unansweredLabel} /> : null}
        </div>
      ) : null}
      {question.options.length > 0 ? (
        <div className='mt-2'>
          <button
            aria-expanded={showOptions}
            className='flex items-center gap-1 rounded-md px-1 py-0.5 text-xs text-muted-foreground transition-colors duration-150 hover:text-foreground'
            data-slot='session-chat-question-options-toggle'
            onClick={() => setShowOptions((value) => !value)}
            type='button'
          >
            {/* One disclosure metaphor across the surface: a right chevron
                that turns a quarter, never a down chevron that flips. */}
            <IconChevronRight
              aria-hidden='true'
              className={cn('ghostex-chat-disclosure-chevron', showOptions && 'is-open')}
            />
            {showOptions ? 'Hide options' : `Show all ${question.options.length} options`}
          </button>
          {showOptions ? (
            <div className='mt-2'>
              <SessionChatChoiceRows
                onSelect={() => {}}
                options={question.options}
                readOnly
                selected={selectedIndices}
              />
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

export function SessionChatQuestionExchangeCard({ exchange }: { exchange: SessionChatQuestionExchange }) {
  return (
    <div
      className='ghostex-chat-question-exchange min-w-0 overflow-hidden rounded-2xl border border-border/65 bg-card'
      data-slot='session-chat-question-exchange'
    >
      {exchange.questions.map((question, index) => (
        <QuestionSection
          answer={exchange.answers?.[index] ?? null}
          hasParsedAnswers={exchange.answers !== null}
          index={index}
          key={`${index}:${question.question}`}
          question={question}
          total={exchange.questions.length}
        />
      ))}
      {exchange.fallbackText ? (
        <div className='border-t border-border/65 px-4 py-3.5 sm:px-5'>
          <MicroLabel text='Answer' />
          <p className='mt-1.5 text-sm leading-snug whitespace-pre-wrap text-foreground [overflow-wrap:anywhere]'>
            {exchange.fallbackText}
          </p>
        </div>
      ) : null}
    </div>
  );
}
