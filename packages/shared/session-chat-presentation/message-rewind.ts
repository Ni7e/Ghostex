/*
CDXC:SessionChat 2026-09-18 SEE-ALSO:
Which prompt offers "Rewind to here", shared by the React rows
(session-chat-message-list/rows.tsx) and the GPUI user rail
(apps/desktop/src/app/native_chat/message_actions.rs, fed through native-presentation.ts).
The surface still decides whether rewinding is possible at all: the host must reach
`/api/rewindSessionChat` and the session must run an agent whose rewind Ghostex drives.
*/

import { isSessionChatPendingMessageId } from '@/packages/core-ui/chat/session-chat-pending';
import type { SessionChatMessage } from '../session-chat';

/** Agents whose own rewind flow Ghostex drives; anything else never offers the action. */
export function sessionChatAgentSupportsRewind(agent: string | null | undefined): boolean {
  return agent === 'claude' || agent === 'codex';
}

/**
 * CDXC:SessionChat 2026-09-02:
 * A rewind target is a prompt the agent has actually taken: the same "genuine user prompt" test
 * the transcript already uses for its turn boundaries (a suppressed harness turn is not one, a
 * `queued` row is still held by the agent's queue) plus the optimistic local echo, which has no
 * transcript row for the daemon to rewind to yet.
 */
export function sessionChatMessageCanRewind(
  message: SessionChatMessage,
  copyText: string,
  suppressed: unknown
): boolean {
  return (
    message.role === 'user' &&
    suppressed === null &&
    copyText.length > 0 &&
    message.queued !== true &&
    !message.startupDelivery &&
    !isSessionChatPendingMessageId(message.id)
  );
}
