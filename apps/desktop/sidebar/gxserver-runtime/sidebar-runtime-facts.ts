import type { GpuiSidebarRuntime } from './core';

/**
 * CDXC:Sidebar 2026-09-21 DECISION:
 * User (M4d part 2, question 1 option A): the facts the Rust sidebar still borrows from the page's
 * projection reach Rust on a narrow one-way channel the runtime posts, rather than by porting the
 * HUD, the git probe and the Close After Done timers into Rust now. The channel carries no
 * diffing and no patches and dies with QuickJS in M8.
 */
type SidebarRuntimeFactsBridge = {
  postSidebarRuntimeFacts?: (payload: string) => boolean;
};

function post(payload: unknown): void {
  const bridge = window.ghostexGpui as (typeof window.ghostexGpui & SidebarRuntimeFactsBridge) | undefined;
  bridge?.postSidebarRuntimeFacts?.(JSON.stringify(payload));
}

/**
 * CDXC:Sidebar 2026-09-25 WHY:
 * The HUD is composed in Rust since the app runtime port's F2 (apps/desktop/src/app/gx_store/hud/).
 * Its one input this runtime still writes, the remote machines' client-parked projects, goes over
 * on its own post, only when it moved.
 */
let lastPostedRemoteRecentProjects: string | undefined;

function postRemoteRecentProjects(runtime: GpuiSidebarRuntime): void {
  const remoteRecentProjects = JSON.stringify([...runtime.remoteRecentProjectsByMachineId]);
  if (remoteRecentProjects === lastPostedRemoteRecentProjects) return;
  lastPostedRemoteRecentProjects = remoteRecentProjects;
  post({ kind: 'remoteRecentProjects', remoteRecentProjects: JSON.parse(remoteRecentProjects), version: 1 });
}

/**
 * The per-row facts the old projection carried into Rust: the armed timers this app's runtime
 * owns, keyed by sidebar session id. A project's git numbers are Rust's own poll since the app
 * runtime port's F5 (apps/desktop/src/app/gx_store/git/poll.rs).
 *
 * `remainingMs` and `remainingLabel` are derived from the host clock at the moment they are read,
 * so they are carried for the reader but are NOT what the comparison judges; `armed`, the deadline
 * and the two send-when flags are.
 */
export function postGpuiSidebarRuntimeFactsRows(runtime: GpuiSidebarRuntime): void {
  postRemoteRecentProjects(runtime);
  const delayedSend: Record<string, unknown> = {};
  for (const sessionId of runtime.workspaceSessionDelayedSends.keys()) {
    const projection = runtime.getDelayedSendProjection(sessionId);
    if (projection) delayedSend[sessionId] = projection;
  }
  post({ delayedSend, kind: 'rows', version: 1 });
}

/** The runtime's own focus paths acknowledge attention through the Rust store's one tracker. */
export function postGpuiSidebarRuntimeFactsAttentionAcknowledge(sessionId: string): void {
  post({ kind: 'attentionAcknowledge', sessionId, version: 1 });
}

/** A reveal the runtime asked the sidebar for, which used to reach Rust only on the next publish. */
export function postGpuiSidebarRuntimeFactsReveal(sessionId: string, requestId: number): void {
  post({ kind: 'reveal', requestId, sessionId, version: 1 });
}
