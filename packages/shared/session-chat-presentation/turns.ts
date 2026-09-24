import type { SessionChatMessage } from '../session-chat';
import { isSessionChatCommandTurn, sessionChatSuppressedTurnLabel } from '@/packages/core-ui/chat/session-chat-noise';
import { SESSION_CHAT_STREAMING_ID } from '@/packages/core-ui/chat/session-chat-streaming';

/**
 * CDXC:SessionChat 2026-09-17 DECISION:
 * User: keep React as the desktop default, make GPUI chat opt-in, and share behavior, presentation rules, and settings with the retained React chat.
 * Turn boundaries, completed work, final replies, and summaries have one implementation consumed by both renderers.
 */
export interface CompletedWorkTurn {
  final: SessionChatMessage | undefined;
  user: SessionChatMessage;
  work: SessionChatMessage[];
}

export interface SummaryModeTurn {
  active: boolean;
  activeWork: SessionChatMessage[];
  final: SessionChatMessage | null;
  user: SessionChatMessage;
}

export type SessionChatRenderItem =
  { kind: 'message'; message: SessionChatMessage } | { kind: 'completed-work'; turn: CompletedWorkTurn };

function hasAgentResponseContent(message: SessionChatMessage): boolean {
  return (
    message.role === 'assistant' &&
    message.id !== SESSION_CHAT_STREAMING_ID &&
    message.blocks.some(
      (block) => block.type === 'image-ref' || (block.type === 'text' && block.text.trim().length > 0)
    )
  );
}

/** One compact row per genuine user prompt, paired with its settled final reply. */
export function summaryModeTurns(
  messages: readonly SessionChatMessage[],
  finalAssistantMessageIds: ReadonlySet<string>,
  isWorking: boolean
): SummaryModeTurn[] {
  const turns: SummaryModeTurn[] = [];
  let current: SummaryModeTurn | null = null;

  for (const message of messages) {
    // A held prompt (agent-CLI queue row, mid-turn send echo — `queued`) has
    // not started its own response yet: it stays inside the working turn's
    // activeWork instead of opening a turn whose reply would never come.
    const isGenuineUserMessage =
      (message.role === 'user' && message.queued !== true && sessionChatSuppressedTurnLabel(message) === null) ||
      isSessionChatCommandTurn(message);
    if (isGenuineUserMessage) {
      current = { active: false, activeWork: [], final: null, user: message };
      turns.push(current);
    } else if (current !== null) {
      current.activeWork.push(message);
      if (finalAssistantMessageIds.has(message.id)) {
        current.final = message;
      }
    }
  }
  const newest = turns.at(-1);
  if (isWorking && newest) {
    newest.active = true;
  }
  return turns;
}

export function isVisibleAssistantArtifact(message: SessionChatMessage): boolean {
  return message.role === 'assistant' && message.blocks.some((block) => block.type === 'image-ref');
}

export function partitionCompletedChatWork(messages: readonly SessionChatMessage[]) {
  const visibleArtifacts: SessionChatMessage[] = [];
  const collapsedWork: SessionChatMessage[] = [];
  for (const message of messages) {
    (isVisibleAssistantArtifact(message) || message.role === 'user' ? visibleArtifacts : collapsedWork).push(message);
  }
  return { visibleArtifacts, collapsedWork };
}

/**
 * Where the response the agent is CURRENTLY producing begins: the last user
 * row that is a genuine prompt the agent has accepted for delivery. A
 * harness-injected turn (task notification, local command output) and a
 * prompt the agent CLI is still holding in its queue (`queued`, including the
 * optimistic echo of a send made mid-turn) both land as user rows WHILE the
 * agent is mid-response — none of them starts a new response, so none of them
 * may settle the one in flight. Falls back to 0 when no such prompt exists
 * (stitched scroll-back that opens mid-conversation): the whole tail is the
 * live response then.
 */
function activeResponseStartIndex(messages: readonly SessionChatMessage[]): number {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (
      message &&
      message.role === 'user' &&
      message.queued !== true &&
      sessionChatSuppressedTurnLabel(message) === null
    ) {
      return index;
    }
  }
  return 0;
}

/** One copy affordance per response: the last assistant text before the next user turn. */
export function finalAssistantMessageIds(
  messages: readonly SessionChatMessage[],
  isWorking: boolean
): ReadonlySet<string> {
  const ids = new Set<string>();
  let finalAssistantId: string | null = null;
  const activeStart = isWorking ? activeResponseStartIndex(messages) : messages.length;

  const commitTurn = (): void => {
    if (finalAssistantId !== null) {
      ids.add(finalAssistantId);
      finalAssistantId = null;
    }
  };

  messages.forEach((message, index) => {
    // A harness-injected turn (a background-task notification, local command
    // output, a message from another session) is authored by the terminal, not
    // by the reader: the agent is still mid-response on both sides of it.
    // Ending the turn there put a copy affordance under commentary that the
    // agent then kept building on.
    if (sessionChatSuppressedTurnLabel(message) !== null && !isSessionChatCommandTurn(message)) {
      return;
    }
    if (message.role === 'user') {
      // A user row past the active response's start is a held prompt (the
      // agent's queue, or a mid-turn send's echo): the text before it is
      // still commentary, so it must not mint a final reply.
      if (index > activeStart) {
        finalAssistantId = null;
      } else {
        commitTurn();
      }
      return;
    }
    if (
      message.role === 'assistant' &&
      message.blocks.some((block) => block.type === 'text' && block.text.trim().length > 0)
    ) {
      finalAssistantId = message.id;
    }
  });
  // The newest assistant text is only a final reply once the turn has
  // finished. While the agent is still working it is commentary, even when it
  // happens to be the most recent text block for a moment.
  if (!isWorking) {
    commitTurn();
  }
  return ids;
}

