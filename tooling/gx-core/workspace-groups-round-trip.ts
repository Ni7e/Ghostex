/**
 * The hand-off round trip: the page edits, the app writes, the app hands back, the page's NEXT edit
 * is computed from what came back.
 *
 * **Why this exists.** M5 piece 7c made the app the only writer of
 * `ghostex-gpui-workspace-session-groups`, and the only route by which a group rename, create,
 * close or project reorder now reaches disk is a bridge: `persistWorkspaceGroups` posts to the
 * native host, the host routes the message by its `type`, the guard edits, and the host evaluates a
 * script in the page that calls `applyWorkspaceGroups`. The guard itself was already gated; the
 * bridge was gated by nothing, and a bridge that nothing drives is how piece 3d shipped an entire
 * dialog port dead with a clean gate beside it.
 *
 * **What is real here and what is not.** The page half is the SHIPPED code: the real
 * `persistWorkspaceGroups`, the real `applyWorkspaceGroupsFromHost`, the real edit methods
 * (`renameWorkspaceGroup`, `createWorkspaceGroup`, `moveSessionToWorkspaceGroup`,
 * `syncWorkspaceSubgroupSessionOrder`) and the real controller wiring of the bridge hook and its
 * parking drain. **The app half is NOT the real `WorkspaceGroupsSync`**, and it cannot be: this is
 * a Bun process. What comes from the Rust probe's dump is the two edges a TypeScript process cannot
 * reach, and only those: the message type the host's routing arm matches on, and the script text
 * the host evaluates, as a template this file substitutes a document into (the probe asserts the
 * substitution rebuilds the script byte for byte). `bridge.edit` is the caller's, and in the gate
 * it is a TypeScript normalizer plus the one app-side change that makes a hand-back observable.
 * That is enough because the guard's own behaviour is gated over 22,572 steps next door; what is
 * gated HERE is the bridge. The script is EVALUATED, not parsed, so the function name, the parking
 * branch and the guard on a bridge that is not installed yet are all exercised rather than
 * described.
 *
 * Three edges are replaced, and each one is an edge rather than a decision: the window bridge
 * (`window.webkit.messageHandlers.ghostexNativeHost`) is a recorder, the page's publish and toast
 * are no-ops, and the guard's storage effects are counted rather than written.
 */
import { resetBrowserStorage } from './browser-shim';
import { GpuiSidebarRuntime } from '@/apps/desktop/sidebar/gxserver-runtime/core';
import {
  createGpuiWorkspaceSessionSubgroupId,
  parseGpuiWorkspaceSessionGroupsState,
} from '@/apps/desktop/sidebar/workspace-session-groups';

type Json = Record<string, any>;

/** One step of a round trip, as both halves see it. */
export type RoundTripStep = {
  step: string;
  /** What the page posted over the bridge, if anything. */
  posted?: Json;
  /** The document the page holds after this step. */
  page: Json;
  /** The hand-back was PARKED because the bridge hook was not installed yet. */
  parkedHere?: boolean;
  /** What the app held after an edit it made on its own, with no post behind it. */
  app?: Json;
};

/**
 * The bridge as the app sees it: a message in, a script out. The app half is the Rust guard, which
 * this file does not re-implement; `edit` is the caller's, and in the gate it is the probe's dump.
 */
export type AppBridge = {
  messageType: string;
  scriptTemplate: string;
  placeholder: string;
  /** What the guard holds after taking this document as a local edit. */
  edit: (state: Json) => Json;
  /**
   * An edit the APP makes on its own, with no post behind it: the prune's pass on a pump, or a drop
   * the app answered itself. Returns what it holds afterwards. Without this the gate can only ever
   * see the app react to the page, and the crossing declared difference 30 is about is the one
   * where the app moved first.
   */
  appEdit: () => Json;
  /**
   * Suppresses the hand-back for an APP-side edit only, which is the shape of a host that told the
   * page only when the page had spoken first. Nothing in the app does this; the gate injects it.
   */
  skipAppHandBack?: boolean;
};

/**
 * Runs one script of page edits against the real page code and the app's bridge.
 *
 * `installLate` is the parking branch: the hook is installed only after the first hand-back has
 * already been evaluated, which is what a document arriving before the controller has connected
 * its sidebar looks like.
 */
