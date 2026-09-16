import { storageScope } from '@/packages/client-storage';
/*
CDXC:SessionChat 2026-09-09 DECISION:
User: the pending tool card's header and command text use the same font as regular chat, superseding the earlier monospace command area.
The card carries the painted row's text as its header and opens to show the actual tool call text the TUI shows under it.
It remembers whether it was left open or closed, so the next card comes up the same way instead of the chat looking frozen while tools run.
The header shows only the dot on the left, with the expand chevron on the right, and draws no outline of its own.
*/

import { useState } from 'react';
import type { SessionChatTerminalActivity } from '../../shared/session-chat';
import { SessionChatStatusCard, SessionChatStatusCardDot } from './session-chat-status-card';

const clientStorage = storageScope(['terminalExpanded']);

const TERMINAL_TOOL_EXPANDED_STORAGE_KEY = 'ghostex.sessionChat.terminalToolExpanded';

function readTerminalToolExpanded(): boolean {
  try {
    return clientStorage.getItem(TERMINAL_TOOL_EXPANDED_STORAGE_KEY) === 'true';
  } catch {
    // localStorage can be unavailable in isolated story contexts.
    return false;
  }
}

function writeTerminalToolExpanded(expanded: boolean): void {
  try {
    clientStorage.setItem(TERMINAL_TOOL_EXPANDED_STORAGE_KEY, expanded ? 'true' : 'false');
  } catch {
    // Same as above: the preference simply does not persist.
  }
}

export function SessionChatTerminalToolRow({ activity }: { activity: SessionChatTerminalActivity }) {
  const [expanded, setExpanded] = useState(readTerminalToolExpanded);
  const detail = activity.detail?.trim() ?? '';
  const expandable = detail.length > 0;
  const open = expanded && expandable;
  const setOpen = (next: boolean): void => {
    if (!expandable) {
      return;
    }
    setExpanded(next);
    writeTerminalToolExpanded(next);
  };

  return (
    <SessionChatStatusCard
      aria-live='polite'
      className='ghostex-chat-terminal-tool-card ghostex-chat-activity-row ghostex-chat-status-card'
      data-kind={activity.kind}
      lead={<SessionChatStatusCardDot />}
      role='status'
      title={activity.label}
      {...(expandable ? { open, onOpenChange: setOpen } : {})}
    >
      {expandable ? <pre className='ghostex-chat-tool-body'>{detail}</pre> : null}
    </SessionChatStatusCard>
  );
}
