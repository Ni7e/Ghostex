/*
 * The rich-Markdown decisions the GPUI transcript cannot make for itself.
 *
 * The native transcript hands one Markdown string to a single `TextView`, which
 * parses and lays it out in Rust. React reaches the same features through
 * remark and rehype passes over its own AST (session-chat-code-fence-meta.ts,
 * session-chat-github-alerts.ts, session-chat-file-paths.ts), and none of that
 * is reachable from Rust. So every decision stays here and travels to the
 * native renderer inside the Markdown itself, marked with a private-use
 * character no agent writes:
 *
 *   * a fenced block that names a file gets its header's label, icon, and
 *     open-file target appended to the fence's info string, where the Rust code
 *     block header reads them back;
 *   * a GitHub alert quote (`> [!NOTE]`) becomes a marked, unquoted section the
 *     native renderer draws as a tinted callout;
 *   * a picture written into prose (`![alt](src)`, or a link to an image file)
 *     becomes a marked token carrying its image source, so the native renderer
 *     draws the thumbnail React draws instead of a chip or a blank band;
 *   * a file reference written as inline code, or a path somebody typed into a
 *     prompt, becomes a real Markdown link, so the native reference pill and
 *     the React file chip point at the same file.
 *
 * Rust only splits on the markers and lays the pieces out.
 *
 * CDXC:SessionChat 2026-09-18 SEE-ALSO:
 * The marker vocabulary below is mirrored in apps/desktop/src/app/native_chat/rich_markdown.rs
 * and apps/desktop/src/app/native_chat/code_block.rs. Change them together.
 */

import { fromMarkdown } from 'mdast-util-from-markdown';
import type { RootContent } from 'mdast';
import type { SessionChatImageRefBlock } from '../session-chat';
import { sessionChatFilePositionSuffix } from './file-position';
import {
  resolveSessionChatFenceTitleFilePath,
  resolveSessionChatInlineCodeFilePath,
  sessionChatBareFilePaths,
  sessionChatFenceTitle,
  sessionChatFilePathIconName,
} from './file-paths';
import { sessionChatImageSource } from './images';

/** Private-use character: never written by an agent, never rendered. */
export const SESSION_CHAT_NATIVE_MARK = '\u{E000}';
export const SESSION_CHAT_NATIVE_ALERT_OPEN = `${SESSION_CHAT_NATIVE_MARK}alert:`;
export const SESSION_CHAT_NATIVE_ALERT_CLOSE = `${SESSION_CHAT_NATIVE_MARK}/alert`;
export const SESSION_CHAT_NATIVE_TABLE_OPEN = `${SESSION_CHAT_NATIVE_MARK}table`;
export const SESSION_CHAT_NATIVE_TABLE_CLOSE = `${SESSION_CHAT_NATIVE_MARK}/table`;
export const SESSION_CHAT_NATIVE_IMAGE_OPEN = `${SESSION_CHAT_NATIVE_MARK}image:`;

/** What the native code-block header shows, as JSON on the fence's info string. */
export interface SessionChatNativeFenceHeader {
  /** The file the fence names, shown instead of the bare language. */
  label: string;
  /** Which of the three file glyphs goes beside it. */
  icon: string;
  /** Present only when the name really is a path the host can open. */
  href?: string;
}

