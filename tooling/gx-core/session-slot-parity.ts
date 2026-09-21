/**
 * The gate for the session slot hotkeys (Focus Session 1 to 9, cmd+1 to cmd+9 by default): the Nth
 * drawn row the store plans and the desktop host focuses and reveals, against the shipped
 * TypeScript it replaces.
 *
 *   cargo run --release --example sidebar_session_slot_parity -- <out-dir> [--inject <mutation>]
 *   bun tooling/gx-core/session-slot-parity.ts compare <out-dir>
 *
 * **The TypeScript side** is the REAL `runNativeSidebarHotkey` with `focusSessionSlot<N>` over a
 * REAL `NativeSidebarUiState`, followed by the REAL `createNativeSidebarSnapshot`, which performs
 * the reveal the hotkey requested, so the state compared is what the old page held after its next
 * publish. The sidebar store is hydrated from the Rust side's raw presentations through the
 * shipped projections; the UI state is READ BY THE SHIPPED READERS from the storage the Rust side
 * wrote. Storage is compared before and after: the page must write nothing.
 *
 * **Compared, per case:** which row the press focuses (the `focusSession` the page posts, against
 * the row the store selects), which row it reveals, the sidebar's own state afterwards and the
 * list it draws, and the collapse envelope the host would store, read back by the shipped reader.
 * The row click's leg the host performs itself since M4d part 2
 * (`gx_store/sidebar_focus_route.rs`: the app modal closed, then `focusSession` to the runtime) is
 * modelled here and must equal what the hotkey's own path posted through the shipped
 * `selectNativeSidebarSession`; the page's copy on the store's path (the host's `sidebarUiMirror`)
 * must draw what the store draws and must not move its reveal request. A remote row in range must reach the remote
 * row machinery's planner on a streaming machine and be handed back on a last-seen one, which is
 * that planner's rule (the open itself is the remote focus gate's).
 *
 * **The host never writes a handled-reveal id on this path**: `sidebar_session_slot.rs` (or
 * `SESSION_SLOT_HOST_SOURCE`) must not name `handled_reveal`, `take_reveal_request`,
 * `revealSidebarSession` or `requestReveal` outside a comment.
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
import { runNativeSidebarHotkey } from '@/apps/desktop/sidebar/native-sidebar/hotkeys';
import { createNativeSidebarSnapshot } from '@/apps/desktop/sidebar/native-sidebar/model';
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
  const drawn = createNativeSidebarSnapshot(ui) as Json;
  const revealBefore = ui.revealRequest?.requestId;
  edges.length = 0;
  const before = storageEntries();
  runNativeSidebarHotkey(ui, `focusSessionSlot${Number(entry.slot)}`, (message) =>
    edges.push({ edge: 'post', message: clone(message) })
  );
  const posted = clone(edges);
  const reveal = ui.revealRequest && ui.revealRequest.requestId !== revealBefore ? ui.revealRequest.sessionId : null;
  const state = stateVector(ui);
  return {
    drawn,
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
 * handler, then the host's messages routed the way `controller.ts` routes them, then the page's next
 * build.
 */
