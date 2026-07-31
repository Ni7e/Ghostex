// Session chat message list (orca §11.2 port).
// Pipeline: strip noise → sort → fold tool-only messages into the preceding
// assistant turn. Autoscroll follows the ref-discipline rules exactly:
// stuckToBottom is mirrored into a ref read by the layout effect, prepend
// keeps a scroll anchor, and a ResizeObserver re-pins during in-place
// streaming growth.

import { IconArrowDown, IconCopy, IconPhoto } from "@tabler/icons-react";
import {
  useCallback,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type { SessionChatMessage } from "../../shared/session-chat";
import { orderSessionChatMessages } from "./session-chat-assembler";
import {
  isSessionChatNearBottom,
  sessionChatDistanceFromBottom,
  SESSION_CHAT_BOTTOM_THRESHOLD_PX,
} from "./session-chat-autoscroll";
import { SessionChatMarkdown } from "./session-chat-markdown";
import { stripSessionChatNoiseMessages } from "./session-chat-noise";
import { SESSION_CHAT_STREAMING_ID } from "./session-chat-streaming";
import {
  foldSessionChatToolMessages,
  splitSessionChatBlocks,
} from "./session-chat-tool-fold";
import { SessionChatToolRun } from "./session-chat-tool-run";

const LOAD_EARLIER_SCROLL_TOP_PX = 80;
const PASTED_IMAGE_NAME = /^ghostex-paste-.+\.png$/i;

export interface SessionChatMessageListProps {
  messages: readonly SessionChatMessage[];
  isWorking: boolean;
  hasMore: boolean;
  loadingEarlier: boolean;
  onLoadEarlier: () => void;
  /** Global tool-run expansion signal; runs start collapsed by default. */
  expandToolRuns?: boolean;
}

function isPastedImagePath(path: string | undefined): boolean {
  if (!path) {
    return false;
  }
  const segment = path.split(/[\\/]/).at(-1) ?? "";
  return PASTED_IMAGE_NAME.test(segment);
}

function imageChipLabel(block: {
  alt?: string;
  path?: string;
  url?: string;
}): string {
  if (isPastedImagePath(block.path)) {
    return "Pasted image";
  }
  if (block.path) {
    return block.path.split(/[\\/]/).at(-1) ?? block.path;
  }
  return block.alt ?? block.url ?? "Image";
}

function TypingIndicator() {
  return (
    <div aria-live="polite" className="ghostex-chat-typing" role="status">
      {[0, 1, 2].map((index) => (
        <span
          className="ghostex-chat-typing-dot"
          key={index}
          style={{ animationDelay: `${index * 160}ms` }}
        />
      ))}
    </div>
  );
}

function MessageRow({
  expandToolRuns,
  message,
}: {
  expandToolRuns: boolean;
  message: SessionChatMessage;
}) {
  const { prose, tools } = splitSessionChatBlocks(message.blocks);
  const markdown = prose
    .filter((block) => block.type === "text")
    .map((block) => (block.type === "text" ? block.text : ""))
    .join("\n\n");
  const images = prose.filter((block) => block.type === "image-ref");

  // No ghost bubbles: skip entirely when there is nothing to show. (Hooks run
  // before this return so hook order stays unconditional.)
  if (markdown.length === 0 && images.length === 0 && tools.length === 0) {
    return null;
  }

  const isUser = message.role === "user";
  const isReasoning = message.role === "reasoning";
  const isSystem = message.role === "system";
  const showControls = !isReasoning && !isSystem && markdown.length > 0;

  const imageChips =
    images.length > 0 ? (
      <div className="ghostex-chat-image-chips">
        {images.map((block, index) =>
          block.type === "image-ref" ? (
            <span className="ghostex-chat-image-chip" key={index}>
              <IconPhoto aria-hidden="true" size={12} stroke={1.8} />
              {imageChipLabel(block)}
            </span>
          ) : null,
        )}
      </div>
    ) : null;

  const copyControl = showControls ? (
    <div className="ghostex-chat-row-controls">
      <button
        aria-label="Copy message"
        className="ghostex-chat-row-control copy-cursor"
        onClick={() => {
          void navigator.clipboard.writeText(markdown);
        }}
        type="button"
      >
        <IconCopy aria-hidden="true" size={13} stroke={1.9} />
      </button>
    </div>
  ) : null;

  if (isUser) {
    // Optimistic echoes render IDENTICALLY to real turns — no muting, no
    // "Queued" label — so replacement by the transcript turn causes no
    // visible state change.
    return (
      <div className="ghostex-chat-row ghostex-chat-row-user group" data-role="user">
        {copyControl}
        <div className="ghostex-chat-user-bubble">
          {imageChips}
          {markdown.length > 0 ? <SessionChatMarkdown markdown={markdown} /> : null}
        </div>
      </div>
    );
  }

  return (
    <div
      className="ghostex-chat-row ghostex-chat-row-block group"
      data-role={message.role}
    >
      {copyControl}
      {imageChips}
      {markdown.length > 0 ? (
        isReasoning ? (
          <div className="ghostex-chat-reasoning">
            <SessionChatMarkdown markdown={markdown} />
          </div>
        ) : isSystem ? (
          <div className="ghostex-chat-system">{markdown}</div>
        ) : (
          <div className="ghostex-chat-assistant-body">
            <SessionChatMarkdown markdown={markdown} />
          </div>
        )
      ) : null}
      {tools.length > 0 ? (
        <SessionChatToolRun blocks={tools} expandSignal={expandToolRuns} />
      ) : null}
    </div>
  );
}

export function SessionChatMessageList({
  expandToolRuns = false,
  hasMore,
  isWorking,
  loadingEarlier,
  messages,
  onLoadEarlier,
}: SessionChatMessageListProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const contentRef = useRef<HTMLDivElement | null>(null);
  const [stuckToBottom, setStuckToBottom] = useState(true);
  const [showJump, setShowJump] = useState(false);
  // stuckToBottom is mirrored into a ref read by the layout effect —
  // depending on the state directly would create a self-loop.
  const stuckToBottomRef = useRef(true);
  const prependAnchorRef = useRef<{ scrollHeight: number; scrollTop: number } | null>(
    null,
  );
  const loadingEarlierRef = useRef(loadingEarlier);
  loadingEarlierRef.current = loadingEarlier;
  const hasMoreRef = useRef(hasMore);
  hasMoreRef.current = hasMore;

  const scrollToBottom = useCallback((): void => {
    const container = containerRef.current;
    if (!container) {
      return;
    }
    container.scrollTop = container.scrollHeight;
    stuckToBottomRef.current = true;
    setStuckToBottom(true);
    setShowJump(false);
  }, []);

  const handleScroll = useCallback((): void => {
    const container = containerRef.current;
    if (!container) {
      return;
    }
    const nearBottom = isSessionChatNearBottom(container);
    stuckToBottomRef.current = nearBottom;
    setStuckToBottom(nearBottom);
    setShowJump(
      !nearBottom &&
        sessionChatDistanceFromBottom(container) > SESSION_CHAT_BOTTOM_THRESHOLD_PX,
    );
    if (
      container.scrollTop < LOAD_EARLIER_SCROLL_TOP_PX &&
      hasMoreRef.current &&
      !loadingEarlierRef.current
    ) {
      prependAnchorRef.current = {
        scrollHeight: container.scrollHeight,
        scrollTop: container.scrollTop,
      };
      onLoadEarlier();
    }
  }, [onLoadEarlier]);

  const rendered = useMemo(
    () =>
      foldSessionChatToolMessages(
        orderSessionChatMessages(stripSessionChatNoiseMessages(messages)),
      ),
    [messages],
  );

  const showTypingIndicator =
    isWorking && !messages.some((message) => message.id === SESSION_CHAT_STREAMING_ID);

  // Layout effect (before paint): restore the prepend anchor, else re-pin to
  // the bottom while stuck.
  useLayoutEffect(() => {
    const container = containerRef.current;
    if (!container) {
      return;
    }
    const anchor = prependAnchorRef.current;
    if (anchor) {
      container.scrollTop = anchor.scrollTop + (container.scrollHeight - anchor.scrollHeight);
      prependAnchorRef.current = null;
      // Do not re-pin after restoring the anchor.
      return;
    }
    if (stuckToBottomRef.current) {
      scrollToBottom();
    }
  }, [rendered.length, isWorking, showTypingIndicator, scrollToBottom]);

  // ResizeObserver on the viewport AND the content element: a streaming turn
  // extending in place never changes the message count, so the layout effect
  // alone would miss it. This is what removes most "Jump to latest" clicks
  // during a live response.
  useLayoutEffect(() => {
    const container = containerRef.current;
    const content = contentRef.current;
    if (!container || !content || typeof ResizeObserver === "undefined") {
      return;
    }
    const observer = new ResizeObserver(() => {
      if (stuckToBottomRef.current) {
        scrollToBottom();
      } else {
        handleScroll();
      }
    });
    observer.observe(container);
    observer.observe(content);
    return () => {
      observer.disconnect();
    };
  }, [handleScroll, scrollToBottom]);

  return (
    <div className="ghostex-chat-list-frame">
      <div
        className="ghostex-chat-list"
        onScroll={handleScroll}
        ref={containerRef}
      >
        <div className="ghostex-chat-list-content" ref={contentRef}>
          {hasMore ? (
            <button
              className="ghostex-chat-load-earlier"
              disabled={loadingEarlier}
              onClick={() => {
                const container = containerRef.current;
                if (container) {
                  prependAnchorRef.current = {
                    scrollHeight: container.scrollHeight,
                    scrollTop: container.scrollTop,
                  };
                }
                onLoadEarlier();
              }}
              type="button"
            >
              {loadingEarlier ? "Loading…" : "Load earlier messages"}
            </button>
          ) : null}
          {rendered.map((message) => (
            <MessageRow
              expandToolRuns={expandToolRuns}
              key={message.id}
              message={message}
            />
          ))}
          {showTypingIndicator ? <TypingIndicator /> : null}
        </div>
      </div>
      {showJump && !stuckToBottom ? (
        <button
          className="ghostex-chat-jump-to-latest"
          onClick={scrollToBottom}
          type="button"
        >
          <IconArrowDown aria-hidden="true" size={13} stroke={2} />
          Jump to latest
        </button>
      ) : null}
    </div>
  );
}
