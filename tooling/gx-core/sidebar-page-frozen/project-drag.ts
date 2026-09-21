/**
 * FROZEN copy of the TypeScript sidebar page, which was deleted on 2026-09-21 (M4d part 2). It is
 * kept only so the parity gates beside it still have the behaviour the app shipped on that date to
 * compare the Rust store against: a clean run proves Rust still matches THAT, not that it matches
 * the app. Never edit this file to make a gate pass; change the Rust and re-record, or delete the
 * gate.
 */
import { sidebarStore } from '@/packages/core-ui/sidebar-store-model';
import { createProjectCollectionIdByProjectId } from '@/packages/core-ui/sidebar-app/drag-drop-geometry';
import {
  moveProjectsToSidebarCollection,
  reorderSidebarProjectCollections,
} from '@/packages/core-ui/project-collections';
import type { NativeSidebarCommand } from '@/packages/shared/native-sidebar';
import { describeNativeSidebarMachine } from './space-navigation';
import { nativeCollectionGroups, saveNativeCollections } from './membership';
import type { NativeSidebarUiState } from './ui-state';
import type { SidebarPostMessage } from './metadata';

type ProjectDrop = Extract<NativeSidebarCommand, { type: 'moveToSpace' | 'moveToCollection' | 'moveCollection' }>;

export function nativeProjectFamily(ui: NativeSidebarUiState, groupId: string): string[] {
  const section = describeNativeSidebarMachine(ui);
  const group = section.groupsById[groupId];
  const projectId = section.resolveProjectId(groupId);
  if (!group || !projectId || (group.remoteMachineContext?.machineId ?? 'local') !== ui.selectedMachineId) return [];
  const parentId = group.projectContext?.worktree?.parentProjectId ?? projectId;
  return section.groupIds.filter(
    (id) =>
      section.resolveProjectId(id) === parentId ||
      section.groupsById[id]?.projectContext?.worktree?.parentProjectId === parentId
  );
}

export function updateNativeProjectDropMembership(
  ui: NativeSidebarUiState,
  groupId: string,
  targetGroupId: string,
  order: string[],
  post: SidebarPostMessage
): void {
  const section = describeNativeSidebarMachine(ui);
  const membership = createProjectCollectionIdByProjectId(
    section.collectionState,
    section.groupIds,
    section.groupsById,
    section.resolveProjectId
  );
  const collectionId = membership.get(section.resolveProjectId(targetGroupId) ?? '');
  const family = nativeProjectFamily(ui, groupId).flatMap((id) => section.resolveProjectId(id) ?? []);
  const next = moveProjectsToSidebarCollection(section.collectionState, family, collectionId);
  saveNativeCollections(
    ui,
    reorderSidebarProjectCollections(
      next,
      order.flatMap((id) => section.resolveProjectId(id) ?? [])
    ),
    post
  );
}

export function runNativeProjectDrop(ui: NativeSidebarUiState, command: ProjectDrop, post: SidebarPostMessage): void {
  const section = describeNativeSidebarMachine(ui);
  const state = sidebarStore.getState();
  const movedGroupIds =
    command.type === 'moveCollection' || command.sourceKind === 'collection'
      ? nativeCollectionGroups(ui, command.sourceId)
      : nativeProjectFamily(ui, command.sourceId);
  if (!movedGroupIds.length) return;
  const moved = new Set(movedGroupIds);
  const remaining = state.groupOrder.filter((id) => !moved.has(id));
  if (command.type === 'moveToSpace') {
    const spaces = section.spacesState;
    if (!spaces || (command.spaceId !== 'other' && !spaces.spaces[command.spaceId])) return;
    const field = command.sourceKind === 'collection' ? 'memberCollectionIds' : 'memberProjectIds';
    const memberIds =
      command.sourceKind === 'collection'
        ? [command.sourceId]
        : movedGroupIds.flatMap((id) => section.resolveProjectId(id) ?? []);
    if (command.sourceKind === 'group')
      saveNativeCollections(ui, moveProjectsToSidebarCollection(section.collectionState, memberIds, undefined), post);
    ui.metadata.updateSpaces(
      ui.selectedMachineId,
      {
        ...spaces,
        spaces: Object.fromEntries(
          Object.entries(spaces.spaces).map(([id, space]) => [
            id,
            {
              ...space,
              [field]: [
                ...(id === command.spaceId ? memberIds : []),
                ...space[field].filter((member) => !memberIds.includes(member)),
              ],
            },
          ])
        ),
      },
      post
    );
    const order = [...movedGroupIds, ...remaining];
    sidebarStore.setState({ groupOrder: order });
    post({ type: 'syncGroupOrder', groupIds: order });
    return;
  }
  if (command.type === 'moveToCollection') {
    const family = movedGroupIds.flatMap((id) => section.resolveProjectId(id) ?? []);
    saveNativeCollections(
      ui,
      moveProjectsToSidebarCollection(section.collectionState, family, command.collectionId),
      post
    );
    return;
  }
  const targets =
    command.targetKind === 'collection'
      ? nativeCollectionGroups(ui, command.targetId)
      : nativeProjectFamily(ui, command.targetId);
  const indices = targets.map((id) => remaining.indexOf(id)).filter((index) => index >= 0);
  if (!indices.length) return;
  const at = command.position === 'before' ? Math.min(...indices) : Math.max(...indices) + 1;
  remaining.splice(at, 0, ...movedGroupIds);
  sidebarStore.setState({ groupOrder: remaining });
  post({ type: 'syncGroupOrder', groupIds: remaining });
}
