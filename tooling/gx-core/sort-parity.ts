/**
 * The gate for the More menu's two sort rows, `sortManual` and `sortLastActivity`: what the store
 * answers against where the shipped TypeScript's path really ENDS.
 *
 *   cargo run --release --example sidebar_sort_parity -- <out-dir>   # from packages/gx-core
 *   bun tooling/gx-core/sort-parity.ts compare <out-dir> [--inject <mutation>]
 *
 * **What the old path is, followed to its last function.** The renderer command reaches the REAL
 * controller (`connectNativeSidebar`, through `bridge.onNativeSidebarCommand`), which calls
 * `runNativeSidebarAction`, which posts `setActiveSessionsSortMode` (with
 * `manualSessionIdsByGroup` only when switching TO manual) through the controller's `post`, which
 * is the real runtime's `vscode.postMessage` from `createGpuiSidebarRuntime`, which is
 * `handleSidebarMessage`. That switch has no case for the message, so it ends in
 * `handleUnsupportedSidebarMessage`, the documented no-op. The store's answer is therefore the
 * empty plan (gx-core `sidebar_actions/sort.rs`), and what this gate proves is that the TypeScript
 * reaches that end and nothing else: no app-modal-host or native-host message, no bridge call, no
 * storage write, no inbound sidebar message. The one edge replaced is
 * `handleUnsupportedSidebarMessage` itself, by a recorder, so the day the runtime grows a real
 * handler the end is not reached and the gate fails.
 *
 * **The scenario, and why it is built.** The store is hydrated with a local project, a second local
 * project that is HIDDEN, a chat collection, a project on a SECOND machine and a browser group, and
 * the controller is given the machine tab and an active TAG FILTER through its own commands. The
 * posted layout is then checked against the rows the real `createNativeSidebarSnapshot` draws for
 * the same ui: it must hold the hidden group, the other machine's group, the chat collection and
 * the rows the tag filter hides, and every drawn group's rows must appear in it in the same order.
 * Those checks are what make a payload built from the drawn rows distinguishable from the full
 * one, which is the mistake a future port of a real handler must not make.
 *
 * Mutations (`--inject`), each of which must be caught:
 *   plan-the-post, close-the-modal-first, refuse-the-sort-rows   (the Rust plan)
 *   a-handler-appears, end-not-recorded                           (the TypeScript route)
 *   seed-from-drawn-rows, drop-other-machines, drop-hidden-groups,
 *   wrong-order-within-a-group, sort-by-activity-leaves-the-manual-order   (the posted layout)
 *
 * Nothing here is private data: the scenario is built.
 */
// First, so the client-storage adapter finds a `Storage` before any module reads one.
import { resetBrowserStorage } from './browser-shim';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createGpuiSidebarRuntime, GpuiSidebarRuntime } from '@/apps/desktop/sidebar/gxserver-runtime/core';
import { createGpuiSidebarHudState } from '@/apps/desktop/sidebar/gxserver-runtime/helpers/command-pane';
import { connectNativeSidebar } from '@/apps/desktop/sidebar/native-sidebar/controller';
import { createNativeSidebarSnapshot } from '@/apps/desktop/sidebar/native-sidebar/model';
import { NativeSidebarUiState } from '@/apps/desktop/sidebar/native-sidebar/ui-state';
import { writeSidebarHiddenItems } from '@/packages/core-ui/sidebar-hidden-items';
import { sidebarStore } from '@/packages/core-ui/sidebar-store-model';

type Json = Record<string, any>;

const REMOTE = 'remote-ab12';
const CHATS = 'combined-chats';
const REMOTE_GROUP = `remote:${REMOTE}:project:R1`;

/** Every call the route made, in order. The end marker is `{ call: 'end' }`. */
const calls: Json[] = [];
/** The posts the runtime received, so the layout can be checked. */
const posts: Json[] = [];

const MUTATIONS = new Set([
  'plan-the-post',
  'close-the-modal-first',
  'refuse-the-sort-rows',
  'a-handler-appears',
  'end-not-recorded',
  'seed-from-drawn-rows',
  'drop-other-machines',
  'drop-hidden-groups',
  'wrong-order-within-a-group',
  'sort-by-activity-leaves-the-manual-order',
]);

