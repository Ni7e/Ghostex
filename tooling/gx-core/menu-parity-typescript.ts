/**
 * The TypeScript half of the menu parity harness: drives the real
 * `apps/desktop/sidebar/native-sidebar/` builders over a recorded presentation and returns their
 * menus in the shape `menu-parity.ts` diffs.
 *
 * The builders read the sidebar zustand store and a `NativeSidebarUiState`, so both are populated
 * here exactly as the running app populates them. Nothing is reimplemented: a difference the diff
 * reports is a difference between the shipped TypeScript and the Rust port, not between two
 * rewrites.
 */
// First, so the client-storage adapter finds a `Storage` before any module reads one.
import { resetBrowserStorage, writeStorageItem } from './browser-shim';
import { sidebarStore } from '@/packages/core-ui/sidebar-store-model';
import {
  createGxserverPresentationSidebarGroup,
  type GxserverPresentationSidebarProjectOverlay,
} from '@/packages/shared/gxserver-presentation-sidebar-projection';
import {
  createGpuiPresentationProjectProjectionMetadata,
  createGpuiSidebarSessionRoutingId,
  resolveGpuiSidebarAgentIcon,
} from '@/apps/desktop/sidebar/gxserver-runtime/helpers/presentation-projection';
import { normalizeCustomSessionTagsState } from '@/packages/shared/session-tags';
import { parseSidebarProjectCollectionsFromGxserver } from '@/packages/core-ui/project-collections';
import { parseSidebarSpacesFromGxserver } from '@/packages/core-ui/spaces';
import { COLORED_AGENT_LOGOS } from '@/packages/core-ui/agent-logos';
import { SIDEBAR_KEEP_AWAKE_RUNTIME_STORAGE_KEY } from '@/packages/core-ui/sidebar-app/collapse-state';
import { NativeSidebarUiState } from '@/apps/desktop/sidebar/native-sidebar/ui-state';
import { createNativeSessionActions } from '@/apps/desktop/sidebar/native-sidebar/session-menu';
import { createNativeProjectMenu } from '@/apps/desktop/sidebar/native-sidebar/project-menu';
import { createNativeCollectionMenu } from '@/apps/desktop/sidebar/native-sidebar/collection-menu';
import { createNativeBulkMenu } from '@/apps/desktop/sidebar/native-sidebar/bulk-menu';
import { createNativeProjectHeaderActions } from '@/apps/desktop/sidebar/native-sidebar/project-actions';
import { createNativeNavigation } from '@/apps/desktop/sidebar/native-sidebar/navigation';
import { nativeSidebarSettings } from '@/apps/desktop/sidebar/native-sidebar/settings';
import type { SidebarSessionGroup, SidebarSessionItem } from '@/packages/shared/session-grid-contract';

type Json = Record<string, any>;

