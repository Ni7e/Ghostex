/**
 * The gate for the project slot hotkeys (cmd+ctrl+1 to cmd+ctrl+9 by default): the whole jump the store plans and the
 * desktop host performs, against the shipped TypeScript it replaces.
 *
 *   cargo run --release --example sidebar_slot_jump_parity -- <out-dir> [--inject <mutation>]
 *   bun tooling/gx-core/slot-jump-parity.ts compare <out-dir>
 *
 * **The TypeScript side** is the REAL `runNativeProjectSlotHotkey` over a REAL
 * `NativeSidebarUiState`, followed by the REAL `createNativeSidebarSnapshot`, which is the build
 * that performs the reveal the hotkey requested (`applyNativeSidebarReveal` runs first in it), so
 * the state compared is the state the old page held after its next publish. The sidebar store is
 * hydrated from the Rust side's raw presentations through the shipped projections, with the same
 * focus; the UI state is READ BY THE SHIPPED READERS from the storage the Rust side wrote
 * (`collapse_into_storage`, `hidden_items_into_storage`), so a stored shape that differs is a
 * difference here too.
 *
 * **Compared, per case:** which row the jump focuses (the `focusSession` the page posts, against the
 * row the store selects), which row it reveals, the sidebar's own state afterwards (Show Hidden, tag
 * filters, the multi-selection, the machine tab), the list it draws (every drawn group's collapse
 * and list expansion, every heading's collapse and drawn rows, every collection's collapse, the
 * selected Space), and the collapse envelope the host would store, read back by the shipped reader
 * and compared with what the page held in memory. **Storage**, compared before and after, because
 * the client-storage adapter writes through the `Storage` prototype no recorder sees: the page must
 * write nothing (the app is the only writer since M5 piece 7c).
 *
 * **The row click's leg is driven, not assumed.** The host focuses the row by sending the SAME
 * `selectSession` a row click sends, so that message is handed to the shipped
 * `selectNativeSidebarSession` over a fresh copy of the same state, and what it posts must equal
 * what the hotkey's own path posted.
 *
 * **The old page's copy on the store's path.** With the store's list drawn the page does NOT run
 * `runNativeProjectSlotHotkey`; it gets the row click's `selectSession` and then the messages the
 * host sends (`pageMessages` in the dump, a `sidebarUiMirror` built by the host's own
 * `sidebar_ui_mirror_changes`), handled by the shipped `NativeSidebarUiState.mirror` the way
 * `controller.ts` routes them, followed by the page's next build. What that copy then draws must be
 * what the store draws, its collapse envelope must read back equal to the store's, it must write no
 * storage, and its reveal request must not have moved: a new one would be published and overwrite
 * the id the host uses to skip an already handled reveal.
 *
 * **The host never writes a handled-reveal id on this path.** The host is not reachable from a
 * gate, so its source is read: `sidebar_slot_jump.rs` (or `SLOT_JUMP_HOST_SOURCE`) must not name
 * `handled_reveal`, `take_reveal_request`, `revealSidebarSession` or `requestReveal` outside a
 * comment. Pointing it at 04b2d0ee8's copy of the file is the mutation that shows it bites.
 *
 * A mutation (`--inject` on the Rust side) is recorded in the dump; the run must then report a
 * difference or a collapsed coverage counter, and exits 1 when it reports neither.
 *
 * Nothing here is private data: every input is built.
 */
// First, so the client-storage adapter finds a `Storage` before any module reads one.
import { resetBrowserStorage, writeStorageItem } from './browser-shim';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { createGpuiSidebarHudState } from '@/apps/desktop/sidebar/gxserver-runtime/helpers/command-pane';
import { createGpuiSidebarSettings } from '@/apps/desktop/sidebar/gxserver-runtime/helpers/bootstrap';
import { createGpuiRemotePresentationSidebarGroups } from '@/apps/desktop/sidebar/gxserver-runtime/helpers/remote-presentation';
import {
  createGpuiPresentationProjectProjectionMetadata,
  createGpuiSidebarSessionRoutingId,
  resolveGpuiSidebarAgentIcon,
} from '@/apps/desktop/sidebar/gxserver-runtime/helpers/presentation-projection';
import { runNativeProjectSlotHotkey } from '@/apps/desktop/sidebar/native-sidebar/hotkeys';
import { createNativeSidebarSnapshot } from '@/apps/desktop/sidebar/native-sidebar/model';
import { selectNativeSidebarSession } from '@/apps/desktop/sidebar/native-sidebar/selection';
import { NativeSidebarUiState } from '@/apps/desktop/sidebar/native-sidebar/ui-state';
import { createGxserverPresentationSidebarGroups } from '@/packages/shared/gxserver-presentation-sidebar-projection';
import { sidebarStore } from '@/packages/core-ui/sidebar-store-model';
import { parseSidebarSpacesFromGxserver } from '@/packages/core-ui/spaces';
import { parseSidebarProjectCollectionsFromGxserver } from '@/packages/core-ui/project-collections';
import { readSidebarUiCollapseState } from '@/packages/core-ui/sidebar-app/collapse-state';
import { persistedProjectSessionSectionCollapseState } from '@/packages/core-ui/sidebar-app/project-session-section-model';

