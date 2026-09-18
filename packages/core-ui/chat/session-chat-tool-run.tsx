// Compact work rows for tool calls, results, and file edits.

import {
  IconChevronRight,
  IconFileText,
  IconPencil,
  IconTerminal2,
  IconTool,
  IconWorldSearch,
} from '@tabler/icons-react';
import { useContext, useRef, type ReactNode } from 'react';
import { useSessionChatDisclosureState } from './session-chat-interaction-state';
import { SessionChatSimpleModeContext } from './session-chat-simple-mode';
import type { SessionChatToolCallBlock, SessionChatToolResultBlock } from '../../shared/session-chat';
import { cn } from '@/packages/components/utils';
import { diffFromSessionChatText, diffFromSessionChatToolCall, type SessionChatDiffLine } from './session-chat-diff';
import { centerSessionChatExpansion, SessionChatExpansion } from './session-chat-expansion';
import { answeredSessionChatQuestionExchange, SessionChatQuestionExchangeCard } from './session-chat-question-exchange';
import { pairSessionChatToolBlocks } from './session-chat-tool-fold';
import {
  SessionChatSubagentContext,
  SessionChatSubagentLink,
  sessionChatToolSubagent,
} from './session-chat-subagent-link';
import { formatSessionChatToolInput } from './session-chat-tool-summary';
import {
  SESSION_CHAT_MAX_TOOL_RESULT_CHARS,
  clipSessionChatToolBody,
  isSessionChatCommandTool,
  sessionChatToolGlyph,
  sessionChatToolPreview,
  sessionChatToolRunFold,
} from '@/packages/shared/session-chat-presentation/tool-rows';

export { SESSION_CHAT_MAX_TOOL_RESULT_CHARS };

type ToolBlock = SessionChatToolCallBlock | SessionChatToolResultBlock;

export interface SessionChatToolRunProps {
  blocks: readonly ToolBlock[];
  /** Global expand toggle; expands the run and each row's detail. */
  expandSignal?: boolean;
  /** The parent disclosure already owns collapsing, so render every row. */
  showAllRows?: boolean;
  /**
   * Keep answered question pairs as plain tool rows. Set by contexts where a
   * hoisted SessionChatQuestionExchangeCard already shows the exchange (the
   * expanded completed-work log), so it is not rendered twice.
   */
  questionPairsAsRows?: boolean;
}

/*
 * The one glyph on this surface that says WHAT ran rather than "this expands":
 * semantic tier (see CDXC:SessionChat in chat.css). It shares the
 * control tier's size because it stands in the same marker slot on the same
 * vertical axis as the chevrons; only its stroke weight and its shape set it
 * apart, and it must never be flattened into a chevron.
 */
const TOOL_GLYPH_ICONS = {
  edit: IconPencil,
  file: IconFileText,
  terminal: IconTerminal2,
  web: IconWorldSearch,
  tool: IconTool,
} as const;

function toolIcon(name: string): ReactNode {
  const Icon = TOOL_GLYPH_ICONS[sessionChatToolGlyph(name)];
  return <Icon aria-hidden='true' className='ghostex-chat-glyph-semantic' />;
}