/**
 * A completed interaction keeps the user's message and the agent's final
 * response in the normal transcript flow. Everything the agent emitted in
 * between becomes one collapsed work section.
 *
 * While the agent is still working, everything from the active response's
 * start onward stays expanded. "Newest turn" is NOT enough for that guard: a
 * harness-injected user row (task notification, local command output) or a
 * held prompt (agent-CLI queue row, mid-turn send echo) lands mid-response
 * and would close the streaming turn the moment it appears — folding live
 * work into a "Worked for" row and yanking the bottom-pinned viewport onto
 * it, only for the fold to vanish again when the injected row settles.
 */
export function completedWorkRenderItems(
  messages: readonly SessionChatMessage[],
  isWorking: boolean,
  interactedMessageIds: ReadonlySet<string>,
  rawMessages: readonly SessionChatMessage[]
): SessionChatRenderItem[] {
  const items: SessionChatRenderItem[] = [];
  const rawIndices = new Map(rawMessages.map((message, index) => [message.id, index]));
  const activeStart = isWorking ? activeResponseStartIndex(messages) : messages.length;
  let index = 0;
  while (index < messages.length) {
    const message = messages[index];
    if (!message || message.role !== 'user') {
      if (message) {
        items.push({ kind: 'message', message });
      }
      index += 1;
      continue;
    }

    let nextUserIndex = index + 1;
    while (
      nextUserIndex < messages.length &&
      (messages[nextUserIndex]?.role !== 'user' ||
        (message.deferredWork && messages[nextUserIndex]?.byteOffset === undefined))
    ) {
      nextUserIndex += 1;
    }
    const turnMessages = messages.slice(index + 1, nextUserIndex);
    let finalIndex = -1;
    for (let turnIndex = turnMessages.length - 1; turnIndex >= 0; turnIndex -= 1) {
      const candidate = turnMessages[turnIndex];
      if (candidate && hasAgentResponseContent(candidate)) {
        finalIndex = turnIndex;
        break;
      }
    }
    const interactedInlineDiff = turnMessages.some((turnMessage) => interactedMessageIds.has(turnMessage.id));
    const interactedGroupedDiff = interactedMessageIds.has(message.id);
    if (
      (!message.deferredWork && finalIndex < 0) ||
      (index >= activeStart && !interactedGroupedDiff) ||
      interactedInlineDiff
    ) {
      items.push({ kind: 'message', message });
      for (const turnMessage of turnMessages) {
        items.push({ kind: 'message', message: turnMessage });
      }
      index = nextUserIndex;
      continue;
    }

    const final = turnMessages[finalIndex];
    const rawStart = rawIndices.get(message.id)!;
    const nextUser = messages[nextUserIndex];
    const rawEnd = nextUser ? rawIndices.get(nextUser.id)! : rawMessages.length;
    items.push({ kind: 'message', message });
    items.push({
      kind: 'completed-work',
      turn: {
        final,
        user: message,
        work: rawMessages.slice(rawStart + 1, rawEnd).filter((row) => row.id !== final?.id),
      },
    });
    index = nextUserIndex;
  }
  return items;
}

/** What a transcript remembers about its last fold: the newest row it had when it settled. */
export interface SessionChatFoldMemory {
  settledAtMessageId?: string;
}

/**
 * CDXC:SessionChat 2026-09-24 DECISION:
 * User: once a turn has folded into "Worked for Xs", a working blip alone must not reopen it; it reopens (animated) only when a new transcript row lands, and folds again when that work ends.
 * The live signal still flaps at turn boundaries (hooks, a Stop hook that continues the turn, a follow-up), and the 8-second settle hold that used to hide that is gone. So a transcript that settled keeps treating the session as settled until its newest row changes; any appended row (a tool call, a streamed reply, a task notification, a new prompt) hands the decision back to the live signal.
 * Returns the working flag the projection should use, and records the settle into `memory`, which the caller keeps for the life of one transcript.
 */
export function stickySessionChatTranscriptWorking(
  messages: readonly SessionChatMessage[],
  working: boolean,
  memory: SessionChatFoldMemory
): boolean {
  const newest = messages.at(-1)?.id;
  const effective = working && (memory.settledAtMessageId === undefined || memory.settledAtMessageId !== newest);
  memory.settledAtMessageId = effective ? undefined : newest;
  return effective;
}

export function workedDurationLabel(startedAt: number | null, completedAt: number | null): string {
  if (startedAt === null || completedAt === null || completedAt < startedAt) {
    return 'Worked';
  }
  const seconds = Math.max(1, Math.round((completedAt - startedAt) / 1000));
  if (seconds < 60) {
    return `Worked for ${seconds}s`;
  }
  const minutes = Math.floor(seconds / 60);
  const remainder = seconds % 60;
  return `Worked for ${minutes}m${remainder > 0 ? ` ${remainder}s` : ''}`;
}
