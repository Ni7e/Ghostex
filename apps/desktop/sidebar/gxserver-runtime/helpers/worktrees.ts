/*
CDXC:RepoStructure 2026-08-22:
Split out of the single 21,861-line `gxserver-runtime.ts`. Pure move: no logic
changed. See `core.ts` for how the runtime's methods are re-attached.
*/
import type { GpuiProjectWorktreeParentCandidate } from '../types-and-protocol';
import { normalizeGpuiPathForProjectComparison } from './presentation-projection';
import { stringFromRecord } from './records';
import type { GxserverPresentationSnapshot, GxserverProjectDomainState } from '@/packages/shared/gxserver-protocol';
import type { SidebarProjectWorktreeMetadata } from '@/packages/shared/session-grid-contract';

export function createGpuiProjectWorktreeParentCandidates({
  domainProjects,
  presentation,
}: {
  domainProjects: readonly GxserverProjectDomainState[];
  presentation: GxserverPresentationSnapshot;
}): GpuiProjectWorktreeParentCandidate[] {
  return [
    ...presentation.projects.map((project) => ({
      name: project.title,
      path: project.path,
      projectId: project.projectId,
      worktree: project.worktree,
    })),
    ...domainProjects.map((project) => ({
      name: project.name,
      path: project.path,
      projectId: project.projectId,
      worktree: project.worktree,
    })),
  ];
}

export function resolveGpuiProjectWorktreeParentMetadata(
  worktree: SidebarProjectWorktreeMetadata | undefined,
  candidates: readonly GpuiProjectWorktreeParentCandidate[]
): SidebarProjectWorktreeMetadata | undefined {
  if (!worktree) {
    return undefined;
  }
  const parentPath = normalizeGpuiPathForProjectComparison(worktree.parentProjectPath);
  const canonicalParent = candidates.find((candidate) => {
    if (candidate.projectId === worktree.parentProjectId || !candidate.path) {
      return false;
    }
    if (normalizeGpuiPathForProjectComparison(candidate.path) !== parentPath) {
      return false;
    }
    return !normalizeGpuiWorktreeParentProjectId(candidate.worktree);
  });
  if (!canonicalParent) {
    return worktree;
  }
  const canonicalParentPath = canonicalParent.path?.trim();
  return {
    ...worktree,
    parentProjectId: canonicalParent.projectId,
    parentProjectName: canonicalParent.name?.trim() || worktree.parentProjectName,
    parentProjectPath: canonicalParentPath || worktree.parentProjectPath,
  };
}

export function normalizeGpuiWorktreeParentProjectId(
  worktree: Record<string, unknown> | undefined
): string | undefined {
  return stringFromRecord(worktree, 'parentProjectId');
}

export function normalizeGpuiSidebarWorktreeMetadata(
  worktree: Record<string, unknown> | undefined
): SidebarProjectWorktreeMetadata | undefined {
  const branch = stringFromRecord(worktree, 'branch');
  const name = stringFromRecord(worktree, 'name');
  const parentProjectId = normalizeGpuiWorktreeParentProjectId(worktree);
  const parentProjectName = stringFromRecord(worktree, 'parentProjectName');
  const parentProjectPath = stringFromRecord(worktree, 'parentProjectPath');
  if (!branch || !name || !parentProjectId || !parentProjectName || !parentProjectPath) {
    return undefined;
  }
  const createdAt = stringFromRecord(worktree, 'createdAt');
  return {
    branch,
    ...(createdAt && !Number.isNaN(Date.parse(createdAt)) ? { createdAt } : {}),
    name,
    parentProjectId,
    parentProjectName,
    parentProjectPath,
  };
}

export function normalizeGpuiProjectPath(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim().replace(/\/+$/u, '') : undefined;
}

export function gpuiProjectNameFromPath(path: string): string {
  return gpuiProjectPathSeparators(path).split('/').filter(Boolean).at(-1) ?? 'Project';
}

function gpuiProjectPathSeparators(path: string): string {
  return /^(?:[a-z]:[\\/]|\\\\|\/\/)/iu.test(path) ? path.replace(/\\/gu, '/') : path;
}