type Json = Record<string, any>;

const COLLAPSE_KEY = 'ghostex-sidebar-ui-collapse-state:window:main';
const HIDDEN_KEY = 'ghostex.sidebar.hidden-items.v1';
const MACHINE_KEY = 'ghostex-sidebar-selected-machine-tab:window:main';

/** What the page reached besides its own state: its posts and its app-modal-host messages. */
const edges: Json[] = [];

function clone<T>(value: T): T {
  return value === undefined ? value : (JSON.parse(JSON.stringify(value)) as T);
}

function installRecorders(): void {
  const window = (globalThis as Json).window as Json;
  window.webkit = {
    messageHandlers: new Proxy({} as Json, {
      get: (_target, name) => ({
        postMessage: (message: Json) => edges.push({ edge: `webkit.${String(name)}`, message: clone(message) }),
      }),
    }),
  };
  window.requestAnimationFrame = () => 1;
  window.cancelAnimationFrame = () => {};
}

function storageEntries(): Map<string, string> {
  const window = (globalThis as Json).window as Json;
  const entries = new Map<string, string>();
  for (const area of ['localStorage', 'sessionStorage']) {
    const storage = window[area] as Json;
    for (let index = 0; index < storage.length; index += 1) {
      const key = storage.key(index) as string | null;
      if (key !== null) entries.set(`${area}:${key}`, String(storage.getItem(key)));
    }
  }
  return entries;
}

function storageChanges(before: Map<string, string>): string[] {
  const after = storageEntries();
  return [...new Set([...before.keys(), ...after.keys()])].filter((key) => before.get(key) !== after.get(key)).sort();
}

/**
 * The store as the module created it. Every case starts from it: a hydrate alone keeps the local
 * focus a previous case's selection applied (`applyLocalFocus` holds it against a publish that has
 * not caught up), which made the focused row of one case leak into the next.
 */
const pristineStore = sidebarStore.getState();

/** The sidebar store and a UI state, as the page held them when the key was pressed. */
function setUp(rust: Json, entry: Json): NativeSidebarUiState {
  sidebarStore.setState(pristineStore, true);
  resetBrowserStorage();
  writeStorageItem(COLLAPSE_KEY, String(entry.storedCollapse));
  writeStorageItem(HIDDEN_KEY, String(entry.storedHidden));
  if (entry.tab !== 'local') writeStorageItem(MACHINE_KEY, String(entry.tab));
  const window = (globalThis as Json).window as Json;
  const runtimeSettings = { debuggingMode: false, showBetaFeatures: false, settings: clone(entry.settings) };
  window.ghostexGpui = { ...(window.ghostexGpui as Json), runtimeSettings };
  const focus = entry.focus as Json | null;
  // The runtime's own projection metadata, which is where a chat project is told apart.
  const projection = createGpuiPresentationProjectProjectionMetadata({
    domainProjects: [],
    presentation: rust.localSnapshot as never,
    projectOrder: undefined,
    recentProjects: [],
  } as never);
  const local = createGxserverPresentationSidebarGroups({
    activeProjectId: focus?.projectId,
    chatProjectIds: projection.chatProjectIds,
    focusedSessionId: focus?.sessionId,
    hiddenProjectIds: projection.hiddenProjectIds,
    presentation: rust.localSnapshot as never,
    projectOverlays: projection.projectOverlays,
    resolveAgentIcon: resolveGpuiSidebarAgentIcon,
    resolveSessionRoutingId: createGpuiSidebarSessionRoutingId,
  } as never);
  // Both remote machines the store holds rows for; the one it does not is not listed at all.
  const remote = createGpuiRemotePresentationSidebarGroups({
    presentationsByMachineId: new Map([
      [String(rust.remoteMachineId), rust.remoteSnapshot as never],
      [String(rust.lastSeenMachineId), rust.lastSeenSnapshot as never],
    ]),
    resolveAgentIcon: resolveGpuiSidebarAgentIcon,
    settings: createGpuiSidebarSettings(runtimeSettings as never),
  });
  sidebarStore.getState().applySidebarMessage({
    type: 'hydrate',
    revision: 7,
    groups: [...local, ...remote] as never,
    hud: createGpuiSidebarHudState({ runtimeSettings }) as never,
    pinnedPrompts: [],
    previousSessions: [],
  } as never);
  const ui = new NativeSidebarUiState();
  const spaces = parseSidebarSpacesFromGxserver(rust.localSnapshot.sidebarSpaces);
  if (spaces) ui.metadata.spaces.local = spaces;
  const collections = parseSidebarProjectCollectionsFromGxserver(rust.localSnapshot.sidebarProjectCollections);
  if (collections) ui.metadata.collections.local = collections;
  ui.showHidden = entry.showHidden === true;
  ui.selectedTagFilters = clone(entry.tagFilters) as never;
  ui.selectedSessionIds = clone(entry.selected) as string[];
  return ui;
}

