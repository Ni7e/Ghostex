import type { SessionChatDraft, SessionChatQueuedPrompt } from '../session-chat';
import type { SessionChatDraftVersion } from '../session-chat-queue';
import { parseSessionChatInterAgentMessage } from '../session-chat-presentation/agent-message';
/**
 * How many rows the strip shows before it scrolls. The composer must stay the
 * dominant thing in the footer, so a long queue scrolls rather than pushing
 * the input off the pane.
 */
export const SESSION_CHAT_QUEUE_VISIBLE_ROWS = 5;

/** Long-press duration that turns a Send tap into a queue (plan 016 §1). */
export const SESSION_CHAT_QUEUE_LONG_PRESS_MS = 500;

/**
 * A row is one line. Show the first line that has any content: a prompt that
 * opens with a blank line, a heading, or a fenced block would otherwise render
 * an empty row and look broken.
 *
 * CDXC:SessionChat 2026-09-24 WHY: a message from another agent opens with the same `Message from another agent` header line every time, so its row names the sender and shows the body instead.
 * SEE-ALSO: packages/gx-chat-core/src/composer/queue.rs `queue_row_preview`.
 */
export function sessionChatQueueRowPreview(text: string): string {
  const agentMessage = parseSessionChatInterAgentMessage(text);
  if (agentMessage) {
    return `From ${agentMessage.agentName}: ${firstContentLine(agentMessage.body)}`;
  }
  return firstContentLine(text);
}

function firstContentLine(text: string): string {
  for (const line of text.split('\n')) {
    const trimmed = line.trim();
    if (trimmed !== '') {
      return trimmed;
    }
  }
  return text.trim();
}

/** Row ids, head first — the exact shape /api/reorderSessionChatQueue wants. */
export function sessionChatQueuePromptIds(queue: readonly SessionChatQueuedPrompt[]): string[] {
  return queue.map((prompt) => prompt.id);
}

/**
 * Optimistic reorder: the strip shows the new order on drop, and the
 * authoritative queue from the mutation's answer replaces it a moment later.
 * Out-of-range indexes return the list untouched rather than throwing, because
 * a drop can resolve against a row that a state frame just removed.
 */
export function moveSessionChatQueueRow(
  queue: readonly SessionChatQueuedPrompt[],
  fromIndex: number,
  toIndex: number
): SessionChatQueuedPrompt[] {
  const next = [...queue];
  if (fromIndex === toIndex || fromIndex < 0 || fromIndex >= next.length || toIndex < 0 || toIndex >= next.length) {
    return next;
  }
  const [moved] = next.splice(fromIndex, 1);
  if (moved === undefined) {
    return next;
  }
  next.splice(toIndex, 0, moved);
  return next;
}

/**
 * A `sending` row is being delivered by the server scheduler right now. Editing,
 * reordering or deleting it would race the send, so every row control is
 * refused on it (see SessionChatQueuedPromptState).
 */
export function isSessionChatQueueRowBusy(prompt: SessionChatQueuedPrompt): boolean {
  return prompt.state === 'sending';
}

/**
 * The row the Alt+ArrowUp composer gesture edits: the one nearest the input,
 * which is the TAIL of the head-first list the strip renders top to bottom.
 * `sending` rows are skipped for the same reason their Edit button is disabled
 * — editing one would race the send already in flight — so the gesture reaches
 * the last row a user could actually have clicked Edit on.
 */
export function lastEditableSessionChatQueueRow(
  queue: readonly SessionChatQueuedPrompt[]
): SessionChatQueuedPrompt | null {
  for (let index = queue.length - 1; index >= 0; index -= 1) {
    const prompt = queue[index];
    if (prompt && !isSessionChatQueueRowBusy(prompt)) {
      return prompt;
    }
  }
  return null;
}

/**
 * Both capability gates in one place (see the transport's queue section):
 * the daemon must have reported a `queue` array AND this host's transport must
 * implement the method. Anything false hides that control outright instead of
 * offering a button that 404s or silently does nothing.
 */
export interface SessionChatQueueCapabilities {
  /** The daemon answered with a queue at all. False hides the whole strip. */
  supported: boolean;
  canQueue: boolean;
  canEdit: boolean;
  canRemove: boolean;
  canReorder: boolean;
  canSendNow: boolean;
  canRetry: boolean;
  canSyncDraft: boolean;
}

