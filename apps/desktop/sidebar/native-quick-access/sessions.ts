/**
 * The Sessions tab: the open + closed merge, scope/tag/project filters, paging,
 * day grouping and rows of packages/core-ui/previous-sessions-modal.tsx.
 */
import {
  filterPreviousSessions,
  filterPreviousSessionsModalItems,
  filterSidebarSessionItems,
  sortPreviousSessionsByClosedAt,
} from '@/packages/core-ui/previous-session-search';
import { getQuickAccessSessionProjectId } from '@/packages/core-ui/quick-access-session-scope';
import { getSessionHistoryCardTitle } from '@/packages/core-ui/session-history-card-title';
import { formatRelativeTime } from '@/packages/core-ui/relative-time';
import { COLORED_AGENT_LOGOS } from '@/packages/core-ui/agent-logos';
import { shouldShowTerminalSessionIcon } from '@/packages/core-ui/session-card-presentation';
import { getSessionTagCatalogs } from '@/packages/core-ui/session-tag-catalogs';
import { nativeTagPresentation } from '../native-sidebar/tag-presentation';
import { sidebarStore } from '@/packages/core-ui/sidebar-store-model';
import {
  getEffectiveSidebarSessionTag,
  getEnabledVisibleSidebarSessionTagFilters,
  getSidebarSessionTagLabel,
  getSidebarSessionTagListItemFilter,
  normalizeSidebarSessionTagListItems,
  sessionMatchesSidebarTagFilters,
} from '@/packages/shared/session-tags';
import {
  getSidebarSessionLifecycleState,
  type SidebarPreviousSessionItem,
  type SidebarSessionItem,
} from '@/packages/shared/session-grid-contract';
import type {
  QuickAccessGroup,
  QuickAccessOption,
  QuickAccessRow,
  QuickAccessSelect,
} from '@/packages/shared/native-quick-access';
import { quickAccessDayLabel } from './day-labels';
import { assetIcon, imageIcon, NO_ICON } from './icons';

export const SESSIONS_PAGE_SIZE = 80;
export const SESSIONS_VISIBLE_WINDOW_MS = 14 * 24 * 60 * 60 * 1_000;
export const SESSION_TRANSCRIPT_SIZE_BATCH_SIZE = 24;

export type SessionScope = 'all' | 'closed' | 'external';

export type QuickAccessOpenSessionItem = {
  kind: 'open';
  key: string;
  groupId: string;
  projectLabel?: string;
  session: SidebarSessionItem;
  timestamp: number;
};

export type QuickAccessClosedSessionItem = {
  kind: 'closed';
  key: string;
  session: SidebarPreviousSessionItem;
  timestamp: number;
};

export type QuickAccessSessionItem = QuickAccessOpenSessionItem | QuickAccessClosedSessionItem;

export type SessionsTabState = {
  scope: SessionScope;
  projectId: string;
  tagFilters: string[];
  remoteSessions?: SidebarPreviousSessionItem[];
  cursor?: string;
  projectOptions: { projectId: string; name: string }[];
  resolvedQueryKey?: string;
  historyWindowCount: number;
  historyAnchorMs: number;
  fileSizesByKey: Record<string, number | null>;
};

export function createSessionsTabState(): SessionsTabState {
  return {
    scope: 'all',
    projectId: '',
    tagFilters: [],
    projectOptions: [],
    historyWindowCount: 1,
    historyAnchorMs: Date.now(),
    fileSizesByKey: {},
  };
}

function parseTimestamp(value: string | undefined): number {
  if (!value) return 0;
  const timestamp = Date.parse(value);
  return Number.isNaN(timestamp) ? 0 : timestamp;
}

export function sessionsQueryKey(state: SessionsTabState, query: string): string {
  return JSON.stringify([query.trim(), [...state.tagFilters].sort(), state.projectId, state.scope === 'external']);
}

function openSessionItems(): QuickAccessOpenSessionItem[] {
  const store = sidebarStore.getState();
  return Object.entries(store.sessionIdsByGroup).flatMap(([groupId, sessionIds]) => {
    const group = store.groupsById[groupId];
    return sessionIds.flatMap((sessionId) => {
      const session = store.sessionsById[sessionId];
      if (!session) return [];
      return [
        {
          kind: 'open' as const,
          key: `open:${session.sessionId}`,
          groupId,
          projectLabel: group?.title?.trim() || undefined,
          session,
          timestamp: parseTimestamp(session.lastInteractionAt),
        },
      ];
    });
  });
}

