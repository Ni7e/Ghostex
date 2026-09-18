import type { SessionChatAgentFleet, SessionChatSubAgent, SessionChatSubagentInfo } from '../session-chat';
import {
  formatSessionChatActivityElapsed,
  sessionChatActivityElapsedSeconds,
} from '../session-chat-controller/activity';

type ModelInfo = Pick<SessionChatSubagentInfo, 'model' | 'effort'>;

function shortModel(model: string): string {
  const value = model.trim().replace(/\[[^\]]*\]/g, '');
  const parts = value.toLowerCase().split(/[ -]+/);
  const family = parts.findIndex((part) => ['opus', 'sonnet', 'haiku', 'fable'].includes(part));
  if (family >= 0) {
    const version = (tokens: string[]) => {
      const found: string[] = [];
      for (const token of tokens) {
        if (!/^\d{1,2}(?:\.\d{1,2})?$/.test(token) || found.length === 2) break;
        found.push(token);
      }
      return found.join('.');
    };
    const number =
      version(parts.slice(family + 1)) || version(parts.slice(0, family).filter((part) => part !== 'claude'));
    const name = parts[family]![0]!.toUpperCase() + parts[family]!.slice(1);
    return number ? `${name} ${number}` : name;
  }
  const named = /^gpt-\d+(?:\.\d+)?-(astra|sol|terra|luna)$/i.exec(value);
  if (named) return named[1]![0]!.toUpperCase() + named[1]!.slice(1).toLowerCase();
  return value
    .replace(/^gpt-/i, 'GPT ')
    .replace(/-codex\b/gi, ' Codex')
    .replace(/-/g, ' ');
}

function shortEffort(effort: string): string {
  const value = effort.trim().toLowerCase();
  return value === 'xhigh' ? 'xHigh' : value ? value[0]!.toUpperCase() + value.slice(1) : '';
}

/** Compact model + effort label ("Opus 5 xHigh") for a subagent row, card or popup. */
export function subagentModelLabel(info?: ModelInfo | null): string {
  return [info?.model ? shortModel(info.model) : 'Model not recorded', info?.effort ? shortEffort(info.effort) : '']
    .filter(Boolean)
    .join(' ');
}

/** One row of the Subagents strip, ready to lay out. */
export interface SessionChatAgentFleetRow {
  /** Stable list key. */
  key: string;
  /** What the subagent transcript viewer is opened with. */
  selector: string;
  /** Agent type as the CLI names it, also the viewer's `agentType`. */
  agentType: string;
  /** The viewer's display name. */
  name: string;
  task: string;
  model: string;
  effort: string;
  /** Compact model + effort label shown in the name cell. */
  modelLabel: string;
  /** Codex rows show the child name/path here; Claude keeps its task text. */
  statusText: string;
  idle: boolean;
  working: boolean;
  /** Claude rows expose the agent type in the link tooltip; Codex rows do not. */
  showAgentType: boolean;
  /** The ‣ that opens the status cell, shown only when the cell carries something. */
  marker: boolean;
  /** Further agents folded into this row (`+2`), or 0. */
  nested: number;
  nestedTitle: string;
  tokens: string;
  elapsedLabel: string;
  /** The • between the token counter and the clock, shown only with both sides present. */
  separator: string;
}

export interface SessionChatAgentFleetStrip {
  stale: boolean;
  /** "2 running, 1 idle", or just the roster size when the sample is stale. */
  countLabel: string;
  rows: SessionChatAgentFleetRow[];
  /** A clock is still moving, so the host must re-project once a second. */
  ticking: boolean;
}

function fleetStale(fleet: SessionChatAgentFleet, now: number): boolean {
  const validUntil = fleet.validUntil ? Date.parse(fleet.validUntil) : null;
  return fleet.stale === true || (validUntil !== null && (!Number.isFinite(validUntil) || now >= validUntil));
}

/**
 * CDXC:AgentScreenDetection 2026-09-18 SEE-ALSO:
 * packages/core-ui/chat/session-chat-agent-fleet-strip.tsx and apps/desktop/src/app/native_chat/agent_fleet.rs render this projection; the roster's counts, status text, clocks and transcript selectors must not be recomputed in either renderer.
 */
export function sessionChatAgentFleetRows(
  fleet: SessionChatAgentFleet | null | undefined,
  provider: string | null | undefined,
  now: number
): SessionChatAgentFleetStrip | null {
  const agents: SessionChatSubAgent[] = fleet?.agents ?? [];
  if (!fleet || agents.length === 0) {
    return null;
  }
  const stale = fleetStale(fleet, now);
  const idleCount = agents.filter((agent) => agent.status === 'idle').length;
  const runningCount = stale ? 0 : agents.length - idleCount;
  // The header says how many are running; the working pulse lives on each row.
  // A stale roster cannot vouch for anything running, so it only carries its size.
  const countLabel = stale
    ? `${agents.length}`
    : [runningCount > 0 ? `${runningCount} running` : null, idleCount > 0 ? `${idleCount} idle` : null]
        .filter((part) => part !== null)
        .join(', ');
  // Carry the captured roster, not the ticking display clock, so identical
  // agent types can be resolved against the provider's ordered launch records.
  const roster = agents.map((agent) => ({
    name: agent.name,
    startedAt:
      agent.startedAt ??
      (agent.elapsedSeconds === undefined ? null : Date.parse(fleet.detectedAt) - agent.elapsedSeconds * 1000),
  }));
  const codex = provider === 'codex';
  let ticking = false;
  const rows = agents.map((agent, index): SessionChatAgentFleetRow => {
    const statusText = (codex ? agent.name : agent.task) ?? '';
    const idle = agent.status === 'idle';
    const working = !stale && !idle;
    if (working && agent.elapsedSeconds !== undefined) {
      ticking = true;
    }
    const elapsed = sessionChatActivityElapsedSeconds(
      {
        detectedAt: fleet.detectedAt,
        ...(agent.elapsedSeconds === undefined ? {} : { elapsedSeconds: agent.elapsedSeconds }),
      },
      working ? now : Date.parse(fleet.detectedAt)
    );
    const nested = agent.nested ?? 0;
    return {
      key: agent.id ?? `${index}:${agent.name}`,
      selector: agent.id ?? `fleet:${JSON.stringify({ agents: roster, index })}`,
      agentType: agent.name,
      name: agent.task ?? agent.name,
      task: agent.task ?? '',
      model: agent.model ?? '',
      effort: agent.effort ?? '',
      modelLabel: subagentModelLabel(agent),
      statusText,
      idle,
      working,
      showAgentType: !codex,
      marker: Boolean(statusText) || (idle && !stale) || nested > 0,
      nested,
      nestedTitle: nested > 0 ? `${nested} more agent${nested === 1 ? '' : 's'} under this one` : '',
      tokens: agent.tokens ?? '',
      elapsedLabel: elapsed === null ? '' : formatSessionChatActivityElapsed(elapsed),
      separator: agent.tokens && elapsed !== null ? '•' : '',
    };
  });
  return { stale, countLabel, rows, ticking };
}
