/**
 * Agent Sync wire types. These mirror the serde output of the Rust crate in
 * packages/agent-sync (camelCase field names, enum variants as camelCase
 * strings). Keep the two in lockstep.
 *
 * CDXC:AgentSync 2026-09-16 SEE-ALSO:
 * packages/agent-sync/src/{scan,plan,apply}.rs are the source of truth for these shapes; the
 * desktop bridge (apps/desktop/src/app/helpers/agents_hub/sync.rs) and `ghostex agent-sync`
 * both emit them unchanged.
 */

export type AgentSyncAgentStatus = 'linked' | 'attention' | 'notInstalled';
export type AgentSyncAgentKind = 'agent' | 'profile';
export type AgentSyncSkillDirState = 'missing' | 'realDir' | 'wholeFolderLink' | 'otherLink' | 'notADir';
export type AgentSyncSkillEntryState =
  | 'linked'
  | 'linkedElsewhere'
  | 'dangling'
  | 'copyIdentical'
  | 'copyDrifted'
  | 'onlyHere'
  | 'missing'
  | 'viaWholeFolder';
export type AgentSyncInstructionKind = 'plain' | 'mdc';
export type AgentSyncInstructionState =
  'missing' | 'pointer' | 'legacyPointer' | 'otherContent' | 'symlink' | 'notAFile';
export type AgentSyncHooksState = 'linked' | 'missing' | 'realDir' | 'otherLink';
export type AgentSyncLockLinkState = 'linked' | 'missing' | 'realFile' | 'otherLink';
export type AgentSyncSourceGitState = 'none' | 'noCommits' | 'committed';

export type AgentSyncSkillEntry = {
  ghostexBundled: boolean;
  linkTarget?: string;
  name: string;
  path: string;
  state: AgentSyncSkillEntryState;
};

export type AgentSyncSkillCounts = {
  copiesDrifted: number;
  copiesIdentical: number;
  dangling: number;
  linked: number;
  linkedElsewhere: number;
  missing: number;
  onlyHere: number;
  viaWholeFolder: number;
};

export type AgentSyncSkillsReport = {
  counts: AgentSyncSkillCounts;
  dir: string;
  dirLinkTarget?: string;
  dirState: AgentSyncSkillDirState;
  entries: AgentSyncSkillEntry[];
};

export type AgentSyncInstructionReport = {
  kind: AgentSyncInstructionKind;
  path: string;
  state: AgentSyncInstructionState;
};

export type AgentSyncHooksReport = {
  dir: string;
  linkTarget?: string;
  state: AgentSyncHooksState;
};

export type AgentSyncLockLinkReport = {
  path: string;
  state: AgentSyncLockLinkState;
};

export type AgentSyncAgentReport = {
  detected: boolean;
  displayName: string;
  hooks?: AgentSyncHooksReport;
  icon?: string;
  id: string;
  instructions?: AgentSyncInstructionReport;
  kind: AgentSyncAgentKind;
  lock?: AgentSyncLockLinkReport;
  root: string;
  skills?: AgentSyncSkillsReport;
  status: AgentSyncAgentStatus;
  universal: boolean;
};

export type AgentSyncSourceSkill = {
  broken: boolean;
  ghostexBundled: boolean;
  inLock: boolean;
  isSymlink: boolean;
  name: string;
  path: string;
};

export type AgentSyncLockInfo = {
  entryCount: number;
  exists: boolean;
  path: string;
  staleEntries: string[];
  untrackedSkills: string[];
};

export type AgentSyncSourceInfo = {
  exists: boolean;
  git: AgentSyncSourceGitState;
  hookScriptCount: number;
  hooksDir: string;
  hooksDirExists: boolean;
  lock: AgentSyncLockInfo;
  mainMdExists: boolean;
  mdFiles: string[];
  path: string;
  skills: AgentSyncSourceSkill[];
  skillsDir: string;
};

export type AgentSyncProblemKind =
  | 'danglingLinks'
  | 'sourceBrokenLinks'
  | 'staleLockEntries'
  | 'untrackedSkills'
  | 'copiedFolders'
  | 'wholeFolderLinks'
  | 'missingPointers';

export type AgentSyncProblem = {
  count: number;
  detail: string;
  fixable: boolean;
  items: string[];
  kind: AgentSyncProblemKind;
  title: string;
};

export type AgentSyncReportSummary = {
  agentsAttention: number;
  agentsDetected: number;
  agentsLinked: number;
  agentsNotInstalled: number;
  copiedSkillFolders: number;
  danglingLinks: number;
  missingPointers: number;
  staleLockEntries: number;
  wholeFolderLinks: number;
};

