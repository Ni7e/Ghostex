import { createContext, useContext, useEffect, useId, useRef, useState } from 'react';
import { useSessionChatDisclosureState } from './session-chat-interaction-state';
import { cn } from '@/packages/components/utils';
import { AppTooltip } from '../app-tooltip';
import type { SessionChatFileChange } from './session-chat-file-changes';
import {
  SESSION_CHAT_FILE_CHANGE_PREVIEW_LINES,
  sessionChatFileChangeCounts,
  sessionChatFileChangeExpandable,
  sessionChatFileChangePathParts,
} from './session-chat-file-change-path';
import { useSessionChatHostLinks } from './session-chat-links';
import { SESSION_CHAT_FILE_PATH_ATTRIBUTE } from './session-chat-file-paths';
import { revealSessionChatFileChangeHeader } from './session-chat-file-change-scroll';
import './session-chat-file-change-card.css';
import { SessionChatDisclosure, anchorSessionChatExpansionTop } from './session-chat-expansion';
import {
  SessionChatFileChangePreviewContext,
  SessionChatSimpleModeContext,
  sessionChatSimpleEditLabel,
} from './session-chat-simple-mode';
import { playCopySound } from '../copy-sound';

export { SessionChatFileChangePreviewContext } from './session-chat-simple-mode';
export const SessionChatFileChangeInteractionContext = createContext<((messageId: string) => void) | null>(null);

/** CDXC:SessionChat 2026-09-10 DECISION:
 * User: clicking anywhere on a file-change path uses the reference pill's host Editor/Docs action, and right-clicking uses the same reference menu; this replaces the separate folder-copy action.
 * User: edits default to one collapsed row; Settings > Chat can enable seven-line previews. Counts beside the path toggle the full diff, replacing the chevron and bottom line-count label.
 * User: after either expanding or collapsing a diff, keep its header visible, scrolling to it when necessary.
 * User: the circle toggles the diff and its center turns white on hover; the left rail also toggles the open code.
 * User: clicking the card itself toggles the diff; only the path/name text opens the file, not the empty space beside it.
 * User: the header is a single line containing the file path, truncated from the start when necessary; this replaces the stacked filename and folder.
 * User: use styled action tooltips; the unified path now shares one tooltip instead of separate folder and filename tooltips.
 */
