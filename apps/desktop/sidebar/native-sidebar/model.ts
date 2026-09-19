import { getGroupSessionSummary } from '@/packages/core-ui/group-session-summary';
import { nativeTagPresentation } from './tag-presentation';
import { createNativeEmptyState } from './empty-state';
import { applyNativeSidebarReveal } from './reveal';
import { createNativeCollections } from './collections';
import {
  getSessionCardTimerTrailingLabel,
  getSessionCardTitleTooltip,
} from '@/packages/core-ui/session-card-presentation';
import { createNativeNavigation } from './navigation';
import {
  getEnabledVisibleSidebarSessionTagFilters,
  normalizeSidebarSessionTagListItems,
  sessionMatchesSidebarTagFilters,
} from '@/packages/shared/session-tags';
import { COLORED_AGENT_LOGOS } from '@/packages/core-ui/agent-logos';
import { getEffectiveSidebarSessionTag, findCustomSessionTag } from '@/packages/shared/session-tags';
import { createNativeSessionActions } from './session-menu';
import {
  createSidebarSpaceSessionSummaries,
  resolveSidebarSpaceForRevealedGroup,
} from '@/packages/core-ui/sidebar-app/space-filtering';
import { describeNativeSidebarMachine } from './space-navigation';
import { formatRelativeTime } from '@/packages/core-ui/relative-time';
import { isRemoteMachineEnabledInSidebar, normalizeghostexSettings } from '@/packages/shared/ghostex-settings';
import type { ExtensionToSidebarMessage } from '@/packages/shared/session-grid-contract';
import { sidebarStore } from '@/packages/core-ui/sidebar-store-model';
import { createDisplaySessionLayout } from '@/packages/shared/active-sessions-sort';
import type { NativeSidebarSnapshot } from '@/packages/shared/native-sidebar';
import type { SidebarSessionGroup, SidebarSessionItem } from '@/packages/shared/session-grid-contract';
import type { ghostexSettings } from '@/packages/shared/ghostex-settings';
import type { CustomSessionTagsState } from '@/packages/shared/session-tags';
import type { NativeSidebarUiState } from './ui-state';
import { projectNativeSidebarGroup } from './project-sections';

export function applyNativeSidebarMessage(message: ExtensionToSidebarMessage): void {
  const state = sidebarStore.getState();
  switch (message.type) {
    case 'hydrate':
    case 'sessionState':
      state.applySidebarMessage(message);
      break;
    case 'sessionPresentationChanged':
      state.applySessionPresentationMessage(message);
      break;
    case 'sidebarGroupsChanged':
      state.applyGroupsChangedMessage(message);
      break;
    case 'sidebarHudChanged':
      state.applyHudChangedMessage(message);
      break;
    case 'sidebarCommandRunStateChanged':
      state.applyCommandRunStateMessage(message);
      break;
    case 'sidebarCommandRunStateCleared':
      state.applyCommandRunStateClearedMessage(message);
      break;
    case 'customSessionTagsChanged':
      state.applyCustomSessionTagsChangedMessage(message);
      break;
    case 'sidebarOrderSyncResult':
      state.applyOrderSyncResultMessage(message);
      break;
    case 'daemonSessionsState':
      state.setDaemonSessionsState(message);
      break;
  }
}

/**
 * CDXC:Sidebar 2026-09-19 WHY:
 * Every publish re-projected every session of the machine (tooltip, labels, tag lookup, hover actions), 30 to 40ms per publish on the service thread and several publishes a second while agents run, most of it for rows nothing had touched.
 * The store keeps the object identity of unchanged sessions, groups and tag state, so a row is re-projected only when one of its inputs is a different object. The identical output object also lets the publisher's field diff skip the row outright. Time-based labels are refreshed by the clock rows, not by this projection.
 */
const projectedSessions = new Map<
  string,
  { deps: readonly unknown[]; value: ReturnType<typeof projectNativeSidebarSession> }
>();

