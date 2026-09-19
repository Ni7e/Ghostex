import {
  createSidebarProjectCollection,
  moveProjectsToSidebarCollection,
  serializeSidebarProjectCollectionsForGxserver,
  writeSidebarProjectCollections,
  type SidebarProjectCollectionsState,
} from '@/packages/core-ui/project-collections';
import {
  createProjectCollectionIdByProjectId,
  getProjectCollectionFamilyProjectIds,
  getRemoteProjectCollectionFamilyProjectIds,
} from '@/packages/core-ui/sidebar-app/drag-drop-geometry';
import {
  getSidebarSpaceIdsContainingCollection,
  getSidebarSpaceIdsContainingProject,
  toggleSpaceCollectionMembership,
  toggleSpaceProjectMembership,
} from '@/packages/core-ui/spaces';
import { writeSidebarHiddenItems } from '@/packages/core-ui/sidebar-hidden-items';
import { openAppModal } from '@/packages/core-ui/app-modal-host-bridge';
import { sidebarStore } from '@/packages/core-ui/sidebar-store-model';
import type { NativeSidebarCommand, NativeSidebarMenuItem } from '@/packages/shared/native-sidebar';
import type { NativeSidebarUiState } from './ui-state';
import type { SidebarPostMessage } from './metadata';
import { describeNativeSidebarMachine } from './space-navigation';

export function saveNativeCollections(
  ui: NativeSidebarUiState,
  next: SidebarProjectCollectionsState,
  post: SidebarPostMessage
) {
  ui.metadata.collections[ui.selectedMachineId] = next;
  if (ui.selectedMachineId === 'local') writeSidebarProjectCollections(next);
  post({
    type: 'updateSidebarProjectCollections',
    state: serializeSidebarProjectCollectionsForGxserver(next),
    ...(ui.selectedMachineId === 'local' ? {} : { remoteMachineId: ui.selectedMachineId }),
  });
}

export function nativeCollectionGroups(ui: NativeSidebarUiState, collectionId: string): string[] {
  const section = describeNativeSidebarMachine(ui);
  const membership = createProjectCollectionIdByProjectId(
    section.collectionState,
    section.groupIds,
    section.groupsById,
    section.resolveProjectId
  );
  return section.groupIds.filter((id) => membership.get(section.resolveProjectId(id) ?? '') === collectionId);
}

export function createNativeSpaceMembershipMenu(
  ui: NativeSidebarUiState,
  member: { collectionId?: string; projectId?: string }
): NativeSidebarMenuItem | undefined {
  const section = describeNativeSidebarMachine(ui);
  if (!section.spacesState) return;
  const spaces = section.spacesState;
  const memberships = member.collectionId
    ? getSidebarSpaceIdsContainingCollection(spaces, member.collectionId)
    : getSidebarSpaceIdsContainingProject(spaces, member.projectId!);
  return {
    label: 'Spaces',
    icon: 'stack',
    presentation: 'page',
    children: [
      ...spaces.order.flatMap((id) =>
        spaces.spaces[id]
          ? [
              {
                label: spaces.spaces[id].name,
                icon: spaces.spaces[id].icon,
                checked: memberships.includes(id),
                command: { type: 'spaceMembership' as const, spaceId: id, ...member },
              },
            ]
          : []
      ),
      { separator: true },
      { label: 'New Space', icon: 'plus', command: { type: 'spaceMembership', ...member } },
    ],
  };
}

export function createNativeProjectMembershipMenu(ui: NativeSidebarUiState, groupId: string): NativeSidebarMenuItem[] {
  const section = describeNativeSidebarMachine(ui);
  const projectId = section.resolveProjectId(groupId);
  if (!projectId) return [];
  const membership = createProjectCollectionIdByProjectId(
    section.collectionState,
    section.groupIds,
    section.groupsById,
    section.resolveProjectId
  );
  const current = membership.get(projectId);
  const groupMenu: NativeSidebarMenuItem = {
    label: 'Add to Group',
    icon: 'plus',
    presentation: 'page',
    children: [
      {
        label: 'New Project Group',
        icon: 'plus',
        command: { type: 'projectMembership', action: 'createCollection', groupId },
      },
      ...section.collectionState.collections.map((collection) => ({
        label: collection.title,
        checked: collection.collectionId === current,
        command: {
          type: 'projectMembership' as const,
          action: 'moveCollection' as const,
          groupId,
          collectionId: collection.collectionId,
        },
      })),
      ...(current
        ? [
            { separator: true },
            {
              label: 'Remove from Group',
              icon: 'x',
              command: { type: 'projectMembership' as const, action: 'moveCollection' as const, groupId },
            },
          ]
        : []),
    ],
  };
  const spaceMenu = current ? undefined : createNativeSpaceMembershipMenu(ui, { projectId });
  return [groupMenu, ...(spaceMenu ? [spaceMenu] : [])];
}

export function runNativeMembershipAction(
  ui: NativeSidebarUiState,
  command: Extract<NativeSidebarCommand, { type: 'projectMembership' | 'spaceMembership' }>,
  post: SidebarPostMessage
) {
  const section = describeNativeSidebarMachine(ui);
  if (command.type === 'spaceMembership') {
    if (!command.spaceId) {
      openAppModal({
        type: 'open',
        modal: 'sidebarSpaceEditor',
        mode: 'create',
        sectionKey: section.sectionKey,
        ...(ui.selectedMachineId === 'local' ? {} : { remoteMachineId: ui.selectedMachineId }),
        memberCollectionId: command.collectionId,
        memberProjectId: command.projectId,
      });
    } else if (section.spacesState) {
      const next = command.collectionId
        ? toggleSpaceCollectionMembership(section.spacesState, command.spaceId, command.collectionId)
        : toggleSpaceProjectMembership(section.spacesState, command.spaceId, command.projectId!);
      ui.metadata.updateSpaces(ui.selectedMachineId, next, post);
    }
    return;
  }
  if (command.action === 'hide') {
    ui.hiddenItems.groupIds = ui.hiddenItems.groupIds.includes(command.groupId)
      ? ui.hiddenItems.groupIds.filter((id) => id !== command.groupId)
      : [...ui.hiddenItems.groupIds, command.groupId];
    writeSidebarHiddenItems(ui.hiddenItems);
    return;
  }
  const group = sidebarStore.getState().groupsById[command.groupId];
  const scopedProjectId = group?.projectContext?.editor.projectId;
  if (!scopedProjectId) return;
  const family =
    ui.selectedMachineId === 'local'
      ? getProjectCollectionFamilyProjectIds(scopedProjectId, section.groupIds, section.groupsById)
      : getRemoteProjectCollectionFamilyProjectIds(scopedProjectId, section.groupIds, section.groupsById);
  if (!family.length) return;
  if (command.action === 'createCollection') {
    const created = createSidebarProjectCollection(section.collectionState, family[0]);
    saveNativeCollections(ui, moveProjectsToSidebarCollection(created.state, family, created.collectionId), post);
    ui.renameRequest = { collectionId: created.collectionId, requestId: Date.now() };
  } else
    saveNativeCollections(
      ui,
      moveProjectsToSidebarCollection(section.collectionState, family, command.collectionId),
      post
    );
}
