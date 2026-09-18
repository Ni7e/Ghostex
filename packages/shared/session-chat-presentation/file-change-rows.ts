// What a file-change card says before either renderer lays it out: the visible
// path, the added/removed counts beside it, and whether it can open. React
// (`session-chat-file-change-card.tsx`) and GPUI (`native_chat/file_change_card.rs`,
// through `native-presentation.ts`) both read these, so a card cannot count or
// shorten differently on the two surfaces.

import type { SessionChatDiffLine } from './diff';

/** How many code lines a card shows while Settings > Chat has previews on. */
export const SESSION_CHAT_FILE_CHANGE_PREVIEW_LINES = 7;

/**
 * GPUI has no start-ellipsis, so the folder half of a long path is shortened
 * here instead. React keeps its CSS `direction: rtl` truncation, which is
 * width-aware; this is the character budget the native card falls back to.
 */
export const SESSION_CHAT_FILE_CHANGE_PARENT_BUDGET = 52;

/** CDXC:SessionChat 2026-09-13 DECISION:
 * User: diff paths start at the current folder; files outside the project keep their full path, with the home directory shortened to ~/ where possible.
 */
export function sessionChatFileChangeDisplayPath(path: string, workingDirectory?: string): string {
  if (!workingDirectory) return path;
  const windows = /^[A-Za-z]:[\\/]/.test(workingDirectory) || workingDirectory.startsWith('\\\\');
  const normalize = (value: string) => (windows ? value.replaceAll('\\', '/') : value).replace(/\/+$/, '');
  const directory = normalize(workingDirectory);
  const normalizedPath = normalize(path);
  const comparable = (value: string) => (windows ? value.toLowerCase() : value);
  const relativeTo = (root: string): string | undefined => {
    if (comparable(normalizedPath).startsWith(`${comparable(root)}/`)) {
      return normalizedPath.slice(root.length + 1);
    }
    return undefined;
  };
  const relative = relativeTo(directory);
  if (relative !== undefined) return relative;
  const home =
    /^(?:\/Users\/[^/]+|\/home\/[^/]+|\/root)(?=\/|$)/.exec(directory)?.[0] ??
    (windows ? /^[A-Za-z]:\/Users\/[^/]+(?=\/|$)/i.exec(directory)?.[0] : undefined);
  if (home) {
    const homeRelative = relativeTo(home);
    if (homeRelative !== undefined) return `~/${homeRelative}`;
  }
  return path;
}

export interface SessionChatFileChangeCounts {
  added: number;
  removed: number;
  /** Diff lines that are not `@@` hunk markers; the preview and fold count these. */
  code: number;
}

export function sessionChatFileChangeCounts(lines: readonly SessionChatDiffLine[]): SessionChatFileChangeCounts {
  let added = 0;
  let removed = 0;
  let code = 0;
  for (const line of lines) {
    if (line.kind === 'meta') continue;
    code += 1;
    if (line.kind === 'add') added += 1;
    else if (line.kind === 'del') removed += 1;
  }
  return { added, removed, code };
}

/**
 * A card with previews on already shows everything it has, so it only opens
 * when there is more than the preview or when the write itself failed.
 */
export function sessionChatFileChangeExpandable(
  counts: SessionChatFileChangeCounts,
  previewEnabled: boolean,
  failed: boolean
): boolean {
  return !previewEnabled || counts.code > SESSION_CHAT_FILE_CHANGE_PREVIEW_LINES || failed;
}

export interface SessionChatFileChangePathParts {
  displayPath: string;
  /** Everything up to and including the last separator, already shortened. */
  parent: string;
  filename: string;
}

export function sessionChatFileChangePathParts(
  path: string,
  workingDirectory?: string,
  budget = SESSION_CHAT_FILE_CHANGE_PARENT_BUDGET
): SessionChatFileChangePathParts {
  const displayPath = sessionChatFileChangeDisplayPath(path, workingDirectory);
  const filename = displayPath.split(/[\\/]/).at(-1) || displayPath;
  const parent = displayPath.slice(0, displayPath.length - filename.length);
  return {
    displayPath,
    parent: parent.length > budget ? `…${parent.slice(parent.length - budget + 1)}` : parent,
    filename,
  };
}
