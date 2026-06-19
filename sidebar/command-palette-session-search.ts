import type {
  SidebarPreviousSessionItem,
  SidebarSessionItem,
} from "../shared/session-grid-contract";
import { isDefaultSessionSearchTitle } from "../shared/session-grid-contract";
import { getSessionHistoryCardTitle } from "./session-history-card-title";

/*
 * CDXC:CommandPalette 2026-06-14-02:05:
 * Session-search ranking and filtering helpers live outside the React palette
 * component so tests can exercise Cmd+P/Cmd+Shift+P behavior without loading
 * shadcn command components or sidebar DOM dependencies.
 */

type CommandPaletteSessionGroup = {
  isActive?: boolean;
  projectContext?: {
    path?: string;
  };
  remoteMachineContext?: {
    machineName?: string;
  };
  title?: string;
};

export type CommandPaletteCurrentSessionItem = {
  groupId: string;
  groupIsActive: boolean;
  projectLabel?: string;
  searchText: string;
  session: SidebarSessionItem;
};

export type CommandPaletteSessionSection = {
  heading: "Current Project" | "Other Active Projects" | "Collapsed Projects";
  items: CommandPaletteCurrentSessionItem[];
  key: "currentProject" | "activeProjects" | "collapsedProjects";
};

const COMMAND_MODE_PREFIX = ">";

export function isCommandPaletteCommandMode(value: string): boolean {
  return value.trimStart().startsWith(COMMAND_MODE_PREFIX);
}

export function getCommandPaletteCommandQuery(value: string): string {
  const trimmedStart = value.trimStart();
  return trimmedStart.startsWith(COMMAND_MODE_PREFIX)
    ? trimmedStart.slice(COMMAND_MODE_PREFIX.length).trim()
    : "";
}

export function getCommandPaletteQueryForRequestedMode(
  currentValue: string,
  requestedInitialQuery: string,
): string {
  const wantsCommandMode = isCommandPaletteCommandMode(requestedInitialQuery);
  const isCurrentlyCommandMode = isCommandPaletteCommandMode(currentValue);
  if (wantsCommandMode === isCurrentlyCommandMode) {
    return currentValue;
  }
  /*
   * CDXC:CommandPalette 2026-06-15-10:27:
   * Repeat command-palette open requests should not close or recreate the
   * native child window. When Cmd+P and Cmd+Shift+P cross modes while the
   * palette is already open, keep the user's query text and only add or remove
   * the leading `>` mode marker.
   */
  if (wantsCommandMode) {
    return `${COMMAND_MODE_PREFIX}${currentValue}`;
  }
  const commandValue = currentValue.trimStart();
  const valueWithoutPrefix = commandValue.startsWith(COMMAND_MODE_PREFIX)
    ? commandValue.slice(COMMAND_MODE_PREFIX.length)
    : commandValue;
  return valueWithoutPrefix.startsWith(" ") ? valueWithoutPrefix.slice(1) : valueWithoutPrefix;
}

export function getCommandPaletteModeSwitchSelectionRange(value: string): {
  end: number;
  start: number;
} {
  if (!isCommandPaletteCommandMode(value)) {
    return { end: value.length, start: 0 };
  }
  const commandPrefixIndex = value.indexOf(COMMAND_MODE_PREFIX);
  const queryStart = value[commandPrefixIndex + 1] === " "
    ? commandPrefixIndex + 2
    : commandPrefixIndex + 1;
  return { end: value.length, start: queryStart };
}

export function createCommandPaletteCurrentSessionItems({
  groupsById,
  sessionIdsByGroup,
  sessionsById,
  workspaceGroupIds,
}: {
  groupsById: Record<string, CommandPaletteSessionGroup | undefined>;
  sessionIdsByGroup: Record<string, readonly string[]>;
  sessionsById: Record<string, SidebarSessionItem>;
  workspaceGroupIds: readonly string[];
}): CommandPaletteCurrentSessionItem[] {
  const items: CommandPaletteCurrentSessionItem[] = [];
  for (const groupId of workspaceGroupIds) {
    const group = groupsById[groupId];
    const projectLabel = getCurrentSessionProjectLabel(group);
    for (const sessionId of sessionIdsByGroup[groupId] ?? []) {
      const session = sessionsById[sessionId];
      if (!session) {
        continue;
      }
      const searchText = createCurrentSessionTitleSearchText(session);
      if (isDefaultSessionSearchTitle(searchText)) {
        continue;
      }
      items.push({
        groupId,
        groupIsActive: group?.isActive === true,
        projectLabel,
        searchText,
        session,
      });
    }
  }
  return items;
}

