/*
CDXC:SessionChat 2026-09-06 DECISION:
User: a message one Codex agent sends to another shows as a collapsible card titled `Received a message from "<name>"`, in the same shape as the goal and Claude Code status cards (the shared status card since 2026-09-16, leading with a message icon).
Collapsed it shows only the first two lines of the message text; expanding shows the full message rendered as markdown.
*/

import { useLayoutEffect, useRef, useState } from 'react';
import { IconMessage } from '@tabler/icons-react';
import { cn } from '@/packages/components/utils';
import {
  SessionChatStatusCard,
  SessionChatStatusCardChevron,
  SessionChatStatusCardLead,
} from './session-chat-status-card';
import { SessionChatMarkdown } from './session-chat-markdown';
import { SessionChatSubagentLink } from './session-chat-subagent-link';

/**
 * How gxserver writes a decoded inter-agent message: the sender path on the
 * first line, a blank line, then the readable payload (session_chat_decode_codex.rs).
 */
const AGENT_MESSAGE_HEADER = /^Message from (\S+)\n\n([\s\S]*)$/;

export interface SessionChatAgentMessage {
  sender: string;
  body: string;
}

export function parseSessionChatAgentMessage(text: string): SessionChatAgentMessage | null {
  const match = AGENT_MESSAGE_HEADER.exec(text);
  if (!match) {
    return null;
  }
  return { body: match[2]?.trim() ?? '', sender: match[1] ?? '' };
}

/** `/root/windows_support` is addressed as `windows_support` by the agents themselves. */
function agentDisplayName(sender: string): string {
  const segments = sender.split('/').filter((segment) => segment.length > 0);
  return segments.at(-1) ?? sender;
}

/** CDXC:SessionChat 2026-09-14 DECISION: User: received subagent messages use the same font size as the rest of the agent messages, including the header, collapsed preview, and expanded body. */
export function SessionChatAgentMessageCard({ body, sender }: SessionChatAgentMessage) {
  const [expanded, setExpanded] = useState(false);
  const [overflows, setOverflows] = useState(false);
  const previewRef = useRef<HTMLParagraphElement>(null);
  const name = agentDisplayName(sender);

  // The chevron only appears when the clamp actually hides text.
  useLayoutEffect(() => {
    const element = previewRef.current;
    if (!element || expanded) {
      return;
    }
    const measure = (): void => setOverflows(element.scrollHeight > element.clientHeight + 1);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, [body, expanded]);

  const expandable = expanded || overflows;

  return (
    <SessionChatStatusCard
      className='ghostex-chat-activity-row ghostex-chat-status-card'
      data-kind='agent-message'
      data-sender={sender}
      lead={<SessionChatStatusCardLead icon={IconMessage} />}
      title={
        <>
          Received a message from &ldquo;
          <SessionChatSubagentLink name={name} selector={sender} />
          &rdquo; subagent
        </>
      }
      trailing={
        expandable ? (
          <SessionChatStatusCardChevron
            expanded={expanded}
            label={expanded ? 'Collapse agent message' : 'Expand agent message'}
            onClick={() => setExpanded((value) => !value)}
          />
        ) : undefined
      }
    >
      {expanded ? (
        <div className='ghostex-chat-agent-message min-w-0'>
          <SessionChatMarkdown markdown={body} />
        </div>
      ) : (
        <p className={cn('line-clamp-2 whitespace-pre-wrap break-words text-foreground/90')} ref={previewRef}>
          {body}
        </p>
      )}
    </SessionChatStatusCard>
  );
}
