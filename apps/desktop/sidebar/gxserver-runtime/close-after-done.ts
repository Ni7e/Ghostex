/*
CDXC:RepoStructure 2026-08-22:
Split out of the single 21,861-line `gxserver-runtime.ts`. Pure move: no logic
changed. See `core.ts` for how the runtime's methods are re-attached.
*/
import { GPUI_DELAYED_SEND_MAX_DELAY_MS } from './constants';
import type { GpuiSidebarRuntime } from './core';
import { formatGpuiCloseAfterDoneCountdown, formatGpuiDelayedSendDelay } from './helpers/close-after-done';
import { parseGpuiRemotePresentationSessionId } from './helpers/remote-presentation';
import type {
  GxserverPresentationCloseAfterDoneProjection,
  GxserverPresentationDelayedSendProjection,
} from '@/packages/shared/gxserver-presentation-sidebar-projection';
import { parseGxserverPresentationProjectSessionId } from '@/packages/shared/gxserver-presentation-sidebar-projection';
import type { GxserverPresentationSession } from '@/packages/shared/gxserver-protocol';
import type { SidebarToExtensionMessage } from '@/packages/shared/session-grid-contract';

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
  scheduleRemoteDelayedSend(
    message: Extract<SidebarToExtensionMessage, { type: 'scheduleDelayedSend' }>
  ): Promise<void>;
  postponeDelayedSend(sessionId: string, delayMs: number): Promise<void>;
  cancelDelayedSend(sessionId: string): Promise<void>;
  findPresentationSessionRowForSidebarSessionId(sessionId: string): GxserverPresentationSession | undefined;
  getCloseAfterDoneProjection(sessionId: string): GxserverPresentationCloseAfterDoneProjection | undefined;
  getDelayedSendProjection(sessionId: string): GxserverPresentationDelayedSendProjection | undefined;
}

