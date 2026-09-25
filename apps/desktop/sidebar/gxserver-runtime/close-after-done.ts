/*
CDXC:RepoStructure 2026-08-22:
Split out of the single 21,861-line `gxserver-runtime.ts`. Pure move: no logic
changed. See `core.ts` for how the runtime's methods are re-attached.
*/
import type { GpuiSidebarRuntime } from './core';
import { formatGpuiCloseAfterDoneCountdown } from './helpers/close-after-done';
import { parseGpuiRemotePresentationSessionId } from './helpers/remote-presentation';
import type { GxserverPresentationCloseAfterDoneProjection } from '@/packages/shared/gxserver-presentation-sidebar-projection';
import { parseGxserverPresentationProjectSessionId } from '@/packages/shared/gxserver-presentation-sidebar-projection';
import type { GxserverPresentationSession } from '@/packages/shared/gxserver-protocol';

/*
CDXC:RepoStructure 2026-08-22:
The method signatures below are copied verbatim from the original class body.
They exist as a standalone interface — rather than being derived from
`typeof gpuiSidebarRuntimeCloseAfterDoneMethods` — because deriving them would make
`GpuiSidebarRuntime` depend on the bodies that depend on it, which TypeScript
reports as a circular base type. `gpuiSidebarRuntimeCloseAfterDoneMethodsShapeCheck`
at the bottom of this file is what keeps the two in step.
*/
export interface GpuiSidebarRuntimeCloseAfterDoneMethods {
  findPresentationSessionRowForSidebarSessionId(sessionId: string): GxserverPresentationSession | undefined;
  getCloseAfterDoneProjection(sessionId: string): GxserverPresentationCloseAfterDoneProjection | undefined;
}

export const gpuiSidebarRuntimeCloseAfterDoneMethods = {
  findPresentationSessionRowForSidebarSessionId(
    this: GpuiSidebarRuntime,
    sessionId: string
  ): GxserverPresentationSession | undefined {
    const remoteSession = parseGpuiRemotePresentationSessionId(sessionId);
    if (remoteSession) {
      return this.findRemotePresentationSession(remoteSession);
    }
    const reference = parseGxserverPresentationProjectSessionId(sessionId);
    if (!reference) {
      return undefined;
    }
    return this.presentation?.sessions.find(
      (session) => session.projectId === reference.projectId && session.sessionId === reference.sessionId
    );
  },

  getCloseAfterDoneProjection(
    this: GpuiSidebarRuntime,
    sessionId: string
  ): GxserverPresentationCloseAfterDoneProjection | undefined {
    /*
    Close After Done belongs to gxserver since 2026-09-25 (server/src/close_after_done.rs): the
    session itself says whether it is armed and, while the countdown runs, when it closes.
    */
    const session = this.findPresentationSessionRowForSidebarSessionId(sessionId);
    if (session?.closeAfterDone !== true) {
      return undefined;
    }
    const deadlineAt = session.closeAfterDoneDeadlineAt;
    const deadlineAtMs = deadlineAt ? Date.parse(deadlineAt) : Number.NaN;
    if (!deadlineAt || !Number.isFinite(deadlineAtMs)) {
      return { armed: true };
    }
    const remainingMs = Math.max(0, deadlineAtMs - Date.now());
    return {
      armed: true,
      deadlineAt,
      remainingLabel: formatGpuiCloseAfterDoneCountdown(remainingMs),
      remainingMs,
    };
  },
};

const gpuiSidebarRuntimeCloseAfterDoneMethodsShapeCheck: GpuiSidebarRuntimeCloseAfterDoneMethods =
  gpuiSidebarRuntimeCloseAfterDoneMethods;
void gpuiSidebarRuntimeCloseAfterDoneMethodsShapeCheck;
