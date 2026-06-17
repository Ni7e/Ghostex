import type { GxserverProjectDomainState } from "../../shared/gxserver-protocol";
import {
  normalizeStoredSidebarAgentOrder,
  normalizeStoredSidebarAgents,
  type StoredSidebarAgent,
} from "../../shared/sidebar-agents";
import {
  normalizeProjectSidebarCommandsState,
  type ProjectSidebarCommandsState,
  type ProjectSidebarCommandsStore,
} from "../../shared/project-sidebar-commands";

type MergeGxserverProjectActionsResult = {
  changed: boolean;
  retainedLocalOwnerIds: string[];
  restoredOwnerIds: string[];
  store: ProjectSidebarCommandsStore;
};

type MergeGxserverAgentsResult = {
  agents: StoredSidebarAgent[];
  changed: boolean;
  order: string[];
};

type GxserverProjectActionsSyncMode = "hydrateMissing" | "replaceFromGxserver";

type GxserverGitPreferences = {
  confirmCommit?: boolean;
  generateCommitBody?: boolean;
  primaryAction?: "commit" | "push" | "pr";
};

/*
CDXC:ProjectActions 2026-05-30-23:59:
Project Actions are shared gxserver project state after the daemon cutover, while the existing sidebar renderer still needs its local command cache to draw action buttons synchronously. Hydrate empty P-id cache entries from gxserver instead of treating the cache as authoritative, so first-launch ID migration cannot make imported actions disappear from the UI.

CDXC:ProjectActions 2026-06-02-10:59:
After presentation deltas carry the gxserver domain project, native action caches are no longer allowed to remain authoritative. Startup may still hydrate missing cache entries, but gxserver-driven reconciliation must replace the local render cache, including empty action state after the user deletes all custom project actions.
*/
export function mergeGxserverProjectActionsIntoCommandsStore(
  store: ProjectSidebarCommandsStore,
  gxserverProjects: readonly GxserverProjectDomainState[],
  ownerIdByProjectId: Readonly<Record<string, string>> = {},
  options: {
    mode?: GxserverProjectActionsSyncMode;
    preserveLocalWhenGxserverEmpty?: boolean;
  } = {},
): MergeGxserverProjectActionsResult {
  const mode = options.mode ?? "hydrateMissing";
  let changed = false;
  const retainedLocalOwnerIds: string[] = [];
  const restoredOwnerIds: string[] = [];
  const nextStore: ProjectSidebarCommandsStore = { ...store };
  const sourceProjects =
    mode === "replaceFromGxserver"
      ? selectAuthoritativeProjectActionSources(gxserverProjects, ownerIdByProjectId)
      : gxserverProjects.map((project) => ({
          ownerProjectId: ownerIdByProjectId[project.projectId] || project.projectId,
          project,
        }));
  for (const { ownerProjectId, project } of sourceProjects) {
    const gxserverState = normalizeProjectSidebarCommandsState({
      commands: project.customCommands,
      deletedDefaultCommandIds: project.deletedDefaultCommandIds,
      order: project.customCommandOrder,
    });
    if (!gxserverState) {
      continue;
    }
    if (
      mode === "hydrateMissing" &&
      !hasProjectSidebarCommandsStateContent(gxserverState)
    ) {
      continue;
    }
    const existingState = nextStore[ownerProjectId];
    /*
    CDXC:ProjectActions 2026-06-17-07:40:
    First startup after an app update can still have the user's titlebar Action
    definitions in the WK local render cache while the gxserver project row has
    no imported action content. Preserve that local state during startup so an
    empty daemon row cannot erase Actions before native mirrors the retained
    state back into gxserver. Later projectUpdated deltas and explicit
    updateProject responses keep using replace mode without this protection.
    */
    if (
      mode === "replaceFromGxserver" &&
      options.preserveLocalWhenGxserverEmpty === true &&
      existingState &&
      hasProjectSidebarCommandsStateContent(existingState) &&
      !hasProjectSidebarCommandsStateContent(gxserverState)
    ) {
      retainedLocalOwnerIds.push(ownerProjectId);
      continue;
    }
    if (
      mode === "hydrateMissing" &&
      existingState &&
      hasProjectSidebarCommandsStateContent(existingState)
    ) {
      continue;
    }
    if (
      mode === "replaceFromGxserver" &&
      areProjectSidebarCommandsStatesEqual(existingState, gxserverState)
    ) {
      continue;
    }
    nextStore[ownerProjectId] = gxserverState;
    restoredOwnerIds.push(ownerProjectId);
    changed = true;
  }
  return { changed, retainedLocalOwnerIds, restoredOwnerIds, store: nextStore };
}

export function hasProjectSidebarCommandsStateContent(
  state: ProjectSidebarCommandsState | undefined,
): boolean {
  return Boolean(
    state &&
      (state.commands.length > 0 ||
        state.order.length > 0 ||
      state.deletedDefaultCommandIds.length > 0),
  );
}

