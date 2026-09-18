import { storageScope } from '@/packages/client-storage';
import type { SessionChatAgentFleet, SessionChatAgentTasks } from '../session-chat';
import { sessionChatAgentFleetRows } from '../session-chat-presentation/agent-fleet';
import { sessionChatAgentTaskPanel } from '../session-chat-presentation/agent-tasks';

/** How often the subagent clocks re-publish between server samples. */
const FLEET_CLOCK_TICK_MS = 1_000;

/**
 * "I want the plan out of the way" is a preference, not a per-session view state, so the fold
 * survives a restart. Same store and same key as React's panel
 * (session-chat-agent-tasks-panel.tsx), so the two renderers remember one answer.
 */
const clientStorage = storageScope(['tasksCollapsed']);
const COLLAPSED_STORAGE_KEY = 'ghostex.chat.agentTasks.collapsed';

function readTasksCollapsed(): boolean {
  try {
    return clientStorage.getItem(COLLAPSED_STORAGE_KEY) === '1';
  } catch {
    return false;
  }
}

function writeTasksCollapsed(collapsed: boolean): void {
  try {
    if (collapsed) clientStorage.setItem(COLLAPSED_STORAGE_KEY, '1');
    else clientStorage.removeItem(COLLAPSED_STORAGE_KEY);
  } catch {
    /* Storage may be unavailable; the fold still works for this session. */
  }
}

/**
 * The two panels that stand above the composer, outside it: the agent's task
 * plan and its subagent roster. Both folds are the user's, so the state lives
 * here and the renderer only draws what this projects.
 *
 * The fleet card's default is "expanded unless Simple mode", which only the
 * renderer knows, so the override is published as-is and the host resolves it.
 */
export class NativeChatPanels {
  private fleetOpen: boolean | null = null;
  private tasksCollapsed = readTasksCollapsed();
  private tasksShowCompleted = false;
  private taskSignature = -1;
  private timer: number | null = null;

  constructor(private readonly republish: () => void) {}

  /** Returns false when the command is not one of this panel's. */
  command(command: { type: string; open?: boolean; expanded?: boolean }): boolean {
    switch (command.type) {
      case 'toggleAgentFleet':
        this.fleetOpen = command.open === true;
        return true;
      case 'toggleAgentTasks':
        this.tasksCollapsed = command.open !== true;
        writeTasksCollapsed(this.tasksCollapsed);
        return true;
      case 'toggleAgentTasksCompleted':
        this.tasksShowCompleted = command.expanded === true;
        return true;
      default:
        return false;
    }
  }

  project(
    fleet: SessionChatAgentFleet | null | undefined,
    tasks: SessionChatAgentTasks | null | undefined,
    provider: string | null | undefined
  ) {
    // A fresh list means a fresh fold: a new plan's done pile starts closed.
    const signature = tasks?.tasks.length ?? 0;
    if (signature !== this.taskSignature) {
      this.taskSignature = signature;
      this.tasksShowCompleted = false;
    }
    const strip = sessionChatAgentFleetRows(fleet, provider, Date.now());
    this.clock(strip?.ticking === true);
    const panel = sessionChatAgentTaskPanel(tasks, {
      collapsed: this.tasksCollapsed,
      showCompleted: this.tasksShowCompleted,
    });
    return {
      agentFleetStrip: strip === null ? null : { ...strip, openOverride: this.fleetOpen },
      agentTasksPanel:
        panel === null ? null : { ...panel, collapsed: this.tasksCollapsed, showCompleted: this.tasksShowCompleted },
    };
  }

  dispose(): void {
    this.clock(false);
  }

  private clock(live: boolean): void {
    if (live === (this.timer !== null)) return;
    if (this.timer !== null) {
      clearInterval(this.timer);
      this.timer = null;
      return;
    }
    this.timer = setInterval(() => this.republish(), FLEET_CLOCK_TICK_MS) as unknown as number;
  }
}
