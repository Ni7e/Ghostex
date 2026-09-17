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
export function agentDisplayName(sender: string): string {
  const segments = sender.split('/').filter((segment) => segment.length > 0);
  return segments.at(-1) ?? sender;
}

