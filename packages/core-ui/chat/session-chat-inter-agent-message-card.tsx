/*
CDXC:SessionChat 2026-09-18 DECISION:
User: a message another agent sent with `ghostex agents send` reads as a message from that agent, not as the user's own prompt bubble, and its sender header is never a heading.
It uses the shared status card shell like the received subagent message: a message icon, "Message from <agent>" with the sending session's title as muted meta, and the full body as chat text.
The identifiers the receiving agent needs (Reply to, Session ID, Agent Session ID) stay in the raw prompt for the agent and are not repeated in the card.
SEE-ALSO: apps/desktop/src/app/native_chat/inter_agent_message.rs renders the same card in the GPUI chat.
*/

import { IconMessage } from '@tabler/icons-react';
import type { ReactNode } from 'react';
import type { SessionChatInterAgentMessage } from '@/packages/shared/session-chat-presentation/agent-message';
import { SessionChatMarkdown } from './session-chat-markdown';
import { SessionChatStatusCard, SessionChatStatusCardLead } from './session-chat-status-card';

export function SessionChatInterAgentMessageCard({
  footer,
  message,
  queued = false,
}: {
  /** Delivery status for a startup send that is still pending or failed. */
  footer?: ReactNode;
  message: SessionChatInterAgentMessage;
  queued?: boolean;
}) {
  return (
    <SessionChatStatusCard
      bodyClassName='text-[var(--chat-prose-foreground)]'
      className='ghostex-chat-activity-row ghostex-chat-status-card'
      data-kind='inter-agent-message'
      data-reply-to={message.replyTo}
      footer={footer}
      lead={<SessionChatStatusCardLead icon={IconMessage} />}
      meta={message.sessionTitle}
      title={`Message from ${message.agentName}`}
      trailing={queued ? <span className='ghostex-chat-queued-label'>Queued</span> : undefined}
    >
      {message.body ? <SessionChatMarkdown chatText markdown={message.body} /> : null}
    </SessionChatStatusCard>
  );
}
