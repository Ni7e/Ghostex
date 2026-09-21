/**
 * Diffs the Rust sidebar menus against the TypeScript ones they replace, for every row, group and
 * collection of a real recording.
 *
 * A missing menu item is a silent feature loss, so this enumerates rather than samples: both sides
 * build every menu of every scenario and the two are compared item by item, including labels,
 * order, icons, enabled and checked state, and the command payload each item carries.
 *
 *   bun tooling/gx-core/menu-parity.ts scenarios <frames.jsonl> <out-dir> [settings.json]
 *   cargo run --release --example sidebar_menu_parity -- <out-dir>     # from packages/gx-core
 *   bun tooling/gx-core/menu-parity.ts compare <out-dir>
 *
 * Recordings and dumps hold private data: keep <out-dir> outside the repository.
 *
 * The TypeScript side takes each group's membership from the Rust dump on purpose. Which rows a
 * group holds is the M4a gate; this one is about what their menus offer, and re-deriving the
 * membership here would only add a second place for it to differ.
 *
 * What that costs: a difference that comes from the group or row SET rather than from a menu is
 * invisible here, because both sides are handed the same set. The two known ones are recorded as
 * M4c declared differences 11 and 12 in PROGRESS.md.
 */
import { readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

type Json = Record<string, unknown>;
type Scenario = { name: string; settings: Json; ui: Json; host: Json; snapshot?: Json };

/**
 * A built account list for the launcher's agent list with its account counts
 * (`nativeAgentLauncherItems(groupId, data)`): two registered Claude accounts, one registered and
 * one unregistered Codex account, and one of a provider no agent has. The pages behind the counts
 * are `account-menu-parity.ts`'s. Nothing here is a real account.
 */
const SYNTHETIC_ACCOUNTS = {
  accounts: [
    {
      id: 'a1',
      provider: 'claude',
      name: 'One',
      email: 'one@example.test',
      registered: true,
      status: 'ready',
      usage: [],
    },
    {
      id: 'a2',
      provider: 'claude',
      name: 'Two',
      email: 'two@example.test',
      registered: true,
      status: 'ready',
      usage: [],
    },
    {
      id: 'a3',
      provider: 'codex',
      name: 'Three',
      email: 'three@example.test',
      registered: true,
      status: 'ready',
      usage: [],
    },
    {
      id: 'a4',
      provider: 'codex',
      name: 'Four',
      email: 'four@example.test',
      registered: false,
      status: 'ready',
      usage: [],
    },
    {
      id: 'a5',
      provider: 'gemini',
      name: 'Five',
      email: 'five@example.test',
      registered: true,
      status: 'ready',
      usage: [],
    },
  ],
  helpers: [],
  defaults: {},
  defaultAccounts: { claude: 'a1' },
};

const [mode, ...rest] = process.argv.slice(2);
if (mode === 'scenarios') await writeScenarios(rest);
else if (mode === 'compare') await compare(rest);
else {
  console.error('usage: menu-parity.ts scenarios <frames.jsonl> <out-dir> [settings.json] | compare <out-dir>');
  process.exit(2);
}

function readSnapshot(framesPath: string): Json {
  for (const line of readFileSync(framesPath, 'utf8').split('\n')) {
    if (!line.trim()) continue;
    const frame = JSON.parse(line) as Json;
    if (frame.type === 'presentationSnapshot') return frame.snapshot as Json;
  }
  throw new Error(`no presentationSnapshot in ${framesPath}`);
}

/** The settings, UI-state and host variants both sides are run over. */
function buildScenarios(snapshot: Json, saved: Json | undefined): Scenario[] {
  const sessions = (snapshot.sessions ?? []) as Json[];
  const projects = (snapshot.projects ?? []) as Json[];
  const sessionIdOf = (session: Json) =>
    `combined-session:${encodeURIComponent(String(session.projectId))}:${encodeURIComponent(String(session.sessionId))}`;
  const agents = [
    { agentId: 'claude', name: 'Claude', icon: 'claude' },
    { agentId: 'codex', name: 'Codex', icon: 'codex' },
    { agentId: 'pi', name: 'Pi Agent', icon: 'pi' },
    { agentId: 'house-agent', name: 'House Agent' },
  ];
  const host = {
    workspaceFocusBridge: true,
    agents,
    primaryAgentId: null,
    globalCommands: [
      { commandId: 'cmd-global-1', name: ' Deploy ', icon: 'rocket', showOnProjectRow: true },
      { commandId: 'cmd-global-2', name: '', showOnProjectRow: true },
      { commandId: 'cmd-global-3', name: 'Hidden', showOnProjectRow: false },
    ],
    commandsByProject: Object.fromEntries(
      projects
        .slice(0, 3)
        .map((project) => [
          String(project.projectId),
          [{ commandId: `cmd-${project.projectId}`, name: 'Project Action', icon: 'bolt', showOnProjectRow: true }],
        ])
    ),
    keepAwakeMinutes: null,
  };
  const everySetting = {
    enableSessionParking: true,
    showTagMenuWhenParking: true,
    showSessionCardHoverButtonsInContextMenu: true,
    showSessionCommandCopyActions: true,
    showSessionDetailsCopyAction: true,
    showBetaFeatures: true,
    hideKeepAwakeTitlebarControl: false,
    browserViewTabHidden: false,
    // Off by default here, so the big scenarios draw every project rather than the first Space's.
    sidebarSpacesEnabled: false,
  };
  const noSetting = {
    enableSessionParking: false,
    showTagMenuWhenParking: false,
    showSessionCardHoverButtonsInContextMenu: false,
    showSessionCommandCopyActions: false,
    showSessionDetailsCopyAction: false,
    showBetaFeatures: false,
    browserViewTabHidden: true,
    sidebarSpacesEnabled: false,
  };
  const emptyUi = {
    selectedMachineId: 'local',
    showHidden: false,
    selectedTagFilters: [] as string[],
    selectedSessionIds: [] as string[],
    hiddenGroupIds: [] as string[],
    hiddenCollectionKeys: [] as string[],
    collapsedGroups: [] as string[],
    collapsedCollections: [] as string[],
    expandedSessionLists: [] as string[],
    expandedHoverActions: [] as string[],
    sectionCollapse: {} as Record<string, Record<string, boolean>>,
    selectedSpaceBySection: {} as Record<string, string>,
  };
  const selected = sessions.slice(0, 6).map(sessionIdOf);
  const scenarios: Scenario[] = [
    { name: 'defaults', settings: {}, ui: emptyUi, host },
    { name: 'every-setting-on', settings: everySetting, ui: emptyUi, host },
    { name: 'every-setting-off', settings: noSetting, ui: emptyUi, host },
    {
      name: 'chevron-off-all-buttons',
      settings: {
        ...everySetting,
        sessionCardHoverButtons: [
          'rename',
          'pin',
          'note',
          'snooze',
          'closeAfterDone',
          'tag',
          'park',
          'sleep',
          'close',
        ].map((id) => ({ id, enabled: true })),
      },
      ui: emptyUi,
      host,
    },
    {
      name: 'chevron-only-close',
      settings: {
        ...everySetting,
        sessionCardHoverButtons: [
          { id: 'chevron', enabled: true },
          { id: 'close', enabled: true },
        ],
      },
      ui: emptyUi,
      host,
    },
    {
      name: 'no-hover-buttons',
      settings: { ...everySetting, sessionCardHoverButtons: [] },
      ui: emptyUi,
      host,
    },
    {
      name: 'legacy-hover-button-ids',
      settings: { ...everySetting, sessionCardHoverButtons: ['tag', 'sleep', 'close'] },
      ui: emptyUi,
      host,
    },
    {
      name: 'tag-filters-and-selection',
      settings: everySetting,
      ui: { ...emptyUi, selectedSessionIds: selected, selectedTagFilters: [] },
      host,
    },
    {
      name: 'one-selected-row',
      settings: everySetting,
      ui: { ...emptyUi, selectedSessionIds: selected.slice(0, 1) },
      host,
    },
    {
      name: 'hidden-and-collapsed',
      settings: everySetting,
      ui: {
        ...emptyUi,
        showHidden: true,
        hiddenGroupIds: [`combined-project:${encodeURIComponent(String(projects[0]?.projectId ?? ''))}`],
        collapsedGroups: projects
          .slice(0, 4)
          .map((project) => `combined-project:${encodeURIComponent(String(project.projectId))}`),
      },
      host,
    },
    {
      name: 'manual-sort-keep-awake',
      settings: { ...everySetting, activeSessionsSortMode: 'manual' },
      ui: emptyUi,
      host: { ...host, keepAwakeMinutes: 120, primaryAgentId: 'codex' },
    },
  ];
  const projectGroupId = (project: Json) => `combined-project:${encodeURIComponent(String(project.projectId))}`;
  scenarios.push({
    name: 'hidden-not-shown',
    settings: everySetting,
    ui: { ...emptyUi, hiddenGroupIds: projects.slice(0, 2).map(projectGroupId) },
    host,
  });
  scenarios.push({
    // Every drawn project collapsed while a hidden one stays expanded: the only state in which the
    // more menu's Collapse All / Expand Previous label can read differently on the two sides.
    name: 'hidden-expanded-rest-collapsed',
    settings: everySetting,
    ui: {
      ...emptyUi,
      hiddenGroupIds: projects.slice(0, 1).map(projectGroupId),
      collapsedGroups: projects.slice(1).map(projectGroupId),
    },
    host,
  });
  // A tag filter shrinks a group's drawn rows, and several menu items are scoped from them.
  for (const filters of [['favorite'], ['untagged'], ['favorite', 'untagged']]) {
    scenarios.push({
      name: `tag-filter-${filters.join('+')}`,
      settings: everySetting,
      ui: { ...emptyUi, selectedTagFilters: filters },
      host,
    });
  }
  scenarios.push({
    name: 'tag-filter-and-selection',
    settings: everySetting,
    ui: { ...emptyUi, selectedTagFilters: ['favorite'], selectedSessionIds: selected },
    host,
  });
  // The Spaces the user really has, under the settings the user really has.
  const spaceSettings = saved
    ? { ...saved, sidebarSpacesEnabled: true }
    : { ...everySetting, sidebarSpacesEnabled: true };
  const spaces = ((snapshot.sidebarSpaces as Json | undefined)?.order ?? []) as string[];
  for (const spaceId of [...spaces, 'other']) {
    scenarios.push({
      name: `space-${spaceId}`,
      settings: spaceSettings,
      ui: { ...emptyUi, selectedSpaceBySection: { local: spaceId } },
      host,
    });
  }
  if (saved) {
    // The user's own configuration, which has Spaces on and so draws one Space. The second one
    // turns Spaces off so the same settings sweep every row of every project.
    scenarios.push({ name: 'saved-settings', settings: saved, ui: emptyUi, host });
    scenarios.push({
      name: 'saved-settings-all-rows',
      settings: { ...saved, sidebarSpacesEnabled: false },
      ui: emptyUi,
      host,
    });
    scenarios.push({
      name: 'saved-settings-selected',
      settings: { ...saved, sidebarSpacesEnabled: false },
      ui: { ...emptyUi, selectedSessionIds: selected, showHidden: true },
      host: { ...host, keepAwakeMinutes: 0 },
    });
  }
  for (const scenario of syntheticScenarios(host)) scenarios.push(scenario);
  return scenarios;
}

/**
 * A presentation the recording has nothing like, so the branches it never reaches are still
 * enumerated: a Delayed Send with a deadline (Postpone By, nine rows), a snooze in the future and
 * one already past (Unsnooze, the only clock-reading rule), a user-made session group and a Chats
 * collection (the whole projectless branch of the project menu and of the header buttons,
 * including Create a Terminal), a worktree project, a project with no git origin, every agent that
 * has a Fork, Full Reload, Copy Resume or Generate Title rule of its own, a browser row, a draft,
 * a parked row, a pinned row, a tagged row and a sleeping row.
 */
function syntheticSnapshot(nowMs: number): Json {
  const iso = (offsetMs: number) => new Date(nowMs + offsetMs).toISOString();
  const projects = [
    {
      projectId: 'syn-main',
      title: 'Synthetic Main',
      path: '/tmp/syn/main',
      gitRemoteOriginUrl: 'git@github.com:ghostex/syn.git',
      groupIds: ['syn-main-g'],
      sortKey: 'a',
      createdAt: iso(-1e7),
      updatedAt: iso(0),
    },
    {
      projectId: 'syn-plain',
      title: 'Synthetic Plain',
      path: '/tmp/syn/plain',
      groupIds: ['syn-plain-g'],
      sortKey: 'b',
      createdAt: iso(-1e7),
      updatedAt: iso(0),
    },
    {
      projectId: 'syn-worktree',
      title: 'Synthetic Worktree',
      path: '/tmp/syn/main/ghostex/feature',
      gitRemoteOriginUrl: null,
      groupIds: ['syn-worktree-g'],
      sortKey: 'c',
      createdAt: iso(-1e7),
      updatedAt: iso(0),
      worktree: {
        name: 'feature',
        branch: 'feature/syn',
        parentProjectId: 'syn-main',
        parentProjectName: 'Synthetic Main',
        parentProjectPath: '/tmp/syn/main',
      },
    },
    {
      projectId: 'syn-chats',
      title: 'Chats',
      path: '/tmp/syn/.ghostex/chats',
      groupIds: ['syn-chats-g'],
      sortKey: 'd',
      createdAt: iso(-1e7),
      updatedAt: iso(0),
    },
  ];
  const base = (over: Json): Json => ({
    projectId: 'syn-main',
    groupId: 'syn-main-g',
    kind: 'agent',
    surface: 'workspace',
    zmxName: 'zmx-syn',
    sortKey: 'a',
    visibleInSidebarByDefault: true,
    createdAt: iso(-3_600_000),
    updatedAt: iso(-60_000),
    lifecycleState: 'running',
    providerSessionState: 'exists',
    sessionPersistenceProvider: 'zmx',
    activity: 'idle',
    pendingQuestionCount: 0,
    title: 'Synthetic session',
    primaryTitle: 'Synthetic session',
    ...over,
  });
  const sessions: Json[] = [
    base({
      sessionId: 'syn-delayed',
      title: 'Delayed send',
      agentIcon: 'claude',
      agentName: 'claude',
      agentSessionId: 'agent-1',
      delayedSendDeadlineAt: iso(600_000),
      delayedSendRemainingLabel: '10m',
    }),
    base({
      sessionId: 'syn-delayed-flags',
      title: 'Delayed send by flag',
      agentIcon: 'codex',
      agentName: 'codex',
      sendWhenAgentStopsActive: true,
    }),
    base({
      sessionId: 'syn-snoozed',
      title: 'Snoozed ahead',
      agentIcon: 'pi',
      agentName: 'pi',
      snoozedUntil: iso(86_400_000),
      lifecycleState: 'sleeping',
      providerSessionState: 'missing',
    }),
    base({
      sessionId: 'syn-snooze-past',
      title: 'Snooze already over',
      agentIcon: 'pi',
      agentName: 'pi',
      snoozedUntil: iso(-86_400_000),
    }),
    base({
      sessionId: 'syn-opencode',
      title: 'OpenCode',
      agentIcon: 'opencode',
      agentName: 'opencode',
      agentSessionId: 'agent-2',
    }),
    base({ sessionId: 'syn-cursor', title: 'Cursor', agentIcon: 'cursor-cli', agentName: 'cursor' }),
    base({
      sessionId: 'syn-antigravity',
      title: 'Antigravity with id',
      agentIcon: 'antigravity-cli',
      agentName: 'antigravity',
      agentSessionId: 'agy-1',
    }),
    base({
      sessionId: 'syn-antigravity-bare',
      title: 'Antigravity without id',
      agentIcon: 'antigravity-cli',
      agentName: 'antigravity',
    }),
    base({ sessionId: 'syn-zcode', title: 'ZCode', agentIcon: 'zcode', agentName: 'zcode', agentSessionId: 'z-1' }),
    base({ sessionId: 'syn-gemini', title: 'Gemini', agentIcon: 'gemini', agentName: 'gemini' }),
    base({ sessionId: 'syn-plain-terminal', title: 'Plain terminal', kind: 'terminal' }),
    base({ sessionId: 'syn-draft', title: 'Draft', agentIcon: 'claude', agentName: 'claude', isDraft: true }),
    base({
      sessionId: 'syn-parked',
      title: 'Parked',
      agentIcon: 'claude',
      agentName: 'claude',
      isParked: true,
      sessionTag: 'blocked',
    }),
    base({
      sessionId: 'syn-pinned',
      title: 'Pinned favorite',
      agentIcon: 'codex',
      agentName: 'codex',
      isPinned: true,
      isFavorite: true,
      sessionTag: 'favorite',
    }),
    base({
      sessionId: 'syn-sleeping',
      title: 'Sleeping',
      agentIcon: 'codex',
      agentName: 'codex',
      lifecycleState: 'sleeping',
      providerSessionState: 'missing',
    }),
    base({
      sessionId: 'syn-stopped',
      title: 'Stopped but pinned',
      agentIcon: 'codex',
      agentName: 'codex',
      lifecycleState: 'stopped',
      providerSessionState: 'missing',
      isPinned: true,
    }),
    base({
      sessionId: 'syn-working',
      title: 'Working',
      agentIcon: 'claude',
      agentName: 'claude',
      activity: 'working',
      workingStartedAt: iso(-30_000),
    }),
    base({
      sessionId: 'syn-attention',
      title: 'Needs attention',
      agentIcon: 'claude',
      agentName: 'claude',
      activity: 'attention',
      pendingQuestionCount: 2,
    }),
    base({ sessionId: 'syn-browser', title: 'A browser pane', kind: 'browser', agentIcon: 'browser' }),
    base({ sessionId: 'syn-grouped-a', title: 'In a user group A', agentIcon: 'claude', agentName: 'claude' }),
    base({
      sessionId: 'syn-grouped-b',
      title: 'In a user group B',
      agentIcon: 'claude',
      agentName: 'claude',
      lifecycleState: 'sleeping',
      providerSessionState: 'missing',
    }),
    base({
      projectId: 'syn-plain',
      groupId: 'syn-plain-g',
      sessionId: 'syn-plain-only',
      title: 'Only session',
      agentIcon: 'claude',
      agentName: 'claude',
      sortKey: 'a',
    }),
    base({
      projectId: 'syn-worktree',
      groupId: 'syn-worktree-g',
      sessionId: 'syn-worktree-only',
      title: 'Worktree session',
      agentIcon: 'codex',
      agentName: 'codex',
      sortKey: 'a',
    }),
    base({
      projectId: 'syn-chats',
      groupId: 'syn-chats-g',
      sessionId: 'syn-chat-one',
      title: 'A chat',
      agentIcon: 'claude',
      agentName: 'claude',
      sortKey: 'a',
    }),
  ];
  const groups = [
    {
      groupId: 'syn-main-g',
      projectId: 'syn-main',
      title: 'Synthetic Main',
      sortKey: 'a',
      sessionIds: sessions.filter((s) => s.projectId === 'syn-main').map((s) => s.sessionId),
    },
    {
      groupId: 'syn-plain-g',
      projectId: 'syn-plain',
      title: 'Synthetic Plain',
      sortKey: 'b',
      sessionIds: ['syn-plain-only'],
    },
    {
      groupId: 'syn-worktree-g',
      projectId: 'syn-worktree',
      title: 'Synthetic Worktree',
      sortKey: 'c',
      sessionIds: ['syn-worktree-only'],
    },
    { groupId: 'syn-chats-g', projectId: 'syn-chats', title: 'Chats', sortKey: 'd', sessionIds: ['syn-chat-one'] },
  ];
  return {
    revision: 1,
    generatedAt: iso(0),
    projects,
    groups,
    sessions,
    customSessionTags: {
      order: ['custom-alpha'],
      tags: { 'custom-alpha': { tagId: 'custom-alpha', name: 'Alpha', icon: 'flag', color: '#112233' } },
    },
    sidebarProjectCollections: {
      order: ['syn-collection'],
      collections: {
        'syn-collection': {
          collectionId: 'syn-collection',
          title: 'Synthetic Folder',
          color: '#3aa675',
          projectIds: ['syn-plain'],
        },
      },
    },
    sidebarSpaces: { order: [], spaces: {} },
    workspaceGroups: {
      projectOrder: ['syn-main', 'syn-plain', 'syn-worktree', 'syn-chats'],
      projects: {
        'syn-main': {
          groups: [
            { groupId: 'syn-user-group', title: 'A user group', sessionIds: ['syn-grouped-a', 'syn-grouped-b'] },
          ],
        },
      },
    },
  };
}

function syntheticScenarios(host: Json): Scenario[] {
  const nowMs = Date.now();
  const snapshot = syntheticSnapshot(nowMs);
  const ui: Json = {
    selectedMachineId: 'local',
    showHidden: false,
    selectedTagFilters: [],
    selectedSessionIds: [],
    hiddenGroupIds: [],
    hiddenCollectionKeys: [],
    collapsedGroups: [],
    collapsedCollections: [],
    expandedSessionLists: [],
    expandedHoverActions: [],
    sectionCollapse: {},
    selectedSpaceBySection: {},
  };
  const every = {
    enableSessionParking: true,
    showTagMenuWhenParking: true,
    showSessionCardHoverButtonsInContextMenu: true,
    showSessionCommandCopyActions: true,
    showSessionDetailsCopyAction: true,
    showBetaFeatures: true,
    browserViewTabHidden: false,
    sidebarSpacesEnabled: false,
    // Every heading expanded, so Parked, Snoozed and Drafts rows are drawn and can be Below.
    projectSessionListCollapsedCount: 50,
  };
  return [
    { name: 'synthetic-every-setting-on', settings: every, ui, host, snapshot },
    {
      name: 'synthetic-every-setting-off',
      settings: {
        ...every,
        enableSessionParking: false,
        showTagMenuWhenParking: false,
        showSessionCardHoverButtonsInContextMenu: false,
        showSessionCommandCopyActions: false,
        showSessionDetailsCopyAction: false,
        showBetaFeatures: false,
        browserViewTabHidden: true,
      },
      ui,
      host,
      snapshot,
    },
    {
      name: 'synthetic-expanded-lists',
      settings: every,
      ui: {
        ...ui,
        expandedSessionLists: ['syn-main', 'syn-plain', 'syn-worktree'],
        sectionCollapse: { 'syn-main': { drafts: false, parked: false, snoozed: false } },
      },
      host,
      snapshot,
    },
    {
      name: 'synthetic-selection',
      settings: every,
      ui: {
        ...ui,
        selectedSessionIds: [
          'combined-session:syn-main:syn-pinned',
          'combined-session:syn-main:syn-parked',
          'combined-session:syn-main:syn-browser',
          'combined-session:syn-main:syn-sleeping',
        ],
      },
      host,
      snapshot,
    },
  ];
}

/**
 * The settings the app really reads. `~/.local/state/ghostex/native-sidebar-settings.json` is a
 * stale copy of an earlier layout and running the gate against it covered a configuration nobody
 * has.
 */
function defaultSettingsPath(): string {
  return join(homedir(), '.config', 'ghostex', 'native-sidebar-settings.json');
}

async function writeScenarios([framesPath, outDir, settingsPath]: string[]) {
  if (!framesPath || !outDir) throw new Error('scenarios <frames.jsonl> <out-dir> [settings.json]');
  const snapshot = readSnapshot(framesPath);
  const path = settingsPath ?? defaultSettingsPath();
  let saved: Json | undefined;
  try {
    saved = JSON.parse(readFileSync(path, 'utf8')) as Json;
  } catch {
    console.log(`no saved settings at ${path}; the saved-settings scenarios are skipped`);
  }
  const scenarios = buildScenarios(snapshot, saved);
  // One clock for both sides: snooze is the only rule that reads one, and a Rust example running
  // at a different instant than the TypeScript could never validate it.
  const nowMs = Date.now();
  scenarios.forEach((scenario, index) => {
    const body = scenario.snapshot ? scenario : { ...scenario, snapshot };
    writeFileSync(
      join(outDir, `scenario-${String(index).padStart(2, '0')}.json`),
      JSON.stringify({ ...body, nowMs, accounts: SYNTHETIC_ACCOUNTS }),
      {
        mode: 0o600,
      }
    );
  });
  console.log(
    `${scenarios.length} scenarios, ${(snapshot.sessions as Json[]).length} sessions, ${(snapshot.projects as Json[]).length} projects`
  );
}

async function compare([outDir]: string[]) {
  if (!outDir) throw new Error('compare <out-dir>');
  const { buildTypeScriptMenus } = await import('./menu-parity-typescript.ts');
  const names = readdirSync(outDir)
    .filter((name) => name.startsWith('scenario-') && name.endsWith('.json'))
    .sort();
  let rows = 0;
  let menus = 0;
  let items = 0;
  const differences: string[] = [];
  for (const name of names) {
    const scenario = JSON.parse(readFileSync(join(outDir, name), 'utf8')) as Json;
    checkClock(String(scenario.name), scenario, differences);
    const rustPath = join(outDir, name.replace('scenario-', 'rust-'));
    const rust = JSON.parse(readFileSync(rustPath, 'utf8')) as Json;
    const ours = buildTypeScriptMenus(scenario, rust);
    writeFileSync(join(outDir, name.replace('scenario-', 'ts-')), JSON.stringify(ours), { mode: 0o600 });
    const counted = { rows: 0, menus: 0, items: 0 };
    diffScenario(String(scenario.name), rust, ours, differences, counted);
    rows += counted.rows;
    menus += counted.menus;
    items += counted.items;
  }
  console.log(`scenarios ${names.length} rows ${rows} menus ${menus} items ${items} differences ${differences.length}`);
  for (const difference of differences.slice(0, 80)) console.log(`  ${difference}`);
  if (differences.length > 80) console.log(`  … and ${differences.length - 80} more`);
  process.exitCode = differences.length ? 1 : 0;
}

/**
 * Both sides must answer the one clock-reading rule (a snooze is over) from the same instant. The
 * Rust example is given the scenario's `nowMs`; `isSidebarSessionSnoozed` inside the shipped
 * TypeScript reads `Date.now()` and cannot be handed one, so the drift between them is measured
 * and any snooze that falls inside it is reported rather than silently decided by whichever side
 * ran first.
 */
function checkClock(name: string, scenario: Json, out: string[]): void {
  const nowMs = Number(scenario.nowMs ?? 0);
  if (!nowMs) {
    out.push(`${name}: the scenario carries no nowMs, so the two sides do not share a clock`);
    return;
  }
  const drift = Math.abs(Date.now() - nowMs);
  const sessions = ((scenario.snapshot as Json | undefined)?.sessions ?? []) as Json[];
  for (const session of sessions) {
    const until = typeof session.snoozedUntil === 'string' ? Date.parse(session.snoozedUntil) : Number.NaN;
    if (Number.isFinite(until) && Math.abs(until - nowMs) <= drift)
      out.push(
        `${name} session ${String(session.sessionId)}: its snooze ends within the ${drift} ms the two sides' clocks differ by`
      );
  }
}

function diffScenario(
  name: string,
  rust: Json,
  ours: Json,
  out: string[],
  counted: { rows: number; menus: number; items: number }
) {
  const rustRows = (rust.rows ?? {}) as Record<string, Json>;
  const ourRows = (ours.rows ?? {}) as Record<string, Json>;
  for (const id of Object.keys(rustRows)) {
    counted.rows += 1;
    const mine = rustRows[id]!;
    const theirs = ourRows[id];
    if (!theirs) {
      out.push(`${name} row ${id}: the TypeScript side built no menus`);
      continue;
    }
    for (const key of ['menu', 'fullMenu', 'hoverBefore', 'hoverAfter']) {
      counted.menus += 1;
      counted.items += diffMenu(`${name} row ${id} ${key}`, mine[key], theirs[key], out);
    }
    if (mine.hoverChevron !== theirs.hoverChevron)
      out.push(`${name} row ${id} hoverChevron: rust ${mine.hoverChevron} ts ${theirs.hoverChevron}`);
    const mineSubmenus = (mine.hoverSubmenus ?? {}) as Record<string, unknown>;
    const theirSubmenus = (theirs.hoverSubmenus ?? {}) as Record<string, unknown>;
    for (const action of new Set([...Object.keys(mineSubmenus), ...Object.keys(theirSubmenus)])) {
      counted.menus += 1;
      counted.items += diffMenu(`${name} row ${id} hover:${action}`, mineSubmenus[action], theirSubmenus[action], out);
    }
  }
  for (const id of Object.keys(ourRows)) if (!rustRows[id]) out.push(`${name} row ${id}: the Rust side built no menus`);

  const rustGroups = (rust.groups ?? {}) as Record<string, Json>;
  const ourGroups = (ours.groups ?? {}) as Record<string, Json>;
  for (const id of Object.keys(rustGroups)) {
    const theirs = ourGroups[id];
    if (!theirs) {
      out.push(`${name} group ${id}: the TypeScript side built no menus`);
      continue;
    }
    for (const key of ['menu', 'headerActions', 'launcherWithAccounts']) {
      counted.menus += 1;
      counted.items += diffMenu(`${name} group ${id} ${key}`, rustGroups[id]![key], theirs[key], out);
    }
  }
  const rustCollections = (rust.collections ?? {}) as Record<string, Json>;
  const ourCollections = (ours.collections ?? {}) as Record<string, Json>;
  for (const id of Object.keys(rustCollections)) {
    counted.menus += 1;
    counted.items += diffMenu(`${name} collection ${id}`, (rustCollections[id] as Json).menu, ourCollections[id], out);
  }
  counted.menus += 2;
  counted.items += diffMenu(`${name} bulk`, rust.bulk, ours.bulk, out);
  counted.items += diffMenu(`${name} moreMenu`, rust.moreMenu, ours.moreMenu, out);
  const rustLogos = (rust.logos ?? {}) as Record<string, string>;
  const ourLogos = (ours.logos ?? {}) as Record<string, string>;
  for (const icon of new Set([...Object.keys(rustLogos), ...Object.keys(ourLogos)])) {
    counted.items += 1;
    if (rustLogos[icon] !== ourLogos[icon])
      out.push(`${name} logo ${icon}: rust ${describeLogo(rustLogos[icon])} ts ${describeLogo(ourLogos[icon])}`);
  }
}

function describeLogo(value: string | undefined): string {
  if (value === undefined) return 'absent';
  return `${value.length} chars`;
}

/** Every item of both menus, recursively. Returns how many items were compared. */
function diffMenu(where: string, left: unknown, right: unknown, out: string[]): number {
  const mine = Array.isArray(left) ? left : left === null || left === undefined ? null : [];
  const theirs = Array.isArray(right) ? right : right === null || right === undefined ? null : [];
  if (mine === null || theirs === null) {
    if (mine !== theirs)
      out.push(
        `${where}: rust ${mine ? `${mine.length} items` : 'none'}, ts ${theirs ? `${theirs.length} items` : 'none'}`
      );
    return 0;
  }
  let compared = 0;
  const length = Math.max(mine.length, theirs.length);
  for (let index = 0; index < length; index += 1) {
    compared += 1;
    const a = mine[index] as Json | undefined;
    const b = theirs[index] as Json | undefined;
    if (!a) {
      out.push(`${where}[${index}]: only the TypeScript side has ${label(b)}`);
      continue;
    }
    if (!b) {
      out.push(`${where}[${index}]: only the Rust side has ${label(a)}`);
      continue;
    }
    const normalizedA = normalizeItem(a);
    const normalizedB = normalizeItem(b);
    for (const key of new Set([...Object.keys(normalizedA), ...Object.keys(normalizedB)])) {
      if (key === 'children') continue;
      const left = JSON.stringify(normalizedA[key]);
      const right = JSON.stringify(normalizedB[key]);
      if (left !== right) out.push(`${where}[${index}] ${label(a)} ${key}: rust ${left} ts ${right}`);
    }
    compared += diffMenu(`${where}[${index}]${label(a)}`, a.children, b.children, out);
  }
  return compared;
}

function label(item: Json | undefined): string {
  if (!item) return '(nothing)';
  if (item.separator === true) return '(separator)';
  return JSON.stringify(item.label ?? '(no label)');
}

/**
 * Both sides written the same way before they are compared: an absent boolean reads as `false`,
 * `undefined` values are dropped the way `JSON.stringify` drops them, and `children` is compared
 * separately so a difference deep in a submenu is reported where it is rather than as one huge
 * string.
 */
function normalizeItem(item: Json): Json {
  const normalized: Json = {};
  for (const key of [
    'label',
    'icon',
    'iconColor',
    'color',
    'detail',
    'suffix',
    'imageDataUrl',
    'agentIcon',
    'menuOwner',
    'presentation',
    'menuStyle',
    'split',
  ]) {
    if (item[key] !== undefined && item[key] !== null) normalized[key] = item[key];
  }
  for (const key of ['supportsChat', 'keepOpen', 'heading', 'checked', 'disabled', 'danger', 'separator', 'primary']) {
    normalized[key] = item[key] === true;
  }
  for (const key of ['command', 'onOpen', 'secondary']) {
    if (item[key] !== undefined && item[key] !== null) normalized[key] = sortKeys(item[key]);
  }
  normalized.hasChildren = Array.isArray(item.children);
  return normalized;
}

function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (value && typeof value === 'object') {
    const entries = Object.entries(value as Json)
      .filter(([, item]) => item !== undefined)
      .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0));
    return Object.fromEntries(entries.map(([key, item]) => [key, sortKeys(item)]));
  }
  return value;
}
