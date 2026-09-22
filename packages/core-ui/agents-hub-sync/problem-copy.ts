import type { AgentSyncAgentReport, AgentSyncProblem, AgentSyncReport } from '../../shared/agent-sync';

export type ProblemTone = 'err' | 'warn';

export type ProblemCopy = {
  /** Plain-language steps shown when the row is opened. */
  steps: string[];
  sub: string;
  title: string;
  tone: ProblemTone;
};

export type ProblemAgentCount = {
  agent: AgentSyncAgentReport;
  count: number;
  unit: string;
};

function plural(count: number, one: string, many: string): string {
  return `${count} ${count === 1 ? one : many}`;
}

function agentProblemCount(agent: AgentSyncAgentReport, kind: AgentSyncProblem['kind']): number {
  switch (kind) {
    case 'danglingLinks':
      return agent.skills?.counts.dangling ?? 0;
    case 'copiedFolders':
      return (agent.skills?.counts.copiesIdentical ?? 0) + (agent.skills?.counts.copiesDrifted ?? 0);
    case 'wholeFolderLinks':
      return agent.skills?.dirState === 'wholeFolderLink' ? 1 : 0;
    case 'missingPointers': {
      const state = agent.instructions?.state;
      return agent.detected && (state === 'missing' || state === 'legacyPointer' || state === 'otherContent') ? 1 : 0;
    }
    default:
      return 0;
  }
}

/** The agents a problem touches, largest first. Problems of the shared folder itself return none. */
export function problemAgents(problem: AgentSyncProblem, report: AgentSyncReport): ProblemAgentCount[] {
  const unit = problem.kind === 'danglingLinks' ? 'link' : problem.kind === 'copiedFolders' ? 'skill' : '';
  return report.agents
    .map((agent) => ({ agent, count: agentProblemCount(agent, problem.kind), unit }))
    .filter((entry) => entry.count > 0)
    .sort((a, b) => b.count - a.count);
}

/**
 * CDXC:AgentSync 2026-09-22 DECISION:
 * The user asked for the Agent Sync page to be "less crowded" and "more organized and clear UX wise" because the first version was "very complicated". Problem rows therefore say what is wrong and why it matters in everyday words (no "drift", "dangling symlinks", "pointers", "prune"), and the paths and the exact fix only appear when a row is opened. The scanner's own titles stay as they are for `ghostex agent-sync status`.
 */
export function problemCopy(problem: AgentSyncProblem, report: AgentSyncReport): ProblemCopy {
  const count = problem.count;
  switch (problem.kind) {
    case 'danglingLinks':
      return {
        steps: ['The dead links are removed.', 'The skills they pointed to are already gone, so nothing else changes.'],
        sub: 'Left behind when skills were renamed or deleted. Safe to remove.',
        title: `${plural(count, 'link points', 'links point')} to skills that no longer exist`,
        tone: 'err',
      };
    case 'sourceBrokenLinks':
      return {
        steps: [
          'The broken link is removed from your shared folder.',
          'If you still want that skill, install it again afterwards.',
        ],
        sub: 'A link inside the shared folder that leads nowhere.',
        title: `${plural(count, 'skill', 'skills')} in your shared folder ${count === 1 ? 'is' : 'are'} broken`,
        tone: 'err',
      };
    case 'copiedFolders': {
      const edited = report.agents.reduce((sum, agent) => sum + (agent.skills?.counts.copiesDrifted ?? 0), 0);
      return {
        steps: [
          'Copies that are identical to the original are backed up, then replaced with a link.',
          edited > 0
            ? `${plural(edited, 'copy was', 'copies were')} edited: ${edited === 1 ? 'it is' : 'they are'} kept as ${edited === 1 ? 'it is' : 'they are'}.`
            : 'A copy that was edited is never replaced.',
          'Nothing is deleted. Backups sit next to the original and end in .bak.',
        ],
        sub: 'Copies go out of date when you edit the original.',
        title: `${plural(count, 'skill is a copy', 'skills are copies')} instead of ${count === 1 ? 'a link' : 'links'}`,
        tone: 'warn',
      };
    }
    case 'wholeFolderLinks':
      return {
        steps: [
          'The folder link is replaced with a real folder.',
          'Every shared skill gets its own link inside it, so the agent sees the same skills as before.',
          'Skills that only this agent uses can then live next to them.',
        ],
        sub: 'Works today, but leaves no room for skills only that agent uses.',
        title: `${plural(count, 'agent links', 'agents link')} the whole skills folder`,
        tone: 'warn',
      };
    case 'missingPointers':
      return {
        steps: [
          'Each agent gets a one-line instruction file that tells it to read ~/.agents/main.md.',
          'A file that already has other content is backed up first, next to the original.',
        ],
        sub: 'Their instruction file does not mention ~/.agents/main.md.',
        title: `${plural(count, 'agent does', 'agents do')} not read your shared instructions`,
        tone: 'warn',
      };
    default:
      return { steps: [], sub: problem.detail, title: problem.title, tone: 'warn' };
  }
}