export const gpuiSidebarRuntimeCloseAfterDoneMethods = {
  async scheduleRemoteDelayedSend(
    this: GpuiSidebarRuntime,
    message: Extract<SidebarToExtensionMessage, { type: 'scheduleDelayedSend' }>
  ): Promise<void> {
    /*
    CDXC:DelayedSend 2026-08-17:
    Remote delayed sends are owned by the gxserver hosting the target session.
    The renderer submits only the canonical trigger and ids; the daemon stores,
    projects, and eventually fires the send even if this app disappears.
    */
    const reference = parseGpuiRemotePresentationSessionId(message.sessionId);
    if (!reference) {
      this.handleUnsupportedSidebarMessage(message);
      return;
    }
    const session = this.findRemotePresentationSession(reference);
    if (!session || (session.kind !== 'terminal' && session.kind !== 'agent')) {
      this.postSidebarActionToast('info', 'Delayed Send is only available for remote terminal sessions.');
      return;
    }

    const trigger = message.sendWhenSpecificAgentFinishes
      ? 'specificAgentStops'
      : message.sendWhenAllProjectSessionsStop
        ? 'allAgentsStop'
        : message.sendWhenAgentStops
          ? 'agentStops'
          : 'afterDelay';
    let delayMs: number | undefined;
    let description: string;
    if (trigger === 'specificAgentStops') {
      description = 'Presses Enter after the selected agent has finished working for 10 seconds.';
    } else if (trigger === 'allAgentsStop') {
      description = 'Presses Enter after all agents in the project have finished working for 10 seconds.';
    } else if (trigger === 'agentStops') {
      description = 'Presses Enter after this agent has finished working for 10 seconds.';
    } else {
      delayMs = message.delayMs;
      if (
        delayMs === undefined ||
        !Number.isSafeInteger(delayMs) ||
        delayMs <= 0 ||
        delayMs > GPUI_DELAYED_SEND_MAX_DELAY_MS
      ) {
        this.postSidebarActionToast('warning', 'Choose a future send time within 24 days.');
        return;
      }
      description = `Presses Enter in ${formatGpuiDelayedSendDelay(delayMs)}.`;
    }

    try {
      await this.requestRemoteGxserver(reference.machineId, '/api/scheduleDelayedSend', {
        ...(delayMs === undefined ? {} : { delayMs }),
        projectId: reference.projectId,
        ...(trigger === 'allAgentsStop' ? { sendWhenAllProjectSessionsStop: true } : {}),
        ...(trigger === 'agentStops' ? { sendWhenAgentStops: true } : {}),
        ...(trigger === 'specificAgentStops'
          ? { sendWhenSpecificAgentFinishes: message.sendWhenSpecificAgentFinishes }
          : {}),
        sessionId: reference.sessionId,
      });
      this.postSidebarActionToast('info', 'Delayed Send scheduled', { description });
    } catch (error) {
      this.postRemoteToast('error', 'Delayed Send unavailable', {
        description: error instanceof Error ? error.message : String(error),
      });
    }
  },

  async postponeDelayedSend(this: GpuiSidebarRuntime, sessionId: string, delayMs: number): Promise<void> {
    /**
     * CDXC:DelayedSend 2026-09-15 WHY:
     * The card posts directly to this runtime, unlike the native scheduling modal. A remote-only handler silently dropped local postponements, leaving both the saved deadline and sidebar countdown unchanged.
     */
    const remote = parseGpuiRemotePresentationSessionId(sessionId);
    const reference = remote ?? parseGxserverPresentationProjectSessionId(sessionId);
    try {
      if (!reference) {
        throw new Error('The selected agent session is unavailable.');
      }
      const params = {
        projectId: reference.projectId,
        sessionId: reference.sessionId,
        delayMs,
      };
      if (remote) {
        await this.requestRemoteGxserver(remote.machineId, '/api/postponeDelayedSend', params);
      } else {
        if (!this.client) {
          throw new Error('The local gxserver is disconnected.');
        }
        await this.client.rpc('/api/postponeDelayedSend', params);
      }
      this.postSidebarActionToast('info', 'Delayed Send postponed', {
        description: `Added ${formatGpuiDelayedSendDelay(delayMs)} to the scheduled send time.`,
      });
    } catch (error) {
      this.postSidebarActionToast('error', 'Delayed Send could not be postponed', {
        description: error instanceof Error ? error.message : String(error),
      });
    }
  },

  async cancelDelayedSend(this: GpuiSidebarRuntime, sessionId: string): Promise<void> {
    const remote = parseGpuiRemotePresentationSessionId(sessionId);
    const reference = remote ?? parseGxserverPresentationProjectSessionId(sessionId);
    try {
      if (!reference) {
        throw new Error('The selected agent session is unavailable.');
      }
      const params = { projectId: reference.projectId, sessionId: reference.sessionId };
      let result: { changed?: boolean };
      if (remote) {
        result = await this.requestRemoteGxserver(remote.machineId, '/api/cancelDelayedSend', params);
      } else {
        if (!this.client) {
          throw new Error('The local gxserver is disconnected.');
        }
        result = await this.client.rpc('/api/cancelDelayedSend', params);
      }
      this.postSidebarActionToast(
        'info',
        result.changed === true ? 'Delayed Send canceled' : 'No Delayed Send timer is active'
      );
    } catch (error) {
      this.postSidebarActionToast('error', 'Delayed Send could not be canceled', {
        description: error instanceof Error ? error.message : String(error),
      });
    }
  },

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

  getDelayedSendProjection(
    this: GpuiSidebarRuntime,
    sessionId: string
  ): GxserverPresentationDelayedSendProjection | undefined {
    const delayedSend = this.workspaceSessionDelayedSends.get(sessionId);
    if (!delayedSend) {
      return undefined;
    }
    return {
      deadlineAt: delayedSend.delayedSendDeadlineAt,
      remainingLabel: delayedSend.delayedSendRemainingLabel,
      remainingMs: delayedSend.delayedSendRemainingMs,
      sendWhenAllProjectSessionsStopActive:
        delayedSend.sendWhenAllProjectSessionsStopActive === true ? true : undefined,
      sendWhenAgentStopsActive: delayedSend.sendWhenAgentStopsActive === true ? true : undefined,
    };
  },
};

const gpuiSidebarRuntimeCloseAfterDoneMethodsShapeCheck: GpuiSidebarRuntimeCloseAfterDoneMethods =
  gpuiSidebarRuntimeCloseAfterDoneMethods;
void gpuiSidebarRuntimeCloseAfterDoneMethodsShapeCheck;