const FENCE_OPEN = /^( {0,3})(`{3,}|~{3,})(.*)$/;
const QUOTE_LINE = /^ {0,3}>/;
const QUOTE_MARKER = /^ {0,3}> ?/;
const ALERT_MARKER = /^\[!(NOTE|TIP|IMPORTANT|WARNING|CAUTION)\]\s*$/i;
const QUOTED_ALERT = /^ {0,3}> ?\[!(?:NOTE|TIP|IMPORTANT|WARNING|CAUTION)\]/i;
/** GFM's delimiter row, the one line that tells a table from prose with pipes in it. */
const TABLE_DELIMITER = /^ {0,3}\|?(?: *:?-+:? *\|)+ *(?::?-+:? *\|? *)?$/;
const PATH_EVIDENCE = /[\\/@]|:\d/;
/**
 * A single-line backtick span holding something a path needs: a separator or a
 * `:line`. Cheap enough to run on every message, and it keeps an answer whose
 * only backticks belong to fences out of the parser.
 */
const INLINE_CODE_PATH_EVIDENCE = /`[^`\n\r]*(?:[\\/]|:\d)[^`\n\r]*`/;
/** The extensions React's `isSessionChatImageHref` accepts, on a destination with its query and hash cut off. */
const IMAGE_EXTENSION = /\.(avif|bmp|gif|heic|heif|ico|jpe?g|png|svg|tiff?|webp)$/i;
/** Cheap enough to run on every message: no bang and no picture extension means nothing to mark. */
const IMAGE_EVIDENCE = /!\[|\]\([^)\r\n]*\.(?:avif|bmp|gif|heic|heif|ico|jpe?g|png|svg|tiff?|webp)/i;
/** A Markdown image or link, with the loose destination a composer image reference needs. */
const INLINE_IMAGE = /(!?)\[([^\]\r\n]*)\]\(([^)\r\n]+)\)/g;
/** A picture written inside backticks is code, and stays code. */
const CODE_SPAN = /`[^`\r\n]*`/g;
/**
 * A composer image reference, whose literal machine path may hold spaces
 * (`Application Support`) that CommonMark will not accept in a link, so the
 * parser leaves it as prose. React's remarkSessionChatImageReferences makes it
 * a link before its bare-path pass runs; this is the same pattern, kept out of
 * the bare-path scan here so a path fragment is not linked inside it.
 */
const COMPOSER_IMAGE_REFERENCE = /\[Image #\d+\]\([^)\r\n]+\)/g;

function fenceHeader(info: string): string | null {
  const trimmed = info.trim();
  const language = trimmed.split(/\s+/)[0] ?? '';
  const title = sessionChatFenceTitle(trimmed.slice(language.length).trim() || null);
  if (title === null) return null;
  const separator = Math.max(title.lastIndexOf('/'), title.lastIndexOf('\\'));
  const reference = resolveSessionChatFenceTitleFilePath(title);
  const header: SessionChatNativeFenceHeader = {
    label: title,
    icon: sessionChatFilePathIconName(title.slice(separator + 1)),
    ...(reference === null ? {} : { href: `${reference.path}${sessionChatFilePositionSuffix(reference.position)}` }),
  };
  return `${SESSION_CHAT_NATIVE_MARK}${JSON.stringify(header)}`;
}

/**
 * One picture, as the native renderer needs it: the same source fields the
 * projected image blocks carry, so `images.rs` loads an authored picture
 * through the transport it already uses for attachments.
 *
 * `label` is overwritten with React's own stand-in text (the link's words, or
 * the alt), because that is what React shows when the bytes cannot be read.
 */
function imageMark(href: string, fallback: string, alt: string): string {
  const destination = href.trim();
  let block: SessionChatImageRefBlock;
  if (/^(https?:|data:)/i.test(destination)) {
    block = { type: 'image-ref', url: destination, alt };
  } else {
    let path = destination;
    try {
      // Markdown destinations arrive percent-encoded; a machine path needs the literal characters back.
      path = decodeURI(destination);
    } catch {
      // Malformed escapes: the raw destination is the best reading of it.
    }
    block = { type: 'image-ref', path, alt };
  }
  const source = { ...sessionChatImageSource(block), label: fallback };
  return `${SESSION_CHAT_NATIVE_IMAGE_OPEN}${JSON.stringify(source)}${SESSION_CHAT_NATIVE_MARK}`;
}

/**
 * Marks the pictures on one line: every Markdown image, and every link whose
 * destination names a picture. React draws both as a real thumbnail at the
 * position they were written (SessionChatInlineImage), which is what the marked
 * line lets the native renderer do.
 */
function markInlineImages(line: string): string {
  if (!line.includes('](')) return line;
  const code: [number, number][] = [];
  for (const span of line.matchAll(CODE_SPAN)) code.push([span.index, span.index + span[0].length]);
  let result = '';
  let cursor = 0;
  for (const match of line.matchAll(INLINE_IMAGE)) {
    const start = match.index;
    const end = start + match[0].length;
    if (code.some(([from, to]) => start < to && end > from)) continue;
    const href = match[3] ?? '';
    const text = (match[2] ?? '').trim();
    const picture = match[1] === '!';
    if (!picture && !IMAGE_EXTENSION.test(href.trim().split(/[?#]/, 1)[0] ?? '')) continue;
    result += line.slice(cursor, start);
    result += imageMark(href, text || 'Image', picture ? text : text || 'Image');
    cursor = end;
  }
  return cursor === 0 ? line : result + line.slice(cursor);
}

/**
 * One pass over the lines: annotate fenced blocks, mark the pictures written
 * into prose, and lift GitHub alert quotes out of the Markdown into a marked
 * section. All three are line-structured, so this costs a scan rather than a
 * second parse of every streaming message.
 */
function markBlocks(markdown: string): string {
  const lines = markdown.split('\n');
  const result: string[] = [];
  let fence: { character: string; length: number } | null = null;
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index] ?? '';
    if (fence !== null) {
      const closing = /^ {0,3}(`{3,}|~{3,})\s*$/.exec(line);
      if (closing && closing[1]![0] === fence.character && closing[1]!.length >= fence.length) {
        fence = null;
      }
      result.push(line);
      continue;
    }
    const opening = FENCE_OPEN.exec(line);
    if (opening) {
      fence = { character: opening[2]![0]!, length: opening[2]!.length };
      const header = fenceHeader(opening[3] ?? '');
      result.push(header === null ? line : `${line} ${header}`);
      continue;
    }
    if (!QUOTE_LINE.test(line)) {
      // A table is marked rather than rewritten: the native renderer draws its
      // toolbar around the section and copies these very lines.
      if (line.includes('|') && TABLE_DELIMITER.test(lines[index + 1] ?? '')) {
        let last = index + 1;
        while (last + 1 < lines.length && (lines[last + 1] ?? '').includes('|')) last += 1;
        result.push(SESSION_CHAT_NATIVE_TABLE_OPEN, ...lines.slice(index, last + 1), SESSION_CHAT_NATIVE_TABLE_CLOSE);
        index = last;
        continue;
      }
      result.push(markInlineImages(line));
      continue;
    }
    let end = index;
    while (end + 1 < lines.length && QUOTE_LINE.test(lines[end + 1] ?? '')) end += 1;
    const body = lines.slice(index, end + 1).map((quoted) => quoted.replace(QUOTE_MARKER, ''));
    const marker = ALERT_MARKER.exec(body[0] ?? '');
    if (!marker) {
      result.push(...lines.slice(index, end + 1));
      index = end;
      continue;
    }
    result.push(
      `${SESSION_CHAT_NATIVE_ALERT_OPEN}${marker[1]!.toLowerCase()}`,
      // The body is ordinary Markdown once the quote markers are gone, so its
      // own fences still get their headers.
      markBlocks(body.slice(1).join('\n')),
      SESSION_CHAT_NATIVE_ALERT_CLOSE
    );
    index = end;
  }
  return result.join('\n');
}

/** Characters that would be read as emphasis, code, or markup inside a link's visible text. */
const LABEL_SPECIALS = /[\\`*_[\]<>~]/g;
/** A destination that has to be wrapped in angle brackets to survive the parser. */
const DESTINATION_NEEDS_BRACKETS = /[\s()]/;

/**
 * One reference, written as the Markdown link the native renderer draws a pill
 * from. The path travels unchanged: escaping is undone by the parser, so the
 * href and the label the pill is looked up by are the literal path again.
 */
function fileLink(path: string, label: string): string {
  const destination = DESTINATION_NEEDS_BRACKETS.test(path)
    ? `<${path.replaceAll('\\', '\\\\').replaceAll('<', '\\<').replaceAll('>', '\\>')}>`
    : path;
  return `[${label.replace(LABEL_SPECIALS, '\\$&')}](${destination})`;
}

/**
 * Turns the file references written into a message into real Markdown links,
 * which is what the native renderer draws reference pills from.
 *
 * Two kinds, both of which React promotes to the very same chip
 * (session-chat-markdown.tsx renders `.ghostex-chat-markdown-file-chip` and
 * `.ghostex-chat-reference-pill` identically inside the transcript):
 *
 *   * an inline-code span that is a path, in anybody's message, which is how an
 *     agent writes `apps/desktop/src/app/native_sidebar/navigation.rs:41` in the
 *     middle of a sentence (React's remarkSessionChatInlineCode plus the `code`
 *     component); and
 *   * a path somebody typed into a prompt without marking it up, which only a
 *     user turn is scanned for (React's remarkSessionChatBareFilePaths).
 *
 * CDXC:SessionChat 2026-09-19 SEE-ALSO:
 * resolveSessionChatInlineCodeFilePath in file-paths.ts is the single detection
 * rule: a span that becomes a file chip in React becomes a pill here, and
 * ordinary code such as `cargo check` or `chrome_ink().opacity(0.12)` becomes
 * neither.
 */
function linkFileReferences(markdown: string, barePaths: boolean): string {
  const tree = fromMarkdown(markdown);
  const edits: { start: number; end: number; text: string }[] = [];
  const imageReferences: [number, number][] = [];
  if (barePaths) {
    for (const reference of markdown.matchAll(COMPOSER_IMAGE_REFERENCE)) {
      imageReferences.push([reference.index, reference.index + reference[0].length]);
    }
  }
  const walk = (nodes: RootContent[], bare: boolean) => {
    for (const node of nodes) {
      if (node.type === 'link' || node.type === 'linkReference' || node.type === 'definition') continue;
      if (node.type === 'code' || node.type === 'html') continue;
      const start = node.position?.start.offset;
      const end = node.position?.end.offset;
      if (node.type === 'inlineCode') {
        if (start === undefined || end === undefined) continue;
        const reference = resolveSessionChatInlineCodeFilePath(node.value);
        if (reference === null) continue;
        const target = `${reference.path}${sessionChatFilePositionSuffix(reference.position)}`;
        // The whole span including its backticks becomes the link, so the pill
        // reads as the path React's chip shows rather than as quoted code.
        edits.push({ start, end, text: fileLink(target, target) });
        continue;
      }
      if ('children' in node) {
        walk(node.children, bare && !(node.type === 'blockquote' && QUOTED_ALERT.test(markdown.slice(start ?? 0, 60))));
        continue;
      }
      if (!bare || node.type !== 'text' || start === undefined || end === undefined) continue;
      // Scanned against the source rather than the node's value: an escape in
      // the text would otherwise shift every offset after it.
      const source = markdown.slice(start, end);
      for (const found of sessionChatBareFilePaths(source)) {
        const from = start + found.start;
        const to = start + found.end;
        if (imageReferences.some(([referenceStart, referenceEnd]) => from < referenceEnd && to > referenceStart))
          continue;
        edits.push({ start: from, end: to, text: fileLink(found.path, found.path) });
      }
    }
  };
  walk(tree.children, barePaths);
  let result = markdown;
  for (const edit of edits.sort((left, right) => right.start - left.start)) {
    result = `${result.slice(0, edit.start)}${edit.text}${result.slice(edit.end)}`;
  }
  return result;
}

/**
 * The Markdown the GPUI transcript renders for one message.
 *
 * Inline-code file references are promoted in every message, the way React
 * promotes them wherever it renders Markdown. `barePaths` follows React's
 * `chatText` mode on top of that: an unmarked path is only spotted in prose
 * somebody typed, never in an agent's answer, where a path that matters is
 * already inline code or a link.
 */
export function sessionChatNativeMarkdown(markdown: string, barePaths = false): string {
  if (markdown === '') return markdown;
  const bareWanted = barePaths && PATH_EVIDENCE.test(markdown);
  const pathsWanted = bareWanted || INLINE_CODE_PATH_EVIDENCE.test(markdown);
  const blocksWanted =
    markdown.includes('```') ||
    markdown.includes('~~~') ||
    markdown.includes('>') ||
    markdown.includes('|') ||
    IMAGE_EVIDENCE.test(markdown);
  if (!pathsWanted && !blocksWanted) return markdown;
  const linked = pathsWanted ? linkFileReferences(markdown, bareWanted) : markdown;
  return blocksWanted ? markBlocks(linked) : linked;
}
