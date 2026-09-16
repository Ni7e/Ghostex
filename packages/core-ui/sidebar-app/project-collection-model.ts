import type { SidebarProjectCollectionsState } from '../project-collections';
import type { SidebarProjectCollectionRenderItem, SidebarGroupsById } from './types';

export function projectSidebarCollections({
  sectionGroupIds,
  collectionState,
  resolveProjectId,
  groupsById,
  enableProjectCollections,
}: {
  sectionGroupIds: readonly string[];
  collectionState: SidebarProjectCollectionsState;
  resolveProjectId: (groupId: string) => string | undefined;
  groupsById: SidebarGroupsById;
  enableProjectCollections: boolean;
}): SidebarProjectCollectionRenderItem[] {
  if (!enableProjectCollections) {
    return sectionGroupIds.map((groupId) => ({ groupId, kind: 'project' }));
  }
  const groupIdByProjectId = new Map<string, string>();
  const projectIdByGroupId = new Map<string, string>();
  for (const groupId of sectionGroupIds) {
    const projectId = resolveProjectId(groupId);
    if (projectId) {
      groupIdByProjectId.set(projectId, groupId);
      projectIdByGroupId.set(groupId, projectId);
    }
  }
  const collectionIdByProjectId = new Map<string, string>();
  for (const collection of collectionState.collections) {
    for (const projectId of collection.projectIds) {
      collectionIdByProjectId.set(projectId, collection.collectionId);
    }
  }
  for (const groupId of sectionGroupIds) {
    const projectId = projectIdByGroupId.get(groupId);
    const parentProjectId = groupsById[groupId]?.projectContext?.worktree?.parentProjectId;
    const inheritedCollectionId = parentProjectId ? collectionIdByProjectId.get(parentProjectId) : undefined;
    if (projectId && inheritedCollectionId) {
      collectionIdByProjectId.set(projectId, inheritedCollectionId);
    }
  }
  /**
   * CDXC:Spaces 2026-09-08 DECISION:
   * User: dropping projects or groups onto a Space, including Other, moves them to its top.
   * Render both kinds in persisted project order so a moved project can precede existing groups.
   */
  const emittedCollectionIds = new Set<string>();
  const items: SidebarProjectCollectionRenderItem[] = sectionGroupIds.flatMap((groupId) =>
    projectIdByGroupId.has(groupId) ? [] : [{ groupId, kind: 'project' as const }]
  );
  for (const collection of collectionState.collections) {
    const visibleProjectIds = collection.projectIds.filter((projectId) => groupIdByProjectId.has(projectId));
    const explicitlyOrderedProjectIds = new Set(visibleProjectIds);
    for (const candidateGroupId of sectionGroupIds) {
      const candidateProjectId = projectIdByGroupId.get(candidateGroupId);
      if (
        candidateProjectId &&
        !explicitlyOrderedProjectIds.has(candidateProjectId) &&
        collectionIdByProjectId.get(candidateProjectId) === collection.collectionId
      ) {
        explicitlyOrderedProjectIds.add(candidateProjectId);
        visibleProjectIds.push(candidateProjectId);
      }
    }
    if (visibleProjectIds.length === 0) {
      continue;
    }
    emittedCollectionIds.add(collection.collectionId);
    items.push({
      collection: { ...collection, projectIds: visibleProjectIds },
      groupIds: visibleProjectIds
        .map((candidate) => groupIdByProjectId.get(candidate))
        .filter((candidate): candidate is string => Boolean(candidate)),
      kind: 'collection',
    });
  }
  for (const groupId of sectionGroupIds) {
    const projectId = projectIdByGroupId.get(groupId);
    if (!projectId) {
      continue;
    }
    const collectionId = projectId ? collectionIdByProjectId.get(projectId) : undefined;
    if (collectionId && emittedCollectionIds.has(collectionId)) {
      continue;
    }
    items.push({ groupId, kind: 'project' });
  }
  const positionByGroupId = new Map(sectionGroupIds.map((id, index) => [id, index]));
  const position = (item: SidebarProjectCollectionRenderItem) =>
    Math.min(
      ...(item.kind === 'collection' ? item.groupIds : [item.groupId]).map(
        (id) => positionByGroupId.get(id) ?? Infinity
      )
    );
  return items.sort((a, b) => position(a) - position(b));
}
