import { cn } from '@/packages/components/utils';
import {
  IconAlertTriangle,
  IconArrowBackUp,
  IconCheck,
  IconChevronRight,
  IconCopy,
  IconFile,
  IconGitBranch,
  IconInfoCircle,
  IconPhoto,
  IconSparkles,
  IconMessagePlus,
} from '@tabler/icons-react';
import { memo, useContext, useId, useRef } from 'react';
import {
  Attachment,
  AttachmentContent,
  AttachmentMedia,
  AttachmentTitle,
  AttachmentTrigger,
} from '../../../components/ui/attachment';
import { Bubble, BubbleContent } from '../../../components/ui/bubble';
import { Button } from '../../../components/ui/button';
import { Marker, MarkerContent, MarkerIcon } from '../../../components/ui/marker';
import { Message, MessageContent, MessageFooter } from '../../../components/ui/message';
import { SESSION_CHAT_FORK_BOUNDARY_ID_PREFIX, type SessionChatMessage } from '../../../shared/session-chat';
import { SessionChatAgentMessageCard, parseSessionChatAgentMessage } from '../session-chat-agent-message-card';
import { SessionChatExpansion, centerSessionChatExpansion } from '../session-chat-expansion';
import { SessionChatFileChangeCards } from '../session-chat-file-change-card';
import { splitSessionChatFileChanges } from '../session-chat-file-changes';
import { SessionChatGoalCard } from '../session-chat-goal-card';
import {
  SessionChatImageReference,
  SessionChatInlineImage,
  useSessionChatImageViewer,
} from '../session-chat-image-viewer';
import { SessionChatInteractionScope, useSessionChatDisclosureState } from '../session-chat-interaction-state';
import { SessionChatMarkdown } from '../session-chat-markdown';
import { SessionChatAgentLineBreaksContext } from '../session-chat-presentation-provider';
import { sameSessionChatMessage } from '../session-chat-message-equality';
import {
  sessionChatSuppressedTurnPresentation,
  type SessionChatStatusRow,
  type SessionChatStatusTone,
} from '../session-chat-noise';
import { SESSION_CHAT_CODEX_GOAL_ID_PREFIX, isSessionChatPendingMessageId } from '../session-chat-pending';
import {
  SessionChatQuestionExchangeCard,
  answeredSessionChatQuestionExchange,
  type SessionChatQuestionExchange,
} from '../session-chat-question-exchange';
import { type SessionChatRewindRequest } from '../session-chat-rewind-dialog';
import { SessionChatSavePromptButton } from '../session-chat-save-prompt-button';
import { SessionChatScrollCap } from '../session-chat-scroll-cap';
import { SessionChatStartupSendStatus, type SessionChatStartupSendActions } from '../session-chat-startup-send-status';
import { isSessionChatTerminalToolMessage, sessionChatTerminalToolActivity } from '../session-chat-terminal-status';
import { SessionChatTerminalToolRow } from '../session-chat-terminal-tool-row';
import { pairSessionChatToolBlocks, splitSessionChatBlocks } from '../session-chat-tool-fold';
import { SessionChatToolRun } from '../session-chat-tool-run';
import { SessionChatUserMessageLayout } from '../session-chat-user-message-layout';
import '../session-chat-agent-tools-disclosure.css';
import { playCopySound } from '../../copy-sound';
export const PASTED_IMAGE_NAME = /^ghostex-paste-.+\.png$/i;
export function isPastedImagePath(path: string | undefined): boolean {
  if (!path) {
    return false;
  }
  const segment = path.split(/[\\/]/).at(-1) ?? '';
  return PASTED_IMAGE_NAME.test(segment);
}

export function imageChipLabel(block: { alt?: string; path?: string; url?: string }): string {
  if (isPastedImagePath(block.path)) {
    return 'Pasted image';
  }
  if (block.path) {
    return block.path.split(/[\\/]/).at(-1) ?? block.path;
  }
  return block.alt ?? block.url ?? 'Image';
}

