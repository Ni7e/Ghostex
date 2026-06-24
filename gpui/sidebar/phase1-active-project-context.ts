import type { SidebarStoryWorkspace } from "../../sidebar/sidebar-story-workspace";
import type { SidebarSessionGroup } from "../../shared/session-grid-contract";

type ExplicitSidebarProjectContext = NonNullable<
  SidebarStoryWorkspace["groupMetadataById"][string]["projectContext"]
>;
type ExplicitLiveSidebarProjectContext = NonNullable<SidebarSessionGroup["projectContext"]>;

/**
 * CDXC:GPUIProjectSidebarBridge 2026-06-23-19:19:
 * Phase 1 active-project snapshots deliberately exclude Browser surface identity at the TypeScript payload boundary. Build Source, Kanban, and gated Manage ids through this helper-owned shape only; Browser readiness stays in the separate Browser workarea readiness message and must not become `browserWorkareaId` in active-project snapshots.
 */
export type GpuiSidebarActiveProjectSurfaceIds = {
  sourceWorkareaId?: string | null;
  kanbanBoardId?: string | null;
  manageWorkspaceId?: string | null;
  browserWorkareaId?: never;
};

export type GpuiSidebarActiveProjectContextPayload = {
  version: 1;
  type: "ghostex.gpui.sidebar.activeProjectContext";
  activeProject: {
    activeProjectId: string | null;
    displayName: string;
    projectPath: string | null;
    isQuickProjectless: boolean;
    workareaAvailability: {
      source: boolean;
      browser: boolean;
      kanban: boolean;
      manage: boolean;
    };
    surfaceIds: GpuiSidebarActiveProjectSurfaceIds;
  };
};

export type GpuiSidebarRuntimeSettings = {
  debuggingMode?: unknown;
  settings?: unknown;
  showBetaFeatures?: unknown;
};

export type GpuiSidebarRuntimeSettingsSnapshot = {
  debuggingMode: boolean;
  settings?: unknown;
  showBetaFeatures: boolean;
};

export type GpuiSidebarActiveProjectGroupsInput = {
  groups: readonly SidebarSessionGroup[];
  runtimeSettings?: GpuiSidebarRuntimeSettings;
};

export function createGpuiSidebarActiveProjectSurfaceIds(
  surfaceIds: GpuiSidebarActiveProjectSurfaceIds = {},
): GpuiSidebarActiveProjectSurfaceIds {
  const strictSurfaceIds: GpuiSidebarActiveProjectSurfaceIds = {};

  if (surfaceIds.sourceWorkareaId !== undefined) {
    strictSurfaceIds.sourceWorkareaId = surfaceIds.sourceWorkareaId;
  }
  if (surfaceIds.kanbanBoardId !== undefined) {
    strictSurfaceIds.kanbanBoardId = surfaceIds.kanbanBoardId;
  }
  if (surfaceIds.manageWorkspaceId !== undefined) {
    strictSurfaceIds.manageWorkspaceId = surfaceIds.manageWorkspaceId;
  }

  return strictSurfaceIds;
}

