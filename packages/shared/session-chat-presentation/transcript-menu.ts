import { sessionChatReferenceMenuRows, type SessionChatReferenceMenuRow } from './reference-menu';

export type SessionChatTranscriptMenuItemId = 'copy' | 'addToChat';

export interface SessionChatTranscriptMenuItem {
  id: SessionChatTranscriptMenuItemId;
  label: string;
  iconPath: string;
  disabled: boolean;
}

export interface SessionChatTranscriptMenuInput {
  /** The trimmed transcript selection when the menu opened, empty when nothing is selected. */
  selection: string;
  /** The press landed on a file or web reference, whose own rows lead the menu. */
  onReference: boolean;
  /** A question card holds the composer, so there is nowhere to add the selection. */
  questionActive: boolean;
}

/**
 * The selection rows of the transcript's right-click menu, after any reference rows.
 *
 * CDXC:SessionChat 2026-09-19 SEE-ALSO:
 * React renders these in the transcript `ContextMenu` of `packages/core-ui/chat/session-chat-view.tsx`
 * (reference rows from `session-chat-reference-menu-items.tsx`); GPUI asks for
 * `sessionChatTranscriptMenuRows` from `apps/desktop/src/app/native_chat/transcript_menu.rs`.
 * Copy stands alone, disabled, on plain transcript with nothing selected, so the menu never opens empty.
 */
export function sessionChatTranscriptMenuItems(input: SessionChatTranscriptMenuInput): SessionChatTranscriptMenuItem[] {
  const items: SessionChatTranscriptMenuItem[] = [];
  if (!input.onReference || input.selection !== '') {
    items.push({ id: 'copy', label: 'Copy', iconPath: 'titlebar/copy.svg', disabled: input.selection === '' });
  }
  if (input.selection !== '') {
    items.push({
      id: 'addToChat',
      label: 'Add to Chat',
      iconPath: 'titlebar/blockquote.svg',
      disabled: input.questionActive,
    });
  }
  return items;
}

/** Text as a Markdown blockquote, one `>` per line, with bare `>` for blank lines. */
export function sessionChatMarkdownQuote(text: string): string {
  return text
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map((line) => (line === '' ? '>' : `> ${line}`))
    .join('\n');
}

/**
 * CDXC:SessionChat 2026-09-22 DECISION:
 * User: Add to Chat adds one more newline between the quoted message and my text so Markdown renders correctly. This supersedes the 2026-09-07 single-newline decision.
 */
export function sessionChatTranscriptQuote(selection: string): string {
  return `${sessionChatMarkdownQuote(selection)}\n\n`;
}

/**
 * The composer after appending `text` to `current`: a blank line separates it from earlier text,
 * reusing whatever line breaks the draft already ends with.
 */
export function sessionChatAppendDraftText(current: string, text: string): string {
  const separator = current === '' || current.endsWith('\n\n') ? '' : current.endsWith('\n') ? '\n' : '\n\n';
  return `${current}${separator}${text}`;
}

export interface SessionChatTranscriptMenuRow extends SessionChatReferenceMenuRow {
  disabled?: boolean;
}

/** GPUI's whole transcript menu: the reference rows for `href`, then the selection rows with their commands. */
export function sessionChatTranscriptMenuRows(input: {
  href?: string | null;
  selection: string;
  questionActive: boolean;
}): SessionChatTranscriptMenuRow[] {
  const references: SessionChatTranscriptMenuRow[] = input.href ? sessionChatReferenceMenuRows(input.href) : [];
  const items = sessionChatTranscriptMenuItems({
    selection: input.selection,
    onReference: references.length > 0,
    questionActive: input.questionActive,
  });
  return [
    ...references,
    ...items.map((item) => ({
      command:
        item.id === 'copy'
          ? { text: input.selection, type: 'copyText' }
          : { text: sessionChatTranscriptQuote(input.selection), type: 'appendToDraft' },
      disabled: item.disabled,
      iconPath: item.iconPath,
      label: item.label,
    })),
  ];
}
