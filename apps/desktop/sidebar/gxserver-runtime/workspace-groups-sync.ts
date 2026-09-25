/*
CDXC:RepoStructure 2026-08-22:
Split out of the single 21,861-line `gxserver-runtime.ts`. Pure move: no logic
changed. See `core.ts` for how the runtime's methods are re-attached.
*/
import {
  createGpuiWorkspaceSessionSubgroupId,
  findGpuiWorkspaceSessionSubgroupForSession,
  parseGpuiWorkspaceSessionGroupsState,
} from '../workspace-session-groups';
import type { GpuiWorkspaceSessionGroupsState } from '../workspace-session-groups';
import type { GpuiSidebarRuntime } from './core';
import type { NativeSidebarBridge } from '@/packages/shared/native-sidebar';
import { isSidebarProjectCollectionsState, isSidebarSpacesState } from './helpers/remote-presentation';
import type {
  GxserverCustomSessionTagsState,
  GxserverSidebarProjectCollectionsState,
  GxserverSidebarSpacesState,
} from '@/packages/shared/gxserver-protocol';

/*
CDXC:RepoStructure 2026-08-22:
The method signatures below are copied verbatim from the original class body.
They exist as a standalone interface — rather than being derived from
`typeof gpuiSidebarRuntimeWorkspaceGroupMethods` — because deriving them would make
`GpuiSidebarRuntime` depend on the bodies that depend on it, which TypeScript
reports as a circular base type. `gpuiSidebarRuntimeWorkspaceGroupMethodsShapeCheck`
at the bottom of this file is what keeps the two in step.
*/
export interface GpuiSidebarRuntimeWorkspaceGroupMethods {
  persistWorkspaceGroups(): void;
  applyWorkspaceGroupsFromHost(state: unknown): void;
  forwardRemoteSidebarProjectCollectionsFromGxserver(
    remoteMachineId: string,
    state: GxserverSidebarProjectCollectionsState
  ): void;
  updateRemoteSidebarProjectCollections(
    remoteMachineId: string,
    state: GxserverSidebarProjectCollectionsState
  ): Promise<void>;
  forwardRemoteSidebarSpacesFromGxserver(remoteMachineId: string, state: GxserverSidebarSpacesState): void;
  updateRemoteSidebarSpaces(remoteMachineId: string, state: GxserverSidebarSpacesState): Promise<void>;
  forwardCustomSessionTagsFromGxserver(state: GxserverCustomSessionTagsState): void;
  forwardRemoteCustomSessionTagsFromGxserver(remoteMachineId: string, state: GxserverCustomSessionTagsState): void;
  workspaceSubgroupSidebarIdForSession(projectId: string, sessionId: string | undefined): string | undefined;
}

/** The document with its object keys in a fixed order, so two equal documents compare equal. */
function canonicalWorkspaceGroupsJson(state: GpuiWorkspaceSessionGroupsState): string {
  return JSON.stringify(state, (_key, value) =>
    value && typeof value === 'object' && !Array.isArray(value)
      ? Object.fromEntries(
          Object.entries(value as Record<string, unknown>).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
        )
      : value
  );
}

/**
 * CDXC:Sessions 2026-09-21 WHY:
 * The app's two scripts for this document (`workspace_groups_hand_back_script` and
 * `workspace_groups_request_script`, packages/gx-core/src/workspace_groups/sync.rs) call these two
 * bridge members, and the sidebar PAGE used to install them on its way past. The page is being
 * deleted and the runtime is the half that still edits the document, so it installs them itself
 * and drains a document that arrived before it ran.
 */
export function installGpuiWorkspaceGroupsHandBack(runtime: GpuiSidebarRuntime): void {
  const bridge = (window.ghostexGpui = window.ghostexGpui ?? {}) as typeof window.ghostexGpui & NativeSidebarBridge;
  bridge.applyWorkspaceGroups = (state) => {
    runtime.applyWorkspaceGroupsFromHost(state);
  };
  bridge.requestWorkspaceGroups = () => {
    runtime.persistWorkspaceGroups();
  };
  if (bridge.pendingWorkspaceGroups !== undefined) {
    const parked = bridge.pendingWorkspaceGroups;
    delete bridge.pendingWorkspaceGroups;
    runtime.applyWorkspaceGroupsFromHost(parked);
  }
}