function session(id: string, lastInteractionAt: string, extra: Json = {}): Json {
  return {
    sessionId: id,
    alias: id,
    primaryTitle: id,
    activity: 'idle',
    agentIcon: 'codex',
    isFocused: false,
    isRunning: true,
    isVisible: false,
    lastInteractionAt,
    createdAt: '2026-09-01T01:00:00.000Z',
    lifecycleState: 'running',
    ...extra,
  };
}

/** One project's three rows: stored A, B, C; C pinned, B the newest and tagged `favorite`. */
function projectSessions(prefix: string): Json[] {
  return [
    session(`${prefix}:A`, '2026-09-15T01:18:43.055Z'),
    session(`${prefix}:B`, '2026-09-15T02:18:43.055Z', { sessionTag: 'favorite' }),
    session(`${prefix}:C`, '2026-09-15T00:18:43.055Z', { isPinned: true }),
  ];
}

function group(groupId: string, title: string, sessions: Json[], extra: Json = {}): Json {
  return { groupId, title, isActive: false, isFocusModeActive: false, layoutVisibleCount: 1, sessions, ...extra };
}

/** The whole store, the same shape the runtime's projection hands the sidebar store. */
function scenarioGroups(): Json[] {
  return [
    group('combined-project:P1', 'P1', projectSessions('combined-session:P1')),
    group('combined-project:P2', 'P2', projectSessions('combined-session:P2')),
    group(CHATS, 'Chats', [session('combined-session:chat:X', '2026-09-15T03:00:00.000Z')], {
      isChatCollection: true,
    }),
    group(REMOTE_GROUP, 'R1', projectSessions(`remote:${REMOTE}:session:R1`), {
      remoteMachineContext: { machineId: REMOTE, machineName: 'Remote', projectId: 'R1' },
    }),
    group('browser-tabs', 'Browser', [session('browser:1', '2026-09-15T03:00:00.000Z', { kind: 'browser' })], {
      kind: 'browser',
    }),
  ];
}

let revision = 0;
function hydrate(sortMode: string): void {
  revision += 1;
  const hud = createGpuiSidebarHudState() as Json;
  sidebarStore.getState().applySidebarMessage({
    type: 'hydrate',
    revision,
    groups: scenarioGroups() as never,
    // The desktop HUD pins `lastActivity`; `manual` is set here only to reach the TypeScript's
    // other branch, where the post must carry no layout.
    hud: {
      ...hud,
      activeSessionsSortMode: sortMode,
      // Without the machine in settings the projection sends the remote tab back to local.
      settings: { ...hud.settings, remoteMachines: [{ id: REMOTE, name: 'Remote', sshHost: 'remote.invalid' }] },
    } as never,
    pinnedPrompts: [],
    previousSessions: [],
  } as never);
}

/** The edges the route could reach, all recorders. Installed once. */
function installRecorders(mutationName: string | undefined): void {
  const window = (globalThis as Json).window as Json;
  const handler = (name: string) => ({
    postMessage: (message: Json) => calls.push({ call: `webkit.${name}`, type: message?.type }),
  });
  window.webkit = {
    messageHandlers: new Proxy({} as Json, { get: (_target, name) => handler(String(name)) }),
  };
  window.ghostexGpui = {
    ...(window.ghostexGpui as Json),
    postNativeSidebarSnapshot: (payload: string) => {
      // A publish is not an effect of the row, but a menu or a close would come through here.
      const parsed = JSON.parse(payload) as Json;
      if (parsed.kind !== 'snapshot' && parsed.kind !== 'clock')
        calls.push({ call: 'sidebarSnapshot', kind: parsed.kind });
    },
    postNativeProjectPathAction: () => {
      calls.push({ call: 'nativeProjectPathAction' });
      return true;
    },
  };
  // Frames and the clock are not run: a publish is the drawn list, which this gate reads directly.
  window.requestAnimationFrame = () => 1;
  window.cancelAnimationFrame = () => {};
  window.setInterval = () => 1;
  window.clearInterval = () => {};
  for (const area of ['localStorage', 'sessionStorage']) {
    const storage = window[area] as Json;
    const setItem = storage.setItem.bind(storage);
    const removeItem = storage.removeItem.bind(storage);
    storage.setItem = (key: string, value: string) => {
      calls.push({ call: `${area}.setItem`, key });
      setItem(key, value);
    };
    storage.removeItem = (key: string) => {
      calls.push({ call: `${area}.removeItem`, key });
      removeItem(key);
    };
  }
  const prototype = GpuiSidebarRuntime.prototype as Json;
  // THE END. Replaced by a recorder, which is the only edge of the route this gate replaces.
  if (mutationName !== 'end-not-recorded')
    prototype.handleUnsupportedSidebarMessage = (message: Json) => {
      calls.push({ call: 'end', type: message?.type });
    };
  const handleSidebarMessage = prototype.handleSidebarMessage as (message: Json) => Promise<void>;
  prototype.handleSidebarMessage = function (this: Json, message: Json) {
    posts.push(JSON.parse(JSON.stringify(message)));
    // The day the runtime grows a real handler: the end is no longer reached.
    if (mutationName === 'a-handler-appears' && message?.type === 'setActiveSessionsSortMode') {
      calls.push({ call: 'setActiveSessionsSortMode', sortMode: message.sortMode });
      return Promise.resolve();
    }
    return handleSidebarMessage.call(this, message);
  };
}

