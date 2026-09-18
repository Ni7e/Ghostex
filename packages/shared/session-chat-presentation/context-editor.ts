import type { ContextDetailsAgent } from '@/packages/core-ui/chat/session-chat-context-details-agents';
import {
  isSessionChatContextDetailStarred,
  orderedSessionChatContextDetailRows,
  orderedSessionChatStarredRows,
  type SessionChatContextDetailGroupId,
  type SessionChatContextDetailRowDefinition,
  type SessionChatContextDetailsPreferences,
} from './context-details';

export function moveContextRow<T>(rows: readonly T[], from: number, to: number): T[] {
  const next = [...rows];
  const [moved] = next.splice(from, 1);
  if (moved !== undefined) next.splice(to, 0, moved);
  return next;
}

export function matchesContextDetailFilter(
  query: string,
  row: SessionChatContextDetailRowDefinition,
  sample: string | null
): boolean {
  const needle = query.trim().toLowerCase();
  return (
    needle.length === 0 ||
    [row.label, row.description, sample ?? ''].some((text) => text.toLowerCase().includes(needle))
  );
}

export function toggleContextDetailStar(
  current: SessionChatContextDetailsPreferences,
  row: SessionChatContextDetailRowDefinition,
  agent: ContextDetailsAgent
): SessionChatContextDetailsPreferences {
  const starred = !isSessionChatContextDetailStarred(current, row);
  const withoutRow = orderedSessionChatStarredRows(current, agent)
    .map((row) => row.id)
    .filter((id) => id !== row.id);
  return {
    ...current,
    starred: { ...current.starred, [row.id]: starred },
    starredOrder: starred ? [...withoutRow, row.id] : withoutRow,
  };
}

export function reorderContextDetails(
  current: SessionChatContextDetailsPreferences,
  agent: ContextDetailsAgent,
  group: SessionChatContextDetailGroupId | 'starred',
  fromId: string,
  toId: string
): SessionChatContextDetailsPreferences {
  const rows =
    group === 'starred'
      ? orderedSessionChatStarredRows(current, agent)
      : orderedSessionChatContextDetailRows(current, group, agent);
  const from = rows.findIndex((row) => row.id === fromId);
  const to = rows.findIndex((row) => row.id === toId);
  if (from < 0 || to < 0 || from === to) return current;
  const order = moveContextRow(rows, from, to).map((row) => row.id);
  return group === 'starred'
    ? { ...current, starredOrder: order }
    : { ...current, order: { ...current.order, [group]: order } };
}
