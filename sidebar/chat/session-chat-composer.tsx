// Session chat composer (orca §11.6 port, v1: plain textarea — the slash /
// skill autocomplete picker and image paste are deliberately out of scope).
// Enter sends, Shift+Enter inserts a newline, Escape interrupts, the IME
// guard swallows composition Enter, and ArrowUp/Down recall draft history.

import { IconArrowUp, IconPlayerStopFilled } from "@tabler/icons-react";
import {
  forwardRef,
  useImperativeHandle,
  useRef,
  useState,
  type KeyboardEvent,
} from "react";
import {
  EMPTY_SESSION_CHAT_COMPOSER_HISTORY,
  pushSessionChatComposerHistory,
  recallNextSessionChatDraft,
  recallPreviousSessionChatDraft,
  resetSessionChatComposerHistoryIndex,
} from "./session-chat-composer-state";

export interface SessionChatComposerHandle {
  focus: () => void;
  /** Insert text at the caret; returns false when the composer cannot take it. */
  insertTypedText: (text: string) => boolean;
}

export interface SessionChatComposerProps {
  disabled?: boolean;
  isWorking: boolean;
  placeholder?: string;
  onSend: (text: string) => void | Promise<void>;
  onInterrupt: () => void;
}

function isImeEvent(event: KeyboardEvent<HTMLTextAreaElement>): boolean {
  return event.nativeEvent.isComposing || event.nativeEvent.keyCode === 229;
}

export const SessionChatComposer = forwardRef<
  SessionChatComposerHandle,
  SessionChatComposerProps
>(function SessionChatComposer(
  { disabled = false, isWorking, onInterrupt, onSend, placeholder },
  ref,
) {
  const [draft, setDraft] = useState("");
  const [history, setHistory] = useState(EMPTY_SESSION_CHAT_COMPOSER_HISTORY);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);

  useImperativeHandle(ref, () => ({
    focus: () => {
      textareaRef.current?.focus();
    },
    insertTypedText: (text: string): boolean => {
      const textarea = textareaRef.current;
      if (!textarea || disabled) {
        return false;
      }
      const start = textarea.selectionStart ?? textarea.value.length;
      const end = textarea.selectionEnd ?? textarea.value.length;
      const next = `${textarea.value.slice(0, start)}${text}${textarea.value.slice(end)}`;
      setDraft(next);
      setHistory((current) => resetSessionChatComposerHistoryIndex(current));
      textarea.focus();
      requestAnimationFrame(() => {
        const caret = start + text.length;
        textarea.setSelectionRange(caret, caret);
      });
      return true;
    },
  }));

  const send = (): void => {
    const text = draft;
    if (text.trim() === "" || disabled) {
      return;
    }
    void onSend(text);
    setHistory((current) => pushSessionChatComposerHistory(current, text));
    setDraft("");
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>): void => {
    // IME guard: composition Enter confirms the composition; letting it fall
    // through would submit a partial draft.
    if (isImeEvent(event)) {
      if (event.key === "Enter") {
        event.preventDefault();
      }
      return;
    }
    if (event.key === "Escape") {
      event.preventDefault();
      onInterrupt();
      return;
    }
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      send();
      return;
    }
    if (event.key === "ArrowUp" && (draft === "" || history.index !== null)) {
      const recalled = recallPreviousSessionChatDraft(history);
      if (recalled) {
        event.preventDefault();
        setHistory(recalled.history);
        setDraft(recalled.draft);
      }
      return;
    }
    if (event.key === "ArrowDown" && history.index !== null) {
      const recalled = recallNextSessionChatDraft(history);
      if (recalled) {
        event.preventDefault();
        setHistory(recalled.history);
        setDraft(recalled.draft);
      }
    }
  };

  const sendDisabled = isWorking ? false : disabled || draft.trim() === "";

  return (
    <div className="ghostex-chat-composer" data-disabled={disabled ? "true" : undefined}>
      <textarea
        className="ghostex-chat-composer-input"
        disabled={disabled}
        onChange={(event) => {
          setDraft(event.target.value);
          setHistory((current) => resetSessionChatComposerHistoryIndex(current));
        }}
        onKeyDown={handleKeyDown}
        placeholder={placeholder ?? "Send a message…"}
        ref={textareaRef}
        rows={1}
        value={draft}
      />
      {isWorking ? (
        <button
          aria-label="Stop"
          className="ghostex-chat-composer-send ghostex-chat-composer-stop"
          onClick={() => {
            onInterrupt();
          }}
          type="button"
        >
          <IconPlayerStopFilled aria-hidden="true" size={14} stroke={1.6} />
        </button>
      ) : (
        <button
          aria-label="Send message"
          className="ghostex-chat-composer-send"
          disabled={sendDisabled}
          onClick={send}
          type="button"
        >
          <IconArrowUp aria-hidden="true" size={15} stroke={2.2} />
        </button>
      )}
    </div>
  );
});
