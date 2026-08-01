// Session chat message list (upstream chat spec §11.2 pipeline on shadcn chat
// components).
// Pipeline: drop the never-surfaced harness records → sort → fold tool-only
// messages into the preceding assistant turn. Harness-injected turns the
// terminal DOES print (task notifications, local command output, interrupts,
// continuation summaries, messages from other sessions) survive as collapsed
// markers that expand to their full text — hiding them is what reads as
// "messages are missing".
//
// Scrolling is owned by the shadcn MessageScroller: autoScroll follows live
// growth, preserveScrollOnPrepend anchors history loads, and the scroller
// button replaces the hand-rolled "Jump to latest" control. The viewport is
// flipped to RTL (content back to LTR) so the scrollbar renders on the left
// edge of the conversation.

import { IconChevronRight, IconCopy, IconPhoto } from "@tabler/icons-react";
import { useCallback, useMemo, useRef, useState } from "react";
import type { SessionChatMessage } from "../../shared/session-chat";
import { cn } from "../../lib/utils";
import { Button } from "../../components/ui/button";
import {
  Attachment,
  AttachmentContent,
  AttachmentGroup,
  AttachmentMedia,
  AttachmentTitle,
} from "../../components/ui/attachment";
import { Bubble, BubbleContent } from "../../components/ui/bubble";
import { Marker, MarkerContent } from "../../components/ui/marker";
import {
  Message,
  MessageContent,
  MessageFooter,
} from "../../components/ui/message";
import {
  MessageScroller,
  MessageScrollerButton,
  MessageScrollerContent,
  MessageScrollerItem,
  MessageScrollerProvider,
  MessageScrollerViewport,
} from "../../components/ui/message-scroller";
import { orderSessionChatMessages } from "./session-chat-assembler";
import { SessionChatMarkdown } from "./session-chat-markdown";
import {
  dropSessionChatHiddenMessages,
  sessionChatSuppressedTurnLabel,
} from "./session-chat-noise";
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

function ImageAttachments({
  blocks,
  className,
}: {
  blocks: readonly { alt?: string; path?: string; url?: string }[];
  className?: string;
}) {
  if (blocks.length === 0) {
    return null;
  }
  return (
    <AttachmentGroup className={className}>
      {blocks.map((block, index) => (
        <Attachment key={index} size="xs">
          <AttachmentMedia>
            <IconPhoto aria-hidden="true" stroke={1.8} />
          </AttachmentMedia>
          <AttachmentContent>
            <AttachmentTitle>{imageChipLabel(block)}</AttachmentTitle>
          </AttachmentContent>
        </Attachment>
      ))}
    </AttachmentGroup>
  );
}

function CopyFooter({ markdown }: { markdown: string }) {
  return (
    <MessageFooter className="px-0 opacity-0 transition-opacity group-hover/message:opacity-100 group-focus-within/message:opacity-100">
      <Button
        aria-label="Copy message"
        onClick={() => {
          void navigator.clipboard.writeText(markdown);
        }}
        size="icon-xs"
        variant="ghost"
      >
        <IconCopy aria-hidden="true" stroke={1.9} />
      </Button>
    </MessageFooter>
  );
}

/**
 * A harness-injected turn the terminal prints too: one muted line that expands
 * to the verbatim text. Collapsed by default so orchestration chatter never
 * buries the conversation, present so it is never silently missing.
 */
