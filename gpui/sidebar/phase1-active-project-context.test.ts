import { describe, expect, test } from "vitest";
import type { SidebarStoryArgs } from "../../sidebar/sidebar-story-fixtures";
import { createSidebarStoryMessage } from "../../sidebar/sidebar-story-fixtures";
import {
  createSidebarStoryWorkspace,
  type SidebarStoryWorkspace,
} from "../../sidebar/sidebar-story-workspace";
import {
  createGpuiSidebarActiveProjectContextPayload,
  createGpuiSidebarActiveProjectSurfaceIds,
  type GpuiSidebarActiveProjectSurfaceIds,
} from "./phase1-active-project-context";

const DEFAULT_STORY_ARGS = {
  createSessionOnSidebarDoubleClick: false,
  debuggingMode: false,
  fixture: "combined-sparse-reference",
  highlightedVisibleCount: 1,
  isFocusModeActive: false,
  renameSessionOnDoubleClick: false,
  showCloseButtonOnSessionCards: false,
  showSessionCloseContextMenuAction: true,
  showSessionCommandCopyActions: true,
  showSessionDetailsCopyAction: true,
  theme: "plain-dark",
  viewMode: "grid",
  visibleCount: 1,
} satisfies SidebarStoryArgs;

const CHAT_GROUP_ID = "combined-sparse-chats";
const PROJECT_GROUP_ID = "combined-sparse-project-ghostex";
const PROJECT_PATH = "/Users/story/dev/combined-sparse-project-ghostex";