export function sessionChatQueueCapabilities(params: {
  /** True once a read/frame carried a `queue` field (even an empty array). */
  daemonSupportsQueue: boolean;
  transport: {
    queuePrompt?: unknown;
    updateQueuedPrompt?: unknown;
    removeQueuedPrompt?: unknown;
    reorderQueue?: unknown;
    sendQueuedPrompt?: unknown;
    setDraft?: unknown;
  };
}): SessionChatQueueCapabilities {
  const { daemonSupportsQueue, transport } = params;
  const gate = (method: unknown): boolean => daemonSupportsQueue && typeof method === 'function';
  return {
    // Editing a row is a remove + a re-queue, so it needs both endpoints.
    canEdit: gate(transport.removeQueuedPrompt) && gate(transport.queuePrompt),
    canQueue: gate(transport.queuePrompt),
    canRemove: gate(transport.removeQueuedPrompt),
    canReorder: gate(transport.reorderQueue),
    canRetry: gate(transport.updateQueuedPrompt),
    canSendNow: gate(transport.sendQueuedPrompt),
    // Draft sync is independent of the queue: a daemon can carry drafts while
    // this host has no queue endpoints, and neither hides anything.
    canSyncDraft: typeof transport.setDraft === 'function',
    supported: daemonSupportsQueue,
  };
}

/** ISO-8601 millis ordering. Unparseable input never counts as newer. */
export function isNewerSessionChatDraftStamp(candidate: string, reference: string | null): boolean {
  const at = Date.parse(candidate);
  if (Number.isNaN(at)) {
    return false;
  }
  if (reference === null) {
    return true;
  }
  const referenceAt = Date.parse(reference);
  return Number.isNaN(referenceAt) ? true : at > referenceAt;
}

/**
 * Offer a different saved draft only when it is still relevant to the live composer.
 * Deliberately conservative:
 *
 * - a draft this client wrote is its own echo and never offered;
 * - identical content is nothing to offer;
 * - an EMPTY incoming draft is never offered, because "Use" on it would clear
 *   the local composer — the exact clobber the whole bar exists to prevent.
 *   Another device clearing its draft simply stops proposing.
 *
 * The caller never applies the result on its own: the bar is shown and the
 * user presses Use.
 */
export function shouldOfferSessionChatDraft(params: {
  incoming: SessionChatDraft | null;
  clientId: string;
  /** Newest stamp already applied or dismissed here; null before the first. */
  lastHandledUpdatedAt: string | null;
  /** Live composer text, so an identical draft never nags. */
  composerText: string;
  localVersion?: SessionChatDraftVersion;
}): boolean {
  const { clientId, composerText, incoming, lastHandledUpdatedAt, localVersion } = params;
  if (!incoming || incoming.parked || incoming.originClientId === clientId) {
    return false;
  }
  if (
    incoming.version &&
    ((localVersion?.draftId === incoming.version.draftId && localVersion.revision >= incoming.version.revision) ||
      incoming.consumedDrafts?.some(
        (receipt) => receipt.draftId === incoming.version!.draftId && receipt.revision >= incoming.version!.revision
      ))
  )
    return false;
  if (incoming.content === composerText || incoming.content.trim() === '') {
    return false;
  }
  return isNewerSessionChatDraftStamp(incoming.updatedAt, lastHandledUpdatedAt);
}

/** Receipts are monotonic even when an older save response follows a newer frame. */
export function mergeSessionChatDraftState(
  current: SessionChatDraft | null,
  incoming: SessionChatDraft
): SessionChatDraft {
  const consumed = new Map<string, number>();
  for (const receipt of [...(current?.consumedDrafts ?? []), ...(incoming.consumedDrafts ?? [])]) {
    consumed.set(receipt.draftId, Math.max(consumed.get(receipt.draftId) ?? 0, receipt.revision));
  }
  const body =
    current?.version &&
    current.version.draftId === incoming.version?.draftId &&
    current.version.revision > incoming.version.revision
      ? current
      : incoming;
  const retired = body.version && (consumed.get(body.version.draftId) ?? 0) >= body.version.revision;
  const delivered = new Map(
    [...(current?.deliveredDrafts ?? []), ...(incoming.deliveredDrafts ?? [])].map((receipt) => [receipt.id, receipt])
  );
  return {
    ...body,
    content: retired ? '' : body.content,
    consumedDrafts: [...consumed].map(([draftId, revision]) => ({ draftId, revision })),
    deliveredDrafts: [...delivered.values()]
      .sort((left, right) => right.deliveredAt.localeCompare(left.deliveredAt) || right.id.localeCompare(left.id))
      .slice(0, 50),
  };
}