function stateVector(ui: NativeSidebarUiState): Json {
  const snapshot = createNativeSidebarSnapshot(ui) as Json;
  return {
    groups: (snapshot.groups as Json[]).map((group) => ({
      groupId: group.groupId,
      collapsed: group.collapsed,
      expanded: group.expanded,
      sections: (group.sections as Json[]).map((section) => ({
        id: section.id,
        collapsed: section.collapsed,
        sessionIds: section.sessionIds,
      })),
    })),
    collections: (snapshot.collections as Json[]).map((collection) => ({
      collectionId: collection.collectionId,
      collapsed: collection.collapsed,
    })),
    selectedSpace: (snapshot.spaces as Json[]).find((space) => space.selected)?.id ?? null,
    showHidden: ui.showHidden,
    tagFilters: ui.selectedTagFilters,
    selectedSessions: ui.selectedSessionIds,
    selectedMachine: ui.selectedMachineId,
  };
}

/**
 * The collapse state as client storage keeps it: section headings persist `pinned` and `sessions`
 * only, and a heading entry holding exactly the defaults reads back as no entry at all. The page's
 * reveal writes such an entry for every revealed project (`{...default, [section]: false}`) where the
 * store's toggles only an actually collapsed heading, so the two agree on every value a reader sees
 * and differ only in whether an all-default entry is spelled out.
 */
function persistedCollapse(collapse: Json): Json {
  const sections = persistedProjectSessionSectionCollapseState(collapse.collapsedProjectSessionSectionsById ?? {});
  return {
    ...collapse,
    collapsedProjectSessionSectionsById: Object.fromEntries(
      Object.entries(sections).filter(([, state]) => (state as Json).pinned || (state as Json).sessions)
    ),
  };
}

/** The shipped path for one press: what it posted, what it left, and what it stored. */
function runTypeScript(rust: Json, entry: Json): Json {
  const ui = setUp(rust, entry);
  // The page draws before the key is pressed; the reveal a build applies is only ever the new one.
  createNativeSidebarSnapshot(ui);
  const revealBefore = ui.revealRequest?.requestId;
  edges.length = 0;
  const before = storageEntries();
  runNativeProjectSlotHotkey(ui, Number(entry.slot), (message) =>
    edges.push({ edge: 'post', message: clone(message) })
  );
  const posted = clone(edges);
  const reveal = ui.revealRequest && ui.revealRequest.requestId !== revealBefore ? ui.revealRequest.sessionId : null;
  const state = stateVector(ui);
  return {
    posted,
    focus: posted.find((edge) => edge.message?.type === 'focusSession')?.message?.sessionId ?? null,
    reveal,
    state,
    collapse: persistedCollapse(clone(ui.collapse) as Json),
    storage: storageChanges(before),
  };
}

/**
 * The page on the store's path, on a fresh copy: the row click's `selectSession` through the shipped
 * handler (when the jump focuses a row), then the host's messages routed the way `controller.ts`
 * routes them, then the page's next build.
 */
