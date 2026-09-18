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

/** A message another Ghostex agent session sent with `ghostex agents send` or `agents create --task`. */
export interface SessionChatInterAgentMessage {
  agentName: string;
  sessionTitle: string;
  sessionId: string;
  agentId: string;
  agentSessionId: string;
  replyTo: string;
  body: string;
}

const INTER_AGENT_HEADER_FIELDS: Readonly<Record<string, keyof SessionChatInterAgentMessage>> = {
  Agent: 'agentName',
  Session: 'sessionTitle',
  'Session ID': 'sessionId',
  'Agent ID': 'agentId',
  'Agent Session ID': 'agentSessionId',
  'Reply to': 'replyTo',
};

/**
 * CDXC:SessionChat 2026-09-18 DECISION:
 * User: messages between agents render as a message from the sending agent, not as the user's own prompt bubble, and the sender header must never show as a heading.
 * Accepts the current header (a blank line before the body) and the pre-2026-09-18 `MESSAGE FROM` header that ended in a dashed line, so transcripts recorded before the format change render the same way.
 * SEE-ALSO: server/src/ghostex_cli/agents/identity.rs writes the header.
 */
export function parseSessionChatInterAgentMessage(text: string): SessionChatInterAgentMessage | null {
  const lines = text.replace(/\r\n/g, '\n').split('\n');
  const opener = lines[0]?.trim();
  if (opener !== 'Message from another agent' && opener !== 'MESSAGE FROM') {
    return null;
  }
  const message: SessionChatInterAgentMessage = {
    agentName: '',
    sessionTitle: '',
    sessionId: '',
    agentId: '',
    agentSessionId: '',
    replyTo: '',
    body: '',
  };
  const seen = new Set<keyof SessionChatInterAgentMessage>();
  let index = 1;
  for (; index < lines.length; index += 1) {
    const field = /^([A-Za-z ]+): (.*)$/.exec(lines[index] ?? '');
    const key = field ? INTER_AGENT_HEADER_FIELDS[field[1] ?? ''] : undefined;
    if (!field || !key) {
      break;
    }
    seen.add(key);
    // The CLI writes `unavailable` for an identifier it could not resolve.
    const value = (field[2] ?? '').trim();
    message[key] = value === 'unavailable' ? '' : value;
  }
  const separator = lines[index]?.trim() ?? '';
  if (!seen.has('agentName') || !seen.has('replyTo') || (separator !== '' && !/^-{3,}$/.test(separator))) {
    return null;
  }
  message.body = lines
    .slice(index + 1)
    .join('\n')
    .trim();
  return message;
}

/** `/root/windows_support` is addressed as `windows_support` by the agents themselves. */
export function agentDisplayName(sender: string): string {
  const segments = sender.split('/').filter((segment) => segment.length > 0);
  return segments.at(-1) ?? sender;
}
