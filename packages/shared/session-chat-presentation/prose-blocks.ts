import type { SessionChatBlock } from '../session-chat';

/**
 * CDXC:SessionChat 2026-09-18 WHY:
 * A turn's text blocks are the paragraphs the agent wrote, not one run of characters. The native projection used to join them with "", which ran the last line of one block into the first line of the next and lost every paragraph break a multi-block reply had, while React joined the same blocks with a blank line.
 * Both renderers read a turn's prose through here so a block boundary is the same blank line in GPUI and in React.
 */
export function sessionChatProseMarkdown(blocks: readonly SessionChatBlock[]): string {
  return blocks
    .filter((block) => block.type === 'text')
    .map((block) => (block.type === 'text' ? block.text : ''))
    .join('\n\n');
}
