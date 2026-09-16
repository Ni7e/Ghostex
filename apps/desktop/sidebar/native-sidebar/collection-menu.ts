import { nativeTagPresentation } from './tag-presentation';
import {
  canSleepSidebarSession,
  canWakeSidebarSession,
  isSidebarBrowserSession,
} from '@/packages/core-ui/session-card-capabilities';
import { getSessionTagCatalogs } from '@/packages/core-ui/session-tag-catalogs';
import {
  SIDEBAR_PROJECT_COLLECTION_COLORS,
  SIDEBAR_PROJECT_COLLECTION_COLOR_LABELS,
  type SidebarProjectCollection,
} from '@/packages/core-ui/project-collections';
import { normalizeghostexSettings } from '@/packages/shared/ghostex-settings';
import { getSidebarSessionTagLabel } from '@/packages/shared/session-tags';
import { sidebarStore } from '@/packages/core-ui/sidebar-store-model';
import type { SidebarSessionItem, SidebarToExtensionMessage } from '@/packages/shared/session-grid-contract';
import type { NativeSidebarCommand, NativeSidebarMenuItem } from '@/packages/shared/native-sidebar';
import type { NativeSidebarUiState } from './ui-state';
import { createNativeSpaceMembershipMenu } from './membership';

export function createNativeCollectionMenu(
  ui: NativeSidebarUiState,
  collection: SidebarProjectCollection,
  storageId: string,
  sessions: SidebarSessionItem[]
): NativeSidebarMenuItem[] {
  const id = collection.collectionId;
  const intent = (
    label: string,
    icon: string,
    action: Extract<NativeSidebarCommand, { type: 'collectionAction' }>['action']
  ): NativeSidebarMenuItem => ({ label, icon, command: { type: 'collectionAction', collectionId: id, action } });
  const batch = (
    label: string,
    icon: string,
    candidates: SidebarSessionItem[],
    message: (sessionId: string) => SidebarToExtensionMessage
  ): NativeSidebarMenuItem[] =>
    candidates.length
      ? [{ label, icon, command: { type: 'batch', messages: candidates.map((session) => message(session.sessionId)) } }]
      : [];
  const agents = sessions.filter((session) => !isSidebarBrowserSession(session));
  const tags = normalizeghostexSettings(sidebarStore.getState().hud.settings).sidebarSessionTagListItems.filter(
    (item) => item.type === 'tag' && item.enabled && item.visible
  );
  const menu: NativeSidebarMenuItem[] = [
    { ...intent('Select all sessions', 'check', 'select'), disabled: !sessions.length },
    ...batch('Sleep sessions', 'moon', sessions.filter(canSleepSidebarSession), (sessionId) => ({
      type: 'setSessionSleeping',
      sessionId,
      sleeping: true,
    })),
    ...batch('Wake sessions', 'player-play', sessions.filter(canWakeSidebarSession), (sessionId) => ({
      type: 'setSessionSleeping',
      sessionId,
      sleeping: false,
    })),
  ];
  if (agents.length && tags.length)
    menu.push({
      label: 'Tag sessions',
      icon: 'tag',
      presentation: 'page',
      children: [
        ...batch('No tag', 'tag-off', agents, (sessionId) => ({ type: 'setSessionTag', sessionId, sessionTag: null })),
        { separator: true },
        ...tags.flatMap((item) =>
          item.type === 'tag'
            ? batch(
                getSidebarSessionTagLabel(item.tag, getSessionTagCatalogs()) ?? item.tag,
                'tag',
                agents,
                (sessionId) => ({ type: 'setSessionTag', sessionId, sessionTag: item.tag })
              ).map((row) => ({ ...row, ...nativeTagPresentation(item.tag) }))
            : []
        ),
      ],
    });
  menu.push(
    ...batch(
      'Pin sessions',
      'pinned',
      sessions.filter((session) => !session.isPinned),
      (sessionId) => ({ type: 'setSessionPinned', sessionId, pinned: true })
    ),
    ...batch(
      'Unpin sessions',
      'pinned-off',
      sessions.filter((session) => session.isPinned),
      (sessionId) => ({ type: 'setSessionPinned', sessionId, pinned: false })
    ),
    ...batch('Full Reload sessions', 'refresh', agents, (sessionId) => ({ type: 'fullReloadSession', sessionId })),
    { separator: true },
    { label: 'Rename group', icon: 'pencil', command: { type: 'renameCollection', collectionId: id } },
    {
      label: 'Group color',
      icon: 'palette',
      presentation: 'page',
      children: SIDEBAR_PROJECT_COLLECTION_COLORS.map((color) => ({
        label: SIDEBAR_PROJECT_COLLECTION_COLOR_LABELS[color],
        color,
        checked: collection.color === color,
        command: { type: 'collectionAction', collectionId: id, action: 'color', value: color },
      })),
    }
  );
  const spaces = createNativeSpaceMembershipMenu(ui, { collectionId: id });
  if (spaces) menu.push({ ...spaces, presentation: 'page' });
  menu.push(
    intent(ui.hiddenItems.collectionKeys.includes(storageId) ? 'Unhide group' : 'Hide group', 'eye-off', 'hide'),
    { ...intent('Delete group', 'trash', 'ungroup'), danger: true },
    {
      label: 'Close all sessions',
      icon: 'x',
      danger: true,
      disabled: !sessions.length,
      command: {
        type: 'command',
        message: { type: 'closeSessions', sessionIds: sessions.map((session) => session.sessionId) },
      },
    }
  );
  return menu;
}