/** Every project the picker offers: the paged answer plus the live sidebar groups. */
export function sessionProjectOptions(state: SessionsTabState): { projectId: string; name: string }[] {
  const store = sidebarStore.getState();
  const options = new Map(state.projectOptions.map((project) => [project.projectId, project]));
  for (const group of Object.values(store.groupsById)) {
    const projectId = getQuickAccessSessionProjectId(group);
    if (projectId && !options.has(projectId)) options.set(projectId, { projectId, name: group.title });
  }
  return [...options.values()].sort(
    (left, right) => left.name.localeCompare(right.name) || left.projectId.localeCompare(right.projectId)
  );
}

export function visibleSessionItems(state: SessionsTabState, query: string): QuickAccessSessionItem[] {
  const store = sidebarStore.getState();
  const hasTagFilters = state.tagFilters.length > 0;
  const showExternalOnly = state.scope === 'external';
  const showClosedOnly = state.scope === 'closed';
  const modalPreviousSessions = filterPreviousSessionsModalItems(state.remoteSessions ?? store.previousSessions);
  const open = (() => {
    if (showClosedOnly || showExternalOnly) return [];
    const items = openSessionItems();
    const tagFiltered = hasTagFilters
      ? items.filter((item) => sessionMatchesSidebarTagFilters(item.session, state.tagFilters as never))
      : items;
    const matched = new Set(
      filterSidebarSessionItems(
        tagFiltered.map((item) => item.session),
        query
      )
    );
    return tagFiltered.filter(
      (item) =>
        matched.has(item.session) &&
        (!state.projectId || getQuickAccessSessionProjectId(store.groupsById[item.groupId]) === state.projectId)
    );
  })();
  const closed = sortPreviousSessionsByClosedAt(
    filterPreviousSessions(
      modalPreviousSessions.filter(
        (session) =>
          (!state.projectId || session.projectId === state.projectId) && (!showExternalOnly || session.externalSession)
      ),
      query,
      { sessionTags: state.tagFilters as never }
    )
  );
  const hasFilters = hasTagFilters || Boolean(state.projectId) || showExternalOnly;
  const cutoff = state.historyAnchorMs - state.historyWindowCount * SESSIONS_VISIBLE_WINDOW_MS;
  const visibleClosed =
    query.trim() || hasFilters ? closed : closed.filter((session) => parseTimestamp(session.closedAt) >= cutoff);
  return [
    ...open,
    ...visibleClosed.map((session): QuickAccessSessionItem => ({
      kind: 'closed',
      key: `closed:${session.historyId}`,
      session,
      timestamp: parseTimestamp(session.closedAt),
    })),
  ].sort((left, right) => right.timestamp - left.timestamp || left.key.localeCompare(right.key));
}

function formatFileSize(sizeBytes: number | null | undefined): string {
  if (sizeBytes === undefined) return '…';
  if (sizeBytes === null) return '-';
  if (sizeBytes < 1_024) return `${sizeBytes} B`;
  const units = ['KB', 'MB', 'GB'];
  let value = sizeBytes / 1_024;
  let unitIndex = 0;
  while (value >= 1_024 && unitIndex < units.length - 1) {
    value /= 1_024;
    unitIndex += 1;
  }
  return `${value < 10 ? value.toFixed(1) : Math.round(value)} ${units[unitIndex]}`;
}

function closedProjectLabel(session: SidebarPreviousSessionItem): string {
  const projectName = session.projectName?.trim();
  if (projectName) return projectName;
  const projectPath = session.projectPath?.trim();
  if (!projectPath) return '';
  const parts = projectPath.split(/[\\/]/u).filter(Boolean);
  return parts[parts.length - 1] ?? projectPath;
}

/**
 * The leading identity glyph, in `SessionFloatingAgentIcon`'s order: the session
 * tag at rest, then the browser favicon, the colored agent logo, and the
 * terminal glyph for an agentless terminal row.
 */
function sessionIcon(session: SidebarSessionItem | SidebarPreviousSessionItem) {
  const tag = getEffectiveSidebarSessionTag(session);
  if (tag) {
    const presentation = nativeTagPresentation(tag);
    return assetIcon(presentation?.icon ?? 'tag', presentation?.iconColor);
  }
  const favicon = imageIcon(session.faviconDataUrl);
  if (favicon) return favicon;
  const logo = session.agentIcon ? imageIcon(COLORED_AGENT_LOGOS[session.agentIcon]) : undefined;
  if (logo) return logo;
  if (shouldShowTerminalSessionIcon(session)) return assetIcon('terminal-2');
  return NO_ICON;
}

