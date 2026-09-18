/**
 * Cmd+F over the transcript.
 *
 * React searches the rendered DOM (session-chat-search.tsx) because it has one;
 * GPUI chat has a list of projected items instead, so the same query runs over
 * the text those items carry. Both are case-insensitive, both count occurrences
 * per row, and both keep the selected occurrence across a transcript refresh, so
 * a search reads the same in either renderer.
 */

type Item = Record<string, unknown>;

function messageText(message: unknown): string {
  const record = message as Item | null | undefined;
  if (!record || typeof record !== 'object') return '';
  const parts: string[] = [];
  if (typeof record.text === 'string') parts.push(record.text);
  const suppressed = record.suppressed as Item | null | undefined;
  if (suppressed && typeof suppressed.label === 'string') parts.push(suppressed.label);
  for (const tool of Array.isArray(record.tools) ? (record.tools as Item[]) : []) {
    const call = tool.call as Item | null | undefined;
    if (call && typeof call.name === 'string') parts.push(call.name);
    if (typeof tool.preview === 'string') parts.push(tool.preview);
  }
  for (const file of Array.isArray(record.files) ? (record.files as Item[]) : []) {
    if (typeof file.path === 'string') parts.push(file.path);
  }
  return parts.filter(Boolean).join('\n');
}

/** Everything a reader can see in one transcript row, joined for matching. */
export function sessionChatTranscriptItemText(item: unknown): string {
  const record = item as Item | null | undefined;
  if (!record || typeof record !== 'object') return '';
  const parts: string[] = [];
  if (typeof record.label === 'string') parts.push(record.label);
  for (const key of ['message', 'user', 'final'] as const) {
    if (record[key]) parts.push(messageText(record[key]));
  }
  for (const key of ['work', 'artifacts'] as const) {
    for (const message of Array.isArray(record[key]) ? (record[key] as unknown[]) : []) {
      parts.push(messageText(message));
    }
  }
  return parts.filter(Boolean).join('\n');
}

function itemId(item: unknown): string {
  const record = item as Item | null | undefined;
  const message = record?.message as Item | undefined;
  const id = typeof record?.id === 'string' ? record.id : typeof message?.id === 'string' ? message.id : '';
  return `${typeof record?.kind === 'string' ? record.kind : ''}:${id}`;
}

export interface SessionChatTranscriptMatch {
  /** Index into the transcript item list the host ships to the renderer. */
  itemIndex: number;
  /** Identity that survives a transcript refresh: row id plus occurrence. */
  key: string;
}

/** Every occurrence of `query`, row by row, in transcript order. */
export function sessionChatTranscriptMatches(items: readonly unknown[], query: string): SessionChatTranscriptMatch[] {
  const needle = query.trim().toLowerCase();
  if (!needle) return [];
  const matches: SessionChatTranscriptMatch[] = [];
  for (const [itemIndex, item] of items.entries()) {
    const haystack = sessionChatTranscriptItemText(item).toLowerCase();
    if (!haystack) continue;
    const id = itemId(item);
    let occurrence = 0;
    for (let at = haystack.indexOf(needle); at >= 0; at = haystack.indexOf(needle, at + needle.length)) {
      matches.push({ itemIndex, key: `${id}#${occurrence}` });
      occurrence++;
    }
  }
  return matches;
}

/** The terminal-style counter beside the field: "3/12", "N/A", or nothing yet. */
export function sessionChatSearchCountLabel(query: string, total: number, activeIndex: number): string {
  if (!query.trim()) return '';
  return total > 0 ? `${activeIndex + 1}/${total}` : 'N/A';
}