function SuppressedTurn({ label, text }: { label: string; text: string }) {
  const [expanded, setExpanded] = useState(false);
  return (
    <div className="flex w-full min-w-0 flex-col gap-1.5">
      <button
        aria-expanded={expanded}
        className="flex min-w-0 items-center gap-1 self-start text-xs text-muted-foreground transition-colors hover:text-foreground"
        onClick={() => setExpanded((value) => !value)}
        type="button"
      >
        <IconChevronRight
          aria-hidden="true"
          className={cn("size-3 shrink-0 transition-transform", expanded && "rotate-90")}
          stroke={2}
        />
        <span className="truncate">{label}</span>
      </button>
      {expanded ? (
        <div className="min-w-0 whitespace-pre-wrap break-words rounded-md border border-border/60 bg-muted/30 px-2.5 py-2 font-mono text-[11px] leading-relaxed text-muted-foreground">
          {text}
        </div>
      ) : null}
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

  // No ghost bubbles: skip entirely when there is nothing to show.
  if (markdown.length === 0 && images.length === 0 && tools.length === 0) {
    return null;
  }

  const suppressedLabel = sessionChatSuppressedTurnLabel(message);
  if (suppressedLabel !== null) {
    return <SuppressedTurn label={suppressedLabel} text={markdown} />;
  }

  const isUser = message.role === "user";
  const isReasoning = message.role === "reasoning";
  const isSystem = message.role === "system";
  const showControls = !isReasoning && !isSystem && markdown.length > 0;

  if (isSystem) {
    return (
      <Marker>
        <MarkerContent>{markdown}</MarkerContent>
      </Marker>
    );
  }

  if (isUser) {
    // Optimistic echoes render IDENTICALLY to real turns — no muting, no
    // "Queued" label — so replacement by the transcript turn causes no
    // visible state change.
    return (
      <Message align="end" data-role="user">
        <MessageContent>
          <ImageAttachments blocks={images} className="self-end" />
          {markdown.length > 0 ? (
            <Bubble align="end" variant="default">
              <BubbleContent>
                <SessionChatMarkdown markdown={markdown} />
              </BubbleContent>
            </Bubble>
          ) : null}
          {showControls ? <CopyFooter markdown={markdown} /> : null}
        </MessageContent>
      </Message>
    );
  }

  return (
    <Message align="start" data-role={message.role}>
      <MessageContent>
        <ImageAttachments blocks={images} />
        {markdown.length > 0 ? (
          <Bubble
            className={isReasoning ? "text-muted-foreground" : undefined}
            variant="ghost"
          >
            <BubbleContent className={isReasoning ? "text-[0.8125rem]" : undefined}>
              <SessionChatMarkdown markdown={markdown} />
            </BubbleContent>
          </Bubble>
        ) : null}
        {tools.length > 0 ? (
          <SessionChatToolRun blocks={tools} expandSignal={expandToolRuns} />
        ) : null}
        {showControls ? <CopyFooter markdown={markdown} /> : null}
      </MessageContent>
    </Message>
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
  const loadingEarlierRef = useRef(loadingEarlier);
  loadingEarlierRef.current = loadingEarlier;
  const hasMoreRef = useRef(hasMore);
  hasMoreRef.current = hasMore;

  // Auto-load older history when the reader scrolls near the top; the
  // viewport's preserveScrollOnPrepend keeps the visible rows in place when
  // the earlier page lands.
  const handleScroll = useCallback(
    (event: React.UIEvent<HTMLDivElement>): void => {
      if (
        event.currentTarget.scrollTop < LOAD_EARLIER_SCROLL_TOP_PX &&
        hasMoreRef.current &&
        !loadingEarlierRef.current
      ) {
        onLoadEarlier();
      }
    },
    [onLoadEarlier],
  );

  const rendered = useMemo(
    () =>
      foldSessionChatToolMessages(
        orderSessionChatMessages(dropSessionChatHiddenMessages(messages)),
        // Collapsed markers must not break a tool-fold run.
        (message) => sessionChatSuppressedTurnLabel(message) !== null,
      ),
    [messages],
  );

  const showTypingIndicator =
    isWorking && !messages.some((message) => message.id === SESSION_CHAT_STREAMING_ID);

  return (
    <MessageScrollerProvider
      autoScroll
      defaultScrollPosition="end"
      scrollPreviousItemPeek={64}
    >
      <MessageScroller className="flex-1">
        {/* RTL viewport + LTR content puts the scrollbar on the left edge. */}
        <MessageScrollerViewport
          className="[direction:rtl]"
          onScroll={handleScroll}
          preserveScrollOnPrepend
        >
          <MessageScrollerContent className="mx-auto w-full max-w-3xl gap-5 px-4 pt-8 pb-4 [direction:ltr]">
            {hasMore ? (
              <div className="flex justify-center">
                <Button
                  disabled={loadingEarlier}
                  onClick={onLoadEarlier}
                  size="sm"
                  variant="ghost"
                >
                  {loadingEarlier ? "Loading…" : "Load earlier messages"}
                </Button>
              </div>
            ) : null}
            {rendered.map((message) => (
              <MessageScrollerItem
                key={message.id}
                messageId={message.id}
                // Collapsed harness markers are user-role rows but must never
                // become the scroll anchor for a turn.
                scrollAnchor={
                  message.role === "user" &&
                  sessionChatSuppressedTurnLabel(message) === null
                }
              >
                <MessageRow expandToolRuns={expandToolRuns} message={message} />
              </MessageScrollerItem>
            ))}
            {showTypingIndicator ? (
              <div
                aria-label="Agent is responding"
                aria-live="polite"
                className="flex h-8 items-center gap-1.5 text-muted-foreground"
                role="status"
              >
                {[0, 1, 2].map((index) => (
                  <span
                    className="size-1.5 animate-bounce rounded-full bg-muted-foreground/70"
                    key={index}
                    style={{ animationDelay: `${index * 160}ms` }}
                  />
                ))}
              </div>
            ) : null}
          </MessageScrollerContent>
        </MessageScrollerViewport>
        <MessageScrollerButton />
      </MessageScroller>
    </MessageScrollerProvider>
  );
}
