/*
CDXC:Git 2026-09-25 WHY:
The Git menu, the Git actions, the diff-stats poll, the review dialog and the
worktree dialogs run in Rust since the app runtime port's family F5
(apps/desktop/src/app/gx_store/git/). What is left here is the prompt-agent
resolution the runtime's other families still call (the board, App Shot,
session create, project activation); it goes with QuickJS in step 3.

A standalone type (rather than one derived from `typeof
gpuiSidebarRuntimeGitMethods`) because deriving it would make
`GpuiSidebarRuntime` depend on the method bodies that depend on it, which
TypeScript reports as a circular base type.
*/
import type { SidebarAgentButton } from '@/packages/shared/sidebar-agents';

export interface GpuiSidebarRuntimeGitMethods {
  resolveDefaultPromptAgent(agentId?: string): SidebarAgentButton | undefined;
  resolveDefaultPromptAgentId(agentId?: string): string;
}
