import type { SessionChatAgentTask, SessionChatAgentTasks } from '../session-chat';

export type SessionChatAgentTaskGroup = 'in_progress' | 'pending' | 'completed';

function taskGroup(task: SessionChatAgentTask): SessionChatAgentTaskGroup {
  if (task.status === 'in_progress' || task.status === 'completed') {
    return task.status;
  }
  return 'pending';
}

function taskOrder(task: SessionChatAgentTask): number {
  const parsed = Number.parseInt(task.id, 10);
  return Number.isFinite(parsed) ? parsed : Number.MAX_SAFE_INTEGER;
}

function byCliOrder(left: SessionChatAgentTask, right: SessionChatAgentTask): number {
  return taskOrder(left) - taskOrder(right) || left.id.localeCompare(right.id);
}

export interface SessionChatAgentTaskRow {
  id: string;
  group: SessionChatAgentTaskGroup;
  subject: string;
  /** "waits for #3, #4" under a pending row, or "". */
  blockedLabel: string;
  /** Hover text: the blockers spelled out, else the subject. */
  title: string;
}

export interface SessionChatAgentTaskPanel {
  /** "4 of 9 done", with the running task appended while collapsed. */
  meta: string;
  /** Rows in running → waiting → done order, already folded. */
  rows: SessionChatAgentTaskRow[];
  /** 0..100, the header's progress bar. */
  percent: number;
  /** "3 more tasks" / "Show less tasks", or "" when nothing is folded. */
  foldLabel: string;
  /** Rows the fold is hiding right now. */
  foldedCount: number;
}

/**
 * CDXC:SessionChat 2026-09-18 SEE-ALSO:
 * packages/core-ui/chat/session-chat-agent-tasks-panel.tsx and apps/desktop/src/app/native_chat/agent_tasks.rs render this projection; row order, the done fold and the header line must not be recomputed in either renderer.
 */
export function sessionChatAgentTaskPanel(
  tasks: SessionChatAgentTasks | null | undefined,
  { collapsed, showCompleted }: { collapsed: boolean; showCompleted: boolean }
): SessionChatAgentTaskPanel | null {
  const list = tasks?.tasks ?? [];
  if (list.length === 0) {
    return null;
  }
  const running = list.filter((task) => taskGroup(task) === 'in_progress').sort(byCliOrder);
  const waiting = list.filter((task) => taskGroup(task) === 'pending').sort(byCliOrder);
  const done = list.filter((task) => taskGroup(task) === 'completed').sort(byCliOrder);
  const doneCount = done.length;
  const total = list.length;
  // Only OPEN tasks can still block: a finished blocker is no longer a wait.
  const subjectById = new Map(
    list.filter((task) => taskGroup(task) !== 'completed').map((task) => [task.id, task.subject])
  );
  // The latest completed task stays visible as the "just did" marker, like the
  // CLI; the rest fold behind the count until asked for.
  const latestDone = done.length > 0 ? done[done.length - 1]! : null;
  const foldedDone = done.slice(0, -1);
  const visibleDone = showCompleted ? done : latestDone ? [latestDone] : [];
  const headline = running[0] ?? waiting[0] ?? null;
  const countText = `${doneCount} of ${total} done`;
  const headlineText = headline
    ? headline.status === 'in_progress'
      ? (headline.activeForm ?? headline.subject)
      : headline.subject
    : null;
  const row = (task: SessionChatAgentTask, group: SessionChatAgentTaskGroup): SessionChatAgentTaskRow => {
    const blockers = (task.blockedBy ?? []).filter((id) => id !== task.id && subjectById.has(id));
    const blockedTitle =
      blockers.length > 0
        ? `Waits for ${blockers.map((id) => `#${id} ${subjectById.get(id) ?? ''}`.trim()).join(', ')}`
        : '';
    return {
      id: task.id,
      group,
      subject: task.subject,
      blockedLabel: group === 'pending' && blockers.length > 0 ? `waits for #${blockers.join(', #')}` : '',
      title: blockedTitle || task.subject,
    };
  };
  return {
    // Only the collapsed header carries the running task: expanded, the rows
    // below say it, and saying it twice reads as a glitch.
    meta: collapsed && headlineText ? `${countText} · ${headlineText}` : countText,
    rows: [
      ...running.map((task) => row(task, 'in_progress')),
      ...waiting.map((task) => row(task, 'pending')),
      ...visibleDone.map((task) => row(task, 'completed')),
    ],
    percent: total === 0 ? 0 : Math.round((doneCount / total) * 100),
    foldLabel:
      foldedDone.length === 0
        ? ''
        : showCompleted
          ? 'Show less tasks'
          : `${foldedDone.length} more task${foldedDone.length === 1 ? '' : 's'}`,
    foldedCount: foldedDone.length,
  };
}