function runStorePath(rust: Json, entry: Json, target: string | null): Json {
  const ui = setUp(rust, entry);
  const snapshot = createNativeSidebarSnapshot(ui);
  const revealBefore = clone(ui.revealRequest);
  const handledBefore = ui.handledRevealRequestId;
  const before = storageEntries();
  edges.length = 0;
  if (target)
    selectNativeSidebarSession(
      ui,
      () => snapshot,
      { type: 'selectSession', sessionId: target, mode: 'focus' },
      (message) => edges.push({ edge: 'post', message: clone(message) })
    );
  const leg = clone(edges);
  for (const message of entry.pageMessages as Json[]) {
    if (message.type === 'revealSidebarSession') ui.requestReveal(message.sessionId, message.requestId);
    if (message.type === 'sidebarUiMirror') ui.mirror(message.changes);
  }
  const state = stateVector(ui);
  return {
    leg,
    state,
    collapse: persistedCollapse(clone(ui.collapse) as Json),
    revealMoved:
      canonical(ui.revealRequest ?? null) !== canonical(revealBefore ?? null) ||
      ui.handledRevealRequestId !== handledBefore,
    storage: storageChanges(before),
  };
}

const FORBIDDEN_ON_SLOT_PATH = ['handled_reveal', 'take_reveal_request', 'revealSidebarSession', 'requestReveal'];

/** The names the host's slot path must not use outside a comment. */
function hostSourceFindings(): string[] {
  const path =
    process.env.SLOT_JUMP_HOST_SOURCE ??
    fileURLToPath(new URL('../../apps/desktop/src/app/gx_store/sidebar_slot_jump.rs', import.meta.url));
  const code = readFileSync(path, 'utf8')
    .split('\n')
    .map((line) => line.replace(/\/\/.*$/, ''))
    .join('\n');
  return FORBIDDEN_ON_SLOT_PATH.filter((name) => code.includes(name)).map(
    (name) => `the host's slot path names ${name} (${path})`
  );
}

/** The envelope the host would store, read back the way the page reads it. */
function readBack(stored: string): Json {
  resetBrowserStorage();
  writeStorageItem(COLLAPSE_KEY, stored);
  return persistedCollapse(clone(readSidebarUiCollapseState('main').state) as Json);
}

function canonical(value: unknown): string {
  const sort = (item: unknown): unknown =>
    Array.isArray(item)
      ? item.map(sort)
      : item && typeof item === 'object'
        ? Object.fromEntries(
            Object.entries(item as Json)
              .filter(([, inner]) => inner !== undefined)
              .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
              .map(([key, inner]) => [key, sort(inner)])
          )
        : item;
  return JSON.stringify(sort(value));
}