export function runWorkspaceGroupsRoundTrip(
  start: Json,
  script: string[],
  bridge: AppBridge,
  options: { installLate?: boolean } = {}
): { steps: RoundTripStep[]; handBacks: number; parked: number; appEdits: number } {
  resetBrowserStorage();
  const posts: Json[] = [];
  const runtime = Object.create(GpuiSidebarRuntime.prototype) as Json;
  runtime.workspaceGroups = parseGpuiWorkspaceSessionGroupsState(start);
  runtime.presentation = undefined;
  runtime.activeProjectId = undefined;
  runtime.activeGroupId = undefined;
  runtime.latestGroups = [];
  runtime.domainProjects = [];
  runtime.recentProjects = [];
  runtime.publishPresentation = () => {};
  runtime.publishRemotePresentationPatch = () => {};
  runtime.refreshSidebarHudFromClient = () => {};
  runtime.postSidebarActionToast = () => {};

  // The real window bridge, recording rather than posting. The shipped `persistWorkspaceGroups`
  // reads exactly this path, so a rename that stopped posting would show here as a missing entry.
  const previousWebkit = (globalThis.window as any).webkit;
  (globalThis.window as any).webkit = {
    messageHandlers: { ghostexNativeHost: { postMessage: (message: Json) => posts.push(message) } },
  };
  // The bridge object the host's script reaches for. The hook is installed the way
  // `installGpuiWorkspaceGroupsHandBack` (gxserver-runtime/workspace-groups-sync.ts) installs it,
  // and drained the way it drains `pendingWorkspaceGroups`.
  const gpuiBridge: Json = {};
  const previousGpui = (globalThis.window as any).ghostexGpui;
  (globalThis.window as any).ghostexGpui = gpuiBridge;
  const installHook = () => {
    gpuiBridge.applyWorkspaceGroups = (state: unknown) => runtime.applyWorkspaceGroupsFromHost(state);
    if (gpuiBridge.pendingWorkspaceGroups !== undefined) {
      const parked = gpuiBridge.pendingWorkspaceGroups;
      delete gpuiBridge.pendingWorkspaceGroups;
      runtime.applyWorkspaceGroupsFromHost(parked);
    }
  };
  if (!options.installLate) installHook();

  let handBacks = 0;
  let parked = 0;
  let appEdits = 0;
  const steps: RoundTripStep[] = [];
  /** The host's own hand-back, evaluated as the real script text. */
  const evaluateHandBack = (held: Json) => {
    const source = bridge.scriptTemplate.replace(bridge.placeholder, JSON.stringify(held));
    // eslint-disable-next-line no-new-func
    new Function(source)();
    handBacks += 1;
  };
  try {
    for (const [index, event] of script.entries()) {
      posts.length = 0;
      switch (event) {
        case 'appEditCrossing':
          // The page's edit happens FIRST and its post waits while the app edits its own copy.
          runtime.renameWorkspaceGroup(createGpuiWorkspaceSessionSubgroupId('P1', 'group-2'), 'Crossed');
          break;
        case 'rename':
          runtime.renameWorkspaceGroup(createGpuiWorkspaceSessionSubgroupId('P1', 'group-2'), 'Renamed');
          break;
        case 'create':
          runtime.createWorkspaceGroup(createGpuiWorkspaceSessionSubgroupId('P1', 'group-2'));
          break;
        case 'move':
          runtime.moveSessionToWorkspaceGroup({
            groupId: createGpuiWorkspaceSessionSubgroupId('P1', 'group-2'),
            sessionId: 'combined-session:P1:S3',
            targetIndex: 0,
          });
          break;
        case 'reorder':
          runtime.syncWorkspaceSubgroupSessionOrder(createGpuiWorkspaceSessionSubgroupId('P1', 'group-2'), [
            'combined-session:P1:S3',
            'combined-session:P1:S1',
          ]);
          break;
        case 'installHook':
          installHook();
          break;
      }
      // An app-side edit with no post behind it, and the crossing: the page posts, the app edits
      // its own copy BEFORE the post is taken, and the post then replaces it. That is declared
      // difference 30 made constructible rather than argued.
      if (event === 'appEdit' || event === 'appEditCrossing') {
        const held = bridge.appEdit();
        appEdits += 1;
        if (!bridge.skipAppHandBack) evaluateHandBack(held);
        if (event === 'appEdit') {
          steps.push({ step: event, page: runtime.workspaceGroups, app: held });
          continue;
        }
      }
      const posted = posts[0];
      let parkedHere = false;
      if (posted) {
        // The routing arm's own test, asked here because the two ends of a bridge agreeing on a
        // string is the one thing neither side can check alone.
        if (posted.type !== bridge.messageType)
          throw new Error(`step ${index} posted ${String(posted.type)}, the host routes ${bridge.messageType}`);
        if (!posted.state || typeof posted.state !== 'object' || Array.isArray(posted.state))
          throw new Error(`step ${index} posted no state object, which the host drops`);
        // The app takes it, and hands its held document back through the REAL script.
        evaluateHandBack(bridge.edit(posted.state as Json));
        if (gpuiBridge.pendingWorkspaceGroups !== undefined) {
          parked += 1;
          parkedHere = true;
        }
      }
      steps.push({
        step: event,
        ...(posted ? { posted } : {}),
        ...(parkedHere ? { parkedHere: true } : {}),
        page: runtime.workspaceGroups,
      });
    }
  } finally {
    (globalThis.window as any).webkit = previousWebkit;
    (globalThis.window as any).ghostexGpui = previousGpui;
  }
  return { steps, handBacks, parked, appEdits };
}
