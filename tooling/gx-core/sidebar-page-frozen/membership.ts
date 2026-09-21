/**
 * FROZEN copy of the TypeScript sidebar page, which was deleted on 2026-09-21 (M4d part 2). It is
 * kept only so the parity gates beside it still have the behaviour the app shipped on that date to
 * compare the Rust store against: a clean run proves Rust still matches THAT, not that it matches
 * the app. Never edit this file to make a gate pass; change the Rust and re-record, or delete the
 * gate.
 */
import {
  createSidebarProjectCollection,
  moveProjectsToSidebarCollection,
  serializeSidebarProjectCollectionsForGxserver,
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
import { openAppModal } from '@/packages/core-ui/app-modal-host-bridge';
import { sidebarStore } from '@/packages/core-ui/sidebar-store-model';
import type { NativeSidebarCommand, NativeSidebarMenuItem } from '@/packages/shared/native-sidebar';
import type { NativeSidebarUiState } from './ui-state';
import { postProjectCollectionsHandOff, type SidebarPostMessage } from './metadata';
import { describeNativeSidebarMachine } from './space-navigation';

/*
CDXC:Projects 2026-09-21 WHY:
This page is no longer a writer of `ghostex.sidebar.projectCollections.v1` and no longer pushes it
to gxserver for THIS COMPUTER. It still EDITS the document for the paths the Rust store does not own
(the collection menus: rename, colour, ungroup, hide, and the Add to Group items reached from
anywhere but a drag), and every one of those edits arrives here and is handed to the app, which is
the single writer and the single synchroniser (apps/desktop/src/app/gx_store/project_docs.rs).
`applyProjectCollections` is the other half: the app hands the held document back after every
change, so the next edit is computed from it rather than from a copy that is already behind.
A REMOTE machine is unchanged and still goes out as a command, because
`updateRemoteSidebarProjectCollections` is a direct call down that machine's tunnel and the app
cannot reach one.
Supersedes the 2026-07-18 decision's "localStorage stays the instant-edit overlay" only in WHERE the
write happens: it is still the instant-edit overlay, still a debounced write-through with an
indefinite retry, and still guarded against a stale echo, all of it now in Rust.
SEE-ALSO: packages/gx-core/src/project_docs/collections.rs.
*/
export function saveNativeCollections(
  ui: NativeSidebarUiState,
  next: SidebarProjectCollectionsState,
  post: SidebarPostMessage
) {
  ui.metadata.collections[ui.selectedMachineId] = next;
  if (ui.selectedMachineId !== 'local') {
    post({
      type: 'updateSidebarProjectCollections',
      state: serializeSidebarProjectCollectionsForGxserver(next),
      remoteMachineId: ui.selectedMachineId,
    });
    return;
  }
  postProjectCollectionsHandOff(next);
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
