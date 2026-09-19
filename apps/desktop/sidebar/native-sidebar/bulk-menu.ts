import { nativeTagPresentation } from './tag-presentation';
import { getSidebarBulkSessionContextMenuAvailability } from '@/packages/core-ui/session-card-capabilities';
import { sidebarStore } from '@/packages/core-ui/sidebar-store-model';
import { nativeSidebarSettings } from './settings';
import {
  getEffectiveSidebarSessionTag,
  getEnabledVisibleSidebarSessionTagSections,
} from '@/packages/shared/session-tags';
import type { SidebarToExtensionMessage } from '@/packages/shared/session-grid-contract';
import type { NativeSidebarMenuItem } from '@/packages/shared/native-sidebar';
import type { NativeSidebarUiState } from './ui-state';

export function createNativeBulkMenu(ui: NativeSidebarUiState): NativeSidebarMenuItem[] | undefined {
  if (ui.selectedSessionIds.length < 2) return;
  const state = sidebarStore.getState();
  const settings = nativeSidebarSettings();
  const available = getSidebarBulkSessionContextMenuAvailability({
    enableSessionParking: settings.enableSessionParking,
    sessionIds: ui.selectedSessionIds,
    sessionsById: state.sessionsById,
  });
  const rows = (
    label: string,
    icon: string,
    ids: string[],
    message: (id: string) => SidebarToExtensionMessage
  ): NativeSidebarMenuItem[] =>
    ids.length ? [{ label, icon, command: { type: 'batch', clearSelection: true, messages: ids.map(message) } }] : [];
  const tagIds = available.taggableSessionIds;
  const sharedTag =
    tagIds.length &&
    tagIds.every(
      (id) =>
        getEffectiveSidebarSessionTag(state.sessionsById[id]) ===
        getEffectiveSidebarSessionTag(state.sessionsById[tagIds[0]])
    )
      ? getEffectiveSidebarSessionTag(state.sessionsById[tagIds[0]])
      : undefined;
  const tags = getEnabledVisibleSidebarSessionTagSections(settings.sidebarSessionTagListItems, {
    customTags:
      ui.selectedMachineId === 'local'
        ? state.customSessionTags
        : state.remoteCustomSessionTagsByMachineId[ui.selectedMachineId],
    includeTags: sharedTag ? [sharedTag] : [],
  }).flatMap((section, index) => [
    ...(index ? [{ separator: true } as NativeSidebarMenuItem] : []),
    ...section.options.flatMap((option) =>
      rows(option.label, 'tag', tagIds, (sessionId) => ({
        type: 'setSessionTag',
        sessionId,
        sessionTag: sharedTag === option.value ? null : option.value,
      })).map((item) => ({ ...item, ...nativeTagPresentation(option.value), checked: sharedTag === option.value }))
    ),
  ]);
  const menu = [
    ...rows('Sleep Selected', 'moon', available.sleepableSessionIds, (sessionId) => ({
      type: 'setSessionSleeping',
      sessionId,
      sleeping: true,
    })),
    ...rows('Wake Selected', 'player-play', available.wakeableSessionIds, (sessionId) => ({
      type: 'setSessionSleeping',
      sessionId,
      sleeping: false,
    })),
    ...(tags.length ? [{ label: 'Tag Selected As', icon: 'tag', children: tags }] : []),
    ...rows('Pin Selected', 'pinned', available.pinnableSessionIds, (sessionId) => ({
      type: 'setSessionPinned',
      sessionId,
      pinned: true,
    })),
    ...rows('Unpin Selected', 'pinned-off', available.unpinnableSessionIds, (sessionId) => ({
      type: 'setSessionPinned',
      sessionId,
      pinned: false,
    })),
  ];
  const park = available.parkableSessionIds.map((sessionId) => ({
    type: 'setSessionParked' as const,
    sessionId,
    parked: true,
  }));
  if (park.length) {
    menu.push(
      settings.showTagMenuWhenParking && tagIds.length
        ? {
            label: 'Park Selected',
            icon: 'archive',
            children: [
              {
                label: 'No Tag Change',
                icon: 'tag-off',
                command: { type: 'batch', clearSelection: true, messages: park },
              },
              { separator: true },
              ...tags.map((item) =>
                item.command?.type === 'batch'
                  ? {
                      ...item,
                      command: {
                        ...item.command,
                        messages: [
                          ...item.command.messages.map((message) =>
                            message.type === 'setSessionTag' && message.sessionTag === null
                              ? { ...message, sessionTag: sharedTag ?? null }
                              : message
                          ),
                          ...park,
                        ],
                      },
                    }
                  : item
              ),
            ],
          }
        : { label: 'Park Selected', icon: 'archive', command: { type: 'batch', clearSelection: true, messages: park } }
    );
  }
  menu.push(
    ...rows('Unpark Selected', 'archive', available.unparkableSessionIds, (sessionId) => ({
      type: 'setSessionParked',
      sessionId,
      parked: false,
    })),
    ...rows('Full Reload Selected', 'refresh', available.fullReloadableSessionIds, (sessionId) => ({
      type: 'fullReloadSession',
      sessionId,
    })),
    { separator: true },
    ...rows('Close Selected', 'x', available.closableSessionIds, (sessionId) => ({
      type: 'closeSession',
      sessionId,
    })).map((row) => ({ ...row, danger: true }))
  );
  return menu;
}