/**
 * CDXC:GPUIProjectSidebarBridge 2026-06-22-20:02:
 * Phase 1 must derive the GPUI active-project contract only from explicit sidebar workspace group metadata. A real project requires active-group projectContext and a non-chat collection marker; project titles are display labels only, and only projectContext.path plus the explicit projectContext.editor.projectId identity may enter the CEF bridge while fixture names, workspace names, .git probing, URLs, command text, logs, persistence, and other private user content must not.
 *
 * CDXC:GPUIProjectSidebarBridge 2026-06-23-06:36:
 * Manage availability in the GPUI sidebar CEF payload must prefer the narrow runtime settings snapshot installed by Rust from the shared sidebar settings source. Only debuggingMode and showBetaFeatures may affect Manage, and both must be strict boolean true; missing, malformed, string-like truthy, Quick/projectless, workspace-default, path/name/project, and filesystem heuristics must not enable Manage.
 *
 * CDXC:GPUISettingsSidebarHandoff 2026-06-24-11:22:
 * The same runtime settings snapshot can carry the saved shared Settings object for SidebarApp HUD normalization, but that object must not expand Manage gating beyond the strict debug/beta boolean check above.
 *
 * CDXC:GPUIProjectSidebarBridge 2026-06-23-06:57:
 * Runtime refresh callbacks use the same strict Manage gate as initial CEF install. Keep the payload helper strict so refreshed Manage availability changes only from explicit debuggingMode and showBetaFeatures booleans, not saved Settings object shape, stale workspace options, or inferred project/path state.
 *
 * CDXC:GPUIProjectSidebarBridge 2026-06-23-06:46:
 * The active-project projectPath field is an allowlisted in-memory contract value sourced only from explicit SidebarStoryWorkspace projectContext.path metadata. Keep missing, non-string, and trim-empty paths as null so Rust keeps the project payload instead of rejecting it; pass a valid non-empty explicit string through unchanged, and do not log or persist it.
 *
 * CDXC:GPUIProjectSidebarBridge 2026-06-24-11:00:
 * Production GPUI now derives the same projectPath allowlist from live SidebarSessionGroup projectContext.path after gxserver presentation projection. Storybook workspaces remain only a test/source helper path; production must not infer paths from fixture names, URLs, filesystems, logs, or project labels.
 *
 * CDXC:GPUIProjectSidebarBridge 2026-06-23-12:25:
 * Source workarea identity must come only from the explicit sidebar/native project-editor key at projectContext.editor.projectId. Valid project payloads pass that non-empty string as the active project id and allowlisted sourceWorkareaId; malformed editor identities are not valid GPUI project payloads and must fall back to Quick/projectless instead of synthesizing Browser, Kanban, Manage, path, title, fixture, filesystem, URL, localhost, or group-id surface identities.
 *
 * CDXC:GPUIProjectSidebarBridge 2026-06-23-12:56:
 * Kanban and Manage surface identities may use the same native project-editor id format as macOS, but only from the explicit projectContext.editor.projectId value. Kanban receives the tasks-mode id for valid project payloads; Manage receives the manage-mode id only when the strict Debugging Mode and Show Beta Features gates make Manage available. This bridge still does not send Browser ids, readiness, URLs, paths beyond the explicit in-memory project path, filesystem probes, or fallback localhost state.
 */
export function createGpuiSidebarActiveProjectContextPayload(
  workspace: SidebarStoryWorkspace,
  runtimeSettings?: GpuiSidebarRuntimeSettings,
): GpuiSidebarActiveProjectContextPayload {
  const activeGroup = workspace.snapshot.groups.find(
    (group) => group.groupId === workspace.snapshot.activeGroupId,
  );
  const activeGroupMetadata = activeGroup
    ? workspace.groupMetadataById[activeGroup.groupId]
    : undefined;
  const projectContext = activeGroupMetadata?.projectContext;

  if (activeGroup && projectContext && activeGroupMetadata?.isChatCollection !== true) {
    return createGpuiProjectPayloadFromActiveGroup({
      activeGroupTitle: activeGroup.title,
      isManageAvailable: isManageWorkareaAvailable(workspace, runtimeSettings),
      projectContext,
    });
  }

  return createGpuiQuickProjectlessPayload();
}

export function createGpuiSidebarActiveProjectContextPayloadFromGroups({
  groups,
  runtimeSettings,
}: GpuiSidebarActiveProjectGroupsInput): GpuiSidebarActiveProjectContextPayload {
  const activeGroup = groups.find((group) => group.isActive);
  const projectContext = activeGroup?.projectContext;

  /*
  CDXC:GPUIProjectSidebarBridge 2026-06-24-11:00:
  Production GPUI sidebar context is derived from the live SidebarApp group projection, not Storybook workspaces or fixture labels. Only an active non-chat group with explicit projectContext.editor.projectId can publish project workareas; Chats, missing gxserver, malformed project ids, and projectless states publish the strict Quick payload.
  */
  if (activeGroup && projectContext && activeGroup.isChatCollection !== true) {
    return createGpuiProjectPayloadFromActiveGroup({
      activeGroupTitle: activeGroup.title,
      isManageAvailable: isManageWorkareaAvailableFromRuntimeSettings(runtimeSettings),
      projectContext,
    });
  }

  return createGpuiQuickProjectlessPayload();
}