export const gpuiSidebarRuntimeWorkspaceGroupMethods = {
  /*
  CDXC:Sessions 2026-09-21 WHY:
  This runtime is no longer a writer of `ghostex-gpui-workspace-session-groups` and no longer
  pushes it to gxserver. It still EDITS the document for the one path the Rust store does not own
  yet (placing a session it has just created or forked into a group; New Group, Rename, Close
  Group and every order write moved to Rust on 2026-09-25), and that edit arrives here and is handed to the app, which
  is the single writer and the single synchroniser (apps/desktop/src/app/gx_store/workspace_groups.rs).
  Two writers of one key was the shape; the one that hurt is that the app's edits reach this page
  only when the daemon echoes them back, so anything written from here in between was written from
  a document that was already behind. `applyWorkspaceGroupsFromHost` is the other half: the app
  hands the held document back after every change, so the next edit is computed from it.
  Supersedes the 2026-07-12 decision's "localStorage stays the instant-edit source" only in WHERE
  the write happens: it is still the instant-edit source, still a debounced write-through with an
  indefinite retry, and still guarded against a stale echo, all of it now in Rust.
  SEE-ALSO: packages/gx-core/src/workspace_groups/sync.rs.
  */
  persistWorkspaceGroups(this: GpuiSidebarRuntime): void {
    window.webkit?.messageHandlers?.ghostexNativeHost?.postMessage({
      state: this.workspaceGroups,
      type: 'persistWorkspaceGroups',
    });
  },

  /**
   * The document the app holds, which is the daemon's copy once the guard has judged it and the
   * newest local edit while a push is outstanding. This page no longer reads the daemon's copy
   * itself: it has no way to know whether a push is in flight, so adopting an echo here would be
   * the oscillation the guard exists to prevent, one process over.
   */
  applyWorkspaceGroupsFromHost(this: GpuiSidebarRuntime, state: unknown): void {
    const parsed = parseGpuiWorkspaceSessionGroupsState(state);
    // A CONTENT comparison, not `JSON.stringify` on the two objects: the app emits `projects` from
    // a sorted map and this page builds it in insertion order, so two equal documents can stringify
    // differently and the test would answer "it moved" for a document that did not.
    if (canonicalWorkspaceGroupsJson(parsed) === canonicalWorkspaceGroupsJson(this.workspaceGroups)) {
      return;
    }
    this.workspaceGroups = parsed;
    if (this.presentation) {
      this.publishPresentation('patch');
    } else {
      this.publishRemotePresentationPatch();
    }
  },

  /*
  CDXC:Projects 2026-09-21 WHY:
  The LOCAL half of this relay is gone, for both documents. `queueSidebarProjectCollectionsServerSync`,
  its debounced `pushSidebarProjectCollectionsToGxserver`, the forward suppression in
  `forwardSidebarProjectCollectionsFromGxserver` and the identical Spaces trio were what the
  2026-07-18-00:00 and 2026-08-27 notes described, and they stopped being reachable when Rust became
  the only desktop writer of this computer's copies (apps/desktop/src/app/gx_store/project_docs.rs,
  M4d part 2 blocker 3): nothing posts an `updateSidebarProjectCollections` or
  `updateSidebarSpaces` without a `remoteMachineId`, and the page that adopted the forward is
  deleted. Only the REMOTE methods are left, and they are direct tunnel calls with no queue and no
  pending flag. The deleted bodies are frozen for the gates in
  tooling/gx-core/project-docs-server-sync-typescript.ts.
  */
  forwardRemoteSidebarProjectCollectionsFromGxserver(
    this: GpuiSidebarRuntime,
    remoteMachineId: string,
    state: GxserverSidebarProjectCollectionsState
  ): void {
    const stateJson = JSON.stringify(state);
    if (this.lastForwardedRemoteSidebarProjectCollectionsJsonByMachineId.get(remoteMachineId) === stateJson) {
      return;
    }
    this.lastForwardedRemoteSidebarProjectCollectionsJsonByMachineId.set(remoteMachineId, stateJson);
    this.messageSource.postMessage({
      remoteMachineId,
      sidebarProjectCollections: state,
      type: 'sidebarProjectCollectionsChanged',
    });
  },

  async updateRemoteSidebarProjectCollections(
    this: GpuiSidebarRuntime,
    remoteMachineId: string,
    state: GxserverSidebarProjectCollectionsState
  ): Promise<void> {
    const response = await this.requestRemoteGxserver<{
      sidebarProjectCollections?: unknown;
    }>(remoteMachineId, '/api/updateSidebarProjectCollections', { state });
    if (!isSidebarProjectCollectionsState(response.sidebarProjectCollections)) {
      throw new Error('Remote gxserver returned invalid project collections.');
    }
    const snapshot = this.remotePresentations.get(remoteMachineId);
    if (snapshot) {
      this.remotePresentations.set(remoteMachineId, {
        ...snapshot,
        sidebarProjectCollections: response.sidebarProjectCollections,
      });
    }
    this.forwardRemoteSidebarProjectCollectionsFromGxserver(remoteMachineId, response.sidebarProjectCollections);
  },

  forwardRemoteSidebarSpacesFromGxserver(
    this: GpuiSidebarRuntime,
    remoteMachineId: string,
    state: GxserverSidebarSpacesState
  ): void {
    const stateJson = JSON.stringify(state);
    if (this.lastForwardedRemoteSidebarSpacesJsonByMachineId.get(remoteMachineId) === stateJson) {
      return;
    }
    this.lastForwardedRemoteSidebarSpacesJsonByMachineId.set(remoteMachineId, stateJson);
    this.messageSource.postMessage({
      remoteMachineId,
      sidebarSpaces: state,
      type: 'sidebarSpacesChanged',
    });
  },

  async updateRemoteSidebarSpaces(
    this: GpuiSidebarRuntime,
    remoteMachineId: string,
    state: GxserverSidebarSpacesState
  ): Promise<void> {
    const response = await this.requestRemoteGxserver<{
      sidebarSpaces?: unknown;
    }>(remoteMachineId, '/api/updateSidebarSpaces', { state });
    if (!isSidebarSpacesState(response.sidebarSpaces)) {
      throw new Error('Remote gxserver returned invalid sidebar spaces.');
    }
    const snapshot = this.remotePresentations.get(remoteMachineId);
    if (snapshot) {
      this.remotePresentations.set(remoteMachineId, {
        ...snapshot,
        sidebarSpaces: response.sidebarSpaces,
      });
    }
    this.forwardRemoteSidebarSpacesFromGxserver(remoteMachineId, response.sidebarSpaces);
  },

  /*
  CDXC:Sessions 2026-09-25 WHY:
  The catalog's write-through moved to Rust (apps/desktop/src/app/gx_store/custom_tags_sync.rs),
  this computer's and a remote machine's alike. What stays here is the forward of the daemon's
  copy into the store feed Quick Access still reads, which is why it no longer waits for a push.
  */
  forwardCustomSessionTagsFromGxserver(this: GpuiSidebarRuntime, state: GxserverCustomSessionTagsState): void {
    const stateJson = JSON.stringify(state);
    if (stateJson === this.lastForwardedCustomSessionTagsJson) {
      return;
    }
    this.lastForwardedCustomSessionTagsJson = stateJson;
    this.messageSource.postMessage({
      customSessionTags: state,
      type: 'customSessionTagsChanged',
    });
  },

  forwardRemoteCustomSessionTagsFromGxserver(
    this: GpuiSidebarRuntime,
    remoteMachineId: string,
    state: GxserverCustomSessionTagsState
  ): void {
    const stateJson = JSON.stringify(state);
    if (this.lastForwardedRemoteCustomSessionTagsJsonByMachineId.get(remoteMachineId) === stateJson) {
      return;
    }
    this.lastForwardedRemoteCustomSessionTagsJsonByMachineId.set(remoteMachineId, stateJson);
    this.messageSource.postMessage({
      customSessionTags: state,
      remoteMachineId,
      type: 'customSessionTagsChanged',
    });
  },

  workspaceSubgroupSidebarIdForSession(
    this: GpuiSidebarRuntime,
    projectId: string,
    sessionId: string | undefined
  ): string | undefined {
    if (!sessionId) {
      return undefined;
    }
    const subgroup = findGpuiWorkspaceSessionSubgroupForSession(this.workspaceGroups, projectId, sessionId);
    return subgroup ? createGpuiWorkspaceSessionSubgroupId(projectId, subgroup.groupId) : undefined;
  },
};

const gpuiSidebarRuntimeWorkspaceGroupMethodsShapeCheck: GpuiSidebarRuntimeWorkspaceGroupMethods =
  gpuiSidebarRuntimeWorkspaceGroupMethods;
void gpuiSidebarRuntimeWorkspaceGroupMethodsShapeCheck;
