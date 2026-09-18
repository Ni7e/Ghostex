/**
 * The rules a run of tool rows renders by: which glyph a row carries, what its
 * one-line preview says, and which rows survive the "+N previous tool calls"
 * fold.
 *
 * CDXC:SessionChat 2026-09-18 SEE-ALSO:
 * The two transcripts must keep picking, previewing, and folding the same rows:
 * `packages/core-ui/chat/session-chat-tool-run.tsx` reads these directly, and
 * `apps/desktop/src/app/native_chat/tool_run.rs` reads them off the wire through
 * `native-transcript-rows.ts`. A rule added here belongs to both, never to one
 * renderer.
 */

import type { SessionChatToolPair } from '@/packages/core-ui/chat/session-chat-tool-fold';
import {
  summarizeSessionChatCommandInput,
  summarizeSessionChatToolInput,
  truncateSessionChatToolPreview,
} from '@/packages/core-ui/chat/session-chat-tool-summary';

/** The first line of a result is the preview when the call has nothing to say. */
export const SESSION_CHAT_TOOL_RESULT_PREVIEW_LENGTH = 120;

/** How much of an expanded tool body either renderer paints before it stops. */
export const SESSION_CHAT_MAX_TOOL_RESULT_CHARS = 4000;

export function clipSessionChatToolBody(text: string): string {
  return text.length > SESSION_CHAT_MAX_TOOL_RESULT_CHARS
    ? `${text.slice(0, SESSION_CHAT_MAX_TOOL_RESULT_CHARS)}…`
    : text;
}

/**
 * The one glyph on this surface that says WHAT ran rather than "this expands".
 * The renderers map these names onto their own icon sets (Tabler in React, the
 * bundled titlebar SVGs in GPUI); the classification itself lives here.
 */
export type SessionChatToolGlyph = 'edit' | 'file' | 'terminal' | 'web' | 'tool';

export function sessionChatToolGlyph(name: string): SessionChatToolGlyph {
  const normalized = name.toLowerCase();
  if (/edit|write|patch|replace/.test(normalized)) return 'edit';
  if (/read|file|glob|list/.test(normalized)) return 'file';
  if (/exec|command|shell|terminal|bash/.test(normalized)) return 'terminal';
  if (/web|search|browser|fetch|url/.test(normalized)) return 'web';
  return 'tool';
}

export function isSessionChatCommandTool(name: string): boolean {
  return /exec|command|shell|terminal|bash/.test(name.toLowerCase());
}

/** The compact text beside a tool row's name. */
export function sessionChatToolPreview(pair: SessionChatToolPair): string {
  const { call, result } = pair;
  if (call && isSessionChatCommandTool(call.name)) return summarizeSessionChatCommandInput(call.input);
  const input = call ? summarizeSessionChatToolInput(call.input) : '';
  return (
    input ||
    truncateSessionChatToolPreview(result?.output.split('\n')[0]?.trim() ?? '', SESSION_CHAT_TOOL_RESULT_PREVIEW_LENGTH)
  );
}

/**
 * True when a message's tool run is nested inside a disclosure that already owns
 * collapsing it: the reasoning row and the assistant commentary heading both
 * open onto their run, so neither the "+N previous tool calls" fold nor simple
 * mode's "N tool calls" group may appear a second time inside them. React reads
 * this as the `showAllRows` prop it passes at exactly those two call sites
 * (`session-chat-message-list/rows.tsx`), and a run only stands alone when the
 * message has no prose to open it, which is what `hasProse` says.
 */
export function sessionChatToolRunShowsAllRows(hasProse: boolean): boolean {
  return hasProse;
}

export const SESSION_CHAT_TOOL_FOLD_EXPANDED_LABEL = 'Show fewer tool calls';

export function sessionChatToolFoldLabel(hiddenCount: number): string {
  return `+${hiddenCount} previous tool ${hiddenCount === 1 ? 'call' : 'calls'}`;
}

export interface SessionChatToolRunFold {
  /** Index-aligned with the run's pairs: the rows a collapsed run still shows. */
  visible: boolean[];
  hiddenCount: number;
  collapsedLabel: string;
  expandedLabel: string;
}

/**
 * An answered question is conversation, not work: its card never folds behind
 * the toggle. The fold hides only the ordinary tool rows before the last pair.
 * `exchanges[index]` is true for a pair that renders as a question exchange.
 */
export function sessionChatToolRunFold(exchanges: readonly boolean[]): SessionChatToolRunFold {
  const visible = exchanges.map((exchange, index) => index === exchanges.length - 1 || exchange);
  const hiddenCount = visible.filter((shown) => !shown).length;
  return {
    visible,
    hiddenCount,
    collapsedLabel: sessionChatToolFoldLabel(hiddenCount),
    expandedLabel: SESSION_CHAT_TOOL_FOLD_EXPANDED_LABEL,
  };
}
