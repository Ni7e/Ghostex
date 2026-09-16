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

/** Skills, Instructions, Hooks: the three dots on an agent row. */
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
