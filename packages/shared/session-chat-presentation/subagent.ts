// Reading a subagent out of a tool call/result pair. React renders the result
// as `SessionChatSubagentLink`, GPUI as the link chip beside a tool row's
// heading; both take the target from here so a Task row points at the same
// transcript on either surface.

import type { SessionChatToolCallBlock, SessionChatToolResultBlock } from '../session-chat';

export interface SessionChatSubagentTarget {
  selector: string;
  name: string;
  agentType?: string;
  task?: string;
  model?: string;
  effort?: string;
}

const SUBAGENT_TOOL_NAMES = ['spawn_agent', 'agent', 'task', 'send_message', 'followup_task'];

function record(value: unknown): Record<string, unknown> | null {
  if (typeof value === 'string') {
    try {
      return record(JSON.parse(value));
    } catch {
      return null;
    }
  }
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function text(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

export function sessionChatToolSubagent(
  call: SessionChatToolCallBlock | undefined,
  result: SessionChatToolResultBlock | undefined,
  agentPath = '/root'
): SessionChatSubagentTarget | null {
  const tool = call?.name.split(/[.:]/).at(-1)?.toLowerCase();
  if (!tool || !SUBAGENT_TOOL_NAMES.includes(tool)) return null;
  const input = record(call?.input);
  const output = record(result?.output);
  if (tool === 'send_message' || tool === 'followup_task') {
    const target = text(input?.target) ?? text(input?.id);
    return target
      ? {
          name: target.split('/').at(-1) ?? target,
          selector: target.startsWith('/') || target === input?.id ? target : `${agentPath}/${target}`,
        }
      : null;
  }
  const task = text(input?.task_name);
  const name = task ?? text(input?.name) ?? text(input?.description) ?? text(output?.agent_nickname);
  const id =
    text(output?.agent_id) ?? text(output?.agentId) ?? /\bagentId:\s*([a-zA-Z0-9_-]+)/.exec(result?.output ?? '')?.[1];
  const selector =
    id ?? text(output?.task_name) ?? (task ? (task.startsWith('/') ? task : `${agentPath}/${task}`) : name);
  return selector
    ? {
        selector,
        name: name ?? selector,
        agentType: text(input?.subagent_type) ?? text(input?.agent_type),
        task: text(input?.description),
      }
    : null;
}

/** A selector that points back at the conversation being read is not a link. */
export function isSessionChatSubagentSelf(selector: string, agentPath = '/root'): boolean {
  return selector === '/root' || selector === agentPath;
}
