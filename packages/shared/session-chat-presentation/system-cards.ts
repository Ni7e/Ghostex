import { SESSION_CHAT_CODEX_GOAL_ID_PREFIX } from '@/packages/core-ui/chat/session-chat-pending';
import { SESSION_CHAT_FORK_BOUNDARY_ID_PREFIX, type SessionChatMessage } from '../session-chat';
import { agentDisplayName, parseSessionChatAgentMessage } from './agent-message';

/** The id `sessionChatPendingMessages` writes for a local command's captured output. */
const APP_COMMAND_OUTPUT_ID_PREFIX = 'app-command-output:';
/** The id it writes for a command Ghostex ran on the session's behalf, of which the rename is the one with its own card. */
const APP_COMMAND_ID_PREFIX = 'app-command:';
const AUTO_NAMED_TITLE_LEAD = 'Ghostex auto named this session';

/**
 * A system row that is a card or a rule rather than a sentence, with everything
 * the card shows. `marker` is the ordinary case: one muted line of the text the
 * daemon wrote.
 */
export type SessionChatSystemCard =
  | { kind: 'auto-named'; title: string }
  | { kind: 'fork-boundary'; text: string }
  | { kind: 'goal'; status: string; objective: string; usage: string }
  | { kind: 'command-output'; command: string; output: string }
  | { kind: 'agent-message'; sender: string; name: string; body: string }
  | { kind: 'marker'; text: string };

function blockText(message: SessionChatMessage, index: number): string {
  const block = message.blocks[index];
  return block?.type === 'text' ? block.text : '';
}

/**
 * Which card a system turn renders as, or null when the turn is not a system
 * turn. Both renderers classify here so a row cannot be a titled card in one
 * and raw prose in the other; each renderer owns only the layout of the card it
 * is handed.
 *
 * Suppressed harness turns are decided first by `sessionChatSuppressedTurnPresentation`
 * and never reach this.
 */
export function classifySessionChatSystemCard(
  message: SessionChatMessage,
  markdown: string
): SessionChatSystemCard | null {
  if (message.role !== 'system') {
    return null;
  }
  const autoNamedTitle =
    message.id.startsWith(APP_COMMAND_ID_PREFIX) && blockText(message, 0) === AUTO_NAMED_TITLE_LEAD
      ? blockText(message, 1).trim()
      : '';
  if (autoNamedTitle.length > 0) {
    return { kind: 'auto-named', title: autoNamedTitle };
  }
  if (message.id.startsWith(SESSION_CHAT_FORK_BOUNDARY_ID_PREFIX)) {
    return { kind: 'fork-boundary', text: markdown };
  }
  if (message.id.startsWith(SESSION_CHAT_CODEX_GOAL_ID_PREFIX)) {
    return {
      kind: 'goal',
      status: blockText(message, 0),
      objective: blockText(message, 1),
      usage: blockText(message, 2),
    };
  }
  if (message.id.startsWith(APP_COMMAND_OUTPUT_ID_PREFIX)) {
    return { kind: 'command-output', command: blockText(message, 0), output: blockText(message, 1) };
  }
  const agentMessage = parseSessionChatAgentMessage(markdown);
  if (agentMessage) {
    return {
      kind: 'agent-message',
      sender: agentMessage.sender,
      name: agentDisplayName(agentMessage.sender),
      body: agentMessage.body,
    };
  }
  return { kind: 'marker', text: markdown };
}
