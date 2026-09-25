import { DEFAULT_GPUI_PROMPT_AGENT_ID } from '../constants';
import type { GpuiSidebarRuntime } from '../core';
import { createGpuiSidebarSettings } from '../helpers/bootstrap';
import type { SidebarAgentButton } from '@/packages/shared/sidebar-agents';

export const gpuiSidebarRuntimeGitPromptAgentMethods = {
  resolveDefaultPromptAgent(this: GpuiSidebarRuntime, agentId?: string): SidebarAgentButton | undefined {
    const requestedAgentId = this.resolveDefaultPromptAgentId(agentId);
    return this.resolveSidebarAgent(requestedAgentId);
  },

  resolveDefaultPromptAgentId(this: GpuiSidebarRuntime, agentId?: string): string {
    return (
      agentId?.trim() || createGpuiSidebarSettings(this.runtimeSettings).defaultPromptAgentId.trim() || DEFAULT_GPUI_PROMPT_AGENT_ID
    );
  },
};
