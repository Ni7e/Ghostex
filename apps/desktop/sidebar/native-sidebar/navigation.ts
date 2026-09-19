import { nativeTagPresentation } from './tag-presentation';
import { closeAppModal, openAppModal, openQuickAccess } from '@/packages/core-ui/app-modal-host-bridge';
import {
  readSidebarKeepAwakeRuntime,
  writeSidebarUiCollapseState,
} from '@/packages/core-ui/sidebar-app/collapse-state';
import { formatSidebarHotkeyLabel } from '@/packages/core-ui/hotkey-label';
import { sidebarStore } from '@/packages/core-ui/sidebar-store-model';
import { KEEP_AWAKE_DURATION_OPTIONS } from '@/packages/shared/ghostex-settings';
import { nativeSidebarSettings } from './settings';
import { normalizeghostexHotkeySettings } from '@/packages/shared/ghostex-hotkeys';
import { GHOSTEX_DISCORD_URL } from '@/packages/shared/sidebar-commands';
import {
  getSidebarSessionTagListItemFilter,
  getSidebarSessionTagListItemLabel,
  normalizeSidebarSessionTagListItems,
} from '@/packages/shared/session-tags';
import { createDisplaySessionLayout } from '@/packages/shared/active-sessions-sort';
import type { NativeSidebarCommand, NativeSidebarMenuItem } from '@/packages/shared/native-sidebar';
import type { SidebarToExtensionMessage } from '@/packages/shared/session-grid-contract';
import type { NativeSidebarUiState } from './ui-state';
import { describeNativeSidebarMachine } from './space-navigation';

export function createNativeNavigation(ui: NativeSidebarUiState) {
  const state = sidebarStore.getState();
  const settings = nativeSidebarSettings();
  const hotkeys = normalizeghostexHotkeySettings(settings.hotkeys);
  const intent = (
    label: string,
    icon: string,
    action: Extract<NativeSidebarCommand, { type: 'sidebarAction' }>['action']
  ): NativeSidebarMenuItem => ({ label, icon, command: { type: 'sidebarAction', action } });
  const runtime = (label: string, icon: string, message: SidebarToExtensionMessage): NativeSidebarMenuItem => ({
    label,
    icon,
    command: { type: 'command', message },
  });
  const section = describeNativeSidebarMachine(ui);
  const groups = section.groupIds.filter((id) => section.isVisible(id) && !state.groupsById[id]?.isChatCollection);
  const sort: NativeSidebarMenuItem[] = [];
  if (ui.selectedMachineId === 'local')
    sort.push({ ...intent('Show hidden', 'eye', 'showHidden'), checked: ui.showHidden }, { separator: true });
  sort.push(
    {
      ...intent('Last Active Sorting', 'clock', 'sortLastActivity'),
      checked: state.hud.activeSessionsSortMode !== 'manual',
    },
    { ...intent('Manual Sorting', 'arrows-sort', 'sortManual'), checked: state.hud.activeSessionsSortMode === 'manual' }
  );
  const catalogs = [state.customSessionTags, ...Object.values(state.remoteCustomSessionTagsByMachineId)];
  for (const item of normalizeSidebarSessionTagListItems(
    settings.sidebarSessionTagListItems,
    state.customSessionTags
  )) {
    if (!item.visible) continue;
    if (item.type === 'separator') {
      if (item.enabled) sort.push({ separator: true });
      continue;
    }
    const tag = getSidebarSessionTagListItemFilter(item);
    if (tag)
      sort.push({
        label: getSidebarSessionTagListItemLabel(item, catalogs),
        ...nativeTagPresentation(tag),
        checked: ui.selectedTagFilters.includes(tag),
        disabled: !item.enabled,
        command: { type: 'toggleTagFilter', tag },
      });
  }
  const more: NativeSidebarMenuItem[] = [];
  if (ui.selectedMachineId === 'local' || ui.metadata.connections[ui.selectedMachineId]?.state === 'connected')
    more.push(intent('Add Project', 'plus', 'addProject'));
  more.push({
    label: 'Sort & Filter',
    icon: 'filter',
    presentation: 'page',
    children: sort.map((item) => ({ ...item, keepOpen: !!item.command })),
  });
  if (groups.length)
    more.push(
      intent(
        groups.some((id) => !ui.collapse.collapsedGroupsById[id]) ? 'Collapse All' : 'Expand Previous',
        'arrows-diagonal',
        'toggleProjects'
      )
    );
  if (ui.selectedMachineId !== 'local') more.push(intent('Edit Machine', 'pencil', 'editMachine'));
  more.push(
    { separator: true },
    intent('Sessions', 'history', 'sessions'),
    intent('Import Sessions', 'download', 'importSessions'),
    runtime('Search by Prompt', 'file-search', { type: 'searchPreviousSessionsByText' }),
    { separator: true },
    intent('Agents Hub', 'users-group', 'agentsHub'),
    runtime('All Automations', 'clock', { type: 'openAutomationsPage' }),
    { separator: true },
    intent('Mobile & Remote', 'devices', 'remoteSetup')
  );
  if (settings.showBetaFeatures && !settings.hideKeepAwakeTitlebarControl) {
    const active = readSidebarKeepAwakeRuntime();
    const awake = KEEP_AWAKE_DURATION_OPTIONS.map((option) => ({
      ...runtime(option.label, 'coffee', {
        type: 'runTitlebarKeepAwakeCommand',
        action: 'start',
        durationMinutes: option.value,
      }),
      checked: active?.durationMinutes === option.value,
    }));
    const children: NativeSidebarMenuItem[] = awake;
    if (active)
      children.push(
        runtime("Don't keep awake", 'square-minus', { type: 'runTitlebarKeepAwakeCommand', action: 'stop' })
      );
    children.push({ separator: true }, intent('Power Settings', 'settings', 'powerSettings'));
    more.push({ label: 'Keep awake', icon: active ? 'coffee' : 'moon', children });
  }
  more.push(
    runtime('Join Discord', 'users-group', { type: 'openExternalUrl', url: GHOSTEX_DISCORD_URL }),
    { separator: true },
    intent('Hotkeys', 'keyboard', 'hotkeys'),
    intent('Settings', 'settings', 'settings')
  );
  return {
    moreMenu: more,
    searchShortcut: hotkeys.openSessionSearchPalette
      ? formatSidebarHotkeyLabel(hotkeys.openSessionSearchPalette)
      : undefined,
    commandsShortcut: hotkeys.openCommandPalette ? formatSidebarHotkeyLabel(hotkeys.openCommandPalette) : undefined,
  };
}