export function buildTypeScriptMenus(scenario: Json, rust: Json): Json {
  const snapshot = scenario.snapshot as Json;
  const ui = setUpStore(scenario, rust);
  const settings = nativeSidebarSettings(scenario.settings);
  const customTags = sidebarStore.getState().customSessionTags;
  const state = sidebarStore.getState();

  const rows: Json = {};
  const groups: Json = {};
  for (const [groupId, group] of Object.entries(rust.groups as Record<string, Json>)) {
    const record = state.groupsById[groupId];
    if (!record) continue;
    const sessions = (state.sessionIdsByGroup[groupId] ?? []).flatMap(
      (sessionId) => state.sessionsById[sessionId] ?? []
    );
    const withSessions: SidebarSessionGroup = { ...record, sessions } as SidebarSessionGroup;
    groups[groupId] = {
      menu: createNativeProjectMenu(withSessions, ui),
      headerActions: createNativeProjectHeaderActions(withSessions),
    };
    const visible = new Set(group.visibleSessionIds as string[]);
    const visibleIds = sessions.filter((session) => visible.has(session.sessionId)).map((s) => s.sessionId);
    for (const session of sessions) {
      const index = visibleIds.indexOf(session.sessionId);
      const below = index < 0 ? [] : visibleIds.slice(index + 1).flatMap((id) => state.sessionsById[id] ?? []);
      const lazy = createNativeSessionActions(session, settings, record, customTags, [], false);
      const full = createNativeSessionActions(session, settings, record, customTags, below);
      const hoverSubmenus: Json = {};
      for (const action of ['tag', 'park', 'snooze'] as const) {
        const items = resolveHoverSubmenu(lazy, full, action);
        if (items.length) hoverSubmenus[action] = items;
      }
      rows[session.sessionId] = {
        menu: lazy.menu,
        hoverBefore: lazy.hoverBefore,
        hoverAfter: lazy.hoverAfter,
        hoverChevron: lazy.hoverChevron,
        fullMenu: ui.selectedSessionIds.includes(session.sessionId)
          ? (createNativeBulkMenu(ui) ?? full.menu)
          : full.menu,
        hoverSubmenus,
      };
    }
  }

  const collections: Json = {};
  for (const [collectionId, entry] of Object.entries(rust.collections as Record<string, Json>)) {
    const collection = ui.metadata.collections.local?.collections.find(
      (candidate) => candidate.collectionId === collectionId
    );
    if (!collection) continue;
    const sessions = (entry.groupIds as string[]).flatMap((groupId) =>
      (state.sessionIdsByGroup[groupId] ?? []).flatMap((sessionId) => state.sessionsById[sessionId] ?? [])
    );
    collections[collectionId] = createNativeCollectionMenu(ui, collection, String(entry.storageId), sessions);
  }

  const logos: Json = {};
  for (const [icon, dataUrl] of Object.entries(COLORED_AGENT_LOGOS)) logos[icon] = dataUrl;

  return {
    rows,
    groups,
    collections,
    bulk: createNativeBulkMenu(ui) ?? null,
    moreMenu: createNativeNavigation(ui).moreMenu,
    logos,
    snapshotRevision: snapshot.revision,
  };
}

/**
 * `resolveNativeSessionMenu`'s hover branch: the placeholder's index in the lazy strip decides
 * which item of the full strip owns the submenu.
 */
function resolveHoverSubmenu(
  lazy: ReturnType<typeof createNativeSessionActions>,
  full: ReturnType<typeof createNativeSessionActions>,
  action: 'tag' | 'park' | 'snooze'
) {
  const placeholders = [...lazy.hoverBefore, ...lazy.hoverAfter];
  const index = placeholders.findIndex(
    (item) => item.children?.[0]?.onOpen?.type === 'sessionMenu' && item.children[0].onOpen.action === action
  );
  if (index < 0) return [];
  return [...full.hoverBefore, ...full.hoverAfter][index]?.children ?? [];
}

