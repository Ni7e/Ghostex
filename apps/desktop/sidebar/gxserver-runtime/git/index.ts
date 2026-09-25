import { gpuiSidebarRuntimeGitPromptAgentMethods } from './prompt-agent';
import type { GpuiSidebarRuntimeGitMethods } from './types';

export type { GpuiSidebarRuntimeGitMethods } from './types';

export const gpuiSidebarRuntimeGitMethods = {
  ...gpuiSidebarRuntimeGitPromptAgentMethods,
};

const gpuiSidebarRuntimeGitMethodsShapeCheck: GpuiSidebarRuntimeGitMethods = gpuiSidebarRuntimeGitMethods;
void gpuiSidebarRuntimeGitMethodsShapeCheck;