describe("createGpuiSidebarActiveProjectContextPayload", () => {
  test("active chat collection becomes Quick/projectless even with project metadata", () => {
    const workspace = createCombinedSparseWorkspace();
    const projectContext = workspace.groupMetadataById[PROJECT_GROUP_ID]?.projectContext;
    const chatWorkspace = withGroupMetadata(
      withActiveGroup(workspace, CHAT_GROUP_ID),
      CHAT_GROUP_ID,
      {
        ...workspace.groupMetadataById[CHAT_GROUP_ID],
        isChatCollection: true,
        projectContext,
      },
    );

    expect(createGpuiSidebarActiveProjectContextPayload(chatWorkspace)).toEqual(
      createQuickPayload(),
    );
  });

  test("active explicit project group includes explicit projectContext.path with Manage unavailable by default", () => {
    const workspace = withActiveGroup(createCombinedSparseWorkspace(), PROJECT_GROUP_ID);

    expect(createGpuiSidebarActiveProjectContextPayload(workspace)).toEqual(
      createProjectPayload(),
    );
  });

  test("active explicit project passes non-empty projectContext.path through unchanged", () => {
    const explicitPath = "  /Users/story/dev/path-keeps-boundary  ";
    const workspace = withProjectContextPath(
      withActiveGroup(createCombinedSparseWorkspace(), PROJECT_GROUP_ID),
      explicitPath,
    );

    expect(createGpuiSidebarActiveProjectContextPayload(workspace)).toEqual(
      createProjectPayload({ projectPath: explicitPath }),
    );
  });

  test("active explicit project uses editor project id as Source workarea id", () => {
    const explicitEditorProjectId = "explicit-source-workarea-7f4d";
    const workspace = withProjectEditorProjectId(
      withActiveGroup(createCombinedSparseWorkspace(), PROJECT_GROUP_ID),
      explicitEditorProjectId,
    );

    expect(createGpuiSidebarActiveProjectContextPayload(workspace)).toEqual(
      createProjectPayload({
        activeProjectId: explicitEditorProjectId,
        sourceWorkareaId: explicitEditorProjectId,
      }),
    );
  });

  test("native-derived Kanban and Manage ids encode explicit editor project ids", () => {
    const explicitEditorProjectId = "project:with/slash";
    const workspace = withProjectEditorProjectId(
      withActiveGroup(createCombinedSparseWorkspace(), PROJECT_GROUP_ID),
      explicitEditorProjectId,
    );

    expect(
      createGpuiSidebarActiveProjectContextPayload(workspace, {
        debuggingMode: true,
        showBetaFeatures: true,
      }),
    ).toEqual(
      createProjectPayload({
        activeProjectId: explicitEditorProjectId,
        sourceWorkareaId: explicitEditorProjectId,
        kanbanBoardId: "project-editor:project%3Awith%2Fslash:tasks",
        manage: true,
        manageWorkspaceId: "project-editor:project%3Awith%2Fslash:manage",
      }),
    );
  });

  test("surface-id helper and generated project payloads exclude Browser identity", () => {
    const browserSurfaceIdRejected: (
      { browserWorkareaId: string } extends GpuiSidebarActiveProjectSurfaceIds
        ? false
        : true
    ) = true;
    const workspace = withActiveGroup(createCombinedSparseWorkspace(), PROJECT_GROUP_ID);
    const payload = createGpuiSidebarActiveProjectContextPayload(workspace, {
      debuggingMode: true,
      showBetaFeatures: true,
    });
    const helperSurfaceIds = createGpuiSidebarActiveProjectSurfaceIds({
      sourceWorkareaId: PROJECT_GROUP_ID,
      kanbanBoardId: nativeProjectEditorSurfaceId(PROJECT_GROUP_ID, "tasks"),
      manageWorkspaceId: nativeProjectEditorSurfaceId(PROJECT_GROUP_ID, "manage"),
    });

    expect(browserSurfaceIdRejected).toBe(true);
    expect(payload.activeProject.workareaAvailability.browser).toBe(true);
    expect(payload.activeProject.workareaAvailability.manage).toBe(true);
    expect(payload.activeProject.surfaceIds).toEqual(helperSurfaceIds);
    expect(payload.activeProject.surfaceIds).not.toHaveProperty("browserWorkareaId");
    expect(helperSurfaceIds).not.toHaveProperty("browserWorkareaId");
  });

  test("empty, missing, or malformed projectContext.path stays null without losing the project payload", () => {
    const workspace = withActiveGroup(createCombinedSparseWorkspace(), PROJECT_GROUP_ID);
    const projectContext = projectContextFor(workspace);
    const projectContextWithoutPath: Partial<typeof projectContext> = { ...projectContext };
    delete projectContextWithoutPath.path;

    const invalidProjectContexts = [
      { ...projectContext, path: "" },
      { ...projectContext, path: "   " },
      projectContextWithoutPath as typeof projectContext,
      { ...projectContext, path: 42 as unknown as string },
    ];

    for (const invalidProjectContext of invalidProjectContexts) {
      const invalidPathWorkspace = withProjectContext(workspace, invalidProjectContext);

      expect(createGpuiSidebarActiveProjectContextPayload(invalidPathWorkspace)).toEqual(
        createProjectPayload({ projectPath: null }),
      );
    }
  });

  test("missing, empty, or malformed editor project id falls back to Quick without Source workarea id", () => {
    const workspace = withActiveGroup(createCombinedSparseWorkspace(), PROJECT_GROUP_ID);
    const projectContext = projectContextFor(workspace);
    const projectContextWithoutProjectId = {
      ...projectContext,
      editor: { ...projectContext.editor },
    };
    delete (projectContextWithoutProjectId.editor as { projectId?: unknown }).projectId;
    const projectContextWithoutEditor: Partial<typeof projectContext> = { ...projectContext };
    delete (projectContextWithoutEditor as { editor?: unknown }).editor;

    const invalidProjectContexts = [
      {
        ...projectContext,
        editor: { ...projectContext.editor, projectId: "" },
      },
      {
        ...projectContext,
        editor: { ...projectContext.editor, projectId: "   " },
      },
      projectContextWithoutProjectId as typeof projectContext,
      projectContextWithoutEditor as typeof projectContext,
      {
        ...projectContext,
        editor: { ...projectContext.editor, projectId: 42 as unknown as string },
      },
    ];

    for (const invalidProjectContext of invalidProjectContexts) {
      const invalidProjectIdWorkspace = withProjectContext(
        workspace,
        invalidProjectContext,
      );

      expect(createGpuiSidebarActiveProjectContextPayload(invalidProjectIdWorkspace)).toEqual(
        createQuickPayload(),
      );
    }
  });

  test("active explicit project enables Manage only when both strict gates are boolean true", () => {
    const baseWorkspace = withActiveGroup(createCombinedSparseWorkspace(), PROJECT_GROUP_ID);
    const workspace = withWorkspaceOptions(baseWorkspace, {
      debuggingMode: true,
      settings: {
        ...baseWorkspace.options.settings!,
        debuggingMode: true,
        showBetaFeatures: true,
      },
    });

    expect(createGpuiSidebarActiveProjectContextPayload(workspace)).toEqual(
      createProjectPayload({ manage: true }),
    );
  });

  test("active explicit project can enable Manage from explicit runtime settings", () => {
    const workspace = withActiveGroup(createCombinedSparseWorkspace(), PROJECT_GROUP_ID);

    expect(
      createGpuiSidebarActiveProjectContextPayload(workspace, {
        debuggingMode: true,
        showBetaFeatures: true,
      }),
    ).toEqual(createProjectPayload({ manage: true }));
  });

  test("explicit runtime settings take precedence over stale workspace settings", () => {
    const baseWorkspace = withActiveGroup(createCombinedSparseWorkspace(), PROJECT_GROUP_ID);
    const workspace = withWorkspaceOptions(baseWorkspace, {
      debuggingMode: true,
      settings: {
        ...baseWorkspace.options.settings!,
        debuggingMode: true,
        showBetaFeatures: true,
      },
    });

    expect(
      createGpuiSidebarActiveProjectContextPayload(workspace, {
        debuggingMode: false,
        showBetaFeatures: true,
      }),
    ).toEqual(createProjectPayload());
  });

  test("active explicit project keeps Manage unavailable when either strict gate is missing", () => {
    const baseWorkspace = withActiveGroup(createCombinedSparseWorkspace(), PROJECT_GROUP_ID);
    const betaOnlyWorkspace = withWorkspaceOptions(baseWorkspace, {
      debuggingMode: false,
      settings: {
        ...baseWorkspace.options.settings!,
        showBetaFeatures: true,
      },
    });
    const missingSettingsWorkspace = withoutWorkspaceSettings(
      withWorkspaceOptions(baseWorkspace, {
        debuggingMode: true,
      }),
    );
    const missingBetaFlagWorkspace = withWorkspaceOptions(baseWorkspace, {
      debuggingMode: true,
      settings: {
        ...baseWorkspace.options.settings!,
        showBetaFeatures: undefined as unknown as boolean,
      },
    });

    expect(createGpuiSidebarActiveProjectContextPayload(betaOnlyWorkspace)).toEqual(
      createProjectPayload(),
    );
    expect(createGpuiSidebarActiveProjectContextPayload(missingSettingsWorkspace)).toEqual(
      createProjectPayload(),
    );
    expect(createGpuiSidebarActiveProjectContextPayload(missingBetaFlagWorkspace)).toEqual(
      createProjectPayload(),
    );
    expect(
      createGpuiSidebarActiveProjectContextPayload(baseWorkspace, {
        showBetaFeatures: true,
      }),
    ).toEqual(createProjectPayload());
    expect(
      createGpuiSidebarActiveProjectContextPayload(baseWorkspace, {
        debuggingMode: true,
      }),
    ).toEqual(createProjectPayload());
  });

  test("active explicit project keeps Manage unavailable for string-like truthy gates", () => {
    const baseWorkspace = withActiveGroup(createCombinedSparseWorkspace(), PROJECT_GROUP_ID);
    const stringBetaWorkspace = withWorkspaceOptions(baseWorkspace, {
      debuggingMode: true,
      settings: {
        ...baseWorkspace.options.settings!,
        showBetaFeatures: "true" as unknown as boolean,
      },
    });
    const stringDebugWorkspace = withWorkspaceOptions(baseWorkspace, {
      debuggingMode: "true" as unknown as boolean,
      settings: {
        ...baseWorkspace.options.settings!,
        showBetaFeatures: true,
      },
    });

    expect(createGpuiSidebarActiveProjectContextPayload(stringBetaWorkspace)).toEqual(
      createProjectPayload(),
    );
    expect(createGpuiSidebarActiveProjectContextPayload(stringDebugWorkspace)).toEqual(
      createProjectPayload(),
    );
    expect(
      createGpuiSidebarActiveProjectContextPayload(baseWorkspace, {
        debuggingMode: true,
        showBetaFeatures: "true",
      }),
    ).toEqual(createProjectPayload());
    expect(
      createGpuiSidebarActiveProjectContextPayload(baseWorkspace, {
        debuggingMode: "true",
        showBetaFeatures: true,
      }),
    ).toEqual(createProjectPayload());
  });

  test("active explicit project keeps Manage unavailable for malformed runtime settings", () => {
    const baseWorkspace = withActiveGroup(createCombinedSparseWorkspace(), PROJECT_GROUP_ID);

    expect(
      createGpuiSidebarActiveProjectContextPayload(baseWorkspace, {
        debuggingMode: 1,
        showBetaFeatures: true,
      }),
    ).toEqual(createProjectPayload());
    expect(
      createGpuiSidebarActiveProjectContextPayload(baseWorkspace, {
        debuggingMode: true,
        showBetaFeatures: 1,
      }),
    ).toEqual(createProjectPayload());
    expect(
      createGpuiSidebarActiveProjectContextPayload(baseWorkspace, {
        debuggingMode: null,
        showBetaFeatures: true,
      }),
    ).toEqual(createProjectPayload());
  });

  test("Quick/projectless payload keeps Manage unavailable with runtime settings enabled", () => {
    const workspace = withActiveGroup(createCombinedSparseWorkspace(), CHAT_GROUP_ID);

    expect(
      createGpuiSidebarActiveProjectContextPayload(workspace, {
        debuggingMode: true,
        showBetaFeatures: true,
      }),
    ).toEqual(createQuickPayload());
  });

  test("project group title alone does not create a project payload", () => {
    const workspace = createCombinedSparseWorkspace();
    const titleOnlyWorkspace = withGroupMetadata(
      withActiveGroup(workspace, PROJECT_GROUP_ID),
      PROJECT_GROUP_ID,
      {
        ...workspace.groupMetadataById[PROJECT_GROUP_ID],
        projectContext: undefined,
      },
    );

    expect(createGpuiSidebarActiveProjectContextPayload(titleOnlyWorkspace)).toEqual(
      createQuickPayload(),
    );
  });

  test("active explicit project includes Source and native-derived Kanban surface ids", () => {
    const workspace = withActiveGroup(createCombinedSparseWorkspace(), PROJECT_GROUP_ID);
    const payload = createGpuiSidebarActiveProjectContextPayload(workspace);

    expect(payload.activeProject.surfaceIds).toEqual({
      sourceWorkareaId: PROJECT_GROUP_ID,
      kanbanBoardId: nativeProjectEditorSurfaceId(PROJECT_GROUP_ID, "tasks"),
    });
    expect(payload.activeProject.surfaceIds).not.toHaveProperty("browserWorkareaId");
    expect(payload.activeProject.surfaceIds).not.toHaveProperty("manageWorkspaceId");
  });

  test("active explicit project includes native-derived Manage surface id only when Manage is available", () => {
    const baseWorkspace = withActiveGroup(createCombinedSparseWorkspace(), PROJECT_GROUP_ID);
    const availableWorkspace = withWorkspaceOptions(baseWorkspace, {
      debuggingMode: true,
      settings: {
        ...baseWorkspace.options.settings!,
        debuggingMode: true,
        showBetaFeatures: true,
      },
    });

    expect(
      createGpuiSidebarActiveProjectContextPayload(baseWorkspace).activeProject.surfaceIds,
    ).toEqual({
      sourceWorkareaId: PROJECT_GROUP_ID,
      kanbanBoardId: nativeProjectEditorSurfaceId(PROJECT_GROUP_ID, "tasks"),
    });
    expect(
      createGpuiSidebarActiveProjectContextPayload(availableWorkspace).activeProject
        .surfaceIds,
    ).toEqual({
      sourceWorkareaId: PROJECT_GROUP_ID,
      kanbanBoardId: nativeProjectEditorSurfaceId(PROJECT_GROUP_ID, "tasks"),
      manageWorkspaceId: nativeProjectEditorSurfaceId(PROJECT_GROUP_ID, "manage"),
    });
  });
});