export function runNativeSidebarAction(
  ui: NativeSidebarUiState,
  action: Extract<NativeSidebarCommand, { type: 'sidebarAction' }>['action'],
  post: (message: SidebarToExtensionMessage) => void
): void {
  const state = sidebarStore.getState();
  if (action === 'sortManual' || action === 'sortLastActivity') {
    const sortMode = action === 'sortManual' ? 'manual' : 'lastActivity';
    const layout = createDisplaySessionLayout({
      enableSessionParking: nativeSidebarSettings().enableSessionParking,
      sessionIdsByGroup: state.sessionIdsByGroup,
      sessionsById: state.sessionsById,
      sortMode: state.hud.activeSessionsSortMode,
      workspaceGroupIds: state.workspaceGroupIds,
    });
    post({
      type: 'setActiveSessionsSortMode',
      sortMode,
      manualSessionIdsByGroup:
        sortMode === 'manual' && state.hud.activeSessionsSortMode !== 'manual' ? layout.sessionIdsByGroup : undefined,
    });
    return;
  }
  if (action === 'showHidden') {
    ui.showHidden = !ui.showHidden;
    return;
  }
  if (action === 'toggleProjects') {
    const section = describeNativeSidebarMachine(ui);
    const ids = section.groupIds.filter((id) => section.isVisible(id) && !state.groupsById[id]?.isChatCollection);
    const expanded = ids.filter((id) => !ui.collapse.collapsedGroupsById[id]);
    if (expanded.length) {
      ui.previousExpandedGroups[ui.selectedMachineId] = expanded;
      for (const id of ids) ui.collapse.collapsedGroupsById[id] = true;
    } else
      for (const id of ui.previousExpandedGroups[ui.selectedMachineId] ?? ids)
        delete ui.collapse.collapsedGroupsById[id];
    writeSidebarUiCollapseState('main', ui.collapse);
    return;
  }
  closeAppModal('SettingsDismissal:sidebarNavigation');
  switch (action) {
    case 'loadSessions':
      return;
    case 'newTag':
      openAppModal({
        type: 'open',
        modal: 'settings',
        initialSection: 'sidebarTags',
        initialSidebarTagsAction: 'createTag',
      });
      break;
    case 'accounts':
      openAppModal({ type: 'open', modal: 'settings', initialTab: 'accounts' });
      break;
    case 'addProject':
      openAppModal({
        type: 'open',
        modal: 'addProject',
        ...(ui.selectedMachineId !== 'local' ? { machineId: ui.selectedMachineId } : {}),
      });
      break;
    case 'editMachine':
      openAppModal({
        type: 'open',
        modal: 'settings',
        initialTab: 'remote',
        initialRemoteMachineId: ui.selectedMachineId,
      });
      break;
    case 'sessions':
      openQuickAccess('recentSessions', { sessionScope: 'all' });
      break;
    case 'commands':
      openQuickAccess('commands');
      break;
    case 'importSessions':
      openQuickAccess('recentSessions', { sessionScope: 'external' });
      break;
    case 'powerSettings':
      openAppModal({ type: 'open', modal: 'settings', initialSearchQuery: 'Keep awake' });
      break;
    default:
      openAppModal({ type: 'open', modal: action });
  }
}
