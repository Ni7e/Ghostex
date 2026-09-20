/**
 * The Projects tab: the sorting, day grouping, search, rows and context menu of
 * packages/core-ui/recent-projects-modal.tsx.
 */
import { createGxserverPresentationProjectGroupId } from '@/packages/shared/gxserver-presentation-sidebar-projection';
import { parseRemoteProjectId } from '@/packages/shared/remote-terminal-selection';
import type { SidebarRecentProject, SidebarToExtensionMessage } from '@/packages/shared/session-grid-contract';
import { resolveWorkspaceProjectIconDataUrl } from '@/packages/shared/workspace-project-appearance';
import { readSidebarHiddenItems } from '@/packages/core-ui/sidebar-hidden-items';
import { readSidebarProjectCollections } from '@/packages/core-ui/project-collections';
import type { QuickAccessGroup, QuickAccessMenuItem, QuickAccessRow } from '@/packages/shared/native-quick-access';
import { quickAccessDayLabel } from './day-labels';
import { assetIcon, imageIcon } from './icons';

export type RecentProjectsData = {
  machineId?: string;
  projects: SidebarRecentProject[];
};

function parseClosedAt(value: string | undefined): number {
  if (!value) return 0;
  const timestamp = Date.parse(value);
  return Number.isNaN(timestamp) ? 0 : timestamp;
}

export function sortRecentProjects(projects: readonly SidebarRecentProject[]): SidebarRecentProject[] {
  return [...projects].sort((left, right) => {
    if (left.isOpen !== right.isOpen) return left.isOpen ? -1 : 1;
    const rightTimestamp = parseClosedAt(right.isOpen ? right.updatedAt : right.recentClosedAt);
    const leftTimestamp = parseClosedAt(left.isOpen ? left.updatedAt : left.recentClosedAt);
    return rightTimestamp - leftTimestamp || left.title.localeCompare(right.title);
  });
}

export function filterRecentProjects(projects: readonly SidebarRecentProject[], query: string): SidebarRecentProject[] {
  const normalizedQuery = query.trim().toLocaleLowerCase();
  if (!normalizedQuery) return [...projects];
  const terms = normalizedQuery.split(/\s+/u);
  return projects.filter((project) => {
    const searchableText = [project.title, project.path].join('\n').toLocaleLowerCase();
    return terms.every((term) => searchableText.includes(term));
  });
}

function sidebarGroupIdForProject(project: SidebarRecentProject): string {
  const remoteReference = parseRemoteProjectId(project.projectId);
  return remoteReference
    ? `remote:${remoteReference.machineId}:group:${remoteReference.projectId}`
    : createGxserverPresentationProjectGroupId(project.projectId);
}

function hiddenProjectState(): { groupIds: string[]; localProjectIds: string[] } {
  const hiddenItems = readSidebarHiddenItems();
  const hiddenCollectionIds = new Set(
    hiddenItems.collectionKeys.flatMap((key) => (key.startsWith('local:') ? [key.slice('local:'.length)] : []))
  );
  const localProjectIds = readSidebarProjectCollections().collections.flatMap((collection) =>
    hiddenCollectionIds.has(collection.collectionId) ? collection.projectIds : []
  );
  return { groupIds: hiddenItems.groupIds, localProjectIds: [...new Set(localProjectIds)] };
}

function projectIcon(project: SidebarRecentProject) {
  const iconDataUrl = resolveWorkspaceProjectIconDataUrl(project);
  const image = imageIcon(iconDataUrl);
  if (image) return image;
  if (project.icon?.kind === 'tabler') return assetIcon(project.icon.icon, project.icon.color);
  return assetIcon('folder');
}

export function projectRowKey(projectId: string): string {
  return `project:${projectId}`;
}

/**
 * Open projects lead under an "Open in sidebar" heading, then one group per day
 * a project was closed, then a trailing "Earlier" group.
 */
export function buildProjectGroups(data: RecentProjectsData | undefined, query: string): QuickAccessGroup[] {
  if (!data) return [];
  const hidden = hiddenProjectState();
  const sorted = sortRecentProjects(filterRecentProjects(data.projects, query));
  const byDay = new Map<string, SidebarRecentProject[]>();
  for (const project of sorted) {
    const dayLabel = project.isOpen
      ? 'Open in sidebar'
      : parseClosedAt(project.recentClosedAt) === 0
        ? 'Earlier'
        : quickAccessDayLabel(parseClosedAt(project.recentClosedAt));
    const grouped = byDay.get(dayLabel);
    if (grouped) grouped.push(project);
    else byDay.set(dayLabel, [project]);
  }
  return [...byDay.entries()].map(([dayLabel, projects]) => ({
    key: dayLabel,
    heading: dayLabel,
    separated: false,
    rows: projects.map((project): QuickAccessRow => ({
      kind: 'project',
      key: projectRowKey(project.projectId),
      title: project.title,
      icon: projectIcon(project),
      tooltip: project.path,
      sessionCount: project.sessionCount,
      isOpen: project.isOpen === true,
      isHidden:
        hidden.groupIds.includes(sidebarGroupIdForProject(project)) ||
        hidden.localProjectIds.includes(project.projectId),
    })),
  }));
}

export function findRecentProject(data: RecentProjectsData | undefined, key: string): SidebarRecentProject | undefined {
  return data?.projects.find((project) => projectRowKey(project.projectId) === key);
}

export function activateRecentProject(
  project: SidebarRecentProject,
  post: (message: SidebarToExtensionMessage) => void
): void {
  post({
    projectId: project.projectId,
    type: project.isOpen ? 'focusRecentProject' : 'restoreRecentProject',
  } as SidebarToExtensionMessage);
}

export function removeRecentProject(
  project: SidebarRecentProject,
  post: (message: SidebarToExtensionMessage) => void
): void {
  post({
    projectId: project.projectId,
    type: project.isOpen ? 'closeProjectFromProjects' : 'removeRecentProject',
  } as SidebarToExtensionMessage);
}

/** The row context menu, in the React modal's order. */
export function recentProjectMenuItems(
  project: SidebarRecentProject,
  machineId: string | undefined
): QuickAccessMenuItem[] {
  const item = (
    id: string,
    label: string,
    icon: string,
    options: { danger?: boolean; disabled?: boolean } = {}
  ): QuickAccessMenuItem => ({
    id,
    label,
    icon: assetIcon(icon),
    danger: options.danger === true,
    disabled: options.disabled === true,
    separator: false,
  });
  if (project.isOpen) {
    return [item('activate', 'Open', 'folder-open')];
  }
  const items: QuickAccessMenuItem[] = [
    item('activate', 'Restore', 'rotate-clockwise'),
    item('copyPath', 'Copy Path', 'copy'),
  ];
  if (machineId) {
    items.push(item('openLocationUnavailable', 'Open File/Folder Location', 'folder-open', { disabled: true }));
    items.push(item('openTerminal', 'Open remote terminal here', 'terminal-2'));
  } else {
    items.push(item('openLocation', 'Open File/Folder Location', 'folder-open'));
  }
  items.push({
    id: 'separator',
    label: '',
    icon: { kind: 'none' },
    danger: false,
    disabled: false,
    separator: true,
  });
  items.push(item('remove', 'Remove project', 'trash', { danger: true }));
  return items;
}
