import geometry from './minimap.json';
import type { SessionChatMessage } from '../session-chat';

/**
 * CDXC:SessionChat 2026-09-18 SEE-ALSO:
 * One dash per user prompt, in two renderers: packages/core-ui/chat/session-chat-minimap.tsx (with session-chat-minimap.css) and apps/desktop/src/app/native_chat/minimap.rs, which reads the same minimap.json.
 * The rail's `scale` is also written as `--ghostex-chat-minimap-scale` in session-chat-minimap.css; change both together.
 */
export const SESSION_CHAT_MINIMAP = geometry;

/** A marker row on the wire: the dash, the transcript row it jumps to, and what the hover preview says. */
export interface SessionChatMinimapMarker {
  id: string;
  item: number;
  prompt: string;
  reply: string;
}

/** What a dash stands for: the prompt's own words, on one line. */
export function sessionChatMinimapPreviewText(message: SessionChatMessage | null | undefined): string {
  return (message?.blocks ?? [])
    .flatMap((block) => (block.type === 'text' ? [block.text] : []))
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** The same one-line preview, cut to the length a hover card can show. */
export function sessionChatMinimapPreview(message: SessionChatMessage | null | undefined): string {
  const text = sessionChatMinimapPreviewText(message);
  return text.length > SESSION_CHAT_MINIMAP.previewLimit
    ? `${text.slice(0, SESSION_CHAT_MINIMAP.previewLimit).trimEnd()}…`
    : text;
}

/** A single prompt has nothing to navigate between, so the rail stays away until there are two. */
export function sessionChatMinimapVisible(turnCount: number): boolean {
  return turnCount >= SESSION_CHAT_MINIMAP.minimumTurns;
}

/** Dashes grow towards the one the pointer is on; everything past the listed distances keeps the smallest width. */
export function sessionChatMinimapDashWidth(distance: number): number {
  const widths = SESSION_CHAT_MINIMAP.dashWidths;
  return widths[Math.min(Math.max(distance, 0), widths.length - 1)] ?? widths[widths.length - 1]!;
}

/** Which dash a pointer at `progress` (0 at the top of the rail, 1 at its bottom) means. */
export function sessionChatMinimapIndexAt(progress: number, turnCount: number): number {
  return Math.round(Math.max(0, Math.min(1, progress)) * (turnCount - 1));
}

/** The rail's own height: one `spacing` step between neighbouring dashes. */
export function sessionChatMinimapRailHeight(turnCount: number): number {
  return Math.max(0, turnCount - 1) * SESSION_CHAT_MINIMAP.spacing;
}
