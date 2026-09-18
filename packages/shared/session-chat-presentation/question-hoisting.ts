/*
CDXC:SessionChat 2026-09-18 SEE-ALSO:
The hoisting rule for answered question cards, shared by the React message list
(session-chat-message-list/list.tsx) and the GPUI transcript
(apps/desktop/src/app/native_chat/question_exchange.rs, fed through native-presentation.ts).
The user's answer never writes a user row: the whole ask/answer exchange lives in tool blocks
between two user turns, so without hoisting it would vanish into the collapsed "Worked for Xs"
section. The raw tool pairs stay as plain rows inside the expanded work log, so nothing renders twice.
*/

import { pairSessionChatToolBlocks, splitSessionChatBlocks } from '@/packages/core-ui/chat/session-chat-tool-fold';
import { answeredSessionChatQuestionExchange, type SessionChatQuestionExchange } from './questions';
import type { SessionChatMessage } from '../session-chat';

/** The answered exchanges one message's tool blocks carry, in the order they were asked. */
export function sessionChatMessageQuestionExchanges(message: SessionChatMessage): SessionChatQuestionExchange[] {
  const { tools } = splitSessionChatBlocks(message.blocks);
  const out: SessionChatQuestionExchange[] = [];
  for (const pair of pairSessionChatToolBlocks(tools)) {
    const exchange = answeredSessionChatQuestionExchange(pair);
    if (exchange) {
      out.push(exchange);
    }
  }
  return out;
}

/** Every answered exchange a completed turn's work carries, lifted out of the fold. */
export function hoistedSessionChatQuestionExchanges(
  work: readonly SessionChatMessage[]
): { exchange: SessionChatQuestionExchange; key: string }[] {
  const out: { exchange: SessionChatQuestionExchange; key: string }[] = [];
  for (const message of work) {
    sessionChatMessageQuestionExchanges(message).forEach((exchange, index) => {
      out.push({ exchange, key: `${message.id}:${index}` });
    });
  }
  return out;
}