function createCombinedSparseWorkspace(): SidebarStoryWorkspace {
  return createSidebarStoryWorkspace(createSidebarStoryMessage(DEFAULT_STORY_ARGS));
}

function withActiveGroup(
  workspace: SidebarStoryWorkspace,
  activeGroupId: string,
): SidebarStoryWorkspace {
  return {
    ...workspace,
    snapshot: {
      ...workspace.snapshot,
      activeGroupId,
    },
  };
}

function withGroupMetadata(
  workspace: SidebarStoryWorkspace,
  groupId: string,
  metadata: SidebarStoryWorkspace["groupMetadataById"][string],
): SidebarStoryWorkspace {
  return {
    ...workspace,
    groupMetadataById: {
      ...workspace.groupMetadataById,
      [groupId]: metadata,
    },
  };
}

function projectContextFor(
  workspace: SidebarStoryWorkspace,
): NonNullable<SidebarStoryWorkspace["groupMetadataById"][string]["projectContext"]> {
  const projectContext = workspace.groupMetadataById[PROJECT_GROUP_ID]?.projectContext;

  if (!projectContext) {
    throw new Error("Expected combined sparse project context in test fixture");
  }

  return projectContext;
}

function withProjectContext(
  workspace: SidebarStoryWorkspace,
  projectContext: NonNullable<
    SidebarStoryWorkspace["groupMetadataById"][string]["projectContext"]
  >,
): SidebarStoryWorkspace {
  const metadata = workspace.groupMetadataById[PROJECT_GROUP_ID];

  if (!metadata) {
    throw new Error("Expected combined sparse project metadata in test fixture");
  }

  return withGroupMetadata(workspace, PROJECT_GROUP_ID, {
    ...metadata,
    projectContext,
  });
}

