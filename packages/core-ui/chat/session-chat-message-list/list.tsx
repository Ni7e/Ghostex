import { normalizeChatTranscript, foldChatTranscript } from '@/packages/shared/session-chat-presentation/transcript';
import {
  completedWorkRenderItems,
  finalAssistantMessageIds,
  isVisibleAssistantArtifact,
  summaryModeTurns,
  workedDurationLabel,
  type CompletedWorkTurn,
  type SummaryModeTurn,
  type SessionChatRenderItem,
} from '@/packages/shared/session-chat-presentation/turns';
// Session chat message list (upstream chat spec §11.2 pipeline on shadcn chat
// components).
// Pipeline: drop the never-surfaced harness records → sort → fold tool-only
// messages into the preceding assistant turn. Harness-injected turns the
// terminal DOES print (task notifications, local command output, interrupts,
// continuation summaries, messages from other sessions) survive as collapsed
// markers that expand to their full text — hiding them is what reads as
// "messages are missing".
//
// TanStack owns measured row positions and keyed history prepends. The chat
// controller retains explicit streaming holds and navigation.

import { cn } from '@/packages/components/utils';
import { IconChevronRight } from '@tabler/icons-react';
import { memo, useCallback, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { SessionChatSimpleModeContext, sessionChatSimpleEditLabel } from '../session-chat-simple-mode';
import { Button } from '../../../components/ui/button';
import { Message, MessageContent } from '../../../components/ui/message';
import {
  MessageScroller,
  MessageScrollerContent,
  MessageScrollerItem,
  SessionChatVirtualScrollerContext,
  MessageScrollerViewport,
} from '../session-chat-virtual-scroller';
import { SessionChatScrollbar } from '../session-chat-scrollbar';
import { useSessionChatVirtualTranscript } from '../use-session-chat-virtual-transcript';
import { transcriptRowElements } from '../session-chat-transcript-mode';
import { Separator } from '../../../components/ui/separator';
import { normalizeghostexHotkeySettings } from '../../../shared/ghostex-hotkeys';
import { type SessionChatMessage, type SessionChatTheme } from '../../../shared/session-chat';
import { formatSidebarHotkeyLabel } from '../../hotkey-label';
import { orderSessionChatMessages } from '../session-chat-assembler';
import { SessionChatDisclosure, SessionChatExpansion, anchorSessionChatExpansionTop } from '../session-chat-expansion';
import { SessionChatFileChangeCards, SessionChatFileChangeInteractionContext } from '../session-chat-file-change-card';
import { splitSessionChatFileChanges } from '../session-chat-file-changes';
import { normalizeSessionChatImageTranscriptMessages } from '../session-chat-image-transcript-markers';
import {
  SessionChatInteractionProvider,
  SessionChatInteractionScope,
  persistSessionChatInteractions,
  sessionChatInteractionState,
  useSessionChatDisclosureState,
} from '../session-chat-interaction-state';
import { normalizeSessionChatLocalCommandMessages } from '../session-chat-local-command-transcript';
import { sameSessionChatMessage } from '../session-chat-message-equality';
import { SessionChatMinimap } from '../session-chat-minimap';
import {
  dropSessionChatHiddenMessages,
  isSessionChatCommandTurn,
  sessionChatSuppressedTurnLabel,
} from '../session-chat-noise';
import { isSessionChatPendingMessageId } from '../session-chat-pending';
import {
  SessionChatQuestionExchangeCard,
  answeredSessionChatQuestionExchange,
  type SessionChatQuestionExchange,
} from '../session-chat-question-exchange';
import {
  SessionChatRewindDialog,
  type RewindSessionChatToMessage,
  type SessionChatRewindRequest,
} from '../session-chat-rewind-dialog';
import {
  SessionChatSaveMarkdownDialog,
  type ListSessionMessageMarkdownPaths,
  type SaveSessionMessageMarkdown,
} from '../session-chat-save-markdown-dialog';
import {
  FOLLOW_BOTTOM_ATTRIBUTE,
  STREAM_HOLD_ATTRIBUTE,
  SessionChatScrollBottomButton,
} from '../session-chat-scroll-bottom-button';
import { type SessionChatStartupSendActions } from '../session-chat-startup-send-status';
import { SESSION_CHAT_STREAMING_ID } from '../session-chat-streaming';
import {
  foldSessionChatToolMessages,
  pairSessionChatToolBlocks,
  splitSessionChatBlocks,
} from '../session-chat-tool-fold';
import { useSessionChatScrollMomentum } from '../use-session-chat-scroll-momentum';
import {
  SESSION_CHAT_HISTORY_NAVIGATION_EVENT,
  useSessionChatScrollRestoration,
} from '../use-session-chat-scroll-restoration';
import {
  DeferredWorkLoading,
  SessionChatHistoryReaderContext,
  useDeferredSessionChatWork,
} from '../session-chat-deferred-work';
import type { SessionChatTransport } from '../session-chat-transport';
import { mergeSessionChatMessagesWith } from '../session-chat-merge';

const LOAD_EARLIER_SCROLL_TOP_PX = 320;
const AUTO_SCROLL_EDGE_THRESHOLD_PX = 10;
/** Gap kept above the streaming row while the stream hold anchors it to the top. */
const STREAM_HOLD_TOP_MARGIN_PX = 12;

/** The chat's Scroll to bottom chord (session-chat-view.tsx dispatches it). */
export function scrollToBottomHotkeyLabel(): string {
  return formatSidebarHotkeyLabel(normalizeghostexHotkeySettings({}).scrollChatToBottom ?? '');
}

export interface SessionChatMessageListProps extends SessionChatStartupSendActions {
  readHistory?: SessionChatTransport['readHistory'];
  sessionKey?: string;
  earlierPageCursor?: number;
  composerCollapsed?: boolean;
  /** Bumped by the view's Scroll to bottom hotkey; each change jumps to the end. */
  scrollToBottomRequest?: number;
  scrollToBottomShortcutLabel?: string;
  messages: readonly SessionChatMessage[];
  isWorking: boolean;
  hasMore: boolean;
  loadingEarlier: boolean;
  onLoadEarlier: () => void;
  onSavePrompt?: (prompt: string) => Promise<void>;
  /** Opens an assistant reply in the host's Docs review so it can be annotated. */
  onAnnotateMessage?: (markdown: string) => void;
  /** Saves a settled assistant response inside this session project's Docs tree. */
  saveMessageMarkdown?: SaveSessionMessageMarkdown;
  /** Reads existing project Markdown paths before generating the next file name. */
  listMessageMarkdownPaths?: ListSessionMessageMarkdownPaths;
  /*
  CDXC:SessionChat 2026-09-02:
  Rewinds the live conversation back to the point before a user prompt was
  sent. Set only when the host can reach `/api/rewindSessionChat` AND the
  session runs an agent whose rewind Ghostex drives (Claude or Codex), so the
  transcript never offers a rewind that would be refused.
  */
  rewindToMessage?: RewindSessionChatToMessage;
  rewindAgent?: 'claude' | 'codex';
  /**
   * The live gate: the same condition that lets the composer send, because the
   * daemon types the rewind into that same pane. Only the "Rewind to here"
   * BUTTON is hidden while false. The confirmation dialog stays mounted either
   * way, so a rewind that is already running (which can itself take the
   * terminal busy) keeps its progress and its refusal on screen instead of
   * vanishing mid-call.
   */
  canRewind?: boolean;
  /**
   * A rewind landed: the prompt it rewound to, verbatim. The chat view puts it
   * back in the composer, so the reader edits the message they just took back
   * instead of retyping it.
   */
  onRewound?: (prompt: string) => void;
  /** Current session title used to prefill a useful Markdown file name. */
  sessionTitle?: string;
  /** Matches the portaled save dialog and toast to this chat surface. */
  theme?: SessionChatTheme;
  /** Reveal reasoning-owned tool activity by default. */
  verboseMode?: boolean;
  /** Show only user prompts with each completed final reply collapsed beneath it. */
  summaryMode?: boolean;
}

/**
 * Answered agent questions buried inside a completed turn's work. The user's
 * answer never writes a user row to the transcript — the whole ask/answer
 * exchange lives in tool blocks between two user turns — so without hoisting
 * it would vanish into the collapsed "Worked for Xs" section. The raw tool
 * rows stay in the expanded work log (questionPairsAsRows), so nothing renders
 * twice.
 */
function hoistedQuestionExchanges(
  work: readonly SessionChatMessage[]
): { exchange: SessionChatQuestionExchange; key: string }[] {
  const out: { exchange: SessionChatQuestionExchange; key: string }[] = [];
  for (const message of work) {
    const { tools } = splitSessionChatBlocks(message.blocks);
    pairSessionChatToolBlocks(tools).forEach((pair, index) => {
      const exchange = answeredSessionChatQuestionExchange(pair);
      if (exchange) {
        out.push({ exchange, key: `${message.id}:${index}` });
      }
    });
  }
  return out;
}

/** CDXC:SessionChat 2026-09-10 DECISION:
 * User: when a turn shows "Worked for", collapse all its file changes under a separate "N files changed" section directly below it.
 * User: do not automatically collapse work or file sections while reading code, and keep the diff header visible after expanding or collapsing it.
 * Preserve an interacted turn's presentation for the lifetime of this transcript; regrouping on the last diff collapse unmounted the very header we needed to reveal.
 * Completed turns keep their identity across final-reply updates so an open Files changed section and its expanded diffs stay mounted.
 */
const CompletedWork = memo(
  function CompletedWork(props: Parameters<typeof CompletedWorkBody>[0]) {
    return (
      <SessionChatInteractionScope id={props.turn.user.id}>
        <CompletedWorkBody {...props} />
      </SessionChatInteractionScope>
    );
  },
  (previous, next) =>
    previous.onExpand === next.onExpand &&
    previous.onAnnotate === next.onAnnotate &&
    previous.onSaveMarkdown === next.onSaveMarkdown &&
    previous.showAssistantCopy === next.showAssistantCopy &&
    previous.verboseMode === next.verboseMode &&
    sameSessionChatMessage(previous.turn.user, next.turn.user) &&
    (previous.turn.final === next.turn.final ||
      (Boolean(previous.turn.final && next.turn.final) &&
        sameSessionChatMessage(previous.turn.final!, next.turn.final!))) &&
    previous.turn.work.length === next.turn.work.length &&
    previous.turn.work.every((message, index) => sameSessionChatMessage(message, next.turn.work[index]!))
);

function CompletedWorkBody({
  onAnnotate,
  onExpand,
  onSaveMarkdown,
  showAssistantCopy,
  turn,
  verboseMode,
}: {
  onAnnotate?: (markdown: string) => void;
  onExpand: (target: HTMLElement | null) => void;
  onSaveMarkdown?: (markdown: string) => void;
  /**
   * A folded turn ends at the next user row, and a harness-injected turn
   * (task notification, local command output) is one of those rows — so this
   * turn's `final` can still be mid-response. Only the real end of the
   * response carries the copy affordance.
   */
  showAssistantCopy: boolean;
  turn: CompletedWorkTurn;
  verboseMode: boolean;
}) {
  const [open, setOpen] = useSessionChatDisclosureState('completed-work', verboseMode);
  const [filesOpen, setFilesOpen] = useState(false);
  const deferred = useDeferredSessionChatWork(turn.user.deferredWork, open || filesOpen);
  const work = useMemo(() => {
    const rows = deferred.messages
      ? mergeSessionChatMessagesWith(
          deferred.messages.filter((message) => message.id !== turn.final?.id),
          turn.work
        )
      : turn.work;
    return foldSessionChatToolMessages(
      dropSessionChatHiddenMessages(
        normalizeSessionChatImageTranscriptMessages(
          normalizeSessionChatLocalCommandMessages(orderSessionChatMessages(rows))
        )
      ),
      (message) => sessionChatSuppressedTurnLabel(message) !== null
    );
  }, [deferred.messages, turn.final?.id, turn.work]);
  const simpleMode = useContext(SessionChatSimpleModeContext);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const visibleArtifacts = work.filter((message) => isVisibleAssistantArtifact(message) || message.role === 'user');
  const collapsedWork = work.filter((message) => !isVisibleAssistantArtifact(message) && message.role !== 'user');
  const hasWork = collapsedWork.length > 0 || Boolean(turn.user.deferredWork);
  const questionExchanges = useMemo(() => hoistedQuestionExchanges(work), [work]);
  const fileChanges = useMemo(
    () =>
      [...work, ...(turn.final ? [turn.final] : [])].flatMap(
        (message) => splitSessionChatFileChanges(splitSessionChatBlocks(message.blocks).tools).changes
      ),
    [work, turn.final]
  );
  const changedFileCount = new Set([
    ...fileChanges.map((change) => change.path),
    ...(turn.user.deferredWork?.filePaths ?? []),
  ]).size;

  return (
    <div className='ghostex-chat-completed-turn'>
      <div className='ghostex-chat-completed-work'>
        <Button
          aria-expanded={hasWork ? open : undefined}
          className='ghostex-chat-completed-work-trigger'
          disabled={!hasWork}
          onClick={() => {
            if (hasWork) {
              if (!open) {
                onExpand(triggerRef.current);
              }
              setOpen((value) => !value);
            }
          }}
          ref={triggerRef}
          size='xs'
          type='button'
          variant='ghost'
        >
          {/* The chevron LEADS, in the transcript's marker slot, like every
              other disclosure. It used to trail the label, which left this row
              as the only expander on the surface whose glyph was not on the
              column. The slot stays even with no work to disclose, so a turn
              with nothing behind it does not shift its label left. */}
          <span className='ghostex-chat-marker-slot'>
            {hasWork ? (
              <IconChevronRight
                aria-hidden='true'
                className={cn('ghostex-chat-disclosure-chevron', open && 'is-open')}
              />
            ) : null}
          </span>
          <span>
            {workedDurationLabel(
              turn.user.timestamp,
              turn.final?.timestamp ?? turn.user.deferredWork?.completedAt ?? null
            )}
          </span>
        </Button>
        <Separator />
        {hasWork && open ? (
          <SessionChatExpansion
            bodyClassName='ghostex-chat-completed-work-content'
            label='Collapse completed work'
            onCollapse={() => setOpen(false)}
          >
            {turn.user.deferredWork && !deferred.messages ? (
              <DeferredWorkLoading error={deferred.error} retry={deferred.retry} />
            ) : (
              collapsedWork.map((message) => (
                <MessageRow
                  hideFileChanges
                  key={message.id}
                  message={message}
                  questionPairsAsRows
                  showAssistantCopy={false}
                  verboseMode={verboseMode}
                />
              ))
            )}
          </SessionChatExpansion>
        ) : null}
      </div>
      {changedFileCount > 0 ? (
        <SessionChatDisclosure
          stateKey='files-changed'
          onOpenChange={setFilesOpen}
          label={
            simpleMode
              ? sessionChatSimpleEditLabel(changedFileCount)
              : `${changedFileCount} ${changedFileCount === 1 ? 'file' : 'files'} changed`
          }
          onExpand={onExpand}
        >
          {turn.user.deferredWork && !deferred.messages ? (
            <DeferredWorkLoading error={deferred.error} retry={deferred.retry} />
          ) : (
            <SessionChatFileChangeCards changes={fileChanges} messageId={turn.user.id} inDisclosure />
          )}
        </SessionChatDisclosure>
      ) : null}
      {visibleArtifacts.map((message) => (
        <MessageRow
          hideFileChanges
          key={message.id}
          message={message}
          showAssistantCopy={false}
          verboseMode={verboseMode}
        />
      ))}
      {questionExchanges.length > 0 ? (
        <Message align='start' className='pb-4' data-role='question-exchange'>
          <MessageContent>
            {questionExchanges.map(({ exchange, key }) => (
              <SessionChatQuestionExchangeCard exchange={exchange} key={key} />
            ))}
          </MessageContent>
        </Message>
      ) : null}
      {turn.final ? (
        <MessageRow
          hideFileChanges
          message={turn.final}
          onAnnotate={onAnnotate}
          onSaveMarkdown={onSaveMarkdown}
          showAssistantCopy={showAssistantCopy}
          verboseMode={verboseMode}
        />
      ) : null}
    </div>
  );
}

export function SessionChatMessageList({
  sessionKey,
  earlierPageCursor,
  composerCollapsed = false,
  scrollToBottomRequest = 0,
  scrollToBottomShortcutLabel = scrollToBottomHotkeyLabel(),
  hasMore,
  isWorking,
  loadingEarlier,
  messages: incomingMessages,
  readHistory,
  onLoadEarlier,
  onAnnotateMessage,
  onSavePrompt,
  onRetryStartupSend,
  onRemoveStartupSend,
  canRewind = true,
  listMessageMarkdownPaths,
  onRewound,
  rewindToMessage,
  rewindAgent = 'claude',
  saveMessageMarkdown,
  sessionTitle = '',
  summaryMode = false,
  theme = 'dark',
  verboseMode = false,
}: SessionChatMessageListProps) {
  const messages = useMemo(() => {
    if (!readHistory || !hasMore) return incomingMessages;
    const user = incomingMessages.findIndex((message) => message.role === 'user');
    // Keep an incomplete historical turn out of the list until its prompt arrives.
    return user < 0 ? (isWorking ? incomingMessages : []) : incomingMessages.slice(user);
  }, [hasMore, incomingMessages, isWorking, readHistory]);
  const interactionState = useMemo(() => sessionChatInteractionState(sessionKey), [sessionKey]);
  const restoredScroll = useRef(interactionState.scroll).current;
  const restoringScrollRef = useRef(Boolean(restoredScroll));
  const scrollRestorationControlRef = useRef({ finished: !restoredScroll, blocked: false });
  const cancelScrollRestoration = useCallback(() => {
    scrollRestorationControlRef.current.finished = true;
    scrollRestorationControlRef.current.blocked = false;
    restoringScrollRef.current = false;
  }, []);
  /** CDXC:SessionChat 2026-09-10 WHY:
   * Both resize-follow paths could scroll past a diff header after it was revealed. A diff toggle pauses them until the reader navigates or sends again.
   */
  const [fileNavigationActive, setFileNavigationActive] = useState(restoredScroll?.fileNavigationActive ?? false);
  const fileNavigationActiveRef = useRef(restoredScroll?.fileNavigationActive ?? false);
  const resumeFileScrolling = useCallback(() => {
    cancelScrollRestoration();
    fileNavigationActiveRef.current = false;
    setFileNavigationActive(false);
  }, [cancelScrollRestoration]);
  const [interactedMessageIds, setInteractedMessageIds] = useState<ReadonlySet<string>>(
    () => new Set(restoredScroll?.interactedMessageIds)
  );
  const reportFileInteraction = useCallback(
    (messageId: string) => {
      cancelScrollRestoration();
      fileNavigationActiveRef.current = true;
      setFileNavigationActive(true);
      shouldFollowBottomRef.current = false;
      viewportRef.current?.setAttribute(FOLLOW_BOTTOM_ATTRIBUTE, 'false');
      setInteractedMessageIds((current) => (current.has(messageId) ? current : new Set([...current, messageId])));
    },
    [cancelScrollRestoration]
  );
  const loadingEarlierRef = useRef(loadingEarlier);
  loadingEarlierRef.current = loadingEarlier;
  const hasMoreRef = useRef(hasMore);
  hasMoreRef.current = hasMore;
  const contentRef = useRef<HTMLDivElement>(null);
  const viewportRef = useRef<HTMLDivElement>(null);
  const cancelScrollMomentum = useSessionChatScrollMomentum(viewportRef);
  const shouldFollowBottomRef = useRef(restoredScroll?.followBottom ?? true);
  const [, refreshScrollPolicy] = useState(0);
  // A collapsed composer means the reader scrolled into history; streaming growth must not pull them back to the end.
  const composerCollapsedRef = useRef(composerCollapsed);
  composerCollapsedRef.current = composerCollapsed;
  /*
  CDXC:SessionChat 2026-09-11 DECISION:
  User: while a reply streams in from the terminal, stop following the bottom so
  the reader stays at the top of the streamed text and can read it as it grows;
  resume following once the stream is done. Trying this UX deliberately.
  User: give the incoming text as much room as possible while the hold is on.
  So the hold anchors the streaming row's top to the top of the viewport and
  keeps it there as the text grows (each growth re-anchors until the row can
  reach the top), instead of leaving it two lines above the composer.
  Both follow paths (the ResizeObserver below and the virtualizer's end anchoring)
  hold while the synthetic streaming row is in the list. A reader scroll during
  the hold ends the anchoring, and the viewport then stays wherever they put it
  when the transcript's row replaces the stream. Scroll to bottom (the pill or
  the configured shortcut) releases the hold for the rest of that stream, so following
  resumes at once; otherwise following resumes when the stream ends.
  */
  const streamOnScreen = messages.some((message) => message.id === SESSION_CHAT_STREAMING_ID);
  const [streamHoldReleased, setStreamHoldReleased] = useState(
    (restoredScroll?.streamOnScreen && restoredScroll.streamHoldReleased) || false
  );
  const streamHoldRef = useRef(false);
  streamHoldRef.current = streamOnScreen && !streamHoldReleased;
  const readerScrolledInHoldRef = useRef(restoredScroll?.readerScrolledInHold ?? false);
  const programmaticScrollTopRef = useRef<number | null>(null);
  const virtualScrollToEndRef = useRef<(() => void) | null>(null);
  const setViewportScrollTop = useCallback((top: number): void => {
    const viewport = viewportRef.current;
    if (!viewport) {
      return;
    }
    const next = Math.max(0, Math.min(top, viewport.scrollHeight - viewport.clientHeight));
    if (Math.abs(next - viewport.scrollTop) < 1) {
      return;
    }
    programmaticScrollTopRef.current = next;
    viewport.scrollTop = next;
  }, []);
  const anchorStreamTop = useCallback((): void => {
    const viewport = viewportRef.current;
    const row = contentRef.current?.querySelector<HTMLElement>(`[data-message-id="${SESSION_CHAT_STREAMING_ID}"]`);
    if (!viewport || !row) {
      return;
    }
    const rowTop = row.getBoundingClientRect().top - viewport.getBoundingClientRect().top + viewport.scrollTop;
    setViewportScrollTop(rowTop - STREAM_HOLD_TOP_MARGIN_PX);
  }, [setViewportScrollTop]);
  const jumpToBottom = useCallback((): void => {
    resumeFileScrolling();
    streamHoldRef.current = false;
    setStreamHoldReleased(true);
    shouldFollowBottomRef.current = true;
    const viewport = viewportRef.current;
    if (viewport) {
      viewport.setAttribute(FOLLOW_BOTTOM_ATTRIBUTE, 'true');
      viewport.removeAttribute(STREAM_HOLD_ATTRIBUTE);
      setViewportScrollTop(viewport.scrollHeight);
      virtualScrollToEndRef.current?.();
      cancelScrollMomentum();
    }
  }, [cancelScrollMomentum, resumeFileScrolling, setViewportScrollTop]);
  useEffect(() => {
    if (scrollToBottomRequest > 0) {
      jumpToBottom();
    }
  }, [jumpToBottom, scrollToBottomRequest]);
  const initialStreamEffectRef = useRef(true);
  useEffect(() => {
    if (!scrollRestorationControlRef.current.finished) {
      if (!restoredScroll?.followBottom) readerScrolledInHoldRef.current = true;
      return;
    }
    if (initialStreamEffectRef.current) {
      initialStreamEffectRef.current = false;
      if (restoredScroll && restoredScroll.streamOnScreen === streamOnScreen) return;
      if (restoredScroll && !streamOnScreen && !restoredScroll.followBottom) return;
    }
    if (streamOnScreen) {
      readerScrolledInHoldRef.current = false;
      // The pill must be reachable while the hold keeps the viewport off the end.
      viewportRef.current?.setAttribute(FOLLOW_BOTTOM_ATTRIBUTE, 'false');
      viewportRef.current?.setAttribute(STREAM_HOLD_ATTRIBUTE, 'true');
      anchorStreamTop();
      return;
    }
    viewportRef.current?.removeAttribute(STREAM_HOLD_ATTRIBUTE);
    const resume = !readerScrolledInHoldRef.current || streamHoldReleased;
    readerScrolledInHoldRef.current = false;
    setStreamHoldReleased(false);
    const viewport = viewportRef.current;
    if (resume && viewport && !composerCollapsedRef.current && !fileNavigationActiveRef.current) {
      shouldFollowBottomRef.current = true;
      viewport.setAttribute(FOLLOW_BOTTOM_ATTRIBUTE, 'true');
      setViewportScrollTop(viewport.scrollHeight);
    }
    // streamHoldReleased is read for the resume decision only when the stream ends.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [anchorStreamTop, setViewportScrollTop, streamOnScreen]);
  const [markdownToSave, setMarkdownToSave] = useState<string | null>(null);
  const [rewindRequest, setRewindRequest] = useState<SessionChatRewindRequest | null>(null);
  const anchorExpandedAreaTop = useCallback(
    (target: HTMLElement | null): void => {
      cancelScrollRestoration();
      // Opening a disclosure is explicit navigation away from the newest row.
      // Clear bottom-follow before its resize can pin the viewport to the end.
      shouldFollowBottomRef.current = false;
      anchorSessionChatExpansionTop(target);
    },
    [cancelScrollRestoration]
  );
  const navigateHistory = useCallback((): void => {
    cancelScrollRestoration();
    shouldFollowBottomRef.current = false;
    if (streamHoldRef.current) readerScrolledInHoldRef.current = true;
    refreshScrollPolicy((revision) => revision + 1);
    viewportRef.current?.setAttribute(FOLLOW_BOTTOM_ATTRIBUTE, 'false');
  }, [cancelScrollRestoration]);

  useLayoutEffect(() => {
    const viewport = viewportRef.current;
    viewport?.addEventListener(SESSION_CHAT_HISTORY_NAVIGATION_EVENT, navigateHistory);
    return () => viewport?.removeEventListener(SESSION_CHAT_HISTORY_NAVIGATION_EVENT, navigateHistory);
  }, [navigateHistory]);

  /** CDXC:SessionChat 2026-09-13 DECISION:
   * User: keep the latest message visible when working indicators or other components above the composer appear, while preserving history navigation and the streaming hold.
   * The composer changes the transcript's bottom padding, which content-box observation misses; observe the border box and retain follow intent through programmatic adjustments.
   */
  useLayoutEffect(() => {
    const content = contentRef.current;
    const viewport = viewportRef.current;
    if (!content || !viewport) {
      return;
    }
    const observer = new ResizeObserver(() => {
      if (!scrollRestorationControlRef.current.finished) return;
      if (streamHoldRef.current) {
        if (!readerScrolledInHoldRef.current) {
          anchorStreamTop();
        }
        return;
      }
      if (shouldFollowBottomRef.current && !composerCollapsedRef.current && !fileNavigationActiveRef.current) {
        setViewportScrollTop(viewport.scrollHeight);
      }
    });
    observer.observe(content, { box: 'border-box' });
    observer.observe(viewport);
    viewport.setAttribute(FOLLOW_BOTTOM_ATTRIBUTE, shouldFollowBottomRef.current ? 'true' : 'false');
    return () => observer.disconnect();
  }, [anchorStreamTop, setViewportScrollTop]);

  const loadEarlierIfNearTop = useCallback(
    (viewport: HTMLDivElement): void => {
      if (restoringScrollRef.current || scrollRestorationControlRef.current.blocked) return;
      if (viewport.scrollTop < LOAD_EARLIER_SCROLL_TOP_PX && hasMoreRef.current && !loadingEarlierRef.current) {
        onLoadEarlier();
      }
    },
    [onLoadEarlier]
  );

  /*
   * A scroll that reaches the top while a page is already loading cannot start
   * another request. Re-check after that page settles: prepend preservation may
   * move the reader away from the boundary, but if it remains near the top the
   * next page starts without requiring another wheel event or a manual button.
   * This also fills a viewport whose initial transcript is too short to scroll.
   */
  useEffect(() => {
    const viewport = viewportRef.current;
    if (viewport) {
      loadEarlierIfNearTop(viewport);
    }
  }, [hasMore, loadingEarlier, loadEarlierIfNearTop, messages.length]);

  // Auto-load older history before the reader reaches the top; the virtualizer's
  // keyed prepend compensation keeps the visible rows in place when the earlier
  // page lands.
  const handleScroll = useCallback(
    (event: React.UIEvent<HTMLDivElement>): void => {
      const viewport = event.currentTarget;
      if (restoringScrollRef.current) return;
      if (
        programmaticScrollTopRef.current !== null &&
        Math.abs(viewport.scrollTop - programmaticScrollTopRef.current) < 1
      ) {
        programmaticScrollTopRef.current = null;
        loadEarlierIfNearTop(viewport);
        return;
      }
      if (streamHoldRef.current) {
        readerScrolledInHoldRef.current = true;
      }
      const followBottom =
        !fileNavigationActiveRef.current &&
        viewport.scrollHeight - viewport.scrollTop - viewport.clientHeight <= AUTO_SCROLL_EDGE_THRESHOLD_PX;
      if (shouldFollowBottomRef.current !== followBottom) {
        shouldFollowBottomRef.current = followBottom;
        refreshScrollPolicy((revision) => revision + 1);
      }
      viewport.setAttribute(FOLLOW_BOTTOM_ATTRIBUTE, shouldFollowBottomRef.current ? 'true' : 'false');
      loadEarlierIfNearTop(viewport);
    },
    [loadEarlierIfNearTop]
  );

  const normalizedMessages = useMemo(
    () =>
      normalizeChatTranscript(messages),
    [messages]
  );
  const rendered = useMemo(
    () =>
      foldChatTranscript(normalizedMessages),
    [normalizedMessages]
  );
  const renderItems = useMemo(
    () => completedWorkRenderItems(rendered, isWorking, interactedMessageIds, normalizedMessages),
    [isWorking, rendered, interactedMessageIds, normalizedMessages]
  );
  const copyableAssistantMessageIds = useMemo(
    () => finalAssistantMessageIds(rendered, isWorking),
    [isWorking, rendered]
  );
  const summaryTurns = useMemo(
    () => summaryModeTurns(rendered, copyableAssistantMessageIds, isWorking),
    [copyableAssistantMessageIds, isWorking, rendered]
  );

  const pendingMessageId = useMemo(() => {
    for (let index = rendered.length - 1; index >= 0; index -= 1) {
      const candidate = rendered[index];
      if (candidate && isSessionChatPendingMessageId(candidate.id)) {
        return candidate.id;
      }
    }
    return null;
  }, [rendered]);

  const virtualRows = useMemo(
    () =>
      summaryMode
        ? summaryTurns.map((turn) => ({ key: `summary:${turn.user.id}`, messageId: turn.user.id }))
        : renderItems.map((item) =>
            item.kind === 'message'
              ? { key: item.message.id, messageId: item.message.id }
              : { key: `completed-work:${item.turn.user.id}`, messageId: item.turn.final?.id ?? item.turn.user.id }
          ),
    [renderItems, summaryMode, summaryTurns]
  );
  const virtualTranscript = useSessionChatVirtualTranscript({
    rows: virtualRows,
    viewportRef,
    contentRef,
    snapshot: restoredScroll,
    programmaticScrollTopRef,
    canFollow:
      shouldFollowBottomRef.current &&
      scrollRestorationControlRef.current.finished &&
      !composerCollapsed &&
      !fileNavigationActive &&
      (!streamOnScreen || streamHoldReleased),
    pinnedMessageIds: [
      ...(!scrollRestorationControlRef.current.finished && restoredScroll?.anchorId ? [restoredScroll.anchorId] : []),
      ...(streamHoldRef.current && !readerScrolledInHoldRef.current ? [SESSION_CHAT_STREAMING_ID] : []),
    ],
  });
  virtualScrollToEndRef.current = virtualTranscript.scrollToEnd;

  /** CDXC:SessionChat 2026-09-14 DECISION:
   * User: after sending from the bottom, scroll to the bottom once the message appears so the Scroll to bottom button does not appear.
   * Restore follow intent before scrolling and use an immediate scroll: intermediate smooth-scroll events could disable following while the new row was still being measured.
   */
  const previousPendingMessageIdRef = useRef(restoredScroll ? pendingMessageId : null);
  useLayoutEffect(() => {
    const previous = previousPendingMessageIdRef.current;
    previousPendingMessageIdRef.current = pendingMessageId;
    if (pendingMessageId === null || previous === pendingMessageId) return;
    resumeFileScrolling();
    shouldFollowBottomRef.current = true;
    viewportRef.current?.setAttribute(FOLLOW_BOTTOM_ATTRIBUTE, 'true');
    refreshScrollPolicy((revision) => revision + 1);
    virtualTranscript.scrollToEnd({ behavior: 'auto' });
    cancelScrollMomentum();
  }, [cancelScrollMomentum, pendingMessageId, resumeFileScrolling, virtualTranscript.scrollToEnd]);

  useSessionChatScrollRestoration({
    snapshot: restoredScroll,
    viewportRef,
    contentRef,
    restoringRef: restoringScrollRef,
    controlRef: scrollRestorationControlRef,
    earlierPageCursor,
    oldestMessageId: messages[0]?.id,
    messagesRevision: virtualTranscript.virtualItems,
    loadedMessageIds: virtualTranscript.rowIndexes,
    revealMessage: virtualTranscript.scrollToMessage,
    hasMore,
    loadingEarlier,
    onLoadEarlier,
    setViewportScrollTop,
  });

  const scrollStateRef = useRef({ streamOnScreen, streamHoldReleased, interactedMessageIds });
  scrollStateRef.current = { streamOnScreen, streamHoldReleased, interactedMessageIds };
  useLayoutEffect(() => {
    const viewport = viewportRef.current;
    const content = contentRef.current;
    if (!viewport || !content) return;
    const capture = () => {
      if (viewport.clientHeight === 0 || !scrollRestorationControlRef.current.finished) return;
      const rows = transcriptRowElements(content);
      const top = viewport.getBoundingClientRect().top;
      let low = 0;
      let high = rows.length;
      while (low < high) {
        const middle = (low + high) >>> 1;
        if (rows[middle]!.getBoundingClientRect().bottom <= top) low = middle + 1;
        else high = middle;
      }
      const anchor = rows[low] as HTMLElement | undefined;
      interactionState.scroll = {
        top: viewport.scrollTop,
        anchorId: anchor?.dataset.messageId ?? null,
        anchorOffset: anchor ? anchor.getBoundingClientRect().top - top : 0,
        followBottom: shouldFollowBottomRef.current,
        streamOnScreen: scrollStateRef.current.streamOnScreen,
        streamHoldReleased: scrollStateRef.current.streamHoldReleased,
        readerScrolledInHold: readerScrolledInHoldRef.current,
        fileNavigationActive: fileNavigationActiveRef.current,
        interactedMessageIds: [...scrollStateRef.current.interactedMessageIds],
      };
    };
    const save = () => {
      capture();
      persistSessionChatInteractions(interactionState);
    };
    let captureFrame = 0;
    let saveTimer: ReturnType<typeof setTimeout> | undefined;
    const scheduleSave = () => {
      if (!captureFrame)
        captureFrame = requestAnimationFrame(() => {
          captureFrame = 0;
          capture();
        });
      if (saveTimer !== undefined) clearTimeout(saveTimer);
      saveTimer = setTimeout(save, 150);
    };
    viewport.addEventListener('scroll', scheduleSave, { passive: true });
    window.addEventListener('pagehide', save);
    document.addEventListener('visibilitychange', save);
    return () => {
      cancelAnimationFrame(captureFrame);
      clearTimeout(saveTimer);
      viewport.removeEventListener('scroll', scheduleSave);
      document.removeEventListener('visibilitychange', save);
      save();
      window.removeEventListener('pagehide', save);
    };
  }, [interactionState, restoredScroll, setViewportScrollTop]);

  return (
    <SessionChatHistoryReaderContext value={readHistory}>
      <SessionChatInteractionProvider state={interactionState}>
        <SessionChatFileChangeInteractionContext value={reportFileInteraction}>
          <SessionChatVirtualScrollerContext value={virtualTranscript}>
            <MessageScroller className={cn('flex-1', summaryTurns.length >= 2 && 'ghostex-chat-has-minimap')}>
              {messages.length === 0 && hasMore ? (
                <button
                  type='button'
                  className='p-3 text-sm text-muted-foreground'
                  disabled={loadingEarlier}
                  onClick={onLoadEarlier}
                >
                  {loadingEarlier ? 'Loading earlier turns…' : 'Load earlier turns'}
                </button>
              ) : null}
              <SessionChatMinimap onNavigate={navigateHistory} turns={summaryTurns} />
              {/* outline-none: Chromium makes scrollers keyboard-focusable and paints
            its default focus ring on them; a transcript is not a control. */}
              <MessageScrollerViewport
                data-app-scrollbar-owner='chat'
                className='outline-none'
                onClickCapture={(event) => {
                  if (
                    event.target instanceof Element &&
                    event.target.closest(
                      'button[aria-expanded], [role="button"][aria-expanded], .ghostex-chat-expansion-rail'
                    )
                  )
                    navigateHistory();
                }}
                onWheel={(event) => {
                  resumeFileScrolling();
                  if (event.deltaY < 0) navigateHistory();
                }}
                onTouchMove={() => {
                  resumeFileScrolling();
                  navigateHistory();
                }}
                onPointerDown={(event) => {
                  if (event.target === event.currentTarget) resumeFileScrolling();
                }}
                onKeyDown={(event) => {
                  if (
                    !event.shiftKey &&
                    !(
                      event.target instanceof Element &&
                      event.target.closest('input, textarea, [contenteditable="true"]')
                    ) &&
                    (event.key === 'Home' || event.key === 'End')
                  ) {
                    event.preventDefault();
                    resumeFileScrolling();
                    if (event.key === 'End') jumpToBottom();
                    else {
                      navigateHistory();
                      virtualTranscript.virtualizer.scrollToOffset(0, { behavior: 'auto' });
                    }
                    return;
                  }
                  if (['ArrowUp', 'ArrowDown', 'PageUp', 'PageDown', 'Home', 'End'].includes(event.key))
                    resumeFileScrolling();
                }}
                onScroll={handleScroll}
                ref={viewportRef}
              >
                <MessageScrollerContent className='mx-auto w-full max-w-3xl' ref={contentRef}>
                  {summaryMode
                    ? virtualTranscript.virtualItems.map((virtualItem) => {
                        const turn = summaryTurns[virtualItem.index]!;
                        return (
                          <MessageScrollerItem key={virtualItem.key} messageId={turn.user.id} virtualItem={virtualItem}>
                            <MessageRow
                              message={turn.user}
                              onRetryStartupSend={onRetryStartupSend}
                              onRemoveStartupSend={onRemoveStartupSend}
                              onSavePrompt={onSavePrompt}
                              {...(rewindToMessage && canRewind ? { onRewind: setRewindRequest } : {})}
                              showAssistantCopy={false}
                              verboseMode={verboseMode}
                            />
                            {turn.final ? (
                              <SessionChatDisclosure
                                stateKey={`summary-reply:${turn.user.id}`}
                                key='agent-reply'
                                label='Agent reply'
                                onExpand={anchorExpandedAreaTop}
                              >
                                <MessageRow
                                  message={turn.final}
                                  {...(onAnnotateMessage ? { onAnnotate: onAnnotateMessage } : {})}
                                  {...(saveMessageMarkdown && listMessageMarkdownPaths
                                    ? { onSaveMarkdown: setMarkdownToSave }
                                    : {})}
                                  showAssistantCopy={copyableAssistantMessageIds.has(turn.final?.id)}
                                  verboseMode={verboseMode}
                                />
                              </SessionChatDisclosure>
                            ) : turn.active ? (
                              <SessionChatDisclosure
                                stateKey={`summary-work:${turn.user.id}`}
                                key='active-work'
                                label='Active work'
                                onExpand={anchorExpandedAreaTop}
                              >
                                {turn.activeWork.map((message, index) => (
                                  <MessageRow
                                    isStreaming={index === turn.activeWork.length - 1}
                                    key={message.id}
                                    message={message}
                                    showAssistantCopy={false}
                                    verboseMode={verboseMode}
                                  />
                                ))}
                              </SessionChatDisclosure>
                            ) : null}
                          </MessageScrollerItem>
                        );
                      })
                    : virtualTranscript.virtualItems.map((virtualItem) => {
                        const index = virtualItem.index;
                        const item = renderItems[index]!;
                        return (
                          <MessageScrollerItem
                            virtualItem={virtualItem}
                            key={item.kind === 'message' ? item.message.id : `completed-work:${item.turn.user.id}`}
                            messageId={
                              item.kind === 'message' ? item.message.id : (item.turn.final?.id ?? item.turn.user.id)
                            }
                          >
                            {item.kind === 'message' ? (
                              <MessageRow
                                /*
                                 * Only the newest row can still be growing, and only while
                                 * the agent is working: transcript tailing appends to the
                                 * last message, and the synthetic streaming preview row is
                                 * always last when it exists. Earlier rows are settled, so
                                 * their code fences are safe to highlight and cache.
                                 * `completedWorkRenderItems` never folds the active
                                 * response while working, so a "completed-work" item is
                                 * settled by construction and keeps the default
                                 * `isStreaming={false}`.
                                 */
                                isStreaming={isWorking && index === renderItems.length - 1}
                                message={item.message}
                                onRetryStartupSend={onRetryStartupSend}
                                onRemoveStartupSend={onRemoveStartupSend}
                                onSavePrompt={onSavePrompt}
                                {...(onAnnotateMessage ? { onAnnotate: onAnnotateMessage } : {})}
                                {...(rewindToMessage && canRewind ? { onRewind: setRewindRequest } : {})}
                                {...(saveMessageMarkdown && listMessageMarkdownPaths
                                  ? { onSaveMarkdown: setMarkdownToSave }
                                  : {})}
                                showAssistantCopy={copyableAssistantMessageIds.has(item.message.id)}
                                verboseMode={verboseMode}
                              />
                            ) : (
                              <CompletedWork
                                onExpand={anchorExpandedAreaTop}
                                {...(onAnnotateMessage ? { onAnnotate: onAnnotateMessage } : {})}
                                {...(saveMessageMarkdown && listMessageMarkdownPaths
                                  ? { onSaveMarkdown: setMarkdownToSave }
                                  : {})}
                                showAssistantCopy={copyableAssistantMessageIds.has(item.turn.final?.id ?? '')}
                                turn={item.turn}
                                verboseMode={verboseMode}
                              />
                            )}
                          </MessageScrollerItem>
                        );
                      })}
                </MessageScrollerContent>
              </MessageScrollerViewport>
              <SessionChatScrollbar
                viewportRef={viewportRef}
                contentRef={contentRef}
                onNavigate={() => {
                  cancelScrollMomentum();
                  resumeFileScrolling();
                  navigateHistory();
                }}
              />
              {/* CDXC:SessionChat 2026-09-11 DECISION:
              User: the scroll-to-bottom pill shows the configured shortcut so the
              end is reachable from the keyboard at any time; keep it small, no icon,
              fully circular. */}
              <SessionChatScrollBottomButton
                contentRef={contentRef}
                edgeThreshold={AUTO_SCROLL_EDGE_THRESHOLD_PX}
                onJump={jumpToBottom}
                shortcutLabel={scrollToBottomShortcutLabel}
                viewportRef={viewportRef}
              />
            </MessageScroller>
            {saveMessageMarkdown && listMessageMarkdownPaths ? (
              <SessionChatSaveMarkdownDialog
                listExistingPaths={listMessageMarkdownPaths}
                markdown={markdownToSave ?? ''}
                onOpenChange={(open) => {
                  if (!open) {
                    setMarkdownToSave(null);
                  }
                }}
                open={markdownToSave !== null}
                save={saveMessageMarkdown}
                sessionTitle={sessionTitle}
                theme={theme}
              />
            ) : null}
            {rewindToMessage ? (
              <SessionChatRewindDialog
                agent={rewindAgent}
                onOpenChange={(open) => {
                  if (!open) {
                    setRewindRequest(null);
                  }
                }}
                {...(onRewound ? { onRewound } : {})}
                request={rewindRequest}
                rewind={rewindToMessage}
                theme={theme}
              />
            ) : null}
          </SessionChatVirtualScrollerContext>
        </SessionChatFileChangeInteractionContext>
      </SessionChatInteractionProvider>
    </SessionChatHistoryReaderContext>
  );
}

import { MessageRow } from './rows';
