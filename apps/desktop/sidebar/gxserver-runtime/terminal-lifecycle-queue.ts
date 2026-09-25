/*
CDXC:RepoStructure 2026-08-22:
Split out of the single 21,861-line `gxserver-runtime.ts`. Pure move: no logic
changed. See `core.ts` for how the runtime's methods are re-attached.
*/
import type { GpuiSidebarRuntime } from './core';
import { normalizeGpuiWorkspaceTabSessionSelection } from './helpers/command-palette';
import { rememberGpuiProjectSession } from './project-activation';
import {
  parseGpuiRemotePresentationProjectId,
  parseGpuiRemotePresentationSessionId,
} from './helpers/remote-presentation';
import { createGxserverPresentationProjectSessionId } from '@/packages/shared/gxserver-presentation-sidebar-projection';

/*
CDXC:RepoStructure 2026-08-22:
The method signatures below are copied verbatim from the original class body.
They exist as a standalone interface — rather than being derived from
`typeof gpuiSidebarRuntimeTerminalLifecycleMethods` — because deriving them would make
`GpuiSidebarRuntime` depend on the bodies that depend on it, which TypeScript
reports as a circular base type. `gpuiSidebarRuntimeTerminalLifecycleMethodsShapeCheck`
at the bottom of this file is what keeps the two in step.
*/
export interface GpuiSidebarRuntimeTerminalLifecycleMethods {
  handleGpuiWorkspaceTabSessionSelected(payload: unknown): void;
}

export const gpuiSidebarRuntimeTerminalLifecycleMethods = {
  handleGpuiWorkspaceTabSessionSelected(this: GpuiSidebarRuntime, payload: unknown): void {
    const selection = normalizeGpuiWorkspaceTabSessionSelection(payload);
    if (!selection) {
      return;
    }
    if (selection.focusStamp !== undefined) {
      // Recorded before anything is posted, so the focus state this selection publishes already echoes it.
      this.gpuiFocusStamp = Math.max(this.gpuiFocusStamp ?? 0, selection.focusStamp);
    }
    for (const remembered of selection.rememberedSessions ?? []) {
      rememberGpuiProjectSession(this, remembered.projectId, remembered.sessionId);
    }
    const remoteSession = parseGpuiRemotePresentationSessionId(selection.sessionId);
    const remoteProject = parseGpuiRemotePresentationProjectId(selection.projectId);
    if (remoteSession || remoteProject) {
      if (
        !remoteSession ||
        !remoteProject ||
        remoteSession.machineId !== remoteProject.machineId ||
        remoteSession.projectId !== remoteProject.projectId
      ) {
        return;
      }
      this.setRemotePresentationSessionFocus(remoteSession);
      this.publishRemotePresentationPatch();
      return;
    }
    /*
    CDXC:FocusRouting 2026-06-26-08:01:
    A GPUI workspace tab click has already selected the native tab in Rust. Match macOS `paneTabSelected` by updating the sidebar's local or machine-scoped remote presentation focus and publishing only the corresponding sidebar patch; do not post `workspaceTerminalFocus` back to Rust or call gxserver `/api/focusSession`.

    CDXC:FocusRouting 2026-06-27-00:33:
    MacOS reconciles stale native sleeping pane tabs when gxserver presentation already reports the canonical P/G session running. Preserve the one-way tab-selection path for ordinary clicks, but if Rust marks the selected mapped tab as locally sleeping and the current presentation row is running, post one bounded WorkspaceTerminalFocus so Rust reuses and attaches that existing tab instead of leaving an inert sleeping placeholder.

    CDXC:FocusRouting 2026-07-11:
    A restored-after-restart Running tab can carry no local terminal runtime at all (no live owner, parked owner, or pending attach payload); Rust reports that as `localRuntimeMissing`. Reconcile it exactly like the stale sleeping case: when gxserver presentation still reports the canonical P/G session running, post one bounded WorkspaceTerminalFocus so Rust materializes the tab through the ordinary gxserver attach pipeline instead of leaving an empty body behind the selected tab.
    */
    const shouldReconcileRunningPresentation =
      (selection.localWasSleeping === true || selection.localRuntimeMissing === true) &&
      this.presentation?.sessions.some(
        (session) =>
          session.projectId === selection.projectId &&
          session.sessionId === selection.sessionId &&
          session.lifecycleState === 'running'
      ) === true;
    this.setLocalPresentationSessionFocus(
      selection.projectId,
      selection.sessionId,
      undefined,
      selection.visibleSessionIds
    );
    if (shouldReconcileRunningPresentation) {
      this.postLocalWorkspaceTerminalFocus(selection.projectId, selection.sessionId);
    }
    this.publishPresentation('patch');
  },
};

const gpuiSidebarRuntimeTerminalLifecycleMethodsShapeCheck: GpuiSidebarRuntimeTerminalLifecycleMethods =
  gpuiSidebarRuntimeTerminalLifecycleMethods;
void gpuiSidebarRuntimeTerminalLifecycleMethodsShapeCheck;
