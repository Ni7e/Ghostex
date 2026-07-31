// SessionChatView — root layout (orca §11.1 port): message list over an
// interactive-card slot over the composer. The question card replaces the
// composer while showing. Hosts inject a SessionChatTransport; everything
// else is derived by useSessionChat.

import { useCallback, useRef, useState } from "react";
import type { KeyboardEvent } from "react";
import {
  SessionChatComposer,
  type SessionChatComposerHandle,
} from "./session-chat-composer";
import { sessionChatEmptyStateCopy } from "./session-chat-empty-state";
import { SessionChatInteractiveCard } from "./session-chat-interactive-card";
import { SessionChatMessageList } from "./session-chat-message-list";
import type { SessionChatTransport } from "./session-chat-transport";
import { useSessionChat } from "./use-session-chat";

const INTERACTIVE_TARGET_SELECTOR = [
  "a[href]",
  "button",
  "input",
  "select",
  "textarea",
  '[contenteditable]:not([contenteditable="false"])',
  '[role="button"]',
  '[role="checkbox"]',
  '[role="combobox"]',
  '[role="menuitem"]',
  '[role="option"]',
  '[role="radio"]',
  '[role="slider"]',
  '[role="switch"]',
  '[role="textbox"]',
  '[data-session-chat-typing-redirect-ignore="true"]',
].join(", ");

export interface SessionChatViewProps {
  /** Host-injected transport scoped to one (projectId, sessionId). */
  transport: SessionChatTransport;
  /** Display label for the agent in the empty state ("claude", "codex", …). */
  agentLabel?: string | null;
  /** Live assistant preview text (hook status) for the streaming bubble. */
  previewText?: string | null;
  /** Optional external live-work signal merged with the server status. */
  working?: boolean;
  /** False when input is held elsewhere; disables composer and cards. */
  canSend?: boolean;
  /** Verified command catalog for local "Ran /x" markers. */
  commandCatalog?: readonly string[];
  className?: string;
}

function EmptyState({
  detail,
  spinning,
  title,
}: {
  detail: string;
  spinning: boolean;
  title: string;
}) {
  return (
    <div className="ghostex-chat-empty-state">
      {spinning ? <span className="ghostex-chat-empty-spinner" /> : null}
      <div className="ghostex-chat-empty-title">{title}</div>
      <div className="ghostex-chat-empty-detail">{detail}</div>
    </div>
  );
}

export function SessionChatView({
  agentLabel,
  canSend = true,
  className,
  commandCatalog,
  previewText,
  transport,
  working,
}: SessionChatViewProps) {
  const chat = useSessionChat({
    commandCatalog,
    previewText,
    transport,
    working,
  });
  const composerRef = useRef<SessionChatComposerHandle | null>(null);
  const [questionActive, setQuestionActive] = useState(false);

  const interrupt = useCallback((): void => {
    void chat.interrupt();
  }, [chat]);

  // Typing anywhere in the pane lands in the composer (§11.1): a single
  // printable character without Ctrl/Meta is redirected; unmodified
  // Backspace/Delete focuses the composer without inserting anything.
  const handleKeyDownCapture = useCallback(
    (event: KeyboardEvent<HTMLDivElement>): void => {
      if (event.defaultPrevented || questionActive) {
        return;
      }
      const target = event.target as HTMLElement | null;
      if (target?.closest?.(INTERACTIVE_TARGET_SELECTOR)) {
        return;
      }
      if (
        (event.key === "Backspace" || event.key === "Delete") &&
        !event.metaKey &&
        !event.ctrlKey &&
        !event.altKey
      ) {
        composerRef.current?.focus();
        return;
      }
      if (
        event.key.length === 1 &&
        !event.metaKey &&
        !event.ctrlKey &&
        !event.nativeEvent.isComposing
      ) {
        if (composerRef.current?.insertTypedText(event.key)) {
          event.preventDefault();
          event.stopPropagation();
        }
      }
    },
    [questionActive],
  );

  const emptyKind =
    chat.view.kind === "ready"
      ? null
      : chat.view.kind === "error"
        ? ("error" as const)
        : chat.view.kind;

  return (
    <div
      className={`ghostex-chat-root${className ? ` ${className}` : ""}`}
      onKeyDownCapture={handleKeyDownCapture}
      tabIndex={-1}
    >
      <div className="ghostex-chat-body">
        {chat.view.kind === "ready" ? (
          <SessionChatMessageList
            hasMore={chat.hasMore}
            isWorking={chat.view.isWorking}
            loadingEarlier={chat.loadingEarlier}
            messages={chat.messages}
            onLoadEarlier={chat.loadEarlier}
          />
        ) : emptyKind ? (
          chat.view.kind === "error" ? (
            <EmptyState
              detail={sessionChatEmptyStateCopy("error").detail}
              spinning={false}
              title={sessionChatEmptyStateCopy("error").title}
            />
          ) : (
            <EmptyState
              detail={sessionChatEmptyStateCopy(emptyKind, agentLabel).detail}
              spinning={emptyKind === "loading" || emptyKind === "starting"}
              title={sessionChatEmptyStateCopy(emptyKind, agentLabel).title}
            />
          )
        ) : null}
      </div>
      <div className="ghostex-chat-bottom">
        <SessionChatInteractiveCard
          canSend={canSend}
          onAnswer={chat.answerPrompt}
          onInterrupt={interrupt}
          onShowingQuestionChange={setQuestionActive}
          prompt={chat.prompt}
        />
        {questionActive ? null : (
          <SessionChatComposer
            disabled={!canSend}
            isWorking={chat.working}
            onInterrupt={interrupt}
            onSend={(text) => chat.send(text)}
            placeholder={canSend ? undefined : "Input is held by another device."}
            ref={composerRef}
          />
        )}
      </div>
    </div>
  );
}
