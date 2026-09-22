import type { AgentSyncPlan, AgentSyncReport } from '../../shared/agent-sync';

/** A small synthetic report for stories: one agent in every state the tab renders. */
const sourceSkills = [
  'ghostex-cli',
  'ghostex-help',
  'madda-commit-and-push',
  'shadcn',
  'web-design-guidelines',
  'skill-creator',
];

function entries(
  dir: string,
  states: Record<
    string,
    'linked' | 'dangling' | 'copyIdentical' | 'copyDrifted' | 'onlyHere' | 'missing' | 'viaWholeFolder'
  >
) {
  return Object.entries(states).map(([name, state]) => ({
    ghostexBundled: name.startsWith('ghostex-'),
    ...(state === 'dangling' ? { linkTarget: `~/.agents/skills/${name}` } : {}),
    name,
    path: `${dir}/${name}`,
    state,
  }));
}

function counts(list: { state: string }[]) {
  const count = (state: string) => list.filter((entry) => entry.state === state).length;
  return {
    copiesDrifted: count('copyDrifted'),
    copiesIdentical: count('copyIdentical'),
    dangling: count('dangling'),
    linked: count('linked'),
    linkedElsewhere: count('linkedElsewhere'),
    missing: count('missing'),
    onlyHere: count('onlyHere'),
    viaWholeFolder: count('viaWholeFolder'),
  };
}

const claudeEntries = entries(
  '~/.claude/skills',
  Object.fromEntries(sourceSkills.map((name) => [name, 'viaWholeFolder']))
);
const kiroEntries = entries('~/.kiro/skills', {
  'faster-chrome-devtools-skill': 'dangling',
  'ghostex-cli': 'copyIdentical',
  'ghostex-help': 'copyIdentical',
  'madda-commit-and-push': 'missing',
  'plannotator-review': 'onlyHere',
  shadcn: 'missing',
  'skill-creator': 'copyDrifted',
  'web-design-guidelines': 'missing',
});
const opencodeEntries = entries('~/.config/opencode/skills', {
  'skill-creator': 'linked',
  test: 'dangling',
  'web-design-guidelines': 'linked',
});
const droidEntries = entries('~/.factory/skills', {
  'ghostex-cli': 'linked',
  'ghostex-help': 'linked',
  'madda-commit-and-push': 'linked',
  shadcn: 'linked',
  'skill-creator': 'linked',
  'web-design-guidelines': 'linked',
});