export function ImageAttachments({
  blocks,
  className,
}: {
  blocks: readonly { alt?: string; path?: string; url?: string }[];
  className?: string;
}) {
  const viewer = useSessionChatImageViewer();
  if (blocks.length === 0) {
    return null;
  }
  /*
  A picture shared in the conversation shows as the picture. The named chip
  stays as the honest stand-in for one that cannot be read here — a host with
  no image transport, or a file that has since gone — so a turn never renders
  a broken image well.
  */
  return (
    <div className={cn('flex min-w-0 flex-wrap gap-2 py-1', className)}>
      {blocks.map((block, index) => {
        const target = {
          ...(block.path !== undefined ? { path: block.path } : {}),
          ...(block.url !== undefined ? { url: block.url } : {}),
          ...(block.alt !== undefined ? { alt: block.alt } : {}),
        };
        const label = imageChipLabel(block);
        const chip = (
          <Attachment size='xs'>
            <AttachmentMedia>
              <IconPhoto aria-hidden='true' stroke={1.8} />
            </AttachmentMedia>
            <AttachmentContent>
              <AttachmentTitle>{label}</AttachmentTitle>
            </AttachmentContent>
            {viewer?.canOpen(target) === true ? (
              <AttachmentTrigger aria-label={`View ${label}`} onClick={() => viewer?.open(target)} />
            ) : null}
          </Attachment>
        );
        return <SessionChatInlineImage fallback={chip} key={index} target={{ ...target, alt: target.alt ?? label }} />;
      })}
    </div>
  );
}

export function UserImageThumbnails({ blocks }: { blocks: readonly { alt?: string; path?: string; url?: string }[] }) {
  if (blocks.length === 0) {
    return null;
  }
  return (
    <div className='flex min-w-0 flex-wrap justify-end gap-1.5 py-1'>
      {blocks.map((block, index) => (
        <SessionChatImageReference
          key={block.path ?? block.url ?? index}
          label={block.alt?.trim() || `Image #${index + 1}`}
          target={{
            ...(block.path !== undefined ? { path: block.path } : {}),
            ...(block.url !== undefined ? { url: block.url } : {}),
            ...(block.alt !== undefined ? { alt: block.alt } : {}),
          }}
        />
      ))}
    </div>
  );
}

export function CopyFooter({
  anchoredToAssistantMarker = false,
  className,
  markdown,
  onAnnotate,
  onRewind,
  onSaveMarkdown,
  onSavePrompt,
}: {
  anchoredToAssistantMarker?: boolean;
  className?: string;
  markdown: string;
  /**
   * CDXC:Docs 2026-09-15 DECISION:
   * User: an agent reply can be annotated like a document. The button is titled "Reply by Annotating" and sits between Copy message and Save to md in the final reply's rail. Set only by hosts with a Docs review (the desktop app); the reply opens there and the feedback comes back to this session.
   */
  onAnnotate?: (markdown: string) => void;
  /** Opens the rewind confirmation for this prompt (user rows only). */
  onRewind?: () => void;
  onSaveMarkdown?: (markdown: string) => void;
  onSavePrompt?: (prompt: string) => Promise<void>;
}) {
  const canSaveMarkdown = markdown.split(/\r?\n/u).filter((line) => line.trim().length > 0).length > 1;
  return (
    <MessageFooter
      className={cn(
        'px-0',
        anchoredToAssistantMarker
          ? 'ghostex-chat-final-actions'
          : 'opacity-0 transition-opacity group-hover/message:opacity-100 group-focus-within/message:opacity-100',
        className
      )}
    >
      <Button
        aria-label='Copy message'
        className={anchoredToAssistantMarker ? 'ghostex-chat-final-action ghostex-chat-final-action-copy' : undefined}
        onClick={() => {
          playCopySound();
          void navigator.clipboard.writeText(markdown);
        }}
        size='icon-xs'
        title='Copy message'
        variant='ghost'
      >
        <IconCopy aria-hidden='true' data-icon='inline-start' stroke={1.9} />
      </Button>
      {onSavePrompt ? <SessionChatSavePromptButton prompt={markdown} onSave={onSavePrompt} /> : null}
      {onRewind ? (
        <Button aria-label='Rewind to here' onClick={onRewind} size='icon-xs' title='Rewind to here' variant='ghost'>
          <IconArrowBackUp aria-hidden='true' data-icon='inline-start' stroke={1.9} />
        </Button>
      ) : null}
      {onAnnotate && markdown.trim().length > 0 ? (
        <Button
          aria-label='Reply by Annotating'
          className={
            anchoredToAssistantMarker ? 'ghostex-chat-final-action ghostex-chat-final-action-annotate' : undefined
          }
          onClick={() => onAnnotate(markdown)}
          size='icon-xs'
          title='Reply by Annotating'
          variant='ghost'
        >
          <IconMessagePlus aria-hidden='true' data-icon='inline-start' stroke={1.9} />
        </Button>
      ) : null}
      {onSaveMarkdown && canSaveMarkdown ? (
        <Button
          aria-label='Save message to Markdown'
          className={anchoredToAssistantMarker ? 'ghostex-chat-final-action ghostex-chat-final-action-save' : undefined}
          onClick={() => onSaveMarkdown(markdown)}
          size='icon-xs'
          title='Save to md'
          variant='ghost'
        >
          <IconFile aria-hidden='true' data-icon='inline-start' stroke={1.9} />
        </Button>
      ) : null}
    </MessageFooter>
  );
}

