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
// Styled with shadcn card/button/input primitives.

import { IconCheck, IconPencil, IconTerminal2, IconX } from "@tabler/icons-react";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type {
  GxserverAnswerSessionChatPromptParams,
  SessionChatInteractivePrompt,
  SessionChatQuestionSelection,
} from "../../shared/session-chat";
import { cn } from "../../lib/utils";
import { Button } from "../../components/ui/button";

export function sessionChatCardDismissKey(
  prompt: SessionChatInteractivePrompt | null,
): string | null {
  if (!prompt) {
    return null;
  }
  if (prompt.kind === "question") {
    return `question:${prompt.questions.length}:${prompt.questions[0]?.question ?? ""}`;
  }
  const title = `Allow ${prompt.tool}?`;
  return `approval:${title}:${prompt.summary ?? ""}`;
}

const DELIVERY_FAILED_NOTICE =
  "Couldn't deliver the answer — switch to Terminal View to answer there.";
const READ_ONLY_NOTICE = "Switch to Terminal to answer";

export interface SessionChatInteractiveCardProps {
  prompt: SessionChatInteractivePrompt | null;
  canSend: boolean;
  onAnswer: (
    params: Omit<GxserverAnswerSessionChatPromptParams, "projectId" | "sessionId">,
  ) => Promise<void>;
  /** Cancel/close: dismisses the card and interrupts the agent prompt (ESC). */
  onInterrupt: () => void;
  /** The question card replaces the composer while showing. */
  onShowingQuestionChange?: (showing: boolean) => void;
  /** Host switch-back, offered by the read-only and delivery-failed notices. */
  onSwitchToTerminal?: () => void;
}

interface DraftAnswer {
  indices: number[];
  other: string;
}

function CardShell({
  children,
  kind,
  onDismiss,
  title,
}: {
  children?: React.ReactNode;
  kind: string;
  onDismiss?: () => void;
  title: string;
}) {
  return (
    <div
      className="grid gap-2.5 overflow-hidden rounded-2xl border border-border bg-card p-3.5 text-card-foreground shadow-lg"
      data-kind={kind}
    >
      <div className="flex items-center justify-between gap-2">
        <span className="text-[0.8125rem] font-semibold">{title}</span>
        {onDismiss ? (
          <Button aria-label="Dismiss" onClick={onDismiss} size="icon-xs" variant="ghost">
            <IconX aria-hidden="true" stroke={2} />
          </Button>
        ) : null}
      </div>
      {children}
    </div>
  );
}

function CardNotice({
  onSwitchToTerminal,
  text,
  tone,
}: {
  onSwitchToTerminal?: () => void;
  text: string;
  tone: "destructive" | "muted";
}) {
  return (
    <div
      className={cn(
        "flex items-center gap-2 text-[11px]",
        tone === "destructive" ? "text-destructive/80" : "text-muted-foreground",
      )}
      role="status"
    >
      <span className="min-w-0 flex-1 leading-snug">{text}</span>
      {onSwitchToTerminal ? (
        <Button onClick={onSwitchToTerminal} size="xs" variant="outline">
          <IconTerminal2 aria-hidden="true" stroke={2} />
          Terminal
        </Button>
      ) : null}
    </div>
  );
}

/** Numbered badge; fills primary once its row is selected (§2.6). */
function OptionBadge({
  children,
  selected,
}: {
  children: React.ReactNode;
  selected: boolean;
}) {
  return (
    <span
      className={cn(
        "mt-px inline-flex h-4.5 min-w-4.5 shrink-0 items-center justify-center rounded font-mono text-[11px] font-semibold",
        selected
          ? "bg-primary text-primary-foreground"
          : "bg-muted text-muted-foreground",
      )}
    >
      {children}
    </span>
  );
}

