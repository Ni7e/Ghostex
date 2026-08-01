// Interactive prompt card (orca §8.7 lifecycle, adapted to the normalized
// SessionChatInteractivePrompt wire shape). The live prompt status lingers
// after answering (the agent emits a post-tool event carrying the same
// prompt), so the card hides by CONTENT KEY until a genuinely different
// prompt arrives; the dismissed key resets whenever the prompt clears so an
// identical follow-up shows again. Styled with shadcn card/button/input
// primitives.

import { IconX } from "@tabler/icons-react";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type {
  GxserverAnswerSessionChatPromptParams,
  SessionChatInteractivePrompt,
  SessionChatQuestionSelection,
} from "../../shared/session-chat";
import { cn } from "../../lib/utils";
import { Button } from "../../components/ui/button";
import { Input } from "../../components/ui/input";

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
  onDismiss: () => void;
  title: string;
}) {
  return (
    <div
      className="grid gap-2.5 rounded-2xl border border-border bg-card p-3.5 text-card-foreground shadow-lg"
      data-kind={kind}
    >
      <div className="flex items-center justify-between gap-2">
        <span className="text-[0.8125rem] font-semibold">{title}</span>
        <Button aria-label="Dismiss" onClick={onDismiss} size="icon-xs" variant="ghost">
          <IconX aria-hidden="true" stroke={2} />
        </Button>
      </div>
      {children}
    </div>
  );
}

export function SessionChatInteractiveCard({
  canSend,
  onAnswer,
  onInterrupt,
  onShowingQuestionChange,
  prompt,
}: SessionChatInteractiveCardProps) {
  const [dismissedKey, setDismissedKey] = useState<string | null>(null);
  const [drafts, setDrafts] = useState<DraftAnswer[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const submittingRef = useRef(false);

  const cardKey = sessionChatCardDismissKey(prompt);
  const showing = prompt !== null && canSend && cardKey !== dismissedKey;
  const showingQuestion = showing && prompt?.kind === "question";

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
    if (submittingRef.current) {
      return;
    }
    submittingRef.current = true;
    setSubmitting(true);
    const keyAtSubmit = cardKey;
    void onAnswer(params)
      .then(() => {
        setDismissedKey(keyAtSubmit);
      })
      .catch(() => {
        // Delivery failed: keep the card visible so the user can retry.
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

  if (prompt.kind === "approval") {
    return (
      <CardShell kind="approval" onDismiss={dismiss} title={`Allow ${prompt.tool}?`}>
        {prompt.summary ? (
          <div className="font-mono text-[11px] text-muted-foreground [overflow-wrap:anywhere]">
            {prompt.summary}
          </div>
        ) : null}
        <div className="flex justify-end gap-2">
          <Button
            disabled={submitting}
            onClick={() => {
              submitAnswer({ approvalSend: "1", kind: "approval" });
            }}
            size="sm"
          >
            Allow
          </Button>
          <Button
            disabled={submitting}
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

  const toggleOption = (questionIndex: number, optionIndex: number): void => {
    const question = prompt.questions[questionIndex];
    if (!question) {
      return;
    }
    setDrafts((current) =>
      current.map((draft, index) => {
        if (index !== questionIndex) {
          return draft;
        }
        if (question.multiSelect) {
          const selected = draft.indices.includes(optionIndex);
          return {
            ...draft,
            indices: selected
              ? draft.indices.filter((value) => value !== optionIndex)
              : [...draft.indices, optionIndex].sort((a, b) => a - b),
          };
        }
        return { ...draft, indices: [optionIndex] };
      }),
    );
  };

  const hasAnswer = drafts.some(
    (draft) => draft.indices.length > 0 || draft.other.trim().length > 0,
  );

  const submitQuestions = (): void => {
    const selections: SessionChatQuestionSelection[] = drafts.map((draft) => ({
      indices: draft.indices,
      ...(draft.other.trim() ? { other: draft.other.trim() } : {}),
    }));
    submitAnswer({ kind: "question", selections });
  };

  return (
    <CardShell
      kind="question"
      onDismiss={dismiss}
      title={prompt.questions.length === 1 ? "Question" : "Questions"}
    >
      {prompt.questions.map((question, questionIndex) => {
        const draft = drafts[questionIndex] ?? { indices: [], other: "" };
        return (
          <div className="grid gap-2" key={questionIndex}>
            {question.header ? (
              <div className="text-[0.6875rem] font-semibold tracking-wider text-muted-foreground uppercase">
                {question.header}
              </div>
            ) : null}
            <div className="text-sm leading-snug">{question.question}</div>
            <div className="grid gap-1">
              {question.options.map((option, optionIndex) => {
                const selected = draft.indices.includes(optionIndex);
                return (
                  <button
                    className={cn(
                      "flex w-full items-start gap-2 rounded-xl border border-border px-2.5 py-1.5 text-left transition-colors hover:bg-muted",
                      selected && "border-ring bg-primary/10 hover:bg-primary/15",
                    )}
                    data-selected={selected ? "true" : undefined}
                    key={optionIndex}
                    onClick={() => {
                      toggleOption(questionIndex, optionIndex);
                    }}
                    type="button"
                  >
                    <span className="mt-px inline-flex h-4.5 min-w-4.5 shrink-0 items-center justify-center rounded bg-muted font-mono text-[11px] font-semibold text-muted-foreground">
                      {optionIndex + 1}
                    </span>
                    <span className="grid min-w-0 gap-0.5">
                      <span className="text-[0.8125rem] leading-snug">
                        {option.label}
                      </span>
                      {option.description ? (
                        <span className="text-xs leading-snug text-muted-foreground">
                          {option.description}
                        </span>
                      ) : null}
                    </span>
                  </button>
                );
              })}
            </div>
            <Input
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
        );
      })}
      <div className="flex justify-end gap-2">
        <Button disabled={submitting || !hasAnswer} onClick={submitQuestions} size="sm">
          Submit
        </Button>
      </div>
    </CardShell>
  );
}