export function createCommandPaletteSessionSections(
  items: readonly CommandPaletteCurrentSessionItem[],
  {
    collapsedGroupsById,
    currentGroupId = getCommandPaletteCurrentGroupId(items),
  }: {
    collapsedGroupsById: Record<string, true>;
    currentGroupId?: string;
  },
): CommandPaletteSessionSection[] {
  /*
   * CDXC:CommandPalette 2026-06-13-22:48:
   * Session search is project-oriented: the current project is first, expanded
   * projects follow, collapsed project rows follow after that, and previous
   * sessions stay last. Do not use the old flat current-session heading because
   * it hides whether a result belongs to the current, active, or collapsed
   * project area.
   *
   * CDXC:CommandPalette 2026-06-19-14:10:
   * The Current Project section must mean the app's active project, not a
   * session row with stale focus metadata. A visible `/` terminal can remain
   * focused while the active project is Ghostex, so use active group state as
   * the authoritative project context for Cmd+P grouping.
   *
   * CDXC:CommandPalette 2026-06-19-14:11:
   * The second live-session bucket is Other Active Projects so users do not
   * read Current Project as a separate concept above the app's active project.
   */
  const currentProjectItems: CommandPaletteCurrentSessionItem[] = [];
  const activeProjectItems: CommandPaletteCurrentSessionItem[] = [];
  const collapsedProjectItems: CommandPaletteCurrentSessionItem[] = [];

  for (const item of items) {
    if (item.groupId === currentGroupId) {
      currentProjectItems.push(item);
      continue;
    }
    if (collapsedGroupsById[item.groupId] === true) {
      collapsedProjectItems.push(item);
      continue;
    }
    activeProjectItems.push(item);
  }

  const sections: CommandPaletteSessionSection[] = [
    {
      heading: "Current Project",
      items: sortCommandPaletteCurrentSessionItemsByLastActive(currentProjectItems),
      key: "currentProject",
    },
    {
      heading: "Other Active Projects",
      items: sortCommandPaletteCurrentSessionItemsByLastActive(activeProjectItems),
      key: "activeProjects",
    },
    {
      heading: "Collapsed Projects",
      items: sortCommandPaletteCurrentSessionItemsByLastActive(collapsedProjectItems),
      key: "collapsedProjects",
    },
  ];
  return sections.filter((section) => section.items.length > 0);
}

export function sortCommandPaletteCurrentSessionItemsByLastActive(
  items: readonly CommandPaletteCurrentSessionItem[],
): CommandPaletteCurrentSessionItem[] {
  /*
   * CDXC:CommandPalette 2026-06-13-23:06:
   * Session search rows must sort by the visible Last Active value from most
   * recently active to least recently active inside each project-status area.
   * Keep equal timestamps stable so missing or identical activity times do not
   * reshuffle rows on every render.
   */
  return sortCommandPaletteRowsByLastActive(items, (item) => item.session);
}

export function sortCommandPalettePreviousSessionsByLastActive(
  sessions: readonly SidebarPreviousSessionItem[],
): SidebarPreviousSessionItem[] {
  return sortCommandPaletteRowsByLastActive(sessions, (session) => session, (session) =>
    getCommandPaletteSessionTimestamp(session.closedAt),
  );
}

export function getCommandPaletteCurrentGroupId(
  items: readonly CommandPaletteCurrentSessionItem[],
): string | undefined {
  return items.find((item) => item.groupIsActive)?.groupId;
}

export function filterCommandPaletteItems<T>(
  items: readonly T[],
  query: string,
  getSearchText: (item: T) => string,
): T[] {
  const normalizedQuery = normalizeCommandPaletteSearchValue(query);
  if (!normalizedQuery) {
    return [...items];
  }
  return items.filter((item) =>
    matchesCommandPaletteSearchQuery(getSearchText(item), normalizedQuery),
  );
}

export function filterCommandPaletteCurrentSessionItems(
  items: readonly CommandPaletteCurrentSessionItem[],
  query: string,
): CommandPaletteCurrentSessionItem[] {
  const normalizedQuery = query.trim();
  if (!normalizedQuery) {
    return items.filter((item) => !isDefaultSessionSearchTitle(item.searchText));
  }
  return items.filter((item) =>
    !isDefaultSessionSearchTitle(item.searchText) &&
    matchesCommandPaletteTitleSearchQuery(item.searchText, normalizedQuery),
  );
}