export const agentSyncFixtureReport: AgentSyncReport = {
  agents: [
    {
      detected: true,
      displayName: 'Claude Code',
      hooks: { dir: '~/.claude/hooks', linkTarget: '~/.agents/hooks', state: 'linked' },
      icon: 'claude',
      id: 'claude-code',
      instructions: { kind: 'plain', path: '~/.claude/CLAUDE.md', state: 'pointer' },
      kind: 'agent',
      lock: { path: '~/.claude/.skill-lock.json', state: 'linked' },
      root: '~/.claude',
      skills: {
        counts: counts(claudeEntries),
        dir: '~/.claude/skills',
        dirLinkTarget: '~/.agents/skills',
        dirState: 'wholeFolderLink',
        entries: claudeEntries,
      },
      status: 'attention',
      universal: false,
    },
    {
      detected: true,
      displayName: 'Droid',
      icon: 'factory-droid',
      id: 'droid',
      instructions: { kind: 'plain', path: '~/.factory/AGENTS.md', state: 'pointer' },
      kind: 'agent',
      root: '~/.factory',
      skills: { counts: counts(droidEntries), dir: '~/.factory/skills', dirState: 'realDir', entries: droidEntries },
      status: 'linked',
      universal: false,
    },
    {
      detected: true,
      displayName: 'Kiro CLI',
      icon: 'kiro',
      id: 'kiro-cli',
      instructions: { kind: 'plain', path: '~/.kiro/steering/ghostex-shared.md', state: 'missing' },
      kind: 'agent',
      root: '~/.kiro',
      skills: { counts: counts(kiroEntries), dir: '~/.kiro/skills', dirState: 'realDir', entries: kiroEntries },
      status: 'attention',
      universal: false,
    },
    {
      detected: true,
      displayName: 'OpenCode',
      icon: 'opencode',
      id: 'opencode',
      instructions: { kind: 'plain', path: '~/.config/opencode/AGENTS.md', state: 'pointer' },
      kind: 'agent',
      root: '~/.config/opencode',
      skills: {
        counts: counts(opencodeEntries),
        dir: '~/.config/opencode/skills',
        dirState: 'realDir',
        entries: opencodeEntries,
      },
      status: 'attention',
      universal: true,
    },
    {
      detected: true,
      displayName: 'Claude Code work profile',
      hooks: { dir: '~/.claude-profiles/work/hooks', state: 'missing' },
      icon: 'claude',
      id: 'claude-code:work',
      instructions: { kind: 'plain', path: '~/.claude-profiles/work/CLAUDE.md', state: 'legacyPointer' },
      kind: 'profile',
      lock: { path: '~/.claude-profiles/work/.skill-lock.json', state: 'missing' },
      root: '~/.claude-profiles/work',
      skills: {
        counts: counts([]),
        dir: '~/.claude-profiles/work/skills',
        dirState: 'missing',
        entries: entries(
          '~/.claude-profiles/work/skills',
          Object.fromEntries(sourceSkills.map((name) => [name, 'missing']))
        ),
      },
      status: 'attention',
      universal: false,
    },
    {
      detected: false,
      displayName: 'Goose',
      id: 'goose',
      kind: 'agent',
      root: '~/.config/goose',
      status: 'notInstalled',
      universal: false,
    },
  ],
  generatedAt: '2026-09-16T12:00:00.000Z',
  home: '/Users/example',
  problems: [
    {
      count: 2,
      detail: 'Removed by Sync. Nothing else references them.',
      fixable: true,
      items: ['~/.kiro/skills/faster-chrome-devtools-skill', '~/.config/opencode/skills/test'],
      kind: 'danglingLinks',
      title: '2 dangling symlinks point at skills that no longer exist',
    },
    {
      count: 1,
      detail: 'Converted to a real folder of per-skill links so agent-local files can coexist with the source.',
      fixable: true,
      items: ['~/.claude/skills'],
      kind: 'wholeFolderLinks',
      title: '1 skills folder is a whole-folder link',
    },
    {
      count: 3,
      detail:
        'Identical copies are backed up and replaced by links. Copies that differ from the source are kept and listed on the agent.',
      fixable: true,
      items: ['~/.kiro/skills/ghostex-cli', '~/.kiro/skills/ghostex-help', '~/.kiro/skills/skill-creator'],
      kind: 'copiedFolders',
      title: '3 skill folders are copies, not links',
    },
    {
      count: 2,
      detail: 'Sync writes the one-line pointer. A file with other content is backed up first.',
      fixable: true,
      items: ['~/.kiro/steering/ghostex-shared.md', '~/.claude-profiles/work/CLAUDE.md'],
      kind: 'missingPointers',
      title: '2 instruction files do not point at ~/.agents/main.md',
    },
    {
      count: 2,
      detail:
        'Left over in .skill-lock.json after skills were removed or renamed. Pruning is an opt-in step of the plan.',
      fixable: true,
      items: ['faster-chrome-devtools-skill', 'test'],
      kind: 'staleLockEntries',
      title: '2 lock entries have no skill folder',
    },
    {
      count: 3,
      detail:
        'Your own skills and the Ghostex bundled skills. The skills CLI skips them on update, which is fine. Nothing to fix.',
      fixable: false,
      items: ['ghostex-cli', 'ghostex-help', 'madda-commit-and-push'],
      kind: 'untrackedSkills',
      title: '3 skills in the source have no lock entry',
    },
  ],
  source: {
    exists: true,
    git: 'noCommits',
    hookScriptCount: 4,
    hooksDir: '~/.agents/hooks',
    hooksDirExists: true,
    lock: {
      entryCount: 5,
      exists: true,
      path: '~/.agents/.skill-lock.json',
      staleEntries: ['faster-chrome-devtools-skill', 'test'],
      untrackedSkills: ['ghostex-cli', 'ghostex-help', 'madda-commit-and-push'],
    },
    mainMdExists: true,
    mdFiles: ['main.md', 'general-programming.md', 'typescript-best-practices.md'],
    path: '~/.agents',
    skills: sourceSkills.map((name) => ({
      broken: false,
      ghostexBundled: name.startsWith('ghostex-'),
      inLock: !name.startsWith('ghostex-') && name !== 'madda-commit-and-push',
      isSymlink: false,
      name,
      path: `~/.agents/skills/${name}`,
    })),
    skillsDir: '~/.agents/skills',
  },
  summary: {
    agentsAttention: 4,
    agentsDetected: 5,
    agentsLinked: 1,
    agentsNotInstalled: 1,
    copiedSkillFolders: 3,
    danglingLinks: 2,
    missingPointers: 2,
    staleLockEntries: 2,
    wholeFolderLinks: 1,
  },
};

