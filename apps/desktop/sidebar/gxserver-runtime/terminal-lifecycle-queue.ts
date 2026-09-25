/*
CDXC:RepoStructure 2026-08-22:
Split out of the single 21,861-line `gxserver-runtime.ts`. Pure move: no logic
changed. See `core.ts` for how the runtime's methods are re-attached.
*/
import {
  GPUI_SIDEBAR_WORKSPACE_TERMINAL_RENAME_COMMAND_MESSAGE_TYPE,
  GPUI_SIDEBAR_WORKSPACE_TERMINAL_RENAME_COMMAND_MESSAGE_VERSION,
} from './constants';
import type { GpuiSidebarRuntime } from './core';
import { normalizeGpuiWorkspaceTabSessionSelection } from './helpers/command-palette';
import { rememberGpuiProjectSession } from './project-activation';
import {
  parseGpuiRemotePresentationProjectId,
  parseGpuiRemotePresentationSessionId,
} from './helpers/remote-presentation';
import {
  gpuiWorkspaceTerminalTitleCommandForAgent,
  normalizeGpuiWorkspaceTerminalRuntimeAction,
} from './helpers/terminal-lifecycle';
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
  handleGpuiWorkspaceTerminalRuntimeAction(payload: unknown): Promise<void>;
  postLocalWorkspaceTerminalRenameCommand(projectId: string, sessionId: string, title: string): void;
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

  async handleGpuiWorkspaceTerminalRuntimeAction(this: GpuiSidebarRuntime, payload: unknown): Promise<void> {
    /*
    Only the export dialog's two actions still arrive here; a session control's Close, Sleep,
    Fork, Full Reload, Note and Switch Account are Rust's
    (gx_store/terminal_lifecycle/runtime_actions.rs).
    */
    const request = normalizeGpuiWorkspaceTerminalRuntimeAction(payload);
    if (!request) {
      return;
    }
    const sessionId = createGxserverPresentationProjectSessionId(request.projectId, request.sessionId);
    if (request.action === 'exportTranscript') {
      await this.exportSessionTranscript(sessionId);
      return;
    }
    await this.exportSessionTranscript(sessionId, request.target);
  },

  postLocalWorkspaceTerminalRenameCommand(
    this: GpuiSidebarRuntime,
    projectId: string,
    sessionId: string,
    title: string
  ): void {
    /*
    CDXC:CefRuntime 2026-06-27-02:27:
    GPUI `renameCommand` is accepted when TypeScript resolves gxserver's raw sessionTarget to the local workspace session and posts one fixed fire-and-forget Rust bridge payload. Keep the result and errors id-only, and pass the normalized title only through `postWorkspaceTerminalRenameCommand` so logs/results do not expose user title text, command text, paths, URLs, tokens, or terminal output.

    CDXC:Sessions 2026-07-28:
    Pi names its session with `/name <title>` and Hermes Agent uses
    `/title <title>` instead of `/rename <title>`, so the payload carries a
    fixed command selector resolved from the session's own agent identity.
    Rust still owns turning that selector into the actual terminal input.
    */
    const postRename = window.ghostexGpui?.postWorkspaceTerminalRenameCommand;
    if (typeof postRename !== 'function') {
      throw new Error('Renderer command bridge unavailable.');
    }
    /*
    CDXC:Sessions 2026-07-29:
    Rust may only type the rename command into a mounted Ghostty surface, and
    it accepts a sidebar-focus attach for this session only while gxserver
    presentation focus agrees. Activate the session exactly like a session-card
    click first so a rename of a background session mounts its terminal
    instead of being dropped at the surface-ownership check.
    */
    this.focusLocalWorkspaceSession(projectId, sessionId);
    this.publishPresentation('patch');
    const session = this.findLocalPresentationSession(projectId, sessionId);
    const agent = (session?.agentId ?? session?.agentName ?? '').trim().toLowerCase();
    const bridgeSent = postRename(
      JSON.stringify({
        version: GPUI_SIDEBAR_WORKSPACE_TERMINAL_RENAME_COMMAND_MESSAGE_VERSION,
        type: GPUI_SIDEBAR_WORKSPACE_TERMINAL_RENAME_COMMAND_MESSAGE_TYPE,
        projectId,
        sessionId,
        title,
        command: gpuiWorkspaceTerminalTitleCommandForAgent(agent),
      })
    );
    if (!bridgeSent) {
      throw new Error('Renderer command bridge unavailable.');
    }
  },
};

const gpuiSidebarRuntimeTerminalLifecycleMethodsShapeCheck: GpuiSidebarRuntimeTerminalLifecycleMethods =
  gpuiSidebarRuntimeTerminalLifecycleMethods;
void gpuiSidebarRuntimeTerminalLifecycleMethodsShapeCheck;
