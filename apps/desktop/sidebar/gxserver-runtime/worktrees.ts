/*
CDXC:Worktrees 2026-09-25 WHY:
The Add, Delete and Rename Worktree dialogs run in Rust since the app runtime
port's family F5 (apps/desktop/src/app/gx_store/git/). What is left here is what
the Project Board's "New worktree" start still calls from this runtime: its
worktree create, now the same one gxserver call the dialog makes
(`/api/createProjectWorktree`, which cuts the checkout, registers it, prepares
its Beads hooks and runs the setup command), and the toast it shows. Both go
with QuickJS in step 3.
*/
import type { GpuiSidebarRuntime } from './core';
import { gpuiWorktreeSlugFromPrompt } from './helpers/worktrees';
import type { GpuiCreatedProjectAgentSessionRecord } from './types-and-protocol';
import { postAppModalHostMessage } from '@/packages/core-ui/app-modal-host-bridge';
import type { AppToastLevel } from '@/packages/shared/app-toast-contract';
import { createAppToastRequest } from '@/packages/shared/app-toast-contract';
import type { GxserverProjectDomainState } from '@/packages/shared/gxserver-protocol';
import type { SidebarToExtensionMessage } from '@/packages/shared/session-grid-contract';

export interface GpuiSidebarRuntimeWorktreeMethods {
  createNewProjectWorktree(
    message: Extract<SidebarToExtensionMessage, { type: 'createProjectWorktree' }>,
    sourceProject: GxserverProjectDomainState
  ): Promise<{
    projectId: string;
    session: GpuiCreatedProjectAgentSessionRecord;
  }>;
  postWorktreeToast(
    level: AppToastLevel,
    title: string,
    options?: {
      description?: string;
      persistent?: boolean;
      toastId?: string;
    }
  ): void;
}

export const gpuiSidebarRuntimeWorktreeMethods = {
  async createNewProjectWorktree(
    this: GpuiSidebarRuntime,
    message: Extract<SidebarToExtensionMessage, { type: 'createProjectWorktree' }>,
    sourceProject: GxserverProjectDomainState
  ): Promise<{
    projectId: string;
    session: GpuiCreatedProjectAgentSessionRecord;
  }> {
    if (!this.client) {
      throw new Error('gxserver is unavailable.');
    }
    const prompt = message.prompt?.trim() ?? '';
    const baseBranch = message.baseBranch?.trim() ?? '';
    const agent = this.resolveSidebarAgent(message.agentId?.trim() ?? '');
    if (!prompt) {
      throw new Error('Worktree prompt is empty.');
    }
    if (!baseBranch) {
      throw new Error('Choose a base branch.');
    }
    if (!agent?.command?.trim()) {
      throw new Error('Choose an agent with a configured command.');
    }
    const response = await this.client.rpc<{ project?: GxserverProjectDomainState }>('/api/createProjectWorktree', {
      baseRef: baseBranch,
      nameHint: gpuiWorktreeSlugFromPrompt(prompt),
      projectId: sourceProject.projectId,
    });
    const worktreeProject = response.project;
    if (!worktreeProject?.projectId) {
      throw new Error('gxserver did not register the new checkout as a worktree project.');
    }
    const session = await this.createAgentSessionRecordForProject(worktreeProject, agent, prompt);
    this.focusProjectId(worktreeProject.projectId);
    return { projectId: worktreeProject.projectId, session };
  },

  postWorktreeToast(
    this: GpuiSidebarRuntime,
    level: AppToastLevel,
    title: string,
    options: {
      description?: string;
      persistent?: boolean;
      toastId?: string;
    } = {}
  ): void {
    try {
      postAppModalHostMessage(
        createAppToastRequest(level, title, options.description, {
          persistent: options.persistent,
          toastId: options.toastId,
        }),
        'AppModals:gpuiWorktreeToast'
      );
    } catch {
      /*
      CDXC:Worktrees 2026-06-24-18:21:
      Worktree mutations should still run when the toast host is unavailable.
      The missing toast bridge is a presentation problem, while gxserver remains
      the production owner for Git, setup, Beads hook, and agent-session state.
      */
    }
  },
};

const gpuiSidebarRuntimeWorktreeMethodsShapeCheck: GpuiSidebarRuntimeWorktreeMethods = gpuiSidebarRuntimeWorktreeMethods;
void gpuiSidebarRuntimeWorktreeMethodsShapeCheck;