function createGpuiProjectPayloadFromActiveGroup({
  activeGroupTitle,
  isManageAvailable,
  projectContext,
}: {
  activeGroupTitle: string;
  isManageAvailable: boolean;
  projectContext: ExplicitSidebarProjectContext | ExplicitLiveSidebarProjectContext;
}): GpuiSidebarActiveProjectContextPayload {
  const editorProjectId = explicitEditorProjectId(projectContext);

  if (editorProjectId === null) {
    return createGpuiQuickProjectlessPayload();
  }

  return {
    version: 1,
    type: "ghostex.gpui.sidebar.activeProjectContext",
    activeProject: {
      activeProjectId: editorProjectId,
      displayName: activeGroupTitle,
      projectPath: explicitInMemoryProjectPath(projectContext),
      isQuickProjectless: false,
      workareaAvailability: {
        source: true,
        browser: true,
        kanban: true,
        manage: isManageAvailable,
      },
      surfaceIds: explicitProjectSurfaceIds(editorProjectId, isManageAvailable),
    },
  };
}

function createGpuiQuickProjectlessPayload(): GpuiSidebarActiveProjectContextPayload {
  return {
    version: 1,
    type: "ghostex.gpui.sidebar.activeProjectContext",
    activeProject: {
      activeProjectId: null,
      displayName: "Quick",
      projectPath: null,
      isQuickProjectless: true,
      workareaAvailability: {
        source: true,
        browser: false,
        kanban: false,
        manage: false,
      },
      surfaceIds: createGpuiSidebarActiveProjectSurfaceIds(),
    },
  };
}

function explicitInMemoryProjectPath(
  projectContext: ExplicitSidebarProjectContext | ExplicitLiveSidebarProjectContext,
): string | null {
  const projectPath = (projectContext as { path?: unknown }).path;

  if (typeof projectPath !== "string" || projectPath.trim().length === 0) {
    return null;
  }

  return projectPath;
}

function explicitEditorProjectId(
  projectContext: ExplicitSidebarProjectContext | ExplicitLiveSidebarProjectContext,
): string | null {
  const projectId = (projectContext as { editor?: { projectId?: unknown } }).editor
    ?.projectId;

  if (typeof projectId !== "string" || projectId.trim().length === 0) {
    return null;
  }

  return projectId;
}

function explicitProjectSurfaceIds(
  editorProjectId: string,
  manageAvailable: boolean,
): GpuiSidebarActiveProjectSurfaceIds {
  return createGpuiSidebarActiveProjectSurfaceIds({
    sourceWorkareaId: editorProjectId,
    kanbanBoardId: nativeProjectEditorSurfaceId(editorProjectId, "tasks"),
    manageWorkspaceId: manageAvailable
      ? nativeProjectEditorSurfaceId(editorProjectId, "manage")
      : undefined,
  });
}

function nativeProjectEditorSurfaceId(
  projectId: string,
  mode: "tasks" | "manage",
): string {
  return `project-editor:${encodeURIComponent(projectId)}:${mode}`;
}

function isManageWorkareaAvailable(
  workspace: SidebarStoryWorkspace,
  runtimeSettings?: GpuiSidebarRuntimeSettings,
): boolean {
  if (runtimeSettings !== undefined) {
    return isManageWorkareaAvailableFromRuntimeSettings(runtimeSettings);
  }

  return (
    workspace.options.debuggingMode === true &&
    workspace.options.settings?.showBetaFeatures === true
  );
}

function isManageWorkareaAvailableFromRuntimeSettings(
  runtimeSettings?: GpuiSidebarRuntimeSettings,
): boolean {
  return (
    runtimeSettings?.debuggingMode === true &&
    runtimeSettings?.showBetaFeatures === true
  );
}