export function createPreviousSessionSearchText(session: SidebarPreviousSessionItem): string {
  return getSessionHistoryCardTitle(session);
}

export function filterCommandPalettePreviousSessions(
  sessions: readonly SidebarPreviousSessionItem[],
  query: string,
): SidebarPreviousSessionItem[] {
  const normalizedQuery = query.trim();
  const searchableSessions = sessions.filter(
    (session) => !isDefaultSessionSearchTitle(createPreviousSessionSearchText(session)),
  );
  if (!normalizedQuery) {
    return searchableSessions;
  }

  return searchableSessions.filter((session) =>
    matchesCommandPaletteTitleSearchQuery(createPreviousSessionSearchText(session), normalizedQuery),
  );
}

export function getPreviousSessionProjectLabel(
  session: SidebarPreviousSessionItem,
): string | undefined {
  const projectName = session.projectName?.trim();
  if (projectName) {
    return projectName;
  }

  const projectPath = session.projectPath?.trim();
  if (!projectPath) {
    return undefined;
  }

  const pathParts = projectPath.split(/[\\/]/u).filter(Boolean);
  return pathParts[pathParts.length - 1] ?? projectPath;
}

function sortCommandPaletteRowsByLastActive<T>(
  items: readonly T[],
  getSession: (item: T) => Pick<SidebarSessionItem, "lastInteractionAt">,
  getFallbackTimestamp: (item: T) => number = () => 0,
): T[] {
  return items
    .map((item, itemIndex) => ({
      item,
      itemIndex,
      timestamp:
        getCommandPaletteSessionTimestamp(getSession(item).lastInteractionAt) ||
        getFallbackTimestamp(item),
    }))
    .sort((left, right) => {
      const timestampDelta = right.timestamp - left.timestamp;
      if (timestampDelta !== 0) {
        return timestampDelta;
      }
      return left.itemIndex - right.itemIndex;
    })
    .map(({ item }) => item);
}

function getCommandPaletteSessionTimestamp(value: string | undefined): number {
  if (!value) {
    return 0;
  }

  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? timestamp : 0;
}

function matchesCommandPaletteSearchQuery(searchText: string, query: string): boolean {
  const normalizedSearchText = normalizeCommandPaletteSearchValue(searchText);
  const queryTokens = normalizeCommandPaletteSearchValue(query).split(/\s+/).filter(Boolean);
  return queryTokens.every((token) => fuzzyIncludes(normalizedSearchText, token));
}

function matchesCommandPaletteTitleSearchQuery(searchText: string, query: string): boolean {
  const normalizedSearchText = normalizeCommandPaletteSearchValue(searchText);
  const queryTokens = normalizeCommandPaletteSearchValue(query).split(/\s+/).filter(Boolean);
  return queryTokens.every((token) => normalizedSearchText.includes(token));
}

function normalizeCommandPaletteSearchValue(value: string | undefined): string {
  if (!value) {
    return "";
  }
  return value
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/[-_/\\.]+/g, " ")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

function fuzzyIncludes(text: string, query: string): boolean {
  let queryIndex = 0;

  for (const character of text) {
    if (character !== query[queryIndex]) {
      continue;
    }
    queryIndex += 1;
    if (queryIndex >= query.length) {
      return true;
    }
  }

  return query.length === 0;
}

function createCurrentSessionTitleSearchText(session: SidebarSessionItem): string {
  /*
   * CDXC:CommandPalette 2026-06-17-22:39:
   * Cmd+P is a session-title jump surface. Searching hidden metadata such as
   * project paths, provider details, session numbers, or shared "Terminal"
   * labels makes unrelated sessions appear for ordinary title queries, so keep
   * both filtering and CommandItem values limited to the same title priority
   * the palette row presents. Use token containment for session titles so
   * `testing` does not fuzzily match `Settings` or letters stitched across an
   * unrelated title.
   */
  return getSessionHistoryCardTitle(session);
}

function getCurrentSessionProjectLabel(
  group: CommandPaletteSessionGroup | undefined,
): string | undefined {
  const title = group?.title?.trim();
  if (title) {
    return title;
  }
  return group?.remoteMachineContext?.machineName?.trim() || undefined;
}