export function SessionChatInteractiveCard({
  canSend,
  onAnswer,
  onInterrupt,
  onShowingQuestionChange,
  onSwitchToTerminal,
  prompt,
}: SessionChatInteractiveCardProps) {
  const [dismissedKey, setDismissedKey] = useState<string | null>(null);
  const [drafts, setDrafts] = useState<DraftAnswer[]>([]);
  const [activeQuestion, setActiveQuestion] = useState(0);
  const [submitting, setSubmitting] = useState(false);
  const [deliveryFailed, setDeliveryFailed] = useState(false);
  const submittingRef = useRef(false);

  const cardKey = sessionChatCardDismissKey(prompt);
  const showing = prompt !== null && cardKey !== dismissedKey;
  const showingQuestion = showing && prompt?.kind === "question";
  const readOnly = !canSend;

  // Reset the dismissed key whenever the prompt clears so an identical
  // follow-up prompt shows again.
  useEffect(() => {
    if (prompt === null) {
      setDismissedKey(null);
    }
  }, [prompt]);

  // Fresh drafts per prompt content; cancel a stale in-flight submit gate
  // during commit so an old answer can't act on a new prompt.
  useLayoutEffect(() => {
    submittingRef.current = false;
    setSubmitting(false);
    setDeliveryFailed(false);
    setActiveQuestion(0);
    if (prompt?.kind === "question") {
      setDrafts(prompt.questions.map(() => ({ indices: [], other: "" })));
    } else {
      setDrafts([]);
    }
  }, [cardKey, canSend, prompt]);

  useEffect(() => {
    onShowingQuestionChange?.(showingQuestion === true);
  }, [onShowingQuestionChange, showingQuestion]);

  if (!showing || !prompt) {
    return null;
  }

  const submitAnswer = (
    params: Omit<GxserverAnswerSessionChatPromptParams, "projectId" | "sessionId">,
  ): void => {
    if (submittingRef.current || readOnly) {
      return;
    }
    submittingRef.current = true;
    setSubmitting(true);
    setDeliveryFailed(false);
    const keyAtSubmit = cardKey;
    void onAnswer(params)
      .then(() => {
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
  };

  const dismiss = (): void => {
    setDismissedKey(cardKey);
    onInterrupt();
  };

  const notice = deliveryFailed ? (
    <CardNotice
      text={DELIVERY_FAILED_NOTICE}
      tone="destructive"
      {...(onSwitchToTerminal ? { onSwitchToTerminal } : {})}
    />
  ) : readOnly ? (
    <CardNotice
      text={READ_ONLY_NOTICE}
      tone="muted"
      {...(onSwitchToTerminal ? { onSwitchToTerminal } : {})}
    />
  ) : null;

  if (prompt.kind === "approval") {
    return (
      <CardShell
        kind="approval"
        title={`Allow ${prompt.tool}?`}
        {...(readOnly ? {} : { onDismiss: dismiss })}
      >
        {prompt.summary ? (
          <div className="font-mono text-[11px] text-muted-foreground [overflow-wrap:anywhere]">
            {prompt.summary}
          </div>
        ) : null}
        {notice}
        <div className="flex justify-end gap-2">
          <Button
            disabled={submitting || readOnly}
            onClick={() => {
              submitAnswer({ approvalSend: "1", kind: "approval" });
            }}
            size="sm"
          >
            Allow
          </Button>
          <Button
            disabled={submitting || readOnly}
            onClick={() => {
              submitAnswer({ approvalSend: "", kind: "approval" });
            }}
            size="sm"
            variant="outline"
          >
            Deny
          </Button>
        </div>
      </CardShell>
    );
  }

  const questions = prompt.questions;
  const questionIndex = Math.min(activeQuestion, Math.max(questions.length - 1, 0));
  const question = questions[questionIndex];
  const draft = drafts[questionIndex] ?? { indices: [], other: "" };
  const isLastQuestion = questionIndex >= questions.length - 1;

  const questionAnswered = (index: number): boolean => {
    const entry = drafts[index];
    return (
      entry !== undefined &&
      (entry.indices.length > 0 || entry.other.trim().length > 0)
    );
  };

  const toggleOption = (optionIndex: number): void => {
    if (!question || readOnly) {
      return;
    }
    setDrafts((current) =>
      current.map((entry, index) => {
        if (index !== questionIndex) {
          return entry;
        }
        if (question.multiSelect) {
          const selected = entry.indices.includes(optionIndex);
          return {
            ...entry,
            indices: selected
              ? entry.indices.filter((value) => value !== optionIndex)
              : [...entry.indices, optionIndex].sort((a, b) => a - b),
          };
        }
        return { ...entry, indices: [optionIndex] };
      }),
    );
  };

  const hasAnswer = drafts.some(
    (entry) => entry.indices.length > 0 || entry.other.trim().length > 0,
  );

  const submitQuestions = (): void => {
    const selections: SessionChatQuestionSelection[] = drafts.map((entry) => ({
      indices: entry.indices,
      ...(entry.other.trim() ? { other: entry.other.trim() } : {}),
    }));
    submitAnswer({ kind: "question", selections });
  };

  // Trailing button cycles Skip → Next → Send answer → Sending… (§2.6);
  // selecting an option never auto-submits.
  const trailingLabel = submitting
    ? "Sending…"
    : isLastQuestion
      ? "Send answer"
      : questionAnswered(questionIndex)
        ? "Next"
        : "Skip";

  return (
    <CardShell
      kind="question"
      title={questions.length === 1 ? "Question" : "Questions"}
      {...(readOnly ? {} : { onDismiss: dismiss })}
    >
      {questions.length > 1 ? (
        <div className="mb-0.5 flex gap-1 overflow-x-auto" role="tablist">
          {questions.map((entry, index) => (
            <button
              aria-selected={index === questionIndex}
              className={cn(
                "flex shrink-0 items-center gap-1 rounded-lg px-2 py-1 text-xs",
                index === questionIndex
                  ? "bg-accent text-accent-foreground"
                  : "text-muted-foreground hover:bg-muted",
              )}
              key={index}
              onClick={() => setActiveQuestion(index)}
              role="tab"
              type="button"
            >
              <span className="max-w-32 truncate">
                {entry.header ?? `Question ${index + 1}`}
              </span>
              {questionAnswered(index) ? (
                <IconCheck aria-hidden="true" className="size-3" stroke={2.4} />
              ) : null}
            </button>
          ))}
        </div>
      ) : null}
      {question ? (
        <div className="grid gap-2">
          {question.header && questions.length === 1 ? (
            <div className="text-[0.6875rem] font-semibold tracking-wider text-muted-foreground uppercase">
              {question.header}
            </div>
          ) : null}
          <div className="text-sm leading-snug">{question.question}</div>
          <div className="max-h-[50vh] divide-y divide-border/60 overflow-y-auto rounded-xl border border-border">
            {question.options.map((option, optionIndex) => {
              const selected = draft.indices.includes(optionIndex);
              return (
                <button
                  className={cn(
                    "flex w-full items-start gap-2 px-2.5 py-1.5 text-left transition-colors",
                    selected ? "bg-accent" : "hover:bg-accent",
                    readOnly && "cursor-default",
                  )}
                  data-selected={selected ? "true" : undefined}
                  disabled={readOnly}
                  key={optionIndex}
                  onClick={() => {
                    toggleOption(optionIndex);
                  }}
                  type="button"
                >
                  <OptionBadge selected={selected}>
                    {selected ? (
                      <IconCheck aria-hidden="true" className="size-3" stroke={2.6} />
                    ) : (
                      optionIndex + 1
                    )}
                  </OptionBadge>
                  <span className="grid min-w-0 gap-0.5">
                    <span className="text-[0.8125rem] leading-snug">{option.label}</span>
                    {option.description ? (
                      <span className="text-xs leading-snug text-muted-foreground">
                        {option.description}
                      </span>
                    ) : null}
                  </span>
                </button>
              );
            })}
            <div className="flex items-center gap-2 px-2.5 py-1.5">
              <OptionBadge selected={draft.other.trim().length > 0}>
                <IconPencil aria-hidden="true" className="size-3" stroke={2} />
              </OptionBadge>
              <input
                className="min-w-0 flex-1 bg-transparent text-[0.8125rem] leading-snug outline-none placeholder:text-muted-foreground disabled:cursor-default"
                disabled={readOnly}
                onChange={(event) => {
                  const value = event.target.value;
                  setDrafts((current) =>
                    current.map((entry, index) =>
                      index === questionIndex ? { ...entry, other: value } : entry,
                    ),
                  );
                }}
                placeholder="Type something…"
                type="text"
                value={draft.other}
              />
            </div>
          </div>
        </div>
      ) : null}
      {notice}
      <div className="flex items-center justify-end gap-2">
        <Button
          className="w-24"
          disabled={readOnly || submitting || (isLastQuestion && !hasAnswer)}
          onClick={() => {
            if (isLastQuestion) {
              submitQuestions();
            } else {
              setActiveQuestion(questionIndex + 1);
            }
          }}
          size="sm"
        >
          {trailingLabel}
        </Button>
      </div>
    </CardShell>
  );
}