export function buildSessionGroups(state: SessionsTabState, query: string, nowMs: number): QuickAccessGroup[] {
  const items = visibleSessionItems(state, query);
  const byDay = new Map<string, QuickAccessSessionItem[]>();
  for (const item of items) {
    const dayLabel = item.timestamp === 0 ? 'Unknown day' : quickAccessDayLabel(item.timestamp);
    const grouped = byDay.get(dayLabel);
    if (grouped) grouped.push(item);
    else byDay.set(dayLabel, [item]);
  }
  return [...byDay.entries()].map(([dayLabel, daySessions]) => ({
    key: dayLabel,
    heading: dayLabel,
    separated: false,
    rows: daySessions.map((item): QuickAccessRow => {
      const size = state.fileSizesByKey[item.key];
      const timestamp = item.kind === 'closed' ? item.session.closedAt : item.session.lastInteractionAt;
      return {
        kind: 'session',
        key: item.key,
        title: getSessionHistoryCardTitle(item.session),
        icon: sessionIcon(item.session),
        projectLabel: item.kind === 'open' ? (item.projectLabel ?? '') : closedProjectLabel(item.session),
        fileSize: formatFileSize(size),
        fileSizeLoading: size === undefined,
        time: timestamp ? formatRelativeTime(timestamp, { allowJustNow: false, nowMs }).value : '',
        inSidebar: item.kind === 'open',
        sleeping: item.kind === 'open' && getSidebarSessionLifecycleState(item.session) === 'sleeping',
        canActivate: item.kind === 'open' || item.session.isRestorable === true,
        canDelete: item.kind === 'closed',
      };
    }),
  }));
}

/** The tag filter menu, built from the Settings-managed sidebar tag row set. */
export function sessionTagSelect(state: SessionsTabState): QuickAccessSelect {
  const store = sidebarStore.getState();
  const items = normalizeSidebarSessionTagListItems(
    store.hud.settings?.sidebarSessionTagListItems,
    store.customSessionTags
  );
  const enabled = new Set(getEnabledVisibleSidebarSessionTagFilters(items));
  const catalogs = getSessionTagCatalogs();
  const options: QuickAccessOption[] = [];
  // A separator row marks the next option, the way `CommandSeparator` sits above it.
  let pendingSeparator = false;
  for (const item of items) {
    if (!item.visible) continue;
    if (item.type === 'separator') {
      pendingSeparator = item.enabled && options.length > 0;
      continue;
    }
    const filter = getSidebarSessionTagListItemFilter(item);
    if (!filter) continue;
    const separated = pendingSeparator;
    pendingSeparator = false;
    options.push({
      value: filter,
      label: getSidebarSessionTagLabel(filter, catalogs) ?? filter,
      detail: '',
      color: '',
      icon: filter === 'favorite' ? assetIcon('star-filled') : assetIcon('tag'),
      disabled: !item.enabled || !enabled.has(filter),
      selected: state.tagFilters.includes(filter),
      separated,
    });
  }
  return {
    label: state.tagFilters.length > 0 ? `${state.tagFilters.length} tags` : 'All tags',
    detail: '',
    color: '',
    options,
    searchable: true,
    searchPlaceholder: 'Filter tags...',
  };
}

export function sessionProjectSelect(state: SessionsTabState): QuickAccessSelect {
  const projects = sessionProjectOptions(state);
  const selected = projects.find((project) => project.projectId === state.projectId);
  return {
    label: selected?.name ?? 'All projects',
    detail: '',
    color: '',
    options: [
      {
        value: '',
        label: 'All projects',
        detail: '',
        color: '',
        icon: NO_ICON,
        disabled: false,
        selected: !state.projectId,
        separated: false,
      },
      ...projects.map((project): QuickAccessOption => ({
        value: project.projectId,
        label: project.name,
        detail: '',
        color: '',
        icon: NO_ICON,
        disabled: false,
        selected: project.projectId === state.projectId,
        separated: false,
      })),
    ],
    searchable: true,
    searchPlaceholder: 'Filter projects...',
  };
}

/** The empty copy the React modal shows for the active scope and filters. */
export function sessionsEmptyCopy(state: SessionsTabState, query: string): string {
  const hasTagFilters = state.tagFilters.length > 0;
  if (state.scope === 'external' && !query.trim() && !hasTagFilters && !state.projectId) {
    return 'No Claude or Codex conversations found outside Ghostex.';
  }
  const closedPrefix = state.scope === 'closed' ? 'closed ' : '';
  if (query.trim()) {
    return hasTagFilters
      ? `No tagged ${closedPrefix}sessions match that search.`
      : `No ${closedPrefix}sessions match that search.`;
  }
  return hasTagFilters ? `No ${closedPrefix}sessions match those tags.` : `No ${closedPrefix}sessions yet.`;
}

export function sessionsLoadingCopy(state: SessionsTabState): string {
  if (state.scope === 'external') return 'Loading external sessions...';
  if (state.scope === 'closed') return 'Loading closed sessions...';
  return 'Loading sessions...';
}
