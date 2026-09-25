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
 * The per-row facts the old projection carried into Rust: a project's git numbers, and the two
 * armed timers this app's runtime owns. Keyed the way the projection keys them, so Rust can read
 * them per project and per sidebar session id.
 *
 * `remainingMs` and `remainingLabel` are derived from the host clock at the moment they are read,
 * so they are carried for the reader but are NOT what the comparison judges; `armed`, the deadline
 * and the two send-when flags are.
 *
 * CDXC:Sidebar 2026-09-21 WHY:
 * The git numbers are read off the groups the projection just built, NOT off
 * `projectDiffStatsByProjectId`. The probe map holds only the projects the background cycle polls
 * (`getVisibleProjectDiffStatsRefreshTargets` skips Quick projects, parked Recent Projects, a
 * project with no path and a remote machine with no live presentation), while `overlayProjectDiffStats`
 * gives every OTHER project group the default stats and publishes those. Posting the map therefore
 * left one channel entry missing per unpolled project, which Rust read as a difference on every
 * single comparison; taking the published object is also the only spelling whose value the step 3
 * reader can use in place of the publish with no behaviour change.
 */
export function postGpuiSidebarRuntimeFactsRows(runtime: GpuiSidebarRuntime): void {
  postRemoteRecentProjects(runtime);
  const projectDiffStats: Record<string, unknown> = {};
  for (const group of runtime.latestGroups) {
    const editor = group.projectContext?.editor;
    if (editor) projectDiffStats[editor.projectId] = editor.diffStats;
  }
  const delayedSend: Record<string, unknown> = {};
  for (const sessionId of runtime.workspaceSessionDelayedSends.keys()) {
    const projection = runtime.getDelayedSendProjection(sessionId);
    if (projection) delayedSend[sessionId] = projection;
  }
  post({ delayedSend, kind: 'rows', projectDiffStats, version: 1 });
}

/** The runtime's own focus paths acknowledge attention through the Rust store's one tracker. */
export function postGpuiSidebarRuntimeFactsAttentionAcknowledge(sessionId: string): void {
  post({ kind: 'attentionAcknowledge', sessionId, version: 1 });
}

/** A reveal the runtime asked the sidebar for, which used to reach Rust only on the next publish. */
export function postGpuiSidebarRuntimeFactsReveal(sessionId: string, requestId: number): void {
  post({ kind: 'reveal', requestId, sessionId, version: 1 });
}
