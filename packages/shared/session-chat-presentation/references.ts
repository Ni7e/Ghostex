/** Rich Prompt Editor numbering: max existing [Image #N]( in the draft, +1. */
export function nextImageReferenceIndex(text: string): number {
  let highest = 0;
  for (const match of text.matchAll(/\[Image #(\d+)·?\]\(/g)) {
    const index = Number.parseInt(match[1] ?? '', 10);
    if (Number.isFinite(index)) {
      highest = Math.max(highest, index);
    }
  }
  return highest + 1;
}

export const IMAGE_PATH_PATTERN = /\.(avif|bmp|gif|heic|heif|ico|jpe?g|png|svg|tiff?|webp)$/i;
/**
 * CDXC:SessionChat 2026-09-06 DECISION:
 * User: expanded image references with the trailing · must still show image previews in input boxes across all apps.
 */
export const LINKED_IMAGE_REFERENCE_PATTERN = /\[Image #\d+·?\]\(([^)\r\n]+)\)/g;

export function linkedImageReferenceHrefs(text: string): string[] {
  return [...text.matchAll(LINKED_IMAGE_REFERENCE_PATTERN)].map((match) => match[1]?.trim() ?? '').filter(Boolean);
}

/** Numbered file references include both attachment labels and descriptive picker labels. */
export function nextFileReferenceIndex(text: string): number {
  let highest = 0;
  for (const match of text.matchAll(/\[(?:\\.|[^\]\\\r\n])* #(\d+)\]\(/g)) {
    const index = Number.parseInt(match[1] ?? '', 10);
    if (Number.isFinite(index)) {
      highest = Math.max(highest, index);
    }
  }
  return highest + 1;
}

export function insertChatReference(current: string, reference: string, start = current.length, end = start): { text: string; caret: number } {
  const needsLeadingSpace = start > 0 && !/\s/.test(current[start - 1] ?? '');
  const inserted = `${needsLeadingSpace ? ' ' : ''}${reference} `;
  return { text: `${current.slice(0, start)}${inserted}${current.slice(end)}`, caret: start + inserted.length };
}

export function nativePathReference(path: string, text: string): string {
  return IMAGE_PATH_PATTERN.test(path) ? `[Image #${nextImageReferenceIndex(text)}](${path})` : `[File #${nextFileReferenceIndex(text)}](${path})`;
}

/**
 * Drops the reference an attachment thumbnail stands for, the way removing a pasted image does in
 * `packages/core-ui/chat/session-chat-composer.tsx`: one leading space and one trailing space go
 * with it so the surrounding sentence keeps its spacing.
 */
export function removeChatReference(current: string, start: number, end: number): { text: string; caret: number } {
  const from = start > 0 && /[^\S\r\n]/.test(current[start - 1] ?? '') ? start - 1 : start;
  const to = /[^\S\r\n]/.test(current[end] ?? '') ? end + 1 : end;
  return { text: `${current.slice(0, from)}${current.slice(to)}`, caret: from };
}