export type AgentSyncReport = {
  agents: AgentSyncAgentReport[];
  generatedAt: string;
  home: string;
  problems: AgentSyncProblem[];
  source: AgentSyncSourceInfo;
  summary: AgentSyncReportSummary;
};

export type AgentSyncPlanVerb = 'link' | 'write' | 'backup' | 'unlink' | 'keep' | 'mkdir' | 'drop';
export type AgentSyncPlanGroupKind =
  'removeDangling' | 'convertWholeFolder' | 'perSkillLinks' | 'pointerFiles' | 'hooks' | 'pruneLock';

export const AGENT_SYNC_PLAN_GROUP_KINDS: readonly AgentSyncPlanGroupKind[] = [
  'removeDangling',
  'convertWholeFolder',
  'perSkillLinks',
  'pointerFiles',
  'hooks',
  'pruneLock',
];

export type AgentSyncPlanOp = {
  agentId?: string;
  content?: string;
  note?: string;
  path: string;
  target?: string;
  verb: AgentSyncPlanVerb;
};

export type AgentSyncPlanGroup = {
  changeCount: number;
  enabledByDefault: boolean;
  kind: AgentSyncPlanGroupKind;
  ops: AgentSyncPlanOp[];
  title: string;
};

export type AgentSyncPlanSummary = {
  backups: number;
  defaultChanges: number;
  drops: number;
  keeps: number;
  links: number;
  mkdirs: number;
  unlinks: number;
  writes: number;
};

export type AgentSyncPlan = {
  generatedAt: string;
  groups: AgentSyncPlanGroup[];
  scope: string;
  stamp: string;
  summary: AgentSyncPlanSummary;
};

export type AgentSyncApplyFailure = {
  error: string;
  op: AgentSyncPlanOp;
};

export type AgentSyncApplyResult = {
  done: AgentSyncPlanOp[];
  enabledGroups: AgentSyncPlanGroupKind[];
  failed: AgentSyncApplyFailure[];
  generatedAt: string;
  plan: AgentSyncPlan;
  scope: string;
  skippedKeeps: number;
};

/** The plan groups a problem row's fix button enables. */
export function agentSyncProblemFixGroups(kind: AgentSyncProblemKind): AgentSyncPlanGroupKind[] {
  switch (kind) {
    case 'danglingLinks':
    case 'sourceBrokenLinks':
      return ['removeDangling'];
    case 'wholeFolderLinks':
      return ['convertWholeFolder'];
    case 'copiedFolders':
      return ['perSkillLinks'];
    case 'missingPointers':
      return ['pointerFiles'];
    case 'staleLockEntries':
      return ['pruneLock'];
    case 'untrackedSkills':
      return [];
  }
}

export function agentSyncDefaultPlanGroups(plan: AgentSyncPlan | undefined): AgentSyncPlanGroupKind[] {
  if (!plan) {
    return AGENT_SYNC_PLAN_GROUP_KINDS.filter((kind) => kind !== 'pruneLock');
  }
  return plan.groups.filter((group) => group.enabledByDefault).map((group) => group.kind);
}

export function agentSyncPlanChangeCount(plan: AgentSyncPlan, enabled: ReadonlySet<AgentSyncPlanGroupKind>): number {
  return plan.groups.reduce((sum, group) => (enabled.has(group.kind) ? sum + group.changeCount : sum), 0);
}

/** Skills, Instructions, Hook scripts: the three things Agent Sync shares, one tone each. */
export type AgentSyncDotTone = 'ok' | 'warn' | 'err' | 'off';

export function agentSyncSkillsTone(agent: AgentSyncAgentReport): AgentSyncDotTone {
  const skills = agent.skills;
  if (!skills) {
    return agent.universal ? 'ok' : 'off';
  }
  if (skills.counts.dangling > 0 || skills.dirState === 'otherLink' || skills.dirState === 'notADir') {
    return 'err';
  }
  if (
    skills.dirState === 'wholeFolderLink' ||
    skills.counts.copiesIdentical > 0 ||
    skills.counts.copiesDrifted > 0 ||
    (!agent.universal && skills.counts.missing > 0)
  ) {
    return 'warn';
  }
  return 'ok';
}

export function agentSyncInstructionsTone(agent: AgentSyncAgentReport): AgentSyncDotTone {
  const instructions = agent.instructions;
  if (!instructions) {
    return 'off';
  }
  switch (instructions.state) {
    case 'pointer':
      return 'ok';
    case 'missing':
    case 'legacyPointer':
    case 'otherContent':
      return 'warn';
    default:
      return 'err';
  }
}