/** The same computer after a sync: every agent linked, nothing left to fix. */
export const agentSyncFixtureSyncedReport: AgentSyncReport = {
  ...agentSyncFixtureReport,
  agents: agentSyncFixtureReport.agents
    .filter((agent) => agent.detected)
    .map((agent) => {
      const linked = entries(
        agent.skills?.dir ?? `${agent.root}/skills`,
        Object.fromEntries(sourceSkills.map((name) => [name, 'linked' as const]))
      );
      return {
        ...agent,
        hooks: agent.hooks ? { ...agent.hooks, state: 'linked' as const } : undefined,
        instructions: agent.instructions ? { ...agent.instructions, state: 'pointer' as const } : undefined,
        lock: agent.lock ? { ...agent.lock, state: 'linked' as const } : undefined,
        skills: agent.skills
          ? {
              ...agent.skills,
              counts: counts(linked),
              dirLinkTarget: undefined,
              dirState: 'realDir' as const,
              entries: linked,
            }
          : undefined,
        status: 'linked' as const,
      };
    }),
  problems: [],
  summary: {
    ...agentSyncFixtureReport.summary,
    agentsAttention: 0,
    agentsLinked: agentSyncFixtureReport.summary.agentsDetected,
    copiedSkillFolders: 0,
    danglingLinks: 0,
    missingPointers: 0,
    staleLockEntries: 0,
    wholeFolderLinks: 0,
  },
};