function compare(args: string[]): void {
  const outDir = args[0];
  if (!outDir) {
    console.error('usage: slot-jump-parity.ts compare <out-dir>');
    process.exitCode = 2;
    return;
  }
  const rust = JSON.parse(readFileSync(join(outDir, 'slot-jump-rust.json'), 'utf8')) as Json;
  const injected = rust.injected as string | null;
  installRecorders();
  const differences: string[] = [];
  const counters: Record<string, number> = {
    cases: 0,
    slotsOutOfRange: 0,
    noProject: 0,
    remoteTabNothing: 0,
    jumps: 0,
    emptyProject: 0,
    focusedRowTarget: 0,
    firstRowTarget: 0,
    reveals: 0,
    collapsedNoReveal: 0,
    expandedOnJump: 0,
    showLessRemoved: 0,
    revealExpandedList: 0,
    revealOpenedSection: 0,
    revealSelectedSpace: 0,
    revealOpenedCollection: 0,
    selectionCleared: 0,
    selectionKept: 0,
    hiddenShift: 0,
    spacesCases: 0,
    rowClickLegs: 0,
    pageMirrored: 0,
    pageMirrorWithoutReveal: 0,
  };
  differences.push(...hostSourceFindings());
  for (const [index, entry] of (rust.entries as Json[]).entries()) {
    counters.cases += 1;
    const where = `#${index} ${String(entry.scenario)} slot=${String(entry.slot)}`;
    const theirs = runTypeScript(rust, entry);
    const mine = entry.result as Json;
    if (theirs.storage.length) differences.push(`${where}: the page wrote storage ${theirs.storage.join(', ')}`);
    if (canonical(mine.focus ?? null) !== canonical(theirs.focus))
      differences.push(`${where}: focus rust ${mine.focus} ts ${theirs.focus}`);
    if (canonical(mine.reveal ?? null) !== canonical(theirs.reveal))
      differences.push(`${where}: reveal rust ${mine.reveal} ts ${theirs.reveal}`);
    if (canonical(mine.state) !== canonical(theirs.state))
      differences.push(`${where}: state\n    rust ${canonical(mine.state)}\n    ts   ${canonical(theirs.state)}`);
    const stored = readBack(String(entry.storedCollapseAfter));
    if (canonical(stored) !== canonical(theirs.collapse))
      differences.push(
        `${where}: stored collapse\n    rust ${canonical(stored)}\n    ts   ${canonical(theirs.collapse)}`
      );
    const page = runStorePath(rust, entry, typeof mine.focus === 'string' ? mine.focus : null);
    if (typeof mine.focus === 'string') {
      counters.rowClickLegs += 1;
      if (canonical(page.leg) !== canonical(theirs.posted))
        differences.push(
          `${where}: row click leg\n    rust ${canonical(page.leg)}\n    ts   ${canonical(theirs.posted)}`
        );
    } else if (theirs.posted.length) {
      differences.push(`${where}: the page posted ${canonical(theirs.posted)} where the store selects nothing`);
    }
    if (canonical(page.state) !== canonical(mine.state))
      differences.push(
        `${where}: the page's copy draws\n    rust ${canonical(mine.state)}\n    page ${canonical(page.state)}`
      );
    if (canonical(page.collapse) !== canonical(stored))
      differences.push(
        `${where}: the page's collapse copy\n    rust ${canonical(stored)}\n    page ${canonical(page.collapse)}`
      );
    if (page.revealMoved) differences.push(`${where}: the page's reveal request moved on the store's path`);
    if (page.storage.length)
      differences.push(`${where}: the page wrote storage on the store's path ${page.storage.join(', ')}`);
    if ((entry.pageMessages as Json[]).some((message) => message.type === 'sidebarUiMirror')) {
      counters.pageMirrored += 1;
      if (!theirs.reveal) counters.pageMirrorWithoutReveal += 1;
    }

    // Coverage, read off the TypeScript's side where it can be, so a scenario that stopped
    // reaching a shape shows as a zero.
    const slot = Number(entry.slot);
    const plan = entry.plan as Json | null;
    if (slot < 1 || slot > 9) counters.slotsOutOfRange += 1;
    else if (entry.tab !== 'local' && !theirs.posted.length) counters.remoteTabNothing += 1;
    else if (!plan) counters.noProject += 1;
    if (theirs.focus) {
      counters.jumps += 1;
      const focused = entry.focus ? `combined-session:${entry.focus.projectId}:${entry.focus.sessionId}` : null;
      if (theirs.focus === focused) counters.focusedRowTarget += 1;
      else counters.firstRowTarget += 1;
      if (entry.selected.length) counters.selectionCleared += theirs.state.selectedSessions.length ? 0 : 1;
    } else if (plan && entry.selected.length && theirs.state.selectedSessions.length) counters.selectionKept += 1;
    if (plan && !plan.target) counters.emptyProject += 1;
    if (theirs.reveal) counters.reveals += 1;
    if (plan?.wasCollapsed && theirs.focus && !theirs.reveal) counters.collapsedNoReveal += 1;
    if (plan?.expandGroup) counters.expandedOnJump += 1;
    if (plan?.collapseSessionList) counters.showLessRemoved += 1;
    const revealPlan = entry.revealPlan as Json | null;
    if (revealPlan?.expandList) counters.revealExpandedList += 1;
    if (revealPlan?.collapsedSection) counters.revealOpenedSection += 1;
    if (revealPlan?.selectSpace) counters.revealSelectedSpace += 1;
    if (theirs.reveal && String(entry.scenario) === 'collectionCollapsed' && plan?.groupId === 'combined-project:P6')
      counters.revealOpenedCollection += 1;
    if (String(entry.scenario) === 'hidden' && plan) counters.hiddenShift += 1;
    if (entry.settings.sidebarSpacesEnabled) counters.spacesCases += 1;
  }
  console.log(
    `${Object.entries(counters)
      .map(([label, count]) => `${label} ${count}`)
      .join(' ')} differences ${differences.length}${injected ? ` (injected ${injected})` : ''}`
  );
  for (const difference of differences.slice(0, 12)) console.log(`  ${difference}`);
  if (differences.length > 12) console.log(`  ... and ${differences.length - 12} more`);
  const collapsed = Object.entries(counters).filter(([, count]) => count === 0);
  if (injected) {
    const noticed = differences.length > 0 || collapsed.length > 0;
    process.exitCode = noticed ? 0 : 1;
    if (!noticed) console.log(`  the injected mutation ${injected} produced NO difference and collapsed no counter`);
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
if (command === 'compare') compare(rest);
else {
  console.error('usage: slot-jump-parity.ts compare <out-dir>');
  process.exitCode = 2;
}