export function agentSyncHooksTone(agent: AgentSyncAgentReport): AgentSyncDotTone {
  const hooks = agent.hooks;
  if (!hooks) {
    return 'off';
  }
  switch (hooks.state) {
    case 'linked':
      return 'ok';
    case 'missing':
    case 'realDir':
      return 'warn';
    default:
      return 'err';
  }
}

export type AgentSyncPart = 'skills' | 'instructions' | 'hooks';

/** The plan groups that fix one part of one agent; empty when that part has nothing to fix. */
export function agentSyncPartFixGroups(agent: AgentSyncAgentReport, part: AgentSyncPart): AgentSyncPlanGroupKind[] {
  switch (part) {
    case 'skills': {
      const skills = agent.skills;
      if (!skills) {
        return [];
      }
      const groups: AgentSyncPlanGroupKind[] = [];
      if (skills.counts.dangling > 0) {
        groups.push('removeDangling');
      }
      if (skills.dirState === 'wholeFolderLink') {
        groups.push('convertWholeFolder');
      }
      if (agent.detected && (skills.counts.copiesIdentical > 0 || (!agent.universal && skills.counts.missing > 0))) {
        groups.push('perSkillLinks');
      }
      return groups;
    }
    case 'instructions': {
      const state = agent.instructions?.state;
      return agent.detected && (state === 'missing' || state === 'legacyPointer' || state === 'otherContent')
        ? ['pointerFiles']
        : [];
    }
    case 'hooks': {
      const hooksOpen = agent.hooks && agent.hooks.state !== 'linked' && agent.hooks.state !== 'otherLink';
      const lockOpen = agent.lock && agent.lock.state !== 'linked' && agent.lock.state !== 'otherLink';
      return agent.detected && (hooksOpen || lockOpen) ? ['hooks'] : [];
    }
  }
}

export const AGENT_SYNC_PARTS: readonly AgentSyncPart[] = ['skills', 'instructions', 'hooks'];

/** How many fixes an agent row advertises ("3 to fix"). An agent the scan flags always shows at least one. */
export function agentSyncIssueCount(agent: AgentSyncAgentReport): number {
  const count = AGENT_SYNC_PARTS.reduce((sum, part) => sum + agentSyncPartFixGroups(agent, part).length, 0);
  return agent.status === 'attention' ? Math.max(count, 1) : count;
}

/** Red when something is broken, amber when it works today but can go out of date. */
export function agentSyncWorstTone(agent: AgentSyncAgentReport): 'ok' | 'warn' | 'err' {
  const tones = [agentSyncSkillsTone(agent), agentSyncInstructionsTone(agent), agentSyncHooksTone(agent)];
  if (tones.includes('err')) {
    return 'err';
  }
  return tones.includes('warn') || agent.status === 'attention' ? 'warn' : 'ok';
}

/** Which of the three shared things a problem belongs to; the shared folder's own problems have none. */
export function agentSyncProblemPart(kind: AgentSyncProblemKind): AgentSyncPart | undefined {
  switch (kind) {
    case 'danglingLinks':
    case 'copiedFolders':
    case 'wholeFolderLinks':
      return 'skills';
    case 'missingPointers':
      return 'instructions';
    default:
      return undefined;
  }
}

export const AGENT_SYNC_SKILL_ENTRY_LABELS: Record<AgentSyncSkillEntryState, string> = {
  copyDrifted: 'Copy, differs from the source',
  copyIdentical: 'Copy, same content as the source',
  dangling: 'Broken link',
  linked: 'Linked',
  linkedElsewhere: 'Linked to another folder',
  missing: 'Not linked yet',
  onlyHere: 'Only here',
  viaWholeFolder: 'Available through the folder link',
};

export const AGENT_SYNC_INSTRUCTION_LABELS: Record<AgentSyncInstructionState, string> = {
  legacyPointer: 'Older pointer wording',
  missing: 'Not present',
  notAFile: 'Not a file',
  otherContent: 'Has content of its own',
  pointer: 'Points at ~/.agents/main.md',
  symlink: 'Is a symlink',
};

export const AGENT_SYNC_VERB_LABELS: Record<AgentSyncPlanVerb, string> = {
  backup: 'backup',
  drop: 'drop',
  keep: 'keep',
  link: 'link',
  mkdir: 'mkdir',
  unlink: 'unlink',
  write: 'write',
};