export const agentSyncFixturePlan: AgentSyncPlan = {
  generatedAt: '2026-09-16T12:00:01.000Z',
  groups: [
    {
      changeCount: 2,
      enabledByDefault: true,
      kind: 'removeDangling',
      ops: [
        {
          agentId: 'kiro-cli',
          note: 'target missing: ~/.agents/skills/faster-chrome-devtools-skill',
          path: '~/.kiro/skills/faster-chrome-devtools-skill',
          verb: 'unlink',
        },
        {
          agentId: 'opencode',
          note: 'target missing: ~/.agents/skills/test',
          path: '~/.config/opencode/skills/test',
          verb: 'unlink',
        },
      ],
      title: 'Remove dangling links',
    },
    {
      changeCount: 8,
      enabledByDefault: true,
      kind: 'convertWholeFolder',
      ops: [
        {
          agentId: 'claude-code',
          note: 'folder symlink; replaced by a real folder of per-skill links',
          path: '~/.claude/skills',
          verb: 'unlink',
        },
        { agentId: 'claude-code', path: '~/.claude/skills', verb: 'mkdir' },
        ...sourceSkills.map((name) => ({
          agentId: 'claude-code',
          path: `~/.claude/skills/${name}`,
          target: `../../.agents/skills/${name}`,
          verb: 'link' as const,
        })),
      ],
      title: 'Convert whole-folder links to per-skill links',
    },
    {
      changeCount: 14,
      enabledByDefault: true,
      kind: 'perSkillLinks',
      ops: [
        {
          agentId: 'kiro-cli',
          note: 'identical to the source copy',
          path: '~/.kiro/skills/ghostex-cli',
          target: '~/.kiro/skills/ghostex-cli.pre-sync-20260916-1200.bak',
          verb: 'backup',
        },
        {
          agentId: 'kiro-cli',
          path: '~/.kiro/skills/ghostex-cli',
          target: '../../.agents/skills/ghostex-cli',
          verb: 'link',
        },
        {
          agentId: 'kiro-cli',
          note: 'identical to the source copy',
          path: '~/.kiro/skills/ghostex-help',
          target: '~/.kiro/skills/ghostex-help.pre-sync-20260916-1200.bak',
          verb: 'backup',
        },
        {
          agentId: 'kiro-cli',
          path: '~/.kiro/skills/ghostex-help',
          target: '../../.agents/skills/ghostex-help',
          verb: 'link',
        },
        {
          agentId: 'kiro-cli',
          note: 'differs from the source; kept for review',
          path: '~/.kiro/skills/skill-creator',
          verb: 'keep',
        },
        {
          agentId: 'kiro-cli',
          note: 'only here; not in the source',
          path: '~/.kiro/skills/plannotator-review',
          verb: 'keep',
        },
        {
          agentId: 'kiro-cli',
          path: '~/.kiro/skills/madda-commit-and-push',
          target: '../../.agents/skills/madda-commit-and-push',
          verb: 'link',
        },
        { agentId: 'kiro-cli', path: '~/.kiro/skills/shadcn', target: '../../.agents/skills/shadcn', verb: 'link' },
        {
          agentId: 'kiro-cli',
          path: '~/.kiro/skills/web-design-guidelines',
          target: '../../.agents/skills/web-design-guidelines',
          verb: 'link',
        },
        { agentId: 'claude-code:work', path: '~/.claude-profiles/work/skills', verb: 'mkdir' },
        ...sourceSkills.map((name) => ({
          agentId: 'claude-code:work',
          path: `~/.claude-profiles/work/skills/${name}`,
          target: `../../../.agents/skills/${name}`,
          verb: 'link' as const,
        })),
        {
          agentId: 'opencode',
          note: 'reads ~/.agents/skills directly; no links added',
          path: '~/.config/opencode/skills',
          verb: 'keep',
        },
      ],
      title: 'Per-skill links',
    },
    {
      changeCount: 3,
      enabledByDefault: true,
      kind: 'pointerFiles',
      ops: [
        { agentId: 'claude-code', note: 'already the pointer', path: '~/.claude/CLAUDE.md', verb: 'keep' },
        {
          agentId: 'kiro-cli',
          content: 'Before starting any task, read ~/.agents/main.md in full and follow its instructions.\n',
          note: 'pointer to ~/.agents/main.md',
          path: '~/.kiro/steering/ghostex-shared.md',
          verb: 'write',
        },
        {
          agentId: 'claude-code:work',
          note: 'older pointer wording',
          path: '~/.claude-profiles/work/CLAUDE.md',
          target: '~/.claude-profiles/work/CLAUDE.md.pre-sync-20260916-1200.bak',
          verb: 'backup',
        },
        {
          agentId: 'claude-code:work',
          content: 'Before starting any task, read ~/.agents/main.md in full and follow its instructions.\n',
          path: '~/.claude-profiles/work/CLAUDE.md',
          verb: 'write',
        },
      ],
      title: 'Instruction pointer files',
    },
    {
      changeCount: 2,
      enabledByDefault: true,
      kind: 'hooks',
      ops: [
        { agentId: 'claude-code', note: 'already linked', path: '~/.claude/hooks', verb: 'keep' },
        {
          agentId: 'claude-code:work',
          path: '~/.claude-profiles/work/hooks',
          target: '/Users/example/.agents/hooks',
          verb: 'link',
        },
        {
          agentId: 'claude-code:work',
          path: '~/.claude-profiles/work/.skill-lock.json',
          target: '/Users/example/.agents/.skill-lock.json',
          verb: 'link',
        },
      ],
      title: 'Hook scripts and lock file links',
    },
    {
      changeCount: 2,
      enabledByDefault: false,
      kind: 'pruneLock',
      ops: [
        {
          note: 'no skill folder in ~/.agents/skills',
          path: '~/.agents/.skill-lock.json',
          target: 'faster-chrome-devtools-skill',
          verb: 'drop',
        },
        {
          note: 'no skill folder in ~/.agents/skills',
          path: '~/.agents/.skill-lock.json',
          target: 'test',
          verb: 'drop',
        },
      ],
      title: 'Prune stale lock entries',
    },
  ],
  scope: 'all',
  stamp: '20260916-1200',
  summary: { backups: 3, defaultChanges: 29, drops: 2, keeps: 5, links: 22, mkdirs: 2, unlinks: 3, writes: 2 },
};
