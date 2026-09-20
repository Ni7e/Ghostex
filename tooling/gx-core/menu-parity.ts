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
import { join } from 'node:path';

type Json = Record<string, unknown>;

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
function buildScenarios(snapshot: Json, saved: Json | undefined) {
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
  const scenarios: { name: string; settings: Json; ui: Json; host: Json }[] = [
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
  const spaces = ((snapshot.sidebarSpaces as Json | undefined)?.order ?? []) as string[];
  for (const spaceId of [...spaces, 'other']) {
    scenarios.push({
      name: `space-${spaceId}`,
      settings: { ...everySetting, sidebarSpacesEnabled: true },
      ui: { ...emptyUi, selectedSpaceBySection: { local: spaceId } },
      host,
    });
  }
  if (saved) {
    scenarios.push({ name: 'saved-settings', settings: saved, ui: emptyUi, host });
    scenarios.push({
      name: 'saved-settings-selected',
      settings: saved,
      ui: { ...emptyUi, selectedSessionIds: selected, showHidden: true },
      host: { ...host, keepAwakeMinutes: 0 },
    });
  }
  return scenarios;
}

async function writeScenarios([framesPath, outDir, settingsPath]: string[]) {
  if (!framesPath || !outDir) throw new Error('scenarios <frames.jsonl> <out-dir> [settings.json]');
  const snapshot = readSnapshot(framesPath);
  const saved = settingsPath ? (JSON.parse(readFileSync(settingsPath, 'utf8')) as Json) : undefined;
  const scenarios = buildScenarios(snapshot, saved);
  scenarios.forEach((scenario, index) => {
    writeFileSync(
      join(outDir, `scenario-${String(index).padStart(2, '0')}.json`),
      JSON.stringify({ ...scenario, snapshot }),
      { mode: 0o600 }
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
    for (const key of ['menu', 'headerActions']) {
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
