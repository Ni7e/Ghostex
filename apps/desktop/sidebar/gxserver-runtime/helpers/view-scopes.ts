/**
 * CDXC:Extensions 2026-09-18 WHY:
 * A scoped view ("Available in → Selected spaces") has to answer "is the ACTIVE project in this space?"
 * while the native titlebar renders, and the answer lives in the owning daemon's collections and spaces
 * documents. Resolve it once here, beside the HUD that already carries `projectViewSpaces`, and let every
 * consumer intersect ids instead of re-deriving sidebar membership.
 * SEE-ALSO: packages/shared/sidebar-spaces-other.ts owns the membership rule, and
 * server/src/project_views/scope.rs applies the same rule for custom project views.
 */
import { normalizeGpuiWorktreeParentProjectId } from './worktrees';
import type { ProjectViewProject } from '@/packages/shared/ghostex-settings/project-views';
import type { GhostexViewScopeSpaceRef } from '@/packages/shared/ghostex-settings/view-scopes';
import type { GxserverPresentationSnapshot, GxserverProjectDomainState } from '@/packages/shared/gxserver-protocol';
import { parseRemoteProjectId } from '@/packages/shared/remote-terminal-selection';
import type { SidebarSessionGroup } from '@/packages/shared/session-grid-contract';
import { isSidebarSpaceProject } from '@/packages/shared/sidebar-spaces-other';

export function createGpuiActiveProjectSpaceRefs({
  activeProjectId,
  domainProjects = [],
  presentation,
  remotePresentationsByMachineId,
}: {
  activeProjectId?: string;
  domainProjects?: readonly GxserverProjectDomainState[];
  presentation?: GxserverPresentationSnapshot;
  remotePresentationsByMachineId?: ReadonlyMap<string, GxserverPresentationSnapshot>;
}): GhostexViewScopeSpaceRef[] {
  if (!activeProjectId) {
    return [];
  }
  const remote = parseRemoteProjectId(activeProjectId);
  const sectionKey = remote ? `remote:${remote.machineId}` : 'local';
  const snapshot = remote ? remotePresentationsByMachineId?.get(remote.machineId) : presentation;
  const spaces = snapshot?.sidebarSpaces;
  if (!snapshot || !spaces) {
    return [];
  }
  const projectId = remote ? remote.projectId : activeProjectId;
  const parentProjectId = normalizeGpuiWorktreeParentProjectId(
    (remote ? undefined : domainProjects.find((project) => project.projectId === projectId)?.worktree) ??
      snapshot.projects.find((project) => project.projectId === projectId)?.worktree
  );
  const memberProjectId = parentProjectId ?? projectId;
  const collectionId = Object.entries(snapshot.sidebarProjectCollections?.collections ?? {}).find(([, collection]) =>
    collection.projectIds.includes(memberProjectId)
  )?.[0];
  return Object.entries(spaces.spaces).flatMap(([spaceId, space]) =>
    isSidebarSpaceProject({ collectionId, parentProjectId, projectId, space }) ? [{ sectionKey, spaceId }] : []
  );
}

/**
 * CDXC:Extensions 2026-09-18 DECISION:
 * User: the "Available in → Selected projects" picker lists only the projects currently in the sidebar.
 * The sidebar rows are the authority, so parked Recent Projects, the synthetic Chats collection and
 * browser groups are all absent, and worktrees appear as their own rows exactly as the sidebar shows them.
 * Ids come from `projectContext.editor.projectId`, the same machine-scoped id space the active project
 * reports, so a ticked remote project matches the project the titlebar is actually rendering for.
 */
export function createGpuiProjectViewProjects(groups: readonly SidebarSessionGroup[] = []): ProjectViewProject[] {
  const seen = new Set<string>();
  return groups.flatMap((group) => {
    const context = group.projectContext;
    if (!context || group.isChatCollection === true || group.kind === 'browser') {
      return [];
    }
    const projectId = context.editor.projectId;
    const name = group.title.trim();
    if (!projectId || !name || seen.has(projectId)) {
      return [];
    }
    seen.add(projectId);
    return [{ name, path: context.path, projectId }];
  });
}