function FileChangeCard({
  change,
  messageId,
  index,
}: {
  change: SessionChatFileChange;
  messageId?: string;
  index: number;
}) {
  const previewEnabled = useContext(SessionChatFileChangePreviewContext);
  const reportInteraction = useContext(SessionChatFileChangeInteractionContext);
  const [expanded, setExpanded] = useSessionChatDisclosureState(
    `file:${messageId ?? ''}:${index}:${change.path}`,
    false
  );
  const [copyStatus, setCopyStatus] = useState<string | null>(null);
  const hostLinks = useSessionChatHostLinks();
  const openFile = hostLinks?.openFile;
  const bodyId = useId();
  const headerRef = useRef<HTMLDivElement>(null);
  // React shortens the folder half with CSS, which is width-aware, so it opts out of the shared character budget.
  const { filename, parent: parentPath } = sessionChatFileChangePathParts(
    change.path,
    hostLinks?.workingDirectory,
    Number.POSITIVE_INFINITY
  );
  useEffect(() => {
    if (copyStatus === null) return;
    const timeout = window.setTimeout(() => setCopyStatus(null), 1500);
    return () => window.clearTimeout(timeout);
  }, [copyStatus]);
  const copyPath = async () => {
    try {
      playCopySound();
      await navigator.clipboard.writeText(change.path);
      setCopyStatus('Path copied');
    } catch (error) {
      console.error('[session-chat] file change path copy failed', error);
      setCopyStatus('Could not copy path');
    }
  };
  const counts = sessionChatFileChangeCounts(change.lines);
  const { added, removed } = counts;
  const canExpand = sessionChatFileChangeExpandable(counts, previewEnabled, Boolean(change.result?.isError));
  const showBody = expanded || previewEnabled;
  const lines = expanded
    ? change.lines
    : change.lines.filter((line) => line.kind !== 'meta').slice(0, SESSION_CHAT_FILE_CHANGE_PREVIEW_LINES);
  const toggle = () => {
    if (!canExpand) return;
    if (messageId) reportInteraction?.(messageId);
    revealSessionChatFileChangeHeader(headerRef.current);
    setExpanded((value) => !value);
  };
  return (
    <section
      className={cn('ghostex-chat-file-change-card', showBody && 'has-preview', canExpand && 'is-expandable')}
      aria-label={`${change.action} ${change.path}`}
      onClick={(event) => {
        if (!(event.target instanceof Element) || event.target.closest('button')) return;
        toggle();
      }}
    >
      <div className='ghostex-chat-file-change-header' ref={headerRef}>
        <button
          type='button'
          className='ghostex-chat-file-change-marker'
          onClick={toggle}
          disabled={!canExpand}
          aria-expanded={expanded}
          aria-controls={bodyId}
          aria-label={`${expanded ? 'Collapse' : 'Show'} changes for ${filename}`}
        />
        <AppTooltip content={copyStatus ?? (openFile ? 'Open path' : 'Copy file path')} side='top'>
          <button
            type='button'
            className='ghostex-chat-file-change-name'
            onClick={() => {
              if (openFile) openFile(change.path);
              else void copyPath();
            }}
            aria-label={`${openFile ? 'Open path' : 'Copy file path'}: ${change.path}`}
            {...{ [SESSION_CHAT_FILE_PATH_ATTRIBUTE]: change.path }}
          >
            {parentPath ? (
              <span className='ghostex-chat-file-change-parent'>
                <bdi dir='ltr'>{parentPath}</bdi>
              </span>
            ) : null}
            <span className='ghostex-chat-file-change-filename'>
              <bdi dir='ltr'>{filename}</bdi>
            </span>
          </button>
        </AppTooltip>
        <span className='sr-only' role='status'>
          {copyStatus}
        </span>
        {change.result?.isError ? <span className='ghostex-chat-file-change-action is-error'>Failed</span> : null}
        <AppTooltip content={expanded ? 'Collapse changes' : 'Show changes'} side='top'>
          <button
            type='button'
            className='ghostex-chat-file-change-counts'
            onClick={toggle}
            disabled={!canExpand}
            aria-expanded={expanded}
            aria-controls={bodyId}
            aria-label={`${expanded ? 'Collapse' : 'Show'} changes for ${filename}: ${added} lines added, ${removed} lines removed`}
          >
            <span className='is-add'>+{added}</span>
            <span className='is-del'>−{removed}</span>
          </button>
        </AppTooltip>
      </div>
      {showBody && canExpand ? (
        <button
          type='button'
          className='ghostex-chat-file-change-rail'
          onClick={toggle}
          aria-expanded={expanded}
          aria-controls={bodyId}
          aria-label={`${expanded ? 'Collapse' : 'Show all'} changes for ${filename} using rail`}
        />
      ) : null}
      {showBody ? (
        <div className='ghostex-chat-file-change-body' id={bodyId}>
          <button
            type='button'
            className='ghostex-chat-file-change-code'
            onClick={toggle}
            disabled={!canExpand}
            aria-expanded={canExpand ? expanded : undefined}
            aria-label={`${expanded ? 'Collapse' : 'Expand'} code for ${filename}`}
          >
            <code>
              {lines.map((line, index) => (
                <span className={cn('ghostex-chat-file-change-line', `is-${line.kind}`)} key={index}>
                  <span aria-hidden='true'>{line.kind === 'add' ? '+' : line.kind === 'del' ? '-' : ' '}</span>
                  <span>{line.text || ' '}</span>
                </span>
              ))}
              {lines.length === 0 ? (
                <span className='ghostex-chat-file-change-empty'>
                  {change.action === 'Delete' ? 'File removed' : 'Empty file'}
                </span>
              ) : null}
            </code>
          </button>
          {expanded && change.result?.isError ? (
            <pre className='ghostex-chat-file-change-error'>{change.result.output}</pre>
          ) : null}
        </div>
      ) : null}
      {showBody && canExpand ? (
        <div className='ghostex-chat-file-change-footer'>
          <button
            type='button'
            className='ghostex-chat-file-change-toggle'
            onClick={toggle}
            aria-expanded={expanded}
            aria-controls={bodyId}
          >
            {expanded ? 'Collapse changes' : 'Show all changes'}
          </button>
        </div>
      ) : null}
    </section>
  );
}

export function SessionChatFileChangeCards({
  changes,
  messageId,
  inDisclosure = false,
}: {
  changes: readonly SessionChatFileChange[];
  messageId?: string;
  inDisclosure?: boolean;
}) {
  const simpleMode = useContext(SessionChatSimpleModeContext);
  if (!changes.length) return null;
  const cards = (
    <div className='ghostex-chat-file-changes'>
      {changes.map((change, index) => (
        <FileChangeCard index={index} change={change} messageId={messageId} key={`${index}:${change.path}`} />
      ))}
    </div>
  );
  /** CDXC:SessionChat 2026-09-13 DECISION:
   * User: in Simple mode, hide file edit cards under "Edited 1 file" or "Edited X files" and show the existing diff cards when expanded.
   */
  return simpleMode && !inDisclosure ? (
    <SessionChatDisclosure
      stateKey='simple-file-edits'
      label={sessionChatSimpleEditLabel(new Set(changes.map((change) => change.path)).size)}
      onExpand={anchorSessionChatExpansionTop}
    >
      {cards}
    </SessionChatDisclosure>
  ) : (
    cards
  );
}