function sameDeps(left: readonly unknown[], right: readonly unknown[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

let settingsSource: unknown = undefined;
let settingsValue: ghostexSettings | undefined;

function normalizedSettings(source: unknown): ghostexSettings {
  if (!settingsValue || source !== settingsSource) {
    settingsSource = source;
    settingsValue = normalizeghostexSettings(source);
  }
  return settingsValue;
}

function projectNativeSidebarSession(
  session: SidebarSessionItem,
  group: Omit<SidebarSessionGroup, 'sessions'>,
  settings: ghostexSettings,
  customTags: CustomSessionTagsState | undefined,
  state: ReturnType<typeof sidebarStore.getState>,
  selected: boolean
) {
  const presentation = getSessionCardTitleTooltip({
    session,
    alwaysShowTitleTooltip: true,
    alwaysShowStateTooltip: !!group.remoteMachineContext,
    showDebugSessionNumbers: state.hud.debuggingMode,
  });
  const tag = getEffectiveSidebarSessionTag(session);
  return {
    ...session,
    titleTooltip: presentation.tooltip,
    displayTitle: session.isGeneratingFirstPromptTitle ? 'Generating title...' : presentation.headingText,
    timerLabel: getSessionCardTimerTrailingLabel(session, Date.now()),
    isMultiSelected: selected,
    effectiveTag: tag,
    tagPresentation: nativeTagPresentation(tag ?? ''),
    customTag: findCustomSessionTag(tag, [
      state.customSessionTags,
      ...Object.values(state.remoteCustomSessionTagsByMachineId),
    ]),
    agentLogoDataUrl: session.agentIcon ? COLORED_AGENT_LOGOS[session.agentIcon] : undefined,
    lastInteractionLabel: session.lastInteractionAt
      ? formatRelativeTime(session.lastInteractionAt, { allowJustNow: false }).value
      : undefined,
    ...createNativeSessionActions(session, settings, group, customTags, [], false),
  };
}

export function createNativeSidebarSnapshot(ui: NativeSidebarUiState): NativeSidebarSnapshot {
  applyNativeSidebarReveal(ui);
  const state = sidebarStore.getState();
  const settings = normalizedSettings(state.hud.settings);
  const projectedSessionIds = new Set<string>();
  const enabledFilters = new Set(
    getEnabledVisibleSidebarSessionTagFilters(
      normalizeSidebarSessionTagListItems(settings.sidebarSessionTagListItems, state.customSessionTags)
    )
  );
  ui.selectedTagFilters = ui.selectedTagFilters.filter((tag) => enabledFilters.has(tag));
  const machines = [
    { id: 'local', label: 'Local', state: 'connected' },
    ...settings.remoteMachines.filter(isRemoteMachineEnabledInSidebar).map((machine) => ({
      id: machine.id,
      label: machine.name,
      state: ui.metadata.connections[machine.id]?.state ?? 'disconnected',
      message: ui.metadata.connections[machine.id]?.message,
    })),
  ];
  if (state.hud.settings && !machines.some((machine) => machine.id === ui.selectedMachineId))
    ui.apply({ type: 'selectMachine', machineId: 'local' });
  const section = describeNativeSidebarMachine(ui);
  const summaries = section.spacesState
    ? createSidebarSpaceSessionSummaries({
        ...section,
        spacesState: section.spacesState,
        sessionIdsByGroup: state.sessionIdsByGroup,
        sessionsById: state.sessionsById,
      })
    : {};
  const activeGroupId = section.groupIds.find((id) =>
    state.sessionIdsByGroup[id]?.some((sessionId) => state.sessionsById[sessionId]?.isFocused)
  );
  const activeSpaceId =
    activeGroupId && section.spacesState
      ? resolveSidebarSpaceForRevealedGroup({
          ...section,
          spacesState: section.spacesState,
          selectedSpaceId: section.selection?.spaceId,
          targetGroupId: activeGroupId,
        })
      : undefined;
  const spaces = section.spacesState
    ? [
        ...section.spacesState.order.flatMap((id) => {
          const space = section.spacesState!.spaces[id];
          return space ? [{ id, name: space.name, icon: space.icon, color: space.color }] : [];
        }),
        { id: 'other', name: 'Other', icon: 'layoutDashboard', color: '' },
      ].map((space) => ({
        ...space,
        selected: section.selection?.spaceId === space.id,
        containsActiveSession: activeSpaceId === space.id,
        workingCount: summaries[space.id]?.workingCount ?? 0,
        attentionCount: summaries[space.id]?.attentionCount ?? 0,
      }))
    : [];
  const layout = createDisplaySessionLayout({
    enableSessionParking: settings.enableSessionParking,
    sessionIdsByGroup: state.sessionIdsByGroup,
    sessionsById: state.sessionsById,
    sortMode: state.hud.activeSessionsSortMode,
    workspaceGroupIds: state.workspaceGroupIds,
  });
  ui.selectedSessionIds = ui.selectedSessionIds.filter((id) => state.sessionsById[id]);
  const groups = layout.groupIds.flatMap((groupId) => {
    const group = state.groupsById[groupId];
    if (
      groupId === 'gxserver-unavailable' ||
      !group ||
      group.isChatCollection ||
      (group.remoteMachineContext?.machineId ?? 'local') !== ui.selectedMachineId ||
      (!group.isChatCollection && !section.isVisible(groupId))
    )
      return [];
    if (!ui.showHidden && ui.hiddenItems.groupIds.includes(groupId)) return [];
    const sessions = (layout.sessionIdsByGroup[groupId] ?? []).filter(
      (id) => state.sessionsById[id] && sessionMatchesSidebarTagFilters(state.sessionsById[id], ui.selectedTagFilters)
    );
    if (ui.selectedTagFilters.length && !sessions.length) return [];
    const customTags = group.remoteMachineContext
      ? state.remoteCustomSessionTagsByMachineId[group.remoteMachineContext.machineId]
      : state.customSessionTags;
    const projected = projectNativeSidebarGroup(
      {
        ...group,
        sessions: sessions.map((id) => {
          const session = state.sessionsById[id]!;
          const selected = ui.selectedSessionIds.includes(id);
          const deps = [
            session,
            group,
            settings,
            customTags,
            state.customSessionTags,
            state.remoteCustomSessionTagsByMachineId,
            state.hud.debuggingMode,
            selected,
          ];
          projectedSessionIds.add(id);
          const cached = projectedSessions.get(id);
          if (cached && sameDeps(cached.deps, deps)) return cached.value;
          const value = projectNativeSidebarSession(session, group, settings, customTags, state, selected);
          projectedSessions.set(id, { deps, value });
          return value;
        }),
      },
      ui,
      settings
    );
    return [projected];
  });
  for (const id of projectedSessions.keys()) if (!projectedSessionIds.has(id)) projectedSessions.delete(id);
  return {
    ...createNativeNavigation(ui),
    emptyState: createNativeEmptyState(ui),
    kind: 'snapshot',
    version: 1,
    revision: state.revision,
    ready: state.hasReceivedSnapshot,
    hud: state.hud,
    selectedMachineId: ui.selectedMachineId,
    machines: machines.map((machine) => ({
      ...machine,
      ...getGroupSessionSummary(
        state.groupOrder
          .filter((id) => (state.groupsById[id]?.remoteMachineContext?.machineId ?? 'local') === machine.id)
          .flatMap((id) =>
            (state.sessionIdsByGroup[id] ?? []).flatMap((sessionId) => state.sessionsById[sessionId] ?? [])
          )
      ),
    })),
    spaces,
    spacesEnabled: !!section.spacesState,
    revealRequest: ui.revealRequest,
    renameRequest: ui.renameRequest,
    scrollScope: `${ui.selectedMachineId}|${section.selection?.spaceId ?? 'all'}`,
    groups,
    ...createNativeCollections(ui, groups),
  };
}
