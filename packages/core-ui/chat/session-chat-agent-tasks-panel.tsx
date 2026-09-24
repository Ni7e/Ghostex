import { storageScope } from '@/packages/client-storage';
/*
CDXC:SessionChat 2026-09-03:
Claude Code's task list, the block its TUI pins under the transcript:

      ◼ ⟳ MNS-40: dedupe start_adapter across four test suites
      ◻ ⌛ connection_audit_log flakes under full-suite load
      ✔ ✅ MNS-24: Close the unclassified-POST fail-open hole
        … +16 completed

gxserver reads the CLI's on-disk task store (server/src/session_chat_agent_tasks.rs)
and republishes it whenever a task appears or changes state, so this panel is
always the list the terminal is showing.

It stands directly above the composer and OUTSIDE it, next to the sub-agent
strip, for the same reason that strip does: this is the agent's plan, which
the user can read but not edit. It sits ABOVE the fleet strip because the plan
outlives any one sub-agent that is working on it.

Two folds, both the user's:
  - The whole panel collapses to its header (remembered across sessions in
    localStorage, because "I want the plan out of the way" is a preference,
    not a per-session mood). The header still names the running task, so a
    collapsed panel is a one-line status, not a blank bar.
  - Completed tasks fold behind a text line under a hairline ("N more tasks",
    then "Show less tasks"), keeping the most recent one visible as the "just
    did" marker. Open tasks are what the reader came for; the done pile is
    available on demand.
    CDXC:SessionChat 2026-09-16 DECISION: User: the fold is a text line, not a button, and reads "N more task(s)" / "Show less tasks". Rows are the Subagents row size. The panel is the shared status card with a list icon.

Rows are ordered running → waiting → done, then by the CLI's own numbering
inside each group, so the eye lands on what is happening now first.
*/

import { useEffect, useState } from 'react';
import { IconCircleCheckFilled, IconLoader2, IconListCheck } from '@tabler/icons-react';
import type { SessionChatAgentTasks } from '../../shared/session-chat';
import {
  sessionChatAgentTaskPanel,
  type SessionChatAgentTaskRow,
} from '@/packages/shared/session-chat-presentation/agent-tasks';
import { SessionChatStatusCard, SessionChatStatusCardLead } from './session-chat-status-card';

const clientStorage = storageScope(['tasksCollapsed']);

const COLLAPSED_STORAGE_KEY = 'ghostex.chat.agentTasks.collapsed';

export interface SessionChatAgentTasksPanelProps {
  /** Null or empty renders nothing: no tasks is not a state worth a box. */
  tasks: SessionChatAgentTasks | null;
}

function readCollapsed(): boolean {
  try {
    return clientStorage.getItem(COLLAPSED_STORAGE_KEY) === '1';
  } catch {
    return false;
  }
}

function writeCollapsed(collapsed: boolean): void {
  try {
    if (collapsed) {
      clientStorage.setItem(COLLAPSED_STORAGE_KEY, '1');
    } else {
      clientStorage.removeItem(COLLAPSED_STORAGE_KEY);
    }
  } catch {
    // Storage may be unavailable (private mode); the fold still works for the session.
  }
}

export function SessionChatAgentTasksPanel({ tasks }: SessionChatAgentTasksPanelProps) {
  const [collapsed, setCollapsed] = useState(readCollapsed);
  const [showCompleted, setShowCompleted] = useState(false);
  const list = tasks?.tasks ?? [];
  // A fresh list means a fresh fold: a new plan's done pile starts closed.
  const listSignature = list.length;
  useEffect(() => {
    setShowCompleted(false);
  }, [listSignature]);

  const panel = sessionChatAgentTaskPanel(tasks, { collapsed, showCompleted });
  if (!panel) {
    return null;
  }

  const setOpen = (open: boolean) => {
    setCollapsed(!open);
    writeCollapsed(!open);
  };

  return (
    <SessionChatStatusCard
      aria-label='Agent tasks'
      className='ghostex-chat-agent-tasks'
      data-collapsed={collapsed ? 'true' : undefined}
      lead={<SessionChatStatusCardLead icon={IconListCheck} />}
      // Only the collapsed header carries the running task: expanded, the
      // rows below say it, and saying it twice reads as a glitch.
      meta={panel.meta}
      bodyTransitionKey={showCompleted}
      onOpenChange={setOpen}
      open={!collapsed}
      title='Tasks'
      toggleTitle={{ open: 'Hide tasks', closed: 'Show tasks' }}
      trailing={
        <span aria-hidden='true' className='ghostex-chat-status-card-lead'>
          <span className='ghostex-chat-agent-tasks-bar'>
            <span className='ghostex-chat-agent-tasks-bar-fill' style={{ width: `${panel.percent}%` }} />
          </span>
        </span>
      }
    >
      <ul className='ghostex-chat-agent-tasks-rows'>
        {panel.rows.map((row) => (
          <TaskRow key={row.id} row={row} />
        ))}
      </ul>
      {panel.foldLabel ? (
        <div className='ghostex-chat-agent-tasks-fold'>
          <button
            aria-expanded={showCompleted}
            className='ghostex-chat-agent-tasks-fold-toggle'
            onClick={() => setShowCompleted((value) => !value)}
            type='button'
          >
            {panel.foldLabel}
          </button>
        </div>
      ) : null}
    </SessionChatStatusCard>
  );
}

function TaskRow({ row }: { row: SessionChatAgentTaskRow }) {
  return (
    <li className='ghostex-chat-agent-tasks-row' data-status={row.group} title={row.title}>
      <span aria-hidden='true' className='ghostex-chat-agent-tasks-marker'>
        {row.group === 'in_progress' ? (
          <IconLoader2 className='ghostex-chat-agent-tasks-spinner' size={13} stroke={2} />
        ) : row.group === 'completed' ? (
          <IconCircleCheckFilled size={13} stroke={2} />
        ) : (
          <span className='ghostex-chat-agent-tasks-dot' />
        )}
      </span>
      <span className='ghostex-chat-card-content ghostex-chat-agent-tasks-subject'>{row.subject}</span>
      {row.blockedLabel ? (
        <span className='ghostex-chat-card-hint [--chat-card-hint-base:0.6875rem] ghostex-chat-agent-tasks-blocked'>
          {row.blockedLabel}
        </span>
      ) : null}
    </li>
  );
}
