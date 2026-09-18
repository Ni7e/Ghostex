// Diff extraction for tool calls/results (upstream chat spec §11.4 port).

export const SESSION_CHAT_EDIT_TOOL_NAMES: ReadonlySet<string> = new Set([
  'Edit',
  'MultiEdit',
  'Write',
  'str_replace',
  'apply_patch',
]);

export const SESSION_CHAT_MAX_DIFF_CHARS = 32_000;
export const SESSION_CHAT_DEFAULT_MAX_DIFF_LINES = 120;

export interface SessionChatDiffLine {
  kind: 'add' | 'del' | 'meta' | 'context';
  text: string;
}

const DIFF_TRUNCATED_LINE: SessionChatDiffLine = {
  kind: 'meta',
  text: '… diff truncated …',
};

function toLines(value: unknown, maxLines: number): { lines: string[]; truncated: boolean } {
  if (typeof value !== 'string') {
    return { lines: [], truncated: false };
  }
  const clipped = value.slice(0, SESSION_CHAT_MAX_DIFF_CHARS);
  const lines = clipped.split('\n', maxLines + 1);
  const truncated = value.length > SESSION_CHAT_MAX_DIFF_CHARS || lines.length > maxLines;
  const bounded = lines.slice(0, maxLines);
  if (!truncated && bounded.at(-1) === '') {
    bounded.pop();
  }
  return { lines: bounded, truncated };
}

export function diffFromSessionChatToolCall(
  name: string,
  input: unknown,
  maxLines: number = SESSION_CHAT_DEFAULT_MAX_DIFF_LINES
): SessionChatDiffLine[] | null {
  if (!SESSION_CHAT_EDIT_TOOL_NAMES.has(name) || typeof input !== 'object' || input === null) {
    return null;
  }
  const record = input as Record<string, unknown>;
  const oldValue = record.old_string ?? record.oldString ?? record.old;
  const newValue = record.new_string ?? record.newString ?? record.new ?? record.content ?? record.file_text;
  const oldLines = toLines(oldValue, maxLines);
  const newLines = toLines(newValue, maxLines);
  const deleted: SessionChatDiffLine[] = oldLines.lines.map((text) => ({
    kind: 'del',
    text,
  }));
  const added: SessionChatDiffLine[] = newLines.lines.map((text) => ({
    kind: 'add',
    text,
  }));
  if (deleted.length === 0 && added.length === 0) {
    return null;
  }
  const path = record.file_path ?? record.path;
  const prefix: SessionChatDiffLine[] = typeof path === 'string' ? [{ kind: 'meta', text: path }] : [];
  // ALL dels first, then ALL adds.
  const combined = [...prefix, ...deleted, ...added];
  const truncated = oldLines.truncated || newLines.truncated || combined.length > maxLines;
  return truncated ? [...combined.slice(0, maxLines - 1), DIFF_TRUNCATED_LINE] : combined;
}

/**
 * CDXC:SessionChat 2026-09-18 WHY:
 * Counting leading plus/minus lines mistook Markdown bullets in command output for file changes.
 * Require unified hunk headers and honor their line counts so surrounding output stays uncolored.
 */
export function diffFromSessionChatText(
  text: string,
  maxLines: number = SESSION_CHAT_DEFAULT_MAX_DIFF_LINES
): SessionChatDiffLine[] | null {
  if (text.length === 0) {
    return null;
  }
  const bounded = toLines(text, maxLines);
  let oldRemaining = 0;
  let newRemaining = 0;
  let hasChanges = false;
  const lines: SessionChatDiffLine[] = bounded.lines.map((line) => {
    const hunk = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@(?: .*)?\r?$/.exec(line);
    if (hunk) {
      const oldCount = Number(hunk[2] ?? 1);
      const newCount = Number(hunk[4] ?? 1);
      if (!Number.isSafeInteger(oldCount) || !Number.isSafeInteger(newCount)) {
        oldRemaining = newRemaining = 0;
        return { kind: 'context', text: line };
      }
      oldRemaining = oldCount;
      newRemaining = newCount;
      return { kind: 'meta', text: line };
    }
    if (oldRemaining > 0 || newRemaining > 0) {
      if (line.startsWith('+') && newRemaining > 0) {
        newRemaining -= 1;
        hasChanges = true;
        return { kind: 'add', text: line.slice(1) };
      }
      if (line.startsWith('-') && oldRemaining > 0) {
        oldRemaining -= 1;
        hasChanges = true;
        return { kind: 'del', text: line.slice(1) };
      }
      if (line.startsWith(' ') && oldRemaining > 0 && newRemaining > 0) {
        oldRemaining -= 1;
        newRemaining -= 1;
        return { kind: 'context', text: line };
      }
      if (line.replace(/\r$/, '') === '\\ No newline at end of file') {
        return { kind: 'meta', text: line };
      }
      oldRemaining = newRemaining = 0;
    }
    if (/^(?:diff --git |index |--- |\+\+\+ )/.test(line)) {
      return { kind: 'meta', text: line };
    }
    return { kind: 'context', text: line };
  });
  if (!hasChanges) {
    return null;
  }
  return bounded.truncated ? [...lines.slice(0, maxLines - 1), DIFF_TRUNCATED_LINE] : lines;
}