/** Runs one Rust entry's command through the real controller and returns what it reached. */
async function runEntry(entry: Json): Promise<{ calls: Json[]; post?: Json; drawn: Map<string, string[]> }> {
  resetBrowserStorage();
  const window = (globalThis as Json).window as Json;
  if (entry.hiddenGroup) writeSidebarHiddenItems({ groupIds: [String(entry.hiddenGroup)], collectionKeys: [] });
  hydrate(String(entry.sortMode));
  const runtime = createGpuiSidebarRuntime();
  const inbound: Json[] = [];
  const messageSource = runtime.messageSource as Json;
  const originalPost = messageSource.postMessage?.bind(messageSource);
  messageSource.postMessage = (message: Json) => {
    inbound.push(message);
    originalPost?.(message);
  };
  const dispose = connectNativeSidebar(runtime);
  const bridge = window.ghostexGpui as Json;
  const machineId = entry.machine === 'local' ? 'local' : String(entry.machine);
  if (machineId !== 'local') bridge.onNativeSidebarCommand({ type: 'selectMachine', machineId });
  if (entry.tagFilter) bridge.onNativeSidebarCommand({ type: 'toggleTagFilter', tag: String(entry.tagFilter) });
  await new Promise((resolve) => setTimeout(resolve, 0));
  calls.length = 0;
  posts.length = 0;
  inbound.length = 0;
  bridge.onNativeSidebarCommand(entry.command);
  await new Promise((resolve) => setTimeout(resolve, 0));
  const reached = calls.map((call) => ({ ...call }));
  for (const message of inbound) reached.push({ call: 'inboundSidebarMessage', type: message?.type });
  const post = posts.find((message) => message?.type === 'setActiveSessionsSortMode');
  dispose();

  // The rows the real projection draws for the same ui, read the way the menu gate builds one.
  const ui = new NativeSidebarUiState() as Json;
  ui.selectedMachineId = machineId;
  ui.selectedTagFilters = entry.tagFilter ? [String(entry.tagFilter)] : [];
  const snapshot = createNativeSidebarSnapshot(ui as never) as Json;
  const drawn = new Map<string, string[]>();
  for (const drawnGroup of (snapshot.groups ?? []) as Json[])
    drawn.set(
      String(drawnGroup.groupId),
      ((drawnGroup.sessions ?? []) as Json[]).map((row) => String(row.sessionId))
    );
  return { calls: reached, post, drawn };
}

function machineOf(groupId: string): string {
  return groupId.startsWith('remote:') ? groupId.split(':')[1]! : 'local';
}

