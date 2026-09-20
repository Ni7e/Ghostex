import { createNativeCollectionMenu } from './collection-menu';
import { nativeCollectionGroups, saveNativeCollections } from './membership';
import { sidebarStore } from '@/packages/core-ui/sidebar-store-model';
import { projectSidebarCollections } from '@/packages/core-ui/sidebar-app/project-collection-model';
import { getAwakeTerminalAndBrowserCount, getGroupSessionSummary } from '@/packages/core-ui/group-session-summary';
import { updateSidebarProjectCollection, removeSidebarProjectCollection } from '@/packages/core-ui/project-collections';
import type {
  NativeSidebarCollection,
  NativeSidebarCommand,
  NativeSidebarGroup,
} from '@/packages/shared/native-sidebar';
import type { SidebarPostMessage } from './metadata';
import type { NativeSidebarUiState } from './ui-state';
import { describeNativeSidebarMachine } from './space-navigation';

export function createNativeCollections(ui: NativeSidebarUiState, groups: NativeSidebarGroup[]) {
  const state = sidebarStore.getState();
  const section = describeNativeSidebarMachine(ui);
  const items = projectSidebarCollections({
    sectionGroupIds: groups.map((group) => group.groupId),
    collectionState: section.collectionState,
    resolveProjectId: section.resolveProjectId,
    groupsById: state.groupsById,
    enableProjectCollections: true,
  });
  const collections: NativeSidebarCollection[] = [];
  const order: { kind: 'project' | 'collection'; id: string }[] = [];
  for (const item of items) {
    if (item.kind === 'project') {
      order.push({ kind: 'project', id: item.groupId });
      continue;
    }
    const collection = item.collection;
    const storageId = `${section.sectionKey}:${collection.collectionId}`;
    if (!ui.showHidden && ui.hiddenItems.collectionKeys.includes(storageId)) continue;
    for (const group of groups) if (item.groupIds.includes(group.groupId)) group.collectionColor = collection.color;
    const sessions = item.groupIds.flatMap((id) => groups.find((group) => group.groupId === id)?.sessions ?? []);
    const menu = createNativeCollectionMenu(ui, collection, storageId, sessions);
    collections.push({
      ...collection,
      storageId,
      groupIds: item.groupIds,
      collapsed: !!ui.collapse.collapsedProjectCollectionsByKey[storageId],
      containsActiveSession: sessions.some((session) => session.isFocused),
      ...getGroupSessionSummary(sessions),
      awakeCount: getAwakeTerminalAndBrowserCount(sessions),
      menu,
    });
    order.push({ kind: 'collection', id: collection.collectionId });
  }
  return { collections, order };
}

export function runNativeCollectionAction(
  ui: NativeSidebarUiState,
  command: Extract<NativeSidebarCommand, { type: 'collectionAction' }>,
  post: SidebarPostMessage
) {
  const section = describeNativeSidebarMachine(ui);
  const key = `${section.sectionKey}:${command.collectionId}`;
  const collection = section.collectionState.collections.find((item) => item.collectionId === command.collectionId);
  if (!collection) return;
  const ids = nativeCollectionGroups(ui, command.collectionId);
  switch (command.action) {
    case 'toggle':
      if (ui.collapse.collapsedProjectCollectionsByKey[key]) delete ui.collapse.collapsedProjectCollectionsByKey[key];
      else ui.collapse.collapsedProjectCollectionsByKey[key] = true;
      return;
    case 'select':
      ui.selectedSessionIds = ids.flatMap((id) => sidebarStore.getState().sessionIdsByGroup[id] ?? []);
      return;
    case 'toggleProjects': {
      const expanded = ids.filter((id) => !ui.collapse.collapsedGroupsById[id]);
      if (expanded.length) {
        ui.previousExpandedGroups[key] = expanded;
        for (const id of ids) ui.collapse.collapsedGroupsById[id] = true;
      } else for (const id of ui.previousExpandedGroups[key] ?? ids) delete ui.collapse.collapsedGroupsById[id];
      return;
    }
    case 'hide':
      ui.hiddenItems.collectionKeys = ui.hiddenItems.collectionKeys.includes(key)
        ? ui.hiddenItems.collectionKeys.filter((id) => id !== key)
        : [...ui.hiddenItems.collectionKeys, key];
      return;
  }
  const next =
    command.action === 'ungroup'
      ? removeSidebarProjectCollection(section.collectionState, collection.collectionId)
      : updateSidebarProjectCollection(section.collectionState, collection.collectionId, (item) => ({
          ...item,
          ...(command.action === 'rename'
            ? { title: command.value?.trim().slice(0, 80) || item.title }
            : { color: command.value ?? item.color }),
        }));
  saveNativeCollections(ui, next, post);
}