/** The store and the sidebar UI state, as the running app holds them for this scenario. */
function setUpStore(scenario: Json, rust: Json): NativeSidebarUiState {
  const snapshot = scenario.snapshot as Json;
  const host = scenario.host as Json;
  resetBrowserStorage();
  if (typeof host.primaryAgentId === 'string')
    writeStorageItem('ghostex-sidebar-project-terminal-launcher', host.primaryAgentId);
  if (typeof host.keepAwakeMinutes === 'number')
    writeStorageItem(
      SIDEBAR_KEEP_AWAKE_RUNTIME_STORAGE_KEY,
      JSON.stringify({ durationMinutes: host.keepAwakeMinutes })
    );
  const metadata = createGpuiPresentationProjectProjectionMetadata({
    domainProjects: [],
    presentation: snapshot as any,
    projectOrder: snapshot.workspaceGroups?.projectOrder,
    recentProjects: [],
  });
  const overlays = new Map<string, GxserverPresentationSidebarProjectOverlay>(
    metadata.projectOverlays.map((overlay) => [overlay.projectId, overlay])
  );
  const projectsById = new Map<string, Json>(
    (snapshot.projects as Json[]).map((project) => [project.projectId, project])
  );
  const sessionsByProject = new Map<string, Map<string, Json>>();
  for (const session of snapshot.sessions as Json[]) {
    const byId = sessionsByProject.get(session.projectId) ?? new Map<string, Json>();
    byId.set(session.sessionId, session);
    sessionsByProject.set(session.projectId, byId);
  }

  const groupsById: Record<string, Omit<SidebarSessionGroup, 'sessions'>> = {};
  const sessionIdsByGroup: Record<string, string[]> = {};
  const sessionsById: Record<string, SidebarSessionItem> = {};
  const groupOrder: string[] = [];
  for (const [groupId, group] of Object.entries(rust.groups as Record<string, Json>)) {
    const members = group.sessions as {
      sidebarSessionId: string;
      projectId: string | null;
      sessionId: string | null;
    }[];
    const projectId = String(group.projectId ?? members[0]?.projectId ?? '');
    const project = projectsById.get(projectId);
    if (!project) continue;
    const rows = members
      .map((member) => sessionsByProject.get(String(member.projectId))?.get(String(member.sessionId)))
      .filter((row): row is Json => row !== undefined);
    const built = createGxserverPresentationSidebarGroup({
      activeProjectId: undefined,
      createProjectGroupId: () => groupId,
      focusedSessionId: undefined,
      project: project as any,
      projectOverlay: overlays.get(projectId),
      resolveAgentIcon: resolveGpuiSidebarAgentIcon,
      resolveSessionRoutingId: createGpuiSidebarSessionRoutingId,
      sessions: rows as any,
      visibleSessionIds: undefined,
    });
    const { sessions, ...record } = built;
    groupOrder.push(groupId);
    groupsById[groupId] = {
      ...record,
      // Every project group and every user-made group is created with this flag by
      // `spliceWorkspaceSubgroups`; a user-made group also loses its project context and title.
      canCreateSessionGroup: true,
      ...(group.projectId ? {} : { projectContext: undefined, title: String(group.title) }),
    } as Omit<SidebarSessionGroup, 'sessions'>;
    sessionIdsByGroup[groupId] = sessions.map((session) => session.sessionId);
    for (const session of sessions) sessionsById[session.sessionId] = session;
  }

  sidebarStore.setState({
    groupOrder,
    groupsById,
    sessionIdsByGroup,
    sessionsById,
    workspaceGroupIds: groupOrder,
    hasReceivedSnapshot: true,
    revision: Number(snapshot.revision ?? 0),
    customSessionTags: snapshot.customSessionTags
      ? normalizeCustomSessionTagsState(snapshot.customSessionTags)
      : undefined,
    remoteCustomSessionTagsByMachineId: {},
    hud: {
      ...sidebarStore.getState().hud,
      settings: scenario.settings,
      activeSessionsSortMode: scenario.settings?.activeSessionsSortMode === 'manual' ? 'manual' : 'lastActivity',
      debuggingMode: false,
      agents: host.agents ?? [],
      globalCommands: host.globalCommands ?? [],
      commandsByProject: host.commandsByProject ?? {},
      recentProjects: [],
    },
  });

  const ui = new NativeSidebarUiState();
  const state = scenario.ui as Json;
  ui.selectedMachineId = String(state.selectedMachineId ?? 'local');
  ui.showHidden = state.showHidden === true;
  ui.selectedTagFilters = (state.selectedTagFilters ?? []) as never[];
  ui.selectedSessionIds = (state.selectedSessionIds ?? []) as string[];
  ui.hiddenItems = {
    groupIds: (state.hiddenGroupIds ?? []) as string[],
    collectionKeys: (state.hiddenCollectionKeys ?? []) as string[],
  };
  ui.collapse.collapsedGroupsById = Object.fromEntries(
    ((state.collapsedGroups ?? []) as string[]).map((id) => [id, true as const])
  );
  ui.collapse.collapsedProjectCollectionsByKey = Object.fromEntries(
    ((state.collapsedCollections ?? []) as string[]).map((id) => [id, true as const])
  );
  ui.collapse.expandedProjectSessionListsById = Object.fromEntries(
    ((state.expandedSessionLists ?? []) as string[]).map((id) => [id, true as const])
  );
  ui.collapse.expandedSessionCardHoverActionsById = Object.fromEntries(
    ((state.expandedHoverActions ?? []) as string[]).map((id) => [id, true as const])
  );
  ui.collapse.selectedSpaceIdBySectionKey = (state.selectedSpaceBySection ?? {}) as Record<string, string>;
  ui.metadata.collections.local = parseSidebarProjectCollectionsFromGxserver(snapshot.sidebarProjectCollections);
  ui.metadata.spaces.local = snapshot.sidebarSpaces
    ? parseSidebarSpacesFromGxserver(snapshot.sidebarSpaces)
    : undefined;
  return ui;
}