/** Applies a posted-layout mutation, which is how the scenario checks are proved able to fail. */
function mutatePost(name: string | undefined, post: Json | undefined, drawn: Map<string, string[]>): Json | undefined {
  if (!post) return post;
  const clone = JSON.parse(JSON.stringify(post)) as Json;
  const layout = clone.manualSessionIdsByGroup as Record<string, string[]> | undefined;
  switch (name) {
    case 'seed-from-drawn-rows':
      if (layout) clone.manualSessionIdsByGroup = Object.fromEntries(drawn);
      return clone;
    case 'drop-other-machines':
      if (layout)
        for (const groupId of Object.keys(layout))
          if (groupId.startsWith('remote:') !== [...drawn.keys()].some((id) => id.startsWith('remote:')))
            delete layout[groupId];
      return clone;
    case 'drop-hidden-groups':
      if (layout) for (const groupId of Object.keys(layout)) if (!drawn.has(groupId)) delete layout[groupId];
      return clone;
    case 'wrong-order-within-a-group':
      if (layout) for (const ids of Object.values(layout)) ids.reverse();
      return clone;
    case 'sort-by-activity-leaves-the-manual-order':
      if (clone.sortMode === 'lastActivity') clone.manualSessionIdsByGroup = Object.fromEntries(drawn);
      return clone;
    default:
      return clone;
  }
}

function mutatePlan(name: string | undefined, entry: Json): Json {
  const clone = JSON.parse(JSON.stringify(entry)) as Json;
  switch (name) {
    case 'plan-the-post':
      clone.calls = [{ call: 'setActiveSessionsSortMode' }];
      return clone;
    case 'close-the-modal-first':
      clone.calls = [{ call: 'closeAppModal' }, ...((clone.calls ?? []) as Json[])];
      return clone;
    case 'refuse-the-sort-rows':
      clone.owned = false;
      clone.calls = null;
      return clone;
    default:
      return clone;
  }
}

function isSubsequence(drawn: string[], full: string[]): boolean {
  let index = 0;
  for (const id of full) if (id === drawn[index]) index += 1;
  return index === drawn.length;
}