function withProjectContextPath(
  workspace: SidebarStoryWorkspace,
  projectPath: string,
): SidebarStoryWorkspace {
  return withProjectContext(workspace, {
    ...projectContextFor(workspace),
    path: projectPath,
  });
}

function withProjectEditorProjectId(
  workspace: SidebarStoryWorkspace,
  projectId: string,
): SidebarStoryWorkspace {
  const projectContext = projectContextFor(workspace);

  return withProjectContext(workspace, {
    ...projectContext,
    editor: {
      ...projectContext.editor,
      projectId,
    },
  });
}

function withWorkspaceOptions(
  workspace: SidebarStoryWorkspace,
  options: Partial<SidebarStoryWorkspace["options"]>,
): SidebarStoryWorkspace {
  return {
    ...workspace,
    options: {
      ...workspace.options,
      ...options,
    },
  };
}

function withoutWorkspaceSettings(workspace: SidebarStoryWorkspace): SidebarStoryWorkspace {
  const { settings: _settings, ...options } = workspace.options;

  return {
    ...workspace,
    options,
  };
}

function createProjectPayload({
  activeProjectId = PROJECT_GROUP_ID,
  manage = false,
  projectPath = PROJECT_PATH,
  sourceWorkareaId = PROJECT_GROUP_ID,
  kanbanBoardId = nativeProjectEditorSurfaceId(activeProjectId, "tasks"),
  manageWorkspaceId = manage
    ? nativeProjectEditorSurfaceId(activeProjectId, "manage")
    : undefined,
}: {
  activeProjectId?: string;
  manage?: boolean;
  projectPath?: string | null;
  sourceWorkareaId?: string;
  kanbanBoardId?: string;
  manageWorkspaceId?: string;
} = {}) {
  const surfaceIds: {
    sourceWorkareaId: string;
    kanbanBoardId: string;
    manageWorkspaceId?: string;
  } = {
    sourceWorkareaId,
    kanbanBoardId,
  };
  if (manageWorkspaceId !== undefined) {
    surfaceIds.manageWorkspaceId = manageWorkspaceId;
  }

  return {
    version: 1,
    type: "ghostex.gpui.sidebar.activeProjectContext",
    activeProject: {
      activeProjectId,
      displayName: "ghostex",
      projectPath,
      isQuickProjectless: false,
      workareaAvailability: {
        source: true,
        browser: true,
        kanban: true,
        manage,
      },
      surfaceIds,
    },
  };
}

function createQuickPayload() {
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
      surfaceIds: {},
    },
  };
}

function nativeProjectEditorSurfaceId(
  projectId: string,
  mode: "tasks" | "manage",
): string {
  return `project-editor:${encodeURIComponent(projectId)}:${mode}`;
}