function runStorePath(rust: Json, entry: Json, target: string | null): Json {
  const ui = setUp(rust, entry);
  const snapshot = createNativeSidebarSnapshot(ui);
  const revealBefore = clone(ui.revealRequest);
  const handledBefore = ui.handledRevealRequestId;
  const before = storageEntries();
  edges.length = 0;
  // The host no longer posts `selectSession` to this page: since M4d part 2 it performs the page's
  // half of a local row click itself and sends the runtime's own message straight to the runtime
  // (apps/desktop/src/app/gx_store/sidebar_focus_route.rs). The message it sends is compared below
  // with what the shipped `selectNativeSidebarSession` posts, which is the claim that route makes.
  if (target) {
    edges.push({ edge: 'webkit.ghostexAppModalHost', message: { type: 'close' } });
    edges.push({ edge: 'post', message: { type: 'focusSession', sessionId: target } });
  }
  const leg = clone(edges);
  for (const message of entry.pageMessages as Json[]) {
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

/**
 * The names the host's session slot path must not use outside a comment. The path runs through
 * `gx_store_focus_and_reveal_slot_row`, which lives in the project slot jump's file, so both files
 * are read: scanning only this path's own file missed a forbidden call placed in the shared one.
 */
function hostSourceFindings(): string[] {
  const paths = [
    process.env.SESSION_SLOT_HOST_SOURCE ??
      fileURLToPath(new URL('../../apps/desktop/src/app/gx_store/sidebar_session_slot.rs', import.meta.url)),
    process.env.SLOT_JUMP_HOST_SOURCE ??
      fileURLToPath(new URL('../../apps/desktop/src/app/gx_store/sidebar_slot_jump.rs', import.meta.url)),
  ];
  return paths.flatMap((path) => {
    const code = readFileSync(path, 'utf8')
      .split('\n')
      .map((line) => line.replace(/\/\/.*$/, ''))
      .join('\n');
    return FORBIDDEN_ON_SLOT_PATH.filter((name) => code.includes(name)).map(
      (name) => `the host's session slot path names ${name} (${path})`
    );
  });
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

/** What the page drew before the press, read for coverage: which exclusions the list had in it. */
function drawnShape(snapshot: Json): Json {
  const groups = snapshot.groups as Json[];
  return {
    collapsedWithRows: groups.some((group) => group.collapsed && (group.sessions as Json[]).length > 0),
    cutRows: groups.some(
      (group) =>
        !group.collapsed &&
        (group.sessions as Json[]).length >
          (group.sections as Json[]).reduce((sum, section) => sum + (section.sessionIds as string[]).length, 0)
    ),
    closedHeadingWithRows: groups.some(
      (group) =>
        !group.collapsed && (group.sections as Json[]).some((section) => section.collapsed && Number(section.count) > 0)
    ),
    collapsedCollection: (snapshot.collections as Json[]).some((collection) => collection.collapsed),
  };
}

function compare(args: string[]): void {
  const outDir = args[0];
  if (!outDir) {
    console.error('usage: session-slot-parity.ts compare <out-dir>');
    process.exitCode = 2;
    return;
  }
  const rust = JSON.parse(readFileSync(join(outDir, 'session-slot-rust.json'), 'utf8')) as Json;
  const injected = rust.injected as string | null;
  installRecorders();
  const differences: string[] = [];
  const counters: Record<string, number> = {
    cases: 0,
    focuses: 0,
    beyondList: 0,
    localTargets: 0,
    remoteTargets: 0,
    remoteOpens: 0,
    remoteHandOffs: 0,
    reveals: 0,
    revealSpaceMemory: 0,
    selectionCleared: 0,
    collapsedGroupSkipped: 0,
    cutRowsSkipped: 0,
    closedHeadingSkipped: 0,
    collapsedCollectionSkipped: 0,
    parkedTargets: 0,
    hiddenCases: 0,
    spacesCases: 0,
    collectionTargets: 0,
    rowClickLegs: 0,
    pageMirrored: 0,
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
    if ((entry.pageMessages as Json[]).some((message) => message.type === 'sidebarUiMirror'))
      counters.pageMirrored += 1;

    // A remote row in range reaches the remote row machinery on a streaming machine and is handed
    // back on a last-seen one.
    const focus = theirs.focus as string | null;
    const remote = typeof focus === 'string' && focus.startsWith('remote:');
    if (remote) {
      counters.remoteTargets += 1;
      const expected = entry.tab === rust.remoteMachineId;
      if (entry.remoteOpen !== expected)
        differences.push(`${where}: remote row machinery answered ${entry.remoteOpen}, expected ${expected}`);
      if (entry.remoteOpen === true) counters.remoteOpens += 1;
      if (entry.remoteOpen === false) counters.remoteHandOffs += 1;
    } else if (entry.remoteOpen !== null && entry.remoteOpen !== undefined) {
      differences.push(`${where}: a local target was handed to the remote row machinery`);
    }

    // Coverage, read off the TypeScript's side, so a scenario that stopped reaching a shape shows
    // as a zero.
    const shape = drawnShape(theirs.drawn);
    if (focus) {
      counters.focuses += 1;
      if (!remote) counters.localTargets += 1;
      if (shape.collapsedWithRows) counters.collapsedGroupSkipped += 1;
      if (shape.cutRows) counters.cutRowsSkipped += 1;
      if (shape.closedHeadingWithRows) counters.closedHeadingSkipped += 1;
      if (shape.collapsedCollection) counters.collapsedCollectionSkipped += 1;
      if (focus.endsWith(':S2p')) counters.parkedTargets += 1;
      if (/:P[67]:/.test(focus)) counters.collectionTargets += 1;
      if ((entry.selected as string[]).length && !theirs.state.selectedSessions.length) counters.selectionCleared += 1;
      if (String(entry.scenario).startsWith('hidden')) counters.hiddenCases += 1;
      if (entry.settings.sidebarSpacesEnabled) counters.spacesCases += 1;
    } else {
      counters.beyondList += 1;
    }
    if (theirs.reveal) counters.reveals += 1;
    if ((entry.revealPlan as Json | null)?.rememberSpace) counters.revealSpaceMemory += 1;
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
  console.error('usage: session-slot-parity.ts compare <out-dir>');
  process.exitCode = 2;
}