async function compare(args: string[]): Promise<void> {
  const outDir = args[0];
  const injectAt = args.indexOf('--inject');
  const mutationName = injectAt >= 0 ? args[injectAt + 1] : undefined;
  if (!outDir || (mutationName !== undefined && !MUTATIONS.has(mutationName))) {
    console.error(`usage: sort-parity.ts compare <out-dir> [--inject <${[...MUTATIONS].join('|')}>]`);
    process.exitCode = 2;
    return;
  }
  const rust = JSON.parse(readFileSync(join(outDir, 'sort-rust.json'), 'utf8')) as Json;
  installRecorders(mutationName);
  const differences: string[] = [];
  const counters: Record<string, number> = {
    entries: 0,
    owned: 0,
    endsReached: 0,
    postsWithLayout: 0,
    postsWithoutLayout: 0,
    hiddenGroupsInLayout: 0,
    otherMachineGroupsInLayoutLocalTab: 0,
    otherMachineGroupsInLayoutRemoteTab: 0,
    chatCollectionsInLayout: 0,
    tagHiddenRowsInLayout: 0,
    orderChecks: 0,
    rustDrawnBelowStored: 0,
  };
  for (const [index, raw] of ((rust.entries ?? []) as Json[]).entries()) {
    counters.entries += 1;
    const entry = mutatePlan(mutationName, raw);
    const where = `#${index} ${String(entry.command?.action)} tab=${String(entry.machine)} tag=${String(entry.tagFilter)} hidden=${String(entry.hiddenGroup)} mode=${String(entry.sortMode)}`;
    if (Number(entry.drawnRows) < Number(entry.storedRows)) counters.rustDrawnBelowStored += 1;
    const theirs = await runEntry(entry);
    // The plan against the route: the store owns the row, plans nothing, and the TypeScript
    // reaches its no-op end once and nothing else.
    if (entry.owned !== true)
      differences.push(`${where}: the store refused a sort row, which hands it to the old runtime`);
    else counters.owned += 1;
    const ends = theirs.calls.filter((call) => call.call === 'end');
    const effects = theirs.calls.filter((call) => call.call !== 'end');
    if (ends.length === 1 && ends[0]!.type === 'setActiveSessionsSortMode') counters.endsReached += 1;
    else
      differences.push(
        `${where}: the TypeScript's end is ${JSON.stringify(ends)}, not handleUnsupportedSidebarMessage`
      );
    const mine = (entry.calls ?? []) as Json[];
    if (JSON.stringify(mine) !== JSON.stringify(effects))
      differences.push(`${where}: rust ${JSON.stringify(mine)} ts ${JSON.stringify(effects)}`);

    // The posted message, whole: its mode, and the layout present only when switching TO manual.
    const post = mutatePost(mutationName, theirs.post, theirs.drawn);
    const action = String(entry.command?.action);
    const wantsLayout = action === 'sortManual' && entry.sortMode !== 'manual';
    if (!post) {
      differences.push(`${where}: the TypeScript posted no setActiveSessionsSortMode`);
      continue;
    }
    if (post.sortMode !== (action === 'sortManual' ? 'manual' : 'lastActivity'))
      differences.push(`${where}: posted sortMode ${String(post.sortMode)}`);
    const layout = post.manualSessionIdsByGroup as Record<string, string[]> | undefined;
    if (!wantsLayout) {
      if ('manualSessionIdsByGroup' in post && layout !== undefined)
        differences.push(`${where}: the post carries a layout where the TypeScript sends none`);
      else counters.postsWithoutLayout += 1;
      continue;
    }
    if (!layout) {
      differences.push(`${where}: the post carries no layout`);
      continue;
    }
    counters.postsWithLayout += 1;
    const tab = String(entry.machine);
    // On this computer's tab only, where the hidden group would otherwise be drawn.
    if (
      tab === 'local' &&
      entry.hiddenGroup &&
      layout[String(entry.hiddenGroup)]?.length &&
      !theirs.drawn.has(String(entry.hiddenGroup))
    )
      counters.hiddenGroupsInLayout += 1;
    if (Object.keys(layout).some((groupId) => machineOf(groupId) !== tab && layout[groupId]!.length))
      counters[tab === 'local' ? 'otherMachineGroupsInLayoutLocalTab' : 'otherMachineGroupsInLayoutRemoteTab'] += 1;
    if (layout[CHATS]?.length) counters.chatCollectionsInLayout += 1;
    if ('browser-tabs' in layout) differences.push(`${where}: the browser group is in the layout`);
    // The drawn list must be the tab's own, or every check below compares against the wrong one.
    if ([...theirs.drawn.keys()].some((groupId) => machineOf(groupId) !== tab))
      differences.push(
        `${where}: the projection drew another machine's groups ${JSON.stringify([...theirs.drawn.keys()])}`
      );
    for (const [groupId, drawnIds] of theirs.drawn) {
      const full = layout[groupId] ?? [];
      if (entry.tagFilter && full.some((id) => !drawnIds.includes(id))) counters.tagHiddenRowsInLayout += 1;
      if (drawnIds.length > 1) counters.orderChecks += 1;
      if (!isSubsequence(drawnIds, full))
        differences.push(
          `${where}: drawn ${groupId} ${JSON.stringify(drawnIds)} is not in layout order ${JSON.stringify(full)}`
        );
    }
  }
  console.log(
    `${Object.entries(counters)
      .map(([label, count]) => `${label} ${count}`)
      .join(' ')} differences ${differences.length}${mutationName ? ` (injected ${mutationName})` : ''}`
  );
  for (const difference of differences.slice(0, 20)) console.log(`  ${difference}`);
  if (differences.length > 20) console.log(`  ... and ${differences.length - 20} more`);
  const collapsed = Object.entries(counters).filter(([, count]) => count === 0);
  if (mutationName) {
    const noticed = differences.length > 0 || collapsed.length > 0;
    process.exitCode = noticed ? 0 : 1;
    if (!noticed)
      console.log(`  the injected mutation ${mutationName} produced NO difference and collapsed no counter`);
    else if (collapsed.length) console.log(`  collapsed: ${collapsed.map(([label]) => label).join(', ')}`);
    return;
  }
  if (collapsed.length) {
    console.log(`  ${collapsed.map(([label]) => label).join(', ')} counted nothing, so the gate is not measuring`);
    process.exitCode = 1;
    return;
  }
  process.exitCode = differences.length ? 1 : 0;
}

const [command, ...rest] = process.argv.slice(2);
if (command === 'compare') await compare(rest);
else {
  console.error('usage: sort-parity.ts compare <out-dir> [--inject <mutation>]');
  process.exitCode = 2;
}