function DiffView({ lines }: { lines: readonly SessionChatDiffLine[] }) {
  return (
    <div className='ghostex-chat-file-edit'>
      <div className='ghostex-chat-diff'>
        {lines.map((line, index) => (
          <div className={cn('ghostex-chat-diff-line', `is-${line.kind}`)} key={index}>
            <span className='ghostex-chat-diff-sign'>
              {line.kind === 'add' ? '+' : line.kind === 'del' ? '-' : ' '}
            </span>
            <span>{line.text}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function ToolBody({ error, label, text }: { error?: boolean; label?: string; text: string }) {
  return (
    <div className='ghostex-chat-tool-body-group'>
      {label ? <div className='ghostex-chat-tool-body-label'>{label}</div> : null}
      <pre className={cn('ghostex-chat-tool-body', error && 'is-error')}>{clipSessionChatToolBody(text)}</pre>
    </div>
  );
}

function ToolLine({
  index,
  call,
  expandSignal,
  result,
}: {
  index: number;
  call?: SessionChatToolCallBlock;
  expandSignal: boolean;
  result?: SessionChatToolResultBlock;
}) {
  const [open, setOpen] = useSessionChatDisclosureState(`tool:${index}:${call?.name ?? 'result'}`, expandSignal);
  const subagentViewer = useContext(SessionChatSubagentContext);
  const simpleMode = useContext(SessionChatSimpleModeContext);
  const subagent = subagentViewer ? sessionChatToolSubagent(call, result, subagentViewer.agentPath) : null;
  const triggerRef = useRef<HTMLButtonElement>(null);

  const name = call?.name ?? 'Result';
  const commandTool = isSessionChatCommandTool(name);
  const preview = sessionChatToolPreview({ call, result });
  const callDiff = call ? diffFromSessionChatToolCall(call.name, call.input) : null;
  const resultDiff = result ? diffFromSessionChatText(result.output) : null;
  const diff = callDiff ?? resultDiff;
  const inputDetail = call ? formatSessionChatToolInput(call.input) : '';
  const inputAddsInfo = Boolean(
    call && (simpleMode || commandTool || inputDetail.replace(/\s+/g, ' ').trim() !== preview)
  );
  const hasResultBody = Boolean(result?.output && resultDiff === null);
  const hasDetail = diff !== null || inputAddsInfo || hasResultBody;

  return (
    <div className={cn('ghostex-chat-work-row', result?.isError && 'is-error')} data-open={open}>
      <div className={cn(subagent && 'ghostex-chat-subagent-tool-heading')}>
        <button
          aria-expanded={hasDetail ? open : undefined}
          className='ghostex-chat-work-trigger'
          disabled={!hasDetail}
          onClick={() => {
            if (hasDetail) {
              if (!open) {
                centerSessionChatExpansion(triggerRef.current);
              }
              setOpen((current) => !current);
            }
          }}
          ref={triggerRef}
          type='button'
        >
          <span className='ghostex-chat-work-icon'>{toolIcon(name)}</span>
          <span className='ghostex-chat-work-heading'>{name}</span>
          {preview && !subagent && !simpleMode ? <span className='ghostex-chat-work-preview'>{preview}</span> : null}
          {hasDetail ? (
            <IconChevronRight aria-hidden='true' className={cn('ghostex-chat-disclosure-chevron', open && 'is-open')} />
          ) : null}
        </button>
        {subagent ? <SessionChatSubagentLink {...subagent} /> : null}
      </div>
      {hasDetail && open ? (
        <SessionChatExpansion
          className='ghostex-chat-work-detail'
          label={`Collapse ${name}`}
          onCollapse={() => setOpen(false)}
        >
          {inputAddsInfo && (!diff || commandTool) ? (
            <ToolBody label={commandTool ? 'Command' : result ? 'Input' : undefined} text={inputDetail} />
          ) : null}
          {diff ? <DiffView lines={diff} /> : null}
          {!diff && hasResultBody && result ? (
            <ToolBody error={result.isError} label={call ? 'Result' : undefined} text={result.output} />
          ) : null}
        </SessionChatExpansion>
      ) : null}
    </div>
  );
}

export function SessionChatToolRun({
  blocks,
  expandSignal = false,
  showAllRows = false,
  questionPairsAsRows = false,
}: SessionChatToolRunProps) {
  const pairs = pairSessionChatToolBlocks(blocks);
  const simpleMode = useContext(SessionChatSimpleModeContext);
  const [expanded, setExpanded] = useSessionChatDisclosureState('tool-run', showAllRows || expandSignal);

  const exchanges = pairs.map((pair) => (questionPairsAsRows ? null : answeredSessionChatQuestionExchange(pair)));
  const renderItem = (index: number) => {
    const pair = pairs[index];
    if (!pair) {
      return null;
    }
    const exchange = exchanges[index];
    if (exchange) {
      return (
        <div className='ghostex-chat-question-exchange-item py-1' key={index}>
          <SessionChatQuestionExchangeCard exchange={exchange} />
        </div>
      );
    }
    return <ToolLine index={index} call={pair.call} expandSignal={expandSignal} key={index} result={pair.result} />;
  };

  const fold = sessionChatToolRunFold(exchanges.map((exchange) => exchange !== null));
  const { visible: collapsedVisible, hiddenCount } = fold;
  const toggle = (
    <button
      aria-expanded={expanded}
      className='ghostex-chat-tool-run-toggle'
      onClick={() => setExpanded((current) => !current)}
      type='button'
    >
      <span className='ghostex-chat-work-icon'>
        <IconChevronRight aria-hidden='true' className={cn('ghostex-chat-disclosure-chevron', expanded && 'is-open')} />
      </span>
      <span>{expanded ? fold.expandedLabel : fold.collapsedLabel}</span>
    </button>
  );

  const allRows = pairs.map((_, index) => renderItem(index));
  const collapsedRows = pairs.map((_, index) => (collapsedVisible[index] ? renderItem(index) : null));

  /** CDXC:SessionChat 2026-09-13 DECISION:
   * User: Simple mode hides the command previews even when no message or reasoning precedes the tools; show only the tool-call count until expanded.
   */
  if (simpleMode && !showAllRows) {
    const work = pairs.map((pair, index) => ({ pair, index })).filter(({ index }) => exchanges[index] === null);
    const count = work.filter(({ pair }) => pair.call).length;
    const label = sessionChatToolCountLabel(count);
    return (
      <div className='ghostex-chat-tool-run'>
        {work.length > 0 ? (
          <>
            <button
              aria-expanded={expanded}
              className='ghostex-chat-tool-run-toggle'
              onClick={() => setExpanded((current) => !current)}
              type='button'
            >
              <span className='ghostex-chat-work-icon'>
                <IconChevronRight
                  aria-hidden='true'
                  className={cn('ghostex-chat-disclosure-chevron', expanded && 'is-open')}
                />
              </span>
              <span>{label}</span>
            </button>
            {expanded ? (
              <SessionChatExpansion
                bodyClassName='ghostex-chat-tool-run-expanded'
                label='Collapse tool calls'
                onCollapse={() => setExpanded(false)}
              >
                {work.map(({ index }) => renderItem(index))}
              </SessionChatExpansion>
            ) : null}
          </>
        ) : null}
        {pairs.map((_, index) => (exchanges[index] !== null ? renderItem(index) : null))}
      </div>
    );
  }

  return (
    <div className='ghostex-chat-tool-run'>
      {hiddenCount === 0 || showAllRows ? (
        allRows
      ) : expanded ? (
        <SessionChatExpansion
          bodyClassName='ghostex-chat-tool-run-expanded'
          label='Show fewer tool calls'
          onCollapse={() => setExpanded(false)}
        >
          {allRows}
          {toggle}
        </SessionChatExpansion>
      ) : (
        <>
          {collapsedRows}
          {toggle}
        </>
      )}
    </div>
  );
}
import { sessionChatToolCountLabel } from '@/packages/shared/session-chat-presentation/simple';
