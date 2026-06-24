import type { SidebarStoryWorkspace } from "../../sidebar/sidebar-story-workspace";

type ExplicitSidebarProjectContext = NonNullable<
  SidebarStoryWorkspace["groupMetadataById"][string]["projectContext"]
>;

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
  showBetaFeatures?: unknown;
};

export type GpuiSidebarRuntimeSettingsSnapshot = {
  debuggingMode: boolean;
  showBetaFeatures: boolean;
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
 * Manage availability in the GPUI sidebar CEF payload must prefer the narrow runtime settings snapshot installed by Rust from the shared sidebar settings source. The snapshot may contain only debuggingMode and showBetaFeatures, and both must be strict boolean true; missing, malformed, string-like truthy, Quick/projectless, workspace-default, path/name/project, and filesystem heuristics must not enable Manage.
 *
 * CDXC:GPUIProjectSidebarBridge 2026-06-23-06:57:
 * Runtime refresh callbacks use the same two-boolean snapshot shape as initial CEF install. Keep the payload helper strict so refreshed Manage availability changes only from explicit debuggingMode and showBetaFeatures booleans, not stale workspace options or inferred project/path state.
 *
 * CDXC:GPUIProjectSidebarBridge 2026-06-23-06:46:
 * The active-project projectPath field is an allowlisted in-memory contract value sourced only from explicit SidebarStoryWorkspace projectContext.path metadata. Keep missing, non-string, and trim-empty paths as null so Rust keeps the project payload instead of rejecting it; pass a valid non-empty explicit string through unchanged, and do not log or persist it.
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
    const editorProjectId = explicitEditorProjectId(projectContext);

    if (editorProjectId === null) {
      return createGpuiQuickProjectlessPayload();
    }
    const manageAvailable = isManageWorkareaAvailable(workspace, runtimeSettings);

    return {
      version: 1,
      type: "ghostex.gpui.sidebar.activeProjectContext",
      activeProject: {
        activeProjectId: editorProjectId,
        displayName: activeGroup.title,
        projectPath: explicitInMemoryProjectPath(projectContext),
        isQuickProjectless: false,
        workareaAvailability: {
          source: true,
          browser: true,
          kanban: true,
          manage: manageAvailable,
        },
        surfaceIds: explicitProjectSurfaceIds(editorProjectId, manageAvailable),
      },
    };
  }

  return createGpuiQuickProjectlessPayload();
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

function explicitInMemoryProjectPath(projectContext: ExplicitSidebarProjectContext): string | null {
  const projectPath = (projectContext as { path?: unknown }).path;

  if (typeof projectPath !== "string" || projectPath.trim().length === 0) {
    return null;
  }

  return projectPath;
}

function explicitEditorProjectId(
  projectContext: ExplicitSidebarProjectContext,
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
    return (
      runtimeSettings.debuggingMode === true &&
      runtimeSettings.showBetaFeatures === true
    );
  }

  return (
    workspace.options.debuggingMode === true &&
    workspace.options.settings?.showBetaFeatures === true
  );
}
