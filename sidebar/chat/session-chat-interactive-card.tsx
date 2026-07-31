// Interactive prompt card (orca §8.7 lifecycle, adapted to the normalized
// SessionChatInteractivePrompt wire shape). The live prompt status lingers
// after answering (the agent emits a post-tool event carrying the same
// prompt), so the card hides by CONTENT KEY until a genuinely different
// prompt arrives; the dismissed key resets whenever the prompt clears so an
// identical follow-up shows again.

import { IconX } from "@tabler/icons-react";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type {
  GxserverAnswerSessionChatPromptParams,
  SessionChatInteractivePrompt,
  SessionChatQuestionSelection,
} from "../../shared/session-chat";
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
      <div className="ghostex-chat-card" data-kind="approval">
        <div className="ghostex-chat-card-header">
          <span className="ghostex-chat-card-title">Allow {prompt.tool}?</span>
          <button
            aria-label="Dismiss"
            className="ghostex-chat-card-close"
            onClick={dismiss}
            type="button"
          >
            <IconX aria-hidden="true" size={13} stroke={2} />
          </button>
        </div>
        {prompt.summary ? (
          <div className="ghostex-chat-card-detail">{prompt.summary}</div>
        ) : null}
        <div className="ghostex-chat-card-actions">
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
      </div>
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
    <div className="ghostex-chat-card" data-kind="question">
      <div className="ghostex-chat-card-header">
        <span className="ghostex-chat-card-title">
          {prompt.questions.length === 1 ? "Question" : "Questions"}
        </span>
        <button
          aria-label="Dismiss"
          className="ghostex-chat-card-close"
          onClick={dismiss}
          type="button"
        >
          <IconX aria-hidden="true" size={13} stroke={2} />
        </button>
      </div>
      {prompt.questions.map((question, questionIndex) => {
        const draft = drafts[questionIndex] ?? { indices: [], other: "" };
        return (
          <div className="ghostex-chat-card-question" key={questionIndex}>
            {question.header ? (
              <div className="ghostex-chat-card-question-header">{question.header}</div>
            ) : null}
            <div className="ghostex-chat-card-question-text">{question.question}</div>
            <div className="ghostex-chat-card-options">
              {question.options.map((option, optionIndex) => {
                const selected = draft.indices.includes(optionIndex);
                return (
                  <button
                    className="ghostex-chat-card-option"
                    data-selected={selected ? "true" : undefined}
                    key={optionIndex}
                    onClick={() => {
                      toggleOption(questionIndex, optionIndex);
                    }}
                    type="button"
                  >
                    <span className="ghostex-chat-card-option-badge">
                      {optionIndex + 1}
                    </span>
                    <span className="ghostex-chat-card-option-copy">
                      <span className="ghostex-chat-card-option-label">
                        {option.label}
                      </span>
                      {option.description ? (
                        <span className="ghostex-chat-card-option-description">
                          {option.description}
                        </span>
                      ) : null}
                    </span>
                  </button>
                );
              })}
            </div>
            <input
              className="ghostex-chat-card-other"
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
      <div className="ghostex-chat-card-actions">
        <Button
          disabled={submitting || !hasAnswer}
          onClick={submitQuestions}
          size="sm"
        >
          Submit
        </Button>
      </div>
    </div>
  );
}