/** Marks a prompt the agent has accepted but not started on yet. */
export function QueuedLabel() {
  return (
    <div className='ghostex-chat-queued-label self-end' data-queued='true'>
      Queued
    </div>
  );
}

/**
 * A harness-injected turn the terminal prints too: one muted line that expands
 * to the verbatim text. Collapsed by default so orchestration chatter never
 * buries the conversation, present so it is never silently missing.
 */
export function SuppressedTurn({ label, text }: { label: string; text: string }) {
  const [expanded, setExpanded] = useSessionChatDisclosureState('suppressed-turn', false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  return (
    <div className='flex w-full min-w-0 flex-col gap-1.5 pb-2'>
      <button
        aria-expanded={expanded}
        className='ghostex-chat-suppressed-trigger self-start'
        // Opts out of the sidebar's legacy `button:where(:not([data-slot]))`
        // base, which otherwise paints a 1px app border around the marker.
        data-slot='session-chat-suppressed-trigger'
        onClick={() => {
          if (!expanded) {
            centerSessionChatExpansion(triggerRef.current);
          }
          setExpanded((value) => !value);
        }}
        ref={triggerRef}
        type='button'
      >
        <span className='ghostex-chat-marker-slot'>
          <IconChevronRight
            aria-hidden='true'
            className={cn('ghostex-chat-disclosure-chevron', expanded && 'is-open')}
            stroke={2}
          />
        </span>
        <span className='truncate'>{label}</span>
      </button>
      {expanded ? (
        <SessionChatExpansion label={`Collapse ${label}`} onCollapse={() => setExpanded(false)}>
          <div className='min-w-0 whitespace-pre-wrap break-words rounded-md border border-border/60 bg-muted/30 px-2.5 py-2 font-mono text-[11px] leading-relaxed text-muted-foreground'>
            {text}
          </div>
        </SessionChatExpansion>
      ) : null}
    </div>
  );
}

/**
 * A harness turn short enough to read in place: one muted line of prose with
 * the marker's label as its lead-in, styled like a reasoning line. Beats a
 * chevron the reader has to click to learn the task exited 0.
 */
export function InlineSuppressedTurn({ label, text }: { label: string; text: string }) {
  return (
    <div className='ghostex-chat-suppressed-inline'>
      <div>
        <span className='ghostex-chat-suppressed-inline-label'>{label}</span>
        {text}
      </div>
    </div>
  );
}

export const STATUS_TONE_ICON: Record<SessionChatStatusTone, { Icon: typeof IconCheck; className: string }> = {
  ok: { Icon: IconCheck, className: 'bg-emerald-500/15 text-emerald-400' },
  error: {
    Icon: IconAlertTriangle,
    className: 'bg-destructive/15 text-destructive',
  },
  neutral: { Icon: IconInfoCircle, className: 'bg-muted text-muted-foreground' },
};

/**
 * The one durable row for a completed action — a model/effort change, a
 * compaction, a background task reporting back. Non-expandable on purpose:
 * the label already says everything the row is for.
 */
export function StatusRow({
  label,
  tone = 'ok',
  detail,
}: {
  label: string;
  tone?: SessionChatStatusTone;
  detail?: string;
}) {
  const { Icon, className } = STATUS_TONE_ICON[tone];
  return (
    <div className='inline-flex max-w-full min-w-0 items-start gap-2 rounded-xl border border-border/60 bg-muted/35 px-3 py-1.5 text-xs font-medium text-muted-foreground'>
      {/* Tone badge: a badge-tier glyph in a tinted round, top-aligned with
          the first text line so multi-line rows keep it at the top left.
          CDXC:SessionChat 2026-09-04 DECISION: User: the row is less rounded
          than a pill (0.75rem, same as the terminal activity card) so a
          wrapped two-line row does not read as a lozenge. */}
      <span className={cn('flex size-4 shrink-0 items-center justify-center rounded-full', className)}>
        <Icon aria-hidden='true' className='ghostex-chat-glyph-badge' />
      </span>
      <span className='min-w-0 [overflow-wrap:anywhere] [text-wrap:pretty]'>
        {label}
        {detail ? (
          <span className='ml-1.5 inline-block whitespace-nowrap rounded-md border border-border/60 px-1.5 font-mono text-[0.6875rem] font-normal tabular-nums'>
            {detail}
          </span>
        ) : null}
      </span>
    </div>
  );
}

/** One row per status; a turn carrying several reports each of them. */
export function StatusRows({ statuses }: { statuses: readonly SessionChatStatusRow[] }) {
  return (
    <div className='flex w-full min-w-0 flex-col items-start gap-1.5 pb-3'>
      {statuses.map((status, index) => (
        <StatusRow key={index} label={status.label} tone={status.tone} detail={status.detail} />
      ))}
    </div>
  );
}

/**
 * Reasoning turn ("thinking"). The body is real markdown — a reasoning summary
 * can carry lists, tables, and code just like an answer, and the old regex
 * strip flattened all of it into one gapless run of lines.
 *
 * `plainReasoningText` still strips, but only for the heading on the
 * disclosure trigger: markdown cannot render inside a <button> (its links and
 * the code block's copy control are interactive). It keeps line structure so
 * the caller can rebuild paragraphs from it.
 */
import { plainReasoningText, plainReasoningTeaser, NON_HOISTABLE_REASONING_LINE, splitReasoningHeadline, USER_TURN_SEPARATOR, normalizeUserMessageMarkdown, userTurnCopyMarkdown } from '@/packages/shared/session-chat-presentation/message-text';
export { plainReasoningText, plainReasoningTeaser, NON_HOISTABLE_REASONING_LINE, splitReasoningHeadline, USER_TURN_SEPARATOR, normalizeUserMessageMarkdown, userTurnCopyMarkdown };

/**
 * Answered question cards carried by a turn's tool blocks. They are
 * conversation, not work, so every disclosure that collapses tool activity
 * (thinking rows, agent-message tool sections) renders them OUTSIDE its fold
 * and passes questionPairsAsRows to the run inside, keeping the raw pair as a
 * plain row there. Empty when the parent already hoists them.
 */
export function questionExchangesFromTools(
  tools: ReturnType<typeof splitSessionChatBlocks>['tools']
): SessionChatQuestionExchange[] {
  const out: SessionChatQuestionExchange[] = [];
  for (const pair of pairSessionChatToolBlocks(tools)) {
    const exchange = answeredSessionChatQuestionExchange(pair);
    if (exchange) {
      out.push(exchange);
    }
  }
  return out;
}

export function QuestionExchangeCards({ exchanges }: { exchanges: readonly SessionChatQuestionExchange[] }) {
  if (exchanges.length === 0) {
    return null;
  }
  return (
    <div className='grid min-w-0 gap-3 py-1.5'>
      {exchanges.map((exchange, index) => (
        <SessionChatQuestionExchangeCard exchange={exchange} key={index} />
      ))}
    </div>
  );
}

/**
 * CDXC:SessionChat 2026-09-13 DECISION:
 * User: use assistant commentary itself as the expandable heading for its tool calls, preserving the full Markdown formatting, before adding Simple mode.
 * The chevron and Markdown are siblings so links, file pills, and code controls remain independent interactive elements.
 */
export function AgentToolsDisclosure({
  isStreaming,
  markdown,
  questionPairsAsRows,
  tools,
  verboseMode,
}: {
  isStreaming: boolean;
  markdown: string;
  questionPairsAsRows: boolean;
  tools: ReturnType<typeof splitSessionChatBlocks>['tools'];
  verboseMode: boolean;
}) {
  const preserveLineBreaks = useContext(SessionChatAgentLineBreaksContext);
  const [open, setOpen] = useSessionChatDisclosureState('tools', verboseMode);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const bodyId = useId();
  const toggle = () => {
    if (!open) centerSessionChatExpansion(triggerRef.current);
    setOpen((value) => !value);
  };

  const exchanges = questionPairsAsRows ? [] : questionExchangesFromTools(tools);

  return (
    <>
      <div className='ghostex-chat-agent-tools'>
        <div
          className='ghostex-chat-agent-message ghostex-chat-agent-tools-heading'
          onClick={(event) => {
            if (
              event.defaultPrevented ||
              !(event.target instanceof Element) ||
              event.target.closest(
                'a, button, input, textarea, select, summary, pre, [role="button"], [contenteditable]'
              ) ||
              event.currentTarget.ownerDocument.getSelection()?.isCollapsed === false
            )
              return;
            toggle();
          }}
        >
          <button
            aria-controls={bodyId}
            aria-expanded={open}
            aria-label={`${open ? 'Hide' : 'Show'} tool calls for this message`}
            className='ghostex-chat-thinking-icon ghostex-chat-agent-tools-toggle'
            onClick={toggle}
            ref={triggerRef}
            type='button'
          >
            <IconChevronRight aria-hidden='true' className={cn('ghostex-chat-disclosure-chevron', open && 'is-open')} />
          </button>
          <SessionChatMarkdown isStreaming={isStreaming} markdown={markdown} preserveLineBreaks={preserveLineBreaks} />
        </div>
        <div hidden={!open} id={bodyId}>
          {open ? (
            <SessionChatExpansion
              className='ghostex-chat-thinking-detail'
              label='Collapse tool calls'
              onCollapse={() => setOpen(false)}
            >
              <SessionChatToolRun blocks={tools} questionPairsAsRows showAllRows />
            </SessionChatExpansion>
          ) : null}
        </div>
      </div>
      <QuestionExchangeCards exchanges={exchanges} />
    </>
  );
}

export function ReasoningRow({
  isStreaming,
  markdown,
  questionPairsAsRows,
  tools,
  verboseMode,
}: {
  isStreaming: boolean;
  markdown: string;
  questionPairsAsRows: boolean;
  tools: ReturnType<typeof splitSessionChatBlocks>['tools'];
  verboseMode: boolean;
}) {
  const [open, setOpen] = useSessionChatDisclosureState('reasoning', verboseMode);
  const triggerRef = useRef<HTMLButtonElement>(null);

  const renderBody = (value: string) => (
    <SessionChatScrollCap className='ghostex-chat-thinking-body'>
      <SessionChatMarkdown interactionKey='reasoning' isStreaming={isStreaming} markdown={value} />
    </SessionChatScrollCap>
  );

  // With tools, the caret owns the tool rows and any block-structured tail of
  // the reasoning; the prose itself stays on the trigger in full. Verbose mode
  // still opens it by default, so nothing is hidden from anyone who wants it.
  // Answered question cards escape the collapse — they are conversation, not
  // work.
  if (tools.length > 0) {
    const { headline, body: detail } = splitReasoningHeadline(markdown);
    const exchanges = questionPairsAsRows ? [] : questionExchangesFromTools(tools);
    return (
      <>
        <div className='ghostex-chat-thinking-row is-disclosure'>
          <button
            aria-expanded={open}
            className='ghostex-chat-thinking-trigger'
            onClick={() => {
              if (!open) {
                centerSessionChatExpansion(triggerRef.current);
              }
              setOpen((value) => !value);
            }}
            ref={triggerRef}
            type='button'
          >
            {/* The reasoning disclosure used to draw a filled clip-path triangle
              here while the tool rows below it drew a stroke chevron: two
              disclosure metaphors on one column, which read as two STATES
              rather than two rows. One glyph now, on the control tier. */}
            <span className='ghostex-chat-thinking-icon'>
              <IconChevronRight
                aria-hidden='true'
                className={cn('ghostex-chat-disclosure-chevron', open && 'is-open')}
              />
            </span>
            <span className='ghostex-chat-thinking-text'>
              {/* The reasoning's own prose, open or collapsed: expanding a turn
                reveals what follows it, it does not relabel it. */}
              <span data-ghostex-thinking-text>{headline}</span>
            </span>
          </button>
          {open ? (
            <SessionChatExpansion
              className='ghostex-chat-thinking-detail'
              label='Collapse thinking'
              onCollapse={() => setOpen(false)}
            >
              {detail.length > 0 ? renderBody(detail) : null}
              <SessionChatToolRun blocks={tools} questionPairsAsRows showAllRows />
            </SessionChatExpansion>
          ) : null}
        </div>
        <QuestionExchangeCards exchanges={exchanges} />
      </>
    );
  }

  return (
    <div className='ghostex-chat-thinking-row'>
      <div className='ghostex-chat-thinking-line'>
        <div data-ghostex-thinking-text>{renderBody(markdown)}</div>
      </div>
    </div>
  );
}

/*
Codex can fold rapid/steered inputs into one transcript turn with a line that
contains only "---". Rendering that transport separator as Markdown turns the
entire preceding paragraph into a Setext h2. It can also repeat an earlier
input after the separator (the repeated part is normally a prefix of the
combined part). Present those inputs as ordinary paragraphs and collapse the
repeated prefix instead of exposing transport syntax in the user's bubble.
*/
export const MessageRow = memo(
  function MessageRow(props: Parameters<typeof MessageRowBody>[0]) {
    return (
      <SessionChatInteractionScope id={props.message.id}>
        <MessageRowBody {...props} />
      </SessionChatInteractionScope>
    );
  },
  (previous, next) => {
    const { message: previousMessage, ...previousOptions } = previous;
    const { message: nextMessage, ...nextOptions } = next;
    return (
      sameSessionChatMessage(previousMessage, nextMessage) &&
      Object.keys({ ...previousOptions, ...nextOptions }).every(
        (key) => previousOptions[key as keyof typeof previousOptions] === nextOptions[key as keyof typeof nextOptions]
      )
    );
  }
);

export function MessageRowBody({
  hideFileChanges = false,
  isStreaming = false,
  message,
  onAnnotate,
  onRewind,
  onSaveMarkdown,
  onSavePrompt,
  onRetryStartupSend,
  onRemoveStartupSend,
  questionPairsAsRows = false,
  showAssistantCopy,
  verboseMode,
}: {
  /**
   * True while the agent is still appending to this row. Only the markdown
   * renderer's syntax highlighting reads it (a fence that is still growing must
   * not be re-tokenized per chunk, and must not enter the highlight cache).
   */
  isStreaming?: boolean;
  hideFileChanges?: boolean;
  message: SessionChatMessage;
  /** Opens this assistant reply in the host's Docs review; see `CopyFooter`. */
  onAnnotate?: (markdown: string) => void;
  /** Set only when this transcript may be rewound; see the list's prop. */
  onRewind?: (request: SessionChatRewindRequest) => void;
  onSaveMarkdown?: (markdown: string) => void;
  onSavePrompt?: (prompt: string) => Promise<void>;
  /** Set inside the expanded completed-work log, where the hoisted question
   * card already shows any answered question this message carries. */
  questionPairsAsRows?: boolean;
  showAssistantCopy: boolean;
  verboseMode: boolean;
} & SessionChatStartupSendActions) {
  const preserveLineBreaks = useContext(SessionChatAgentLineBreaksContext);
  const { prose, tools: allTools } = splitSessionChatBlocks(message.blocks);
  const { tools, changes } = splitSessionChatFileChanges(allTools);
  const fileCards = hideFileChanges ? null : <SessionChatFileChangeCards changes={changes} messageId={message.id} />;
  const markdown = prose
    .filter((block) => block.type === 'text')
    .map((block) => (block.type === 'text' ? block.text : ''))
    .join('\n\n');
  const images = prose.filter((block) => block.type === 'image-ref');

  // No ghost bubbles: skip entirely when there is nothing to show.
  if (markdown.length === 0 && images.length === 0 && tools.length === 0 && (hideFileChanges || changes.length === 0)) {
    return null;
  }

  // The pending tool row: the working strip's card shape, placed as the
  // transcript's last row, opening onto the painted tool block.
  if (isSessionChatTerminalToolMessage(message)) {
    return <SessionChatTerminalToolRow activity={sessionChatTerminalToolActivity(message)} />;
  }

  const suppressedTurn = sessionChatSuppressedTurnPresentation(message);
  if (suppressedTurn !== null) {
    if (suppressedTurn.kind === 'status') {
      return (
        <StatusRows
          statuses={suppressedTurn.statuses ?? [{ label: suppressedTurn.label, tone: suppressedTurn.tone ?? 'ok' }]}
        />
      );
    }
    if (suppressedTurn.kind === 'inline') {
      return <InlineSuppressedTurn label={suppressedTurn.label} text={suppressedTurn.text} />;
    }
    return <SuppressedTurn label={suppressedTurn.label} text={suppressedTurn.text} />;
  }

  const isUser = message.role === 'user';
  const isReasoning = message.role === 'reasoning';
  const isSystem = message.role === 'system';
  const userMarkdown = isUser ? normalizeUserMessageMarkdown(markdown) : '';
  const userCopyMarkdown = isUser ? userTurnCopyMarkdown(userMarkdown, images) : '';
  const showCopy = isUser
    ? userCopyMarkdown.length > 0
    : markdown.length > 0 && message.role === 'assistant' && showAssistantCopy;
  /*
  CDXC:SessionChat 2026-09-02:
  A rewind target is a prompt the agent has actually taken: the same "genuine
  user prompt" test the transcript already uses for its turn boundaries (a
  suppressed harness turn returned above, a `queued` row is still held by the
  agent's queue) plus the optimistic local echo, which has no transcript row
  for the daemon to rewind to yet.
  */
  const showRewind =
    isUser &&
    onRewind !== undefined &&
    showCopy &&
    message.queued !== true &&
    !message.startupDelivery &&
    !isSessionChatPendingMessageId(message.id);

  const autoNamedTitle =
    message.id.startsWith('app-command:') &&
    message.blocks[0]?.type === 'text' &&
    message.blocks[0].text === 'Ghostex auto named this session' &&
    message.blocks[1]?.type === 'text'
      ? message.blocks[1].text.trim()
      : '';
  if (isSystem && autoNamedTitle) {
    return (
      <Marker className='ghostex-chat-status-card'>
        <div className='inline-flex max-w-full items-start gap-2.5 rounded-2xl border border-border/70 bg-muted/40 px-3.5 py-2.5 shadow-sm'>
          <IconSparkles aria-hidden='true' className='mt-0.5 size-4 shrink-0 text-muted-foreground' stroke={1.8} />
          <span className='flex min-w-0 flex-col gap-0.5'>
            <span className='text-sm font-medium leading-5 text-foreground'>Ghostex auto named this session</span>
            <span className='wrap-break-word text-xs leading-4 text-muted-foreground'>
              New name: <span className='text-foreground/85'>{autoNamedTitle}</span>
            </span>
          </span>
        </div>
      </Marker>
    );
  }

  /*
  CDXC:SessionFork 2026-08-28:
  The seam where stitched scroll-back crosses from one fork ancestor into the
  next. gxserver synthesizes it as a system row, but it is not a note about the
  session: it is the boundary between two threads, so it reads as a labeled
  horizontal rule instead of another centered sentence. The text stays exactly
  as the daemon wrote it.
  */
  if (isSystem && message.id.startsWith(SESSION_CHAT_FORK_BOUNDARY_ID_PREFIX)) {
    return (
      <Marker className='pt-1 pb-3' variant='separator'>
        <MarkerContent className='inline-flex items-center gap-1.5'>
          <MarkerIcon className='size-3.5'>
            <IconGitBranch aria-hidden='true' className='size-3.5' stroke={2} />
          </MarkerIcon>
          {markdown}
        </MarkerContent>
      </Marker>
    );
  }

  if (isSystem && message.id.startsWith(SESSION_CHAT_CODEX_GOAL_ID_PREFIX)) {
    const [status, objective, usage] = message.blocks.map((block) => (block.type === 'text' ? block.text : ''));
    return <SessionChatGoalCard objective={objective ?? ''} status={status ?? ''} usage={usage || undefined} />;
  }

  if (isSystem && message.id.startsWith('app-command-output:')) {
    const command = message.blocks[0]?.type === 'text' ? message.blocks[0].text : '';
    const output = message.blocks[1]?.type === 'text' ? message.blocks[1].text : '';
    return (
      <details open className='ghostex-chat-status-card min-w-0 rounded-lg border bg-muted/20'>
        <summary className='cursor-pointer px-3 py-2 text-xs font-medium'>{command}</summary>
        <pre className='max-h-96 overflow-auto whitespace-pre-wrap break-words border-t px-3 py-2 text-xs leading-relaxed'>
          {output}
        </pre>
      </details>
    );
  }

  if (isSystem) {
    const agentMessage = parseSessionChatAgentMessage(markdown);
    if (agentMessage) {
      return <SessionChatAgentMessageCard body={agentMessage.body} sender={agentMessage.sender} />;
    }
  }

  if (isSystem) {
    return (
      <Marker className='pb-2'>
        <MarkerContent>{markdown}</MarkerContent>
      </Marker>
    );
  }

  /*
   * ONLY a genuine reasoning turn goes to the thinking lane. This used to also
   * catch any turn carrying a tool call, which silently demoted real answers:
   * `foldSessionChatToolMessages` folds the following tool-only rows INTO the
   * assistant turn, so a plain prose answer followed by a tool call was
   * rendered as stripped, unformatted thinking. An assistant turn now keeps
   * its markdown and shows the tools it owns beneath it.
   */
  if (isReasoning && markdown.length > 0 && images.length === 0) {
    return (
      <>
        <ReasoningRow
          isStreaming={isStreaming}
          markdown={markdown}
          questionPairsAsRows={questionPairsAsRows}
          tools={tools}
          verboseMode={verboseMode}
        />
        {fileCards}
      </>
    );
  }

  if (isUser) {
    /*
     * The "Queued" label is driven by the agent's own queue bookkeeping in
     * the transcript (`message.queued`). An optimistic echo carries the flag
     * only when the send was issued mid-response — the agent will hold that
     * prompt, so the echo pre-renders the queued row that replaces it and the
     * swap stays invisible. The server retracts the queued row the moment the
     * queue releases it, so the label cannot outlive the wait.
     */
    return (
      <Message align='end' className='pb-4' data-role='user'>
        <MessageContent className='ghostex-chat-user-message-container'>
          {message.startupDelivery ? (
            <SessionChatStartupSendStatus
              delivery={message.startupDelivery}
              onRetryStartupSend={onRetryStartupSend}
              onRemoveStartupSend={onRemoveStartupSend}
            />
          ) : message.queued === true ? (
            <QueuedLabel />
          ) : null}
          <SessionChatUserMessageLayout>
            {showCopy ? (
              <CopyFooter
                className='ghostex-chat-user-actions'
                markdown={userCopyMarkdown}
                onSavePrompt={onSavePrompt}
                {...(showRewind && onRewind
                  ? { onRewind: () => onRewind({ messageId: message.id, prompt: userCopyMarkdown }) }
                  : {})}
              />
            ) : null}
            <div className='ghostex-chat-user-content'>
              <UserImageThumbnails blocks={images} />
              {userMarkdown.length > 0 ? (
                <Bubble align='end' className='ghostex-chat-user-bubble' variant='default'>
                  <BubbleContent>
                    <SessionChatMarkdown chatText markdown={userMarkdown} />
                  </BubbleContent>
                </Bubble>
              ) : null}
            </div>
          </SessionChatUserMessageLayout>
        </MessageContent>
      </Message>
    );
  }

  return (
    <Message align='start' className='pb-4' data-role={message.role}>
      <MessageContent>
        <ImageAttachments blocks={images} />
        {markdown.length > 0 && tools.length > 0 ? (
          <AgentToolsDisclosure
            isStreaming={isStreaming}
            markdown={markdown}
            questionPairsAsRows={questionPairsAsRows}
            tools={tools}
            verboseMode={verboseMode}
          />
        ) : markdown.length > 0 ? (
          <div className='ghostex-chat-agent-message'>
            <SessionChatMarkdown
              isStreaming={isStreaming}
              markdown={markdown}
              preserveLineBreaks={preserveLineBreaks}
            />
          </div>
        ) : null}
        {tools.length > 0 && markdown.length === 0 ? (
          <SessionChatToolRun blocks={tools} questionPairsAsRows={questionPairsAsRows} />
        ) : null}
        {fileCards}
        {showCopy ? (
          <CopyFooter
            anchoredToAssistantMarker={tools.length === 0}
            markdown={markdown}
            onAnnotate={onAnnotate}
            onSaveMarkdown={onSaveMarkdown}
          />
        ) : null}
      </MessageContent>
    </Message>
  );
}