/*
CDXC:SidebarAgents 2026-05-31-00:24:
Custom Agents follow the same cutover rule as Actions: gxserver imports them into shared project domain state, while the current macOS sidebar still renders from a synchronous local cache. Rehydrate only empty local agent stores so a stale WKWebView key cannot hide imported agents, without overwriting edits already made in the current sidebar.

CDXC:SidebarAgents 2026-06-02-10:59:
Gxserver project-domain deltas are authoritative for shared custom-agent definitions. Native keeps agents in localStorage only as a synchronous renderer/editor cache, so daemon reconciliation replaces that cache and can clear it when gxserver has no custom agents.
*/
export function mergeGxserverAgentsIntoSidebarStore(
  storedAgents: readonly StoredSidebarAgent[],
  storedOrder: readonly string[],
  gxserverProjects: readonly GxserverProjectDomainState[],
  options: { mode?: GxserverProjectActionsSyncMode } = {},
): MergeGxserverAgentsResult {
  const mode = options.mode ?? "hydrateMissing";
  const sourceProject = gxserverProjects.find(
    (project) => project.customAgents.length > 0 || project.customAgentOrder.length > 0,
  );
  if (mode === "replaceFromGxserver" && gxserverProjects.length === 0) {
    return {
      agents: [...storedAgents],
      changed: false,
      order: [...storedOrder],
    };
  }
  if (!sourceProject) {
    if (mode === "replaceFromGxserver") {
      const changed = storedAgents.length > 0 || storedOrder.length > 0;
      return {
        agents: [],
        changed,
        order: [],
      };
    }
    return {
      agents: [...storedAgents],
      changed: false,
      order: [...storedOrder],
    };
  }
  const nextAgents =
    mode === "hydrateMissing" && storedAgents.length > 0
      ? [...storedAgents]
      : normalizeStoredSidebarAgents(sourceProject.customAgents);
  const nextOrder =
    mode === "hydrateMissing" && storedOrder.length > 0
      ? [...storedOrder]
      : normalizeStoredSidebarAgentOrder(sourceProject.customAgentOrder);
  const changed =
    JSON.stringify(nextAgents) !== JSON.stringify(storedAgents) ||
    JSON.stringify(nextOrder) !== JSON.stringify(storedOrder);
  return { agents: nextAgents, changed, order: nextOrder };
}

export function readGxserverGitPreferences(
  gxserverProjects: readonly GxserverProjectDomainState[],
): GxserverGitPreferences {
  /*
  CDXC:NativeSidebarGit 2026-06-02-14:01:
  Git preferences are mirrored to project gitConfig rows. During local-first saves, gxserver can publish one updated project before every mirrored row has caught up, so read the newest explicit preference row instead of the first row in project order.
  */
  const source = [...gxserverProjects]
    .filter((project) => {
      const config = project.gitConfig;
      return (
        isGitPrimaryAction(config.primaryAction) ||
        typeof config.confirmCommit === "boolean" ||
        typeof config.generateCommitBody === "boolean"
      );
    })
    .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))[0];
  if (!source) {
    return {};
  }
  return {
    ...(typeof source.gitConfig.confirmCommit === "boolean"
      ? { confirmCommit: source.gitConfig.confirmCommit }
      : {}),
    ...(typeof source.gitConfig.generateCommitBody === "boolean"
      ? { generateCommitBody: source.gitConfig.generateCommitBody }
      : {}),
    ...(isGitPrimaryAction(source.gitConfig.primaryAction)
      ? { primaryAction: source.gitConfig.primaryAction }
      : {}),
  };
}

function isGitPrimaryAction(value: unknown): value is "commit" | "push" | "pr" {
  return value === "commit" || value === "push" || value === "pr";
}

function selectAuthoritativeProjectActionSources(
  gxserverProjects: readonly GxserverProjectDomainState[],
  ownerIdByProjectId: Readonly<Record<string, string>>,
): { ownerProjectId: string; project: GxserverProjectDomainState }[] {
  const sourceByOwnerProjectId = new Map<
    string,
    { ownerProjectId: string; project: GxserverProjectDomainState }
  >();
  for (const project of gxserverProjects) {
    const ownerProjectId = ownerIdByProjectId[project.projectId] || project.projectId;
    if (project.projectId !== ownerProjectId && !projectActionsProjectHasContent(project)) {
      continue;
    }
    const existing = sourceByOwnerProjectId.get(ownerProjectId);
    if (!existing) {
      sourceByOwnerProjectId.set(ownerProjectId, { ownerProjectId, project });
      continue;
    }
    if (project.projectId === ownerProjectId && existing.project.projectId !== ownerProjectId) {
      sourceByOwnerProjectId.set(ownerProjectId, { ownerProjectId, project });
      continue;
    }
    if (
      existing.project.projectId !== ownerProjectId &&
      !projectActionsProjectHasContent(existing.project) &&
      projectActionsProjectHasContent(project)
    ) {
      sourceByOwnerProjectId.set(ownerProjectId, { ownerProjectId, project });
    }
  }
  return [...sourceByOwnerProjectId.values()];
}

function projectActionsProjectHasContent(project: GxserverProjectDomainState): boolean {
  return (
    project.customCommands.length > 0 ||
    project.customCommandOrder.length > 0 ||
    project.deletedDefaultCommandIds.length > 0
  );
}

function areProjectSidebarCommandsStatesEqual(
  left: ProjectSidebarCommandsState | undefined,
  right: ProjectSidebarCommandsState,
): boolean {
  if (!left) {
    return !hasProjectSidebarCommandsStateContent(right);
  }
  return JSON.stringify(left) === JSON.stringify(right);
}
