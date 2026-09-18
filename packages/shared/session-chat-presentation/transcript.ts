import type { SessionChatMessage } from '../session-chat';
import { orderSessionChatMessages } from '@/packages/core-ui/chat/session-chat-assembler';
import { normalizeSessionChatImageTranscriptMessages } from '@/packages/core-ui/chat/session-chat-image-transcript-markers';
import { normalizeSessionChatLocalCommandMessages } from '@/packages/core-ui/chat/session-chat-local-command-transcript';
import {
  dropSessionChatHiddenMessages,
  sessionChatSuppressedTurnLabel,
} from '@/packages/core-ui/chat/session-chat-noise';
import { foldSessionChatToolMessages } from '@/packages/core-ui/chat/session-chat-tool-fold';
import { completedWorkRenderItems, finalAssistantMessageIds, summaryModeTurns, type CompletedWorkTurn } from './turns';
import { mergeSessionChatMessagesWith } from '@/packages/core-ui/chat/session-chat-merge';

export function normalizeChatTranscript(messages: readonly SessionChatMessage[]): SessionChatMessage[] {
  return dropSessionChatHiddenMessages(
    normalizeSessionChatImageTranscriptMessages(
      normalizeSessionChatLocalCommandMessages(orderSessionChatMessages(messages))
    )
  );
}

export function foldChatTranscript(messages: readonly SessionChatMessage[]): SessionChatMessage[] {
  return foldSessionChatToolMessages(messages, (message) => sessionChatSuppressedTurnLabel(message) !== null);
}

export function completedChatWork(turn: CompletedWorkTurn, deferred?: readonly SessionChatMessage[]) {
  const rows = deferred
    ? mergeSessionChatMessagesWith(
        deferred.filter((message) => message.id !== turn.final?.id),
        turn.work
      )
    : turn.work;
  return foldChatTranscript(normalizeChatTranscript(rows));
}

export function projectChatTranscript(
  messages: readonly SessionChatMessage[],
  working: boolean,
  interactedMessageIds: ReadonlySet<string> = new Set()
) {
  const normalized = normalizeChatTranscript(messages);
  const rendered = foldChatTranscript(normalized);
  const finalIds = finalAssistantMessageIds(rendered, working);
  return {
    normalized,
    rendered,
    items: completedWorkRenderItems(rendered, working, interactedMessageIds, normalized),
    finalIds: [...finalIds],
    summaryTurns: summaryModeTurns(rendered, finalIds, working),
  };
}
