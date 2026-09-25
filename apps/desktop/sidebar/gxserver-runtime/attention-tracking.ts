/*
CDXC:Notifications 2026-09-25 WHY:
Attention (the minimum visible window before an acknowledgement, the local clear, Escape and the
completion sound) is the Rust store's since the app runtime port (packages/gx-core/src/attention.rs,
apps/desktop/src/app/gx_store/attention/). What is left here is the one door the runtime's own focus
paths still use while it owns focus (focusSession and Split Right): the acknowledgement goes to the
store's tracker on the facts channel, so every door shares one timer.
*/
import type { GpuiSidebarRuntime } from './core';
import type { GpuiSessionAttentionAcknowledgeReason } from './types-and-protocol';
import { postGpuiSidebarRuntimeFactsAttentionAcknowledge } from './sidebar-runtime-facts';

export interface GpuiSidebarRuntimeAttentionMethods {
  acknowledgeSessionAttention(sessionId: string, reason: GpuiSessionAttentionAcknowledgeReason): boolean;
}

export const gpuiSidebarRuntimeAttentionMethods = {
  acknowledgeSessionAttention(
    this: GpuiSidebarRuntime,
    sessionId: string,
    _reason: GpuiSessionAttentionAcknowledgeReason
  ): boolean {
    postGpuiSidebarRuntimeFactsAttentionAcknowledge(sessionId);
    return true;
  },
};

const gpuiSidebarRuntimeAttentionMethodsShapeCheck: GpuiSidebarRuntimeAttentionMethods =
  gpuiSidebarRuntimeAttentionMethods;
void gpuiSidebarRuntimeAttentionMethodsShapeCheck;
