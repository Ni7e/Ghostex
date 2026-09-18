export function plainReasoningText(markdown: string): string {
  return (
    markdown
      .replace(/```(?:[^\n]*)\n?([\s\S]*?)```/g, '$1')
      .replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1')
      .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
      .replace(/`([^`]+)`/g, '$1')
      .replace(/^\s{0,3}(?:#{1,6}|>|[-+*]|\d+[.)])\s+/gm, '')
      // Underscores drop only where they mark emphasis; the ones inside
      // snake_case identifiers are part of the word and stay.
      .replace(/(?:\*\*|\*|~~|(?<![A-Za-z0-9])_+|_+(?![A-Za-z0-9]))/g, '')
      .replace(/\\([\\`*_[\]{}()#+\-.!>])/g, '$1')
      .trim()
  );
}

/** The first non-empty line of the stripped reasoning, for a one-line label. */
export function plainReasoningTeaser(markdown: string): string {
  return (
    plainReasoningText(markdown)
      .split(/\n+/)
      .map((line) => line.trim())
      .find(Boolean) ?? ''
  );
}

/**
 * A list item, a table row, a blockquote, or a fence opener means something to
 * the markdown renderer that plain text on the trigger cannot carry, so that
 * line and everything after it stay in the body.
 */
export const NON_HOISTABLE_REASONING_LINE = /^\s{0,3}(?:[-+*]\s|\d+[.)]\s|>|\||```|~~~)/;

/**
 * The disclosure heading carries the reasoning's OWN text, never the word
 * "Thinking". Verbose mode opens every reasoning turn by default, so a static
 * label produced a column of identical "Thinking" rows that said nothing
 * while the sentence under each of them said everything.
 *
 * CDXC:SessionChat 2026-09-04 DECISION:
 * User: a reasoning row with tool calls under it must "always show all of the text wrapped"; it used to hoist only the first line and clamp it to one row with an ellipsis, so the reader had to expand the row to finish the sentence.
 * The heading therefore owns every leading line that plain text can carry (paragraphs, headings, emphasis, inline code, links), and the body renders only what follows the first line that needs the markdown renderer, so nothing is printed twice and the chevron folds the tool calls rather than the thought.
 * Paragraphs stay separated by one blank line and hard-wrapped lines rejoin with a space, so the heading reads the way markdown would have set it.
 */
export function splitReasoningHeadline(markdown: string): {
  headline: string;
  body: string;
} {
  const lines = markdown.split(/\r?\n/);
  const firstBlock = lines.findIndex((line) => NON_HOISTABLE_REASONING_LINE.test(line));
  const split = firstBlock < 0 ? lines.length : firstBlock;
  const headline = plainReasoningText(lines.slice(0, split).join('\n'))
    .split(/\n[ \t]*\n+/)
    .map((paragraph) => paragraph.replace(/\s*\n\s*/g, ' ').trim())
    .filter(Boolean)
    .join('\n\n');
  if (headline.length === 0) {
    return { headline: plainReasoningTeaser(markdown), body: markdown };
  }
  return {
    headline,
    body: lines.slice(split).join('\n').trim(),
  };
}


export const USER_TURN_SEPARATOR = /\r?\n[\t ]*---[\t ]*(?:\r?\n|$)/;

export function normalizeUserMessageMarkdown(markdown: string): string {
  const parts = markdown.split(USER_TURN_SEPARATOR).map((part) => part.trim());
  if (parts.length === 1) {
    return markdown;
  }

  const visible: string[] = [];
  for (const part of parts) {
    if (!part) {
      continue;
    }
    const containingIndex = visible.findIndex((candidate) => candidate.startsWith(part));
    if (containingIndex < 0) {
      visible.push(part);
      continue;
    }

    const remainder = visible[containingIndex]?.slice(part.length).trimStart() ?? '';
    visible[containingIndex] = remainder ? `${part}\n\n${remainder}` : part;
  }
  return visible.join('\n\n');
}

/*
 * Legacy agent transcripts carry a picture as a separate image block. Copy has
 * to restore a named reference for those blocks or the reader loses the one
 * thing that names the file they attached. Modern linked references stay in
 * the turn's text, so both their authored position and copyable path survive.
 */
export function userTurnCopyMarkdown(markdown: string, images: readonly { path?: string; url?: string }[]): string {
  const references = images
    .map((block, index) => {
      const href = block.path ?? block.url;
      return href === undefined ? '' : `[Image #${index + 1}](${href})`;
    })
    .filter((reference) => reference !== '');
  return [references.join(' '), markdown].filter((part) => part !== '').join('\n\n');
}

