import { afterEach, describe, expect, test, vi } from "vitest";
import {
  GXSERVER_PROTOCOL_VERSION,
  type GxserverAppUserData,
  type GxserverPresentationGroup,
  type GxserverPresentationProject,
  type GxserverPresentationSession,
  type GxserverPresentationSnapshot,
  type GxserverProjectDomainState,
  type GxserverProjectId,
  type GxserverSessionId,
  type GxserverRecentProjectDomainState,
  type GxserverSidebarHudResponse,
} from "../../shared/gxserver-protocol";
import {
  createGxserverPresentationProjectGroupId,
  createGxserverPresentationProjectSessionId,
} from "../../shared/gxserver-presentation-sidebar-projection";
import type { SidebarCommandButton } from "../../shared/sidebar-commands";
import {
  createGpuiSidebarRuntime,
  createGpuiSidebarCommandSessionIndicators,
  createGpuiPetOverlayStatePayload,
  createGpuiSessionStatusIndicatorCandidatesFromSidebarGroups,
  createGpuiSessionStatusIndicatorsPayload,
  type GpuiCommandPaneSessionSummary,
  type GpuiSidebarRuntimeSettings,
} from "./phase1-gxserver-runtime";
import { DEFAULT_ghostex_SETTINGS } from "../../shared/ghostex-settings";
import type {
  SidebarSessionGroup,
  SidebarSessionItem,
  SidebarToExtensionMessage,
} from "../../shared/session-grid-contract";
import { createDefaultSidebarProjectDiffStats } from "../../shared/project-diff-stats";

const BASE_COMMAND = {
  closeTerminalOnExit: false,
  icon: "terminal",
  isDefault: false,
  playCompletionSound: true,
} satisfies Pick<
  SidebarCommandButton,
  "closeTerminalOnExit" | "icon" | "isDefault" | "playCompletionSound"
>;

type RunSidebarCommandMessage = Extract<
  SidebarToExtensionMessage,
  { type: "runSidebarCommand" }
>;

const RUN_SIDEBAR_COMMAND_SELECTION_KEYS = {
  commandId: true,
  runMode: true,
  type: true,
} satisfies Record<keyof RunSidebarCommandMessage, true>;

afterEach(async () => {
  await new Promise((resolve) => setTimeout(resolve, 0));
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("createGpuiSidebarCommandSessionIndicators", () => {
  test("matches terminal Actions by command id first and normalized title second", () => {
    const commands: SidebarCommandButton[] = [
      {
        ...BASE_COMMAND,
        actionType: "terminal",
        command: "npm run build",
        commandId: "build",
        name: "Build",
      },
      {
        ...BASE_COMMAND,
        actionType: "terminal",
        command: "12345678901234567890with-extra-command-text",
        commandId: "unnamed",
        name: "",
      },
      {
        ...BASE_COMMAND,
        actionType: "terminal",
        command: "npm run deploy",
        commandId: "deploy",
        name: "Deploy",
      },
      {
        ...BASE_COMMAND,
        actionType: "browser",
        commandId: "docs",
        name: "Docs",
        url: "https://example.invalid/docs",
      },
    ];
    const sessions: GpuiCommandPaneSessionSummary[] = [
      {
        commandId: "old-build",
        sessionId: "session-build",
        status: "idle",
        title: "  build  ",
      },
      {
        commandId: "unnamed",
        isActive: true,
        sessionId: "session-unnamed",
        status: "running",
        title: "12345678901234567890",
      },
      {
        sessionId: "session-deploy-title-only",
        status: "idle",
        title: "Deploy",
      },
      {
        commandId: "deploy",
        sessionId: "session-deploy-exact",
        status: "error",
        title: "Deploy",
      },
      {
        commandId: "docs",
        sessionId: "session-docs",
        status: "running",
        title: "Docs",
      },
    ];

    expect(createGpuiSidebarCommandSessionIndicators(commands, sessions)).toEqual([
      {
        commandId: "build",
        isActive: false,
        sessionId: "session-build",
        status: "idle",
        title: "  build  ",
      },
      {
        commandId: "unnamed",
        isActive: true,
        sessionId: "session-unnamed",
        status: "running",
        title: "12345678901234567890",
      },
      {
        commandId: "deploy",
        isActive: false,
        sessionId: "session-deploy-exact",
        status: "error",
        title: "Deploy",
      },
    ]);
  });
});

describe("GPUI status indicator and pet overlay payloads", () => {
  test("counts only live zmx-backed idle sessions and carries settings fan-out", () => {
    /*
    CDXC:GPUIStatusPetOverlay 2026-06-26-04:38:
    Status/pet TypeScript coverage pins the GPUI candidate fan-out to live SidebarApp groups and saved shared Settings. Idle/available counts require live zmx terminal backing, while bridge payloads stay bounded to counts, booleans, size, pet id, project/session ids, order, and short titles without paths, URLs, commands, terminal output, or generic IPC fields.
    */
    const group = createStatusTestGroup([
      createStatusTestSession("P1alpha:attention-1", {
        activity: "attention",
        displayTitle: "Needs Review",
        lastInteractionAt: "2026-06-26T01:00:00.000Z",
      }),
      createStatusTestSession("P1alpha:idle-live", {
        displayTitle: "Idle Live",
        lastInteractionAt: "2026-06-26T00:30:00.000Z",
        providerSessionState: "exists",
      }),
      createStatusTestSession("P1alpha:idle-stale", {
        displayTitle: "Idle Stale",
        isLive: false,
        nativePaneState: "unmounted",
        providerSessionState: "missing",
      }),
      createStatusTestSession("P1alpha:working-1", {
        activity: "working",
        displayTitle: "Working",
        lastInteractionAt: "2026-06-26T00:45:00.000Z",
        sessionKind: "terminal",
      }),
    ]);
    const settings = {
      ...DEFAULT_ghostex_SETTINGS,
      hideFloatingSessionStatusIndicators: true,
      hideMenuBarSessionStatusIndicators: false,
      petOverlayEnabled: true,
      selectedPetId: DEFAULT_ghostex_SETTINGS.selectedPetId,
      sessionStatusIndicatorSize: "large",
    } satisfies typeof DEFAULT_ghostex_SETTINGS;

    const candidates = createGpuiSessionStatusIndicatorCandidatesFromSidebarGroups([group]);
    const statusPayload = createGpuiSessionStatusIndicatorsPayload(candidates, settings);
    const petPayload = createGpuiPetOverlayStatePayload(candidates, settings);

    expect(statusPayload).toMatchObject({
      attentionCount: 1,
      availableCount: 1,
      hideFloatingIndicators: true,
      hideMenuBarIndicators: false,
      size: "large",
      workingCount: 1,
    });
    expect(statusPayload.projects).toEqual([
      {
        projectId: "P1alpha",
        sessions: [
          expect.objectContaining({
            sessionId: "P1alpha:attention-1",
            status: "attention",
            title: "Needs Review",
          }),
          expect.objectContaining({
            sessionId: "P1alpha:working-1",
            status: "working",
            title: "Working",
          }),
          expect.objectContaining({
            sessionId: "P1alpha:idle-live",
            status: "available",
            title: "Idle Live",
          }),
        ],
        title: "Alpha",
      },
    ]);
    expect(JSON.stringify(statusPayload)).not.toContain("Idle Stale");
    expect(petPayload).toMatchObject({
      enabled: true,
      selectedPetId: DEFAULT_ghostex_SETTINGS.selectedPetId,
      statusItems: [
        { count: 1, status: "attention" },
        { count: 1, status: "working" },
      ],
    });
    expect(petPayload.activities.map((activity) => activity.id)).toEqual([
      "P1alpha:attention-1",
      "P1alpha:working-1",
    ]);
  });
});

describe("createGpuiSidebarRuntime command-action bridge", () => {
  test("forces terminal Action runtime messages to keep command panes open", async () => {
    /*
    CDXC:GPUICommandPane 2026-06-26-05:11:
    GPUI runtime bridge coverage must prove `runSidebarCommand` is only command id plus optional runMode, hydrated HUD commands may still preserve saved close-on-exit metadata, and terminal Action launch payloads force `closeTerminalOnExit:false` so reusable command-pane tabs match native parity. Browser Actions still omit the terminal-only field, and command text, URLs, cwd/env, paths, terminal output, and logs stay resolved from trusted HUD state.
    */
    const alpha = createTestDomainProject("P1alpha", "Alpha");
    const commandActionPayloads: unknown[] = [];
    installGpuiRuntimeTestHost({
      commandActionPayloads,
      initialActiveProjectId: alpha.projectId,
      projects: [alpha],
      sidebarCommands: [
        {
          ...BASE_COMMAND,
          actionType: "terminal",
          closeTerminalOnExit: true,
          command: "npm run build",
          commandId: "build",
          name: "Build",
        },
        {
          ...BASE_COMMAND,
          actionType: "browser",
          commandId: "docs",
          name: "Docs",
          url: "https://example.invalid/docs",
        },
      ],
      snapshot: createTestPresentationSnapshot([alpha]),
    });

    const { messageSource, start, vscode } = createGpuiSidebarRuntime();
    const messages: unknown[] = [];
    messageSource.addEventListener("message", (event) => {
      messages.push((event as MessageEvent).data);
    });

    start();
    await waitForMessage(messages, (message) =>
      isMessageOfType(message, "hydrate") &&
      message.hud.commands.some((command: SidebarCommandButton) =>
        command.commandId === "build" &&
        command.command === "npm run build" &&
        command.closeTerminalOnExit === true,
      ),
    );

    const runBuildMessage = {
      commandId: "build",
      runMode: "debug",
      type: "runSidebarCommand",
    } satisfies RunSidebarCommandMessage;
    const runDocsMessage = {
      commandId: "docs",
      type: "runSidebarCommand",
    } satisfies RunSidebarCommandMessage;

    expect(Object.keys(RUN_SIDEBAR_COMMAND_SELECTION_KEYS).sort()).toEqual([
      "commandId",
      "runMode",
      "type",
    ]);
    expect(runBuildMessage).not.toHaveProperty("closeTerminalOnExit");
    vscode.postMessage(runBuildMessage as never);
    vscode.postMessage(runDocsMessage as never);
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(commandActionPayloads).toEqual([
      expect.objectContaining({
        actionType: "terminal",
        closeTerminalOnExit: false,
        command: "npm run build",
        commandId: "build",
        name: "Build",
        playCompletionSound: true,
        runMode: "debug",
      }),
      expect.not.objectContaining({
        closeTerminalOnExit: expect.any(Boolean),
      }),
    ]);
    expect(commandActionPayloads[1]).toEqual(expect.objectContaining({
      actionType: "browser",
      commandId: "docs",
      name: "Docs",
      url: "https://example.invalid/docs",
    }));
  });

  test("rejects malformed command-pane selectors before bridge payloads", async () => {
    /*
    CDXC:GPUICommandPane 2026-06-26-05:22:
    Malformed runtime messages with missing, non-string, or blank command ids must go through the unsupported-message no-op path before command Action lookup or run-end bridge payload construction, even when the renderer object carries unsafe launch fields such as command text, URLs, cwd/env, paths, logs, or output.
    */
    const alpha = createTestDomainProject("P1alpha", "Alpha");
    const appModalHostMessages: unknown[] = [];
    const commandActionPayloads: unknown[] = [];
    const commandRunEndPayloads: unknown[] = [];
    installGpuiRuntimeTestHost({
      appModalHostMessages,
      commandActionPayloads,
      commandRunEndPayloads,
      initialActiveProjectId: alpha.projectId,
      projects: [alpha],
      sidebarCommands: [
        {
          ...BASE_COMMAND,
          actionType: "terminal",
          command: "npm run build",
          commandId: "build",
          name: "Build",
        },
      ],
      snapshot: createTestPresentationSnapshot([alpha]),
    });

    const { messageSource, start, vscode } = createGpuiSidebarRuntime();
    const messages: unknown[] = [];
    messageSource.addEventListener("message", (event) => {
      messages.push((event as MessageEvent).data);
    });

    start();
    await waitForMessage(messages, (message) => isMessageOfType(message, "hydrate"));

    const unsafeFields = {
      closeTerminalOnExit: true,
      command: "echo should-not-forward",
      cwd: "/Users/private/project",
      env: { TOKEN: "should-not-forward" },
      logs: "raw log text",
      output: "raw terminal output",
      url: "https://example.invalid/private?token=secret",
      worktreePath: "/Users/private/project-worktree",
    };
    const malformedMessages: unknown[] = [
      { ...unsafeFields, type: "runSidebarCommand" },
      { ...unsafeFields, commandId: 123, runMode: "debug", type: "runSidebarCommand" },
      { ...unsafeFields, commandId: "   ", runMode: "debug", type: "runSidebarCommand" },
      { ...unsafeFields, type: "endSidebarCommandRun" },
      { ...unsafeFields, commandId: { value: "build" }, type: "endSidebarCommandRun" },
      { ...unsafeFields, commandId: "\n\t", type: "endSidebarCommandRun" },
    ];

    expect(() => {
      for (const message of malformedMessages) {
        vscode.postMessage(message as never);
      }
    }).not.toThrow();
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(commandActionPayloads).toEqual([]);
    expect(commandRunEndPayloads).toEqual([]);
    expect(appModalHostMessages).toEqual([]);
  });
});

describe("createGpuiSidebarRuntime local session focus parity", () => {
  test("matches macOS sidebar clicks by focusing locally without gxserver renderer-command dispatch", async () => {
    /*
    CDXC:GPUISidebarSessionFocus 2026-06-26-04:42:
    GPUI local session-card clicks must mirror the macOS sidebar: the reused SidebarApp updates local focus through the adapter and the CEF bootstrap focus hint, never by calling gxserver `/api/focusSession`, because that endpoint routes to whichever renderer client gxserver owns first and can create an endless two-session bounce.
    */
    const alpha = createTestDomainProject("P1alpha", "Alpha");
    const sessionIds = ["G1alpha", "G2beta", "G3gamma"] as const;
    const firstSidebarSessionId = createGxserverPresentationProjectSessionId(
      alpha.projectId,
      sessionIds[0],
    );
    const secondSidebarSessionId = createGxserverPresentationProjectSessionId(
      alpha.projectId,
      sessionIds[1],
    );
    const focusStatePayloads: Array<{
      focusedSessionId?: string;
      type: string;
      version: number;
      visibleSessionIds: string[];
    }> = [];
    const focusDebugPayloads: unknown[] = [];
    const host = installGpuiRuntimeTestHost({
      focusDebugPayloads,
      focusStatePayloads,
      initialActiveProjectId: alpha.projectId,
      initialFocusedSessionId: sessionIds[0],
      initialVisibleSessionIds: [sessionIds[0]],
      projects: [alpha],
      snapshot: createTestPresentationSnapshotWithSessions(alpha, sessionIds),
    });

    const { messageSource, start, vscode } = createGpuiSidebarRuntime();
    const messages: unknown[] = [];
    messageSource.addEventListener("message", (event) => {
      messages.push((event as MessageEvent).data);
    });

    start();

    await waitForMessage(messages, (message) =>
      isMessageOfType(message, "hydrate") &&
      message.groups.some((group) =>
        group.sessions.some((session) =>
          session.sessionId === firstSidebarSessionId &&
          session.isFocused === true &&
          session.isVisible === true,
        ),
      ),
    );
    messages.length = 0;

    vscode.postMessage({
      sessionId: secondSidebarSessionId,
      type: "focusSession",
    } as never);

    const groupsChanged = await waitForMessage(messages, (message) =>
      isMessageOfType(message, "sidebarGroupsChanged") &&
      message.groups.some((group) =>
        group.sessions.some((session) =>
          session.sessionId === secondSidebarSessionId &&
          session.isFocused === true &&
          session.isVisible === true,
        ),
      ),
    );
    const latestFocusState = focusStatePayloads[focusStatePayloads.length - 1];

    expect(host.calls.map((call) => call.pathname)).not.toContain("/api/focusSession");
    expect(latestFocusState).toEqual(expect.objectContaining({
      focusedSessionId: sessionIds[1],
      visibleSessionIds: expect.arrayContaining([sessionIds[0], sessionIds[1]]),
    }));
    expect(latestFocusState?.visibleSessionIds).not.toEqual([sessionIds[1]]);
    expect(focusDebugPayloads.map((payload) => (payload as { event?: string }).event))
      .toEqual(expect.arrayContaining([
        "sidebarFocusMessage",
        "localVisibleProjection",
        "localFocusStateSet",
        "localFocusApplied",
        "publishPresentation",
      ]));
    expect(JSON.stringify(focusDebugPayloads)).toContain(sessionIds[1]);
    expect(JSON.stringify(focusDebugPayloads)).not.toContain("/api/focusSession");
    expect(
      groupsChanged.groups.flatMap((group) => group.sessions)
        .filter((session) => session.isFocused)
        .map((session) => session.sessionId),
    ).toEqual([secondSidebarSessionId]);
  });

  test("does not replay same-transport bootstrap active project over live local focus", async () => {
    /*
    CDXC:GPUISidebarBootstrapReplay 2026-06-26-05:31:
    Regression coverage for the GPUI bounce at 2026-06-26 05:23 UAE time: after a local sidebar click moves focus to a new project, a delayed same-transport CEF bootstrap refresh may still carry the previous `initialActiveProjectId`. The runtime must store that bootstrap snapshot without applying it as focus, or the active group loops between the stale and current projects.
    */
    const alpha = createTestDomainProject("P2alpha", "Alpha");
    const beta = createTestDomainProject("P3beta", "Beta");
    const alphaSessionId = "G7alpha";
    const betaSessionId = "G3beta";
    const betaSidebarSessionId = createGxserverPresentationProjectSessionId(
      beta.projectId,
      betaSessionId,
    );
    const focusDebugPayloads: unknown[] = [];
    installGpuiRuntimeTestHost({
      focusDebugPayloads,
      initialActiveProjectId: alpha.projectId,
      initialFocusedSessionId: alphaSessionId,
      initialVisibleSessionIds: [alphaSessionId],
      projects: [alpha, beta],
      snapshot: createTestPresentationSnapshotWithProjectSessions([
        [alpha, [alphaSessionId]],
        [beta, [betaSessionId]],
      ]),
    });

    const { messageSource, start, vscode } = createGpuiSidebarRuntime();
    const messages: unknown[] = [];
    messageSource.addEventListener("message", (event) => {
      messages.push((event as MessageEvent).data);
    });

    start();

    await waitForMessage(messages, (message) =>
      isMessageOfType(message, "hydrate") &&
      message.groups.some((group) =>
        group.groupId === createGxserverPresentationProjectGroupId(alpha.projectId),
      ),
    );
    messages.length = 0;

    vscode.postMessage({
      sessionId: betaSidebarSessionId,
      type: "focusSession",
    } as never);

    await waitForMessage(messages, (message) =>
      isMessageOfType(message, "sidebarGroupsChanged") &&
      message.groups.some((group) =>
        group.groupId === createGxserverPresentationProjectGroupId(beta.projectId) &&
        group.isActive &&
        group.sessions.some((session) =>
          session.sessionId === betaSidebarSessionId &&
          session.isFocused === true,
        ),
      ),
    );
    messages.length = 0;
    focusDebugPayloads.length = 0;

    window.ghostexGpui?.onGxserverBootstrapChanged?.({
      authToken: "test-token",
      baseUrl: "http://gxserver.test",
      clientId: "test-client",
      focusedSessionId: betaSessionId,
      initialActiveProjectId: alpha.projectId,
      protocolVersion: GXSERVER_PROTOCOL_VERSION,
      visibleSessionIds: [alphaSessionId, betaSessionId],
    });
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(messages.filter((message) => isMessageOfType(message, "sidebarGroupsChanged")))
      .toEqual([]);
    expect(focusDebugPayloads.map((payload) => (payload as { event?: string }).event))
      .toContain("bootstrapRefreshStored");
    expect(focusDebugPayloads.map((payload) => (payload as { event?: string }).event))
      .not.toContain("bootstrapFocusStateApplied");
  });

  test("routes GPUI status pet activation callbacks through focusSession", async () => {
    /*
    CDXC:GPUIStatusPetOverlay 2026-06-26-05:07:
    GPUI status/pet activation is a fixed first-party callback carrying one bounded session id. The runtime must route it through the same focusSession path as SidebarApp clicks, reject malformed/private ids, and avoid generic buses, gxserver focusSession RPC dispatch, paths, URLs, commands, titles, tokens, or terminal content.
    */
    const alpha = createTestDomainProject("P1alpha", "Alpha");
    const sessionIds = ["G1alpha", "G2beta"] as const;
    const firstSidebarSessionId = createGxserverPresentationProjectSessionId(
      alpha.projectId,
      sessionIds[0],
    );
    const secondSidebarSessionId = createGxserverPresentationProjectSessionId(
      alpha.projectId,
      sessionIds[1],
    );
    const focusStatePayloads: Array<{
      focusedSessionId?: string;
      type: string;
      version: number;
      visibleSessionIds: string[];
    }> = [];
    const host = installGpuiRuntimeTestHost({
      focusStatePayloads,
      initialActiveProjectId: alpha.projectId,
      initialFocusedSessionId: sessionIds[0],
      initialVisibleSessionIds: [sessionIds[0]],
      projects: [alpha],
      snapshot: createTestPresentationSnapshotWithSessions(alpha, sessionIds),
    });

    const { messageSource, start } = createGpuiSidebarRuntime();
    const messages: unknown[] = [];
    messageSource.addEventListener("message", (event) => {
      messages.push((event as MessageEvent).data);
    });

    start();

    await waitForMessage(messages, (message) =>
      isMessageOfType(message, "hydrate") &&
      message.groups.some((group) =>
        group.sessions.some((session) =>
          session.sessionId === firstSidebarSessionId &&
          session.isFocused === true,
        ),
      ),
    );
    messages.length = 0;

    const testWindow = window as Window & {
      ghostexGpui: NonNullable<Window["ghostexGpui"]>;
    };
    testWindow.ghostexGpui.onStatusPetActivation?.({
      sessionId: "bad/path",
      type: "ghostex.gpui.sidebar.statusPetActivation",
      version: 1,
    });
    testWindow.ghostexGpui.onStatusPetActivation?.({
      sessionId: secondSidebarSessionId,
      type: "ghostex.gpui.sidebar.statusPetActivation",
      version: 1,
    });

    await waitForMessage(messages, (message) =>
      isMessageOfType(message, "sidebarGroupsChanged") &&
      message.groups.some((group) =>
        group.sessions.some((session) =>
          session.sessionId === secondSidebarSessionId &&
          session.isFocused === true,
        ),
      ),
    );
    const latestFocusState = focusStatePayloads[focusStatePayloads.length - 1];

    expect(latestFocusState).toEqual(expect.objectContaining({
      focusedSessionId: sessionIds[1],
      visibleSessionIds: expect.arrayContaining([sessionIds[0], sessionIds[1]]),
    }));
    expect(host.calls.map((call) => call.pathname)).not.toContain("/api/focusSession");
    expect(focusStatePayloads).not.toEqual(expect.arrayContaining([
      expect.objectContaining({ focusedSessionId: "bad/path" }),
    ]));
  });
});

describe("createGpuiSidebarRuntime local close-to-recent", () => {
  test("removes a closed project from normal groups while using gxserver recent rows", async () => {
    const alpha = createTestDomainProject("P1alpha", "Alpha");
    const beta = createTestDomainProject("P2beta", "Beta");
    const alphaGroupId = createGxserverPresentationProjectGroupId(alpha.projectId);
    const closeResponseProject: GxserverProjectDomainState = {
      ...alpha,
      isRecentProject: true,
      recentClosedAt: "2026-06-25T14:50:00.000Z",
      updatedAt: "2026-06-25T14:50:00.000Z",
    };
    const closeResponseRecent: GxserverRecentProjectDomainState = {
      path: alpha.path ?? "/tmp/gpui-alpha",
      projectId: alpha.projectId,
      recentClosedAt: closeResponseProject.recentClosedAt,
      sessionCount: 0,
      title: alpha.name,
    };
    installGpuiRuntimeTestHost({
      closeResponseProject,
      closeResponseRecent,
      initialActiveProjectId: alpha.projectId,
      projects: [alpha, beta],
      snapshot: createTestPresentationSnapshot([alpha, beta]),
    });

    const { messageSource, start, vscode } = createGpuiSidebarRuntime();
    const messages: unknown[] = [];
    messageSource.addEventListener("message", (event) => {
      messages.push((event as MessageEvent).data);
    });

    start();

    await waitForMessage(messages, (message) =>
      isMessageOfType(message, "hydrate") &&
      message.groups.some((group) => group.groupId === alphaGroupId),
    );

    vscode.postMessage({
      groupId: alphaGroupId,
      type: "closeWorkspaceProjectForGroup",
    } as never);

    const groupsChanged = await waitForMessage(messages, (message) =>
      isMessageOfType(message, "sidebarGroupsChanged") &&
      message.removedGroupIds.includes(alphaGroupId),
    );
    const hudChanged = await waitForMessage(messages, (message) =>
      isMessageOfType(message, "sidebarHudChanged") &&
      message.hud.recentProjects.some((project) => project.projectId === alpha.projectId),
    );

    expect(groupsChanged.groups.map((group) => group.groupId)).not.toContain(alphaGroupId);
    expect(
      groupsChanged.groups.some((group) => group.projectContext && group.title === alpha.name),
    ).toBe(false);
    expect(hudChanged.hud.recentProjects).toEqual([
      expect.objectContaining({
        path: closeResponseRecent.path,
        projectId: alpha.projectId,
        title: alpha.name,
      }),
    ]);
  });
});

describe("createGpuiSidebarRuntime local restore recent project", () => {
  test("uses gxserver restore response while returning the group active in normal groups", async () => {
    const alpha = createTestDomainProject("P1alpha", "Alpha");
    const beta = createTestDomainProject("P2beta", "Beta");
    const alphaGroupId = createGxserverPresentationProjectGroupId(alpha.projectId);
    const betaGroupId = createGxserverPresentationProjectGroupId(beta.projectId);
    const parkedAlpha: GxserverProjectDomainState = {
      ...alpha,
      isRecentProject: true,
      recentClosedAt: "2026-06-25T14:50:00.000Z",
      updatedAt: "2026-06-25T14:50:00.000Z",
    };
    const restoredAlpha: GxserverProjectDomainState = {
      ...alpha,
      isRecentProject: false,
      recentClosedAt: undefined,
      updatedAt: "2026-06-25T14:55:00.000Z",
    };
    const alphaRecent = createTestRecentProject(
      alpha.projectId,
      alpha.name,
      "2026-06-25T14:50:00.000Z",
    );
    const zetaRecent = createTestRecentProject(
      "P3zeta",
      "Zeta",
      "2026-06-25T14:40:00.000Z",
    );
    const host = installGpuiRuntimeTestHost({
      initialActiveProjectId: beta.projectId,
      initialRecentProjects: [alphaRecent, zetaRecent],
      projects: [parkedAlpha, beta],
      restoreProjectId: alpha.projectId,
      restoreResponseProject: restoredAlpha,
      restoreResponseRecentProjects: [zetaRecent],
      restoredProjects: [restoredAlpha, beta],
      restoredSnapshot: createTestPresentationSnapshot([restoredAlpha, beta], 2),
      snapshot: createTestPresentationSnapshot([beta]),
    });

    const { messageSource, start, vscode } = createGpuiSidebarRuntime();
    const messages: unknown[] = [];
    messageSource.addEventListener("message", (event) => {
      messages.push((event as MessageEvent).data);
    });

    start();

    const hydrate = await waitForMessage(messages, (message) =>
      isMessageOfType(message, "hydrate") &&
      message.groups.some((group) => group.groupId === betaGroupId) &&
      message.hud.recentProjects.some((project) => project.projectId === alpha.projectId),
    );

    expect(hydrate.groups.map((group) => group.groupId)).not.toContain(alphaGroupId);
    expect(hydrate.hud.recentProjects.map((project) => project.projectId)).toEqual([
      alpha.projectId,
      zetaRecent.projectId,
    ]);

    vscode.postMessage({
      projectId: alpha.projectId,
      type: "restoreRecentProject",
    } as never);

    const groupsChanged = await waitForMessage(messages, (message) =>
      isMessageOfType(message, "sidebarGroupsChanged") &&
      message.groups.some((group) => group.groupId === alphaGroupId && group.isActive),
    );
    const hudChanged = await waitForMessage(messages, (message) =>
      isMessageOfType(message, "sidebarHudChanged") &&
      message.hud.recentProjects.length === 1 &&
      message.hud.recentProjects[0]?.projectId === zetaRecent.projectId,
    );

    expect(host.calls.some((call) =>
      call.pathname === "/api/restoreRecentProject" &&
      call.params.projectId === alpha.projectId,
    )).toBe(true);
    expect(groupsChanged.groupOrder).toContain(alphaGroupId);
    expect(groupsChanged.groups).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          groupId: alphaGroupId,
          isActive: true,
          title: alpha.name,
        }),
      ]),
    );
    expect(hudChanged.hud.recentProjects.map((project) => project.projectId)).toEqual([
      zetaRecent.projectId,
    ]);
  });
});

/*
CDXC:GPUIRecentProjectsRuntimeTests 2026-06-25-19:54:
Recent Projects bridge coverage must pin the remaining GPUI routes to authoritative gxserver/native contracts without production changes: local remove consumes `/api/removeRecentProject` rows verbatim, and remote recent actions use machine-scoped ids with Rust-owned path resolution.

CDXC:GPUIRecentProjects 2026-06-25-21:36:
Local Recent Projects copy/open bridge coverage must prove GPUI forwards only a fixed native action plus the trusted local project id. Renderer-supplied paths, titles, and other row authority must not enter native payloads, and ordering coverage must pin parsed `recentClosedAt` descending while preserving gxserver order for timestamp ties.
*/
describe("createGpuiSidebarRuntime local remove recent project", () => {
  test("uses the gxserver remove response as the only recent-project drawer source", async () => {
    const alpha = createTestDomainProject("P1alpha", "Alpha");
    const parkedAlpha: GxserverProjectDomainState = {
      ...alpha,
      isRecentProject: true,
      recentClosedAt: "2026-06-25T15:10:00.000Z",
      updatedAt: "2026-06-25T15:10:00.000Z",
    };
    const alphaRecent = createTestRecentProject(
      alpha.projectId,
      alpha.name,
      "2026-06-25T15:10:00.000Z",
    );
    const betaRecent = createTestRecentProject(
      "P2beta",
      "Beta",
      "2026-06-25T15:05:00.000Z",
    );
    const authoritativeRecent = createTestRecentProject(
      "P3zeta",
      "Zeta",
      "2026-06-25T15:00:00.000Z",
    );
    const host = installGpuiRuntimeTestHost({
      initialActiveProjectId: "P0missing",
      initialRecentProjects: [alphaRecent, betaRecent],
      projects: [parkedAlpha],
      removeRecentProjectId: alpha.projectId,
      removeResponseRecentProjects: [authoritativeRecent],
      snapshot: createTestPresentationSnapshot([]),
    });

    const { messageSource, start, vscode } = createGpuiSidebarRuntime();
    const messages: unknown[] = [];
    messageSource.addEventListener("message", (event) => {
      messages.push((event as MessageEvent).data);
    });

    start();

    const hydrate = await waitForMessage(messages, (message) =>
      isMessageOfType(message, "hydrate") &&
      message.hud.recentProjects.length === 2,
    );

    expect(hydrate.hud.recentProjects.map((project) => project.projectId)).toEqual([
      alpha.projectId,
      betaRecent.projectId,
    ]);

    vscode.postMessage({
      projectId: alpha.projectId,
      type: "removeRecentProject",
    } as never);

    const hudChanged = await waitForMessage(messages, (message) =>
      isMessageOfType(message, "sidebarHudChanged") &&
      message.hud.recentProjects.length === 1 &&
      message.hud.recentProjects[0]?.projectId === authoritativeRecent.projectId,
    );

    expect(host.calls.some((call) =>
      call.pathname === "/api/removeRecentProject" &&
      call.params.projectId === alpha.projectId,
    )).toBe(true);
    expect(hudChanged.hud.recentProjects).toEqual([
      expect.objectContaining({
        path: authoritativeRecent.path,
        projectId: authoritativeRecent.projectId,
        title: authoritativeRecent.title,
      }),
    ]);
    expect(hudChanged.hud.recentProjects.map((project) => project.projectId)).not.toContain(
      alpha.projectId,
    );
    expect(hudChanged.hud.recentProjects.map((project) => project.projectId)).not.toContain(
      betaRecent.projectId,
    );
  });
});

describe("createGpuiSidebarRuntime recent-project ordering", () => {
  test("sorts by parsed recentClosedAt descending for unequal values", async () => {
    const oldestRecent = createTestRecentProject(
      "P1oldest",
      "Oldest",
      "2026-06-25T15:00:00.000Z",
    );
    const newestRecent = createTestRecentProject(
      "P2newest",
      "Newest",
      "2026-06-25T09:30:00.000-06:00",
    );
    const middleRecent = createTestRecentProject(
      "P3middle",
      "Middle",
      "2026-06-25T15:15:00.000Z",
    );
    installGpuiRuntimeTestHost({
      initialActiveProjectId: "P0missing",
      initialRecentProjects: [oldestRecent, newestRecent, middleRecent],
      projects: [],
      snapshot: createTestPresentationSnapshot([]),
    });

    const { messageSource, start } = createGpuiSidebarRuntime();
    const messages: unknown[] = [];
    messageSource.addEventListener("message", (event) => {
      messages.push((event as MessageEvent).data);
    });

    start();

    const hydrate = await waitForMessage(messages, (message) =>
      isMessageOfType(message, "hydrate") &&
      message.hud.recentProjects.length === 3,
    );

    expect(hydrate.hud.recentProjects.map((project) => project.title)).toEqual([
      "Newest",
      "Middle",
      "Oldest",
    ]);
  });

  test("preserves gxserver order for equal recentClosedAt values", async () => {
    const alphaRecent = createTestRecentProject(
      "P1alpha",
      "Alpha",
      "2026-06-25T15:00:00.000Z",
    );
    const zebraRecent = createTestRecentProject(
      "P2zebra",
      "Zebra",
      "2026-06-25T15:00:00.000Z",
    );
    installGpuiRuntimeTestHost({
      initialActiveProjectId: "P0missing",
      initialRecentProjects: [zebraRecent, alphaRecent],
      projects: [],
      snapshot: createTestPresentationSnapshot([]),
    });

    const { messageSource, start } = createGpuiSidebarRuntime();
    const messages: unknown[] = [];
    messageSource.addEventListener("message", (event) => {
      messages.push((event as MessageEvent).data);
    });

    start();

    const hydrate = await waitForMessage(messages, (message) =>
      isMessageOfType(message, "hydrate") &&
      message.hud.recentProjects.length === 2,
    );

    expect(hydrate.hud.recentProjects.map((project) => project.title)).toEqual([
      "Zebra",
      "Alpha",
    ]);
  });
});

describe("createGpuiSidebarRuntime local Recent Projects native bridge", () => {
  test.each([
    {
      action: "copyRecentProjectPath",
      messageType: "copyRecentProjectPath",
    },
    {
      action: "openRecentProjectInFinder",
      messageType: "openRecentProjectInFinder",
    },
  ] as const)(
    "routes $messageType to only the fixed native action and local project id",
    async ({ action, messageType }) => {
      const alphaRecent = createTestRecentProject(
        "P1alpha",
        "Alpha",
        "2026-06-25T15:20:00.000Z",
      );
      const nativeProjectPathActions: unknown[] = [];
      installGpuiRuntimeTestHost({
        initialActiveProjectId: "P0missing",
        initialRecentProjects: [alphaRecent],
        nativeProjectPathActions,
        projects: [],
        snapshot: createTestPresentationSnapshot([]),
      });

      const { messageSource, start, vscode } = createGpuiSidebarRuntime();
      const messages: unknown[] = [];
      messageSource.addEventListener("message", (event) => {
        messages.push((event as MessageEvent).data);
      });

      start();

      await waitForMessage(messages, (message) => isMessageOfType(message, "hydrate"));

      vscode.postMessage({
        filePath: "/tmp/renderer-controlled-file",
        path: "/tmp/renderer-controlled-path",
        projectId: alphaRecent.projectId,
        title: "Renderer Controlled Title",
        type: messageType,
      } as never);

      expect(nativeProjectPathActions).toEqual([
        {
          action,
          projectId: alphaRecent.projectId,
          type: "ghostex.gpui.sidebar.nativeProjectPathAction",
          version: 1,
        },
      ]);
    },
  );
});

describe("createGpuiSidebarRuntime remote Recent Projects Copy Path", () => {
  test("routes to a fixed native action with only the machine-scoped project id", async () => {
    const nativeProjectPathActions: unknown[] = [];
    installGpuiRuntimeTestHost({
      initialActiveProjectId: "P0missing",
      nativeProjectPathActions,
      projects: [],
      snapshot: createTestPresentationSnapshot([]),
    });

    const { messageSource, start, vscode } = createGpuiSidebarRuntime();
    const messages: unknown[] = [];
    messageSource.addEventListener("message", (event) => {
      messages.push((event as MessageEvent).data);
    });

    start();

    await waitForMessage(messages, (message) => isMessageOfType(message, "hydrate"));

    vscode.postMessage({
      projectId: "remote:remote-main:project:P1alpha",
      type: "copyRecentProjectPath",
    } as never);

    expect(nativeProjectPathActions).toEqual([
      {
        action: "copyRemoteProjectPath",
        projectId: "remote:remote-main:project:P1alpha",
        type: "ghostex.gpui.sidebar.nativeProjectPathAction",
        version: 1,
      },
    ]);
    expect(nativeProjectPathActions[0]).not.toHaveProperty("path");
    expect(nativeProjectPathActions[0]).not.toHaveProperty("filePath");
  });
});

describe("createGpuiSidebarRuntime remote Recent Projects Open Folder", () => {
  test("routes to a fixed native action without the old unsupported toast", async () => {
    const nativeProjectPathActions: unknown[] = [];
    installGpuiRuntimeTestHost({
      initialActiveProjectId: "P0missing",
      nativeProjectPathActions,
      projects: [],
      snapshot: createTestPresentationSnapshot([]),
    });

    const { messageSource, start, vscode } = createGpuiSidebarRuntime();
    const messages: unknown[] = [];
    messageSource.addEventListener("message", (event) => {
      messages.push((event as MessageEvent).data);
    });

    start();

    await waitForMessage(messages, (message) => isMessageOfType(message, "hydrate"));

    vscode.postMessage({
      projectId: "remote:remote-main:project:P1alpha",
      type: "openRecentProjectInFinder",
    } as never);

    expect(nativeProjectPathActions).toEqual([
      {
        action: "copyRemoteProjectOpenFolderCommand",
        projectId: "remote:remote-main:project:P1alpha",
        type: "ghostex.gpui.sidebar.nativeProjectPathAction",
        version: 1,
      },
    ]);
    expect(
      messages.some((message) =>
        JSON.stringify(message).includes("Remote folder open unavailable"),
      ),
    ).toBe(false);
  });
});

describe("createGpuiSidebarRuntime remote Recent Projects mutations", () => {
  test("closes a remote project through the owning gxserver and publishes its machine-scoped recent row", async () => {
    const alpha = createTestDomainProject("P1alpha", "Alpha");
    const beta = createTestDomainProject("P2beta", "Beta");
    const remoteRecent = createTestRecentProject(
      alpha.projectId,
      alpha.name,
      "2026-06-25T15:20:00.000Z",
    );
    const appModalHostMessages: unknown[] = [];
    installGpuiRuntimeTestHost({
      appModalHostMessages,
      initialActiveProjectId: "P0missing",
      projects: [],
      runtimeSettings: createTestRemoteRuntimeSettings(),
      snapshot: createTestPresentationSnapshot([]),
    });

    const { messageSource, start, vscode } = createGpuiSidebarRuntime();
    const messages: unknown[] = [];
    messageSource.addEventListener("message", (event) => {
      messages.push((event as MessageEvent).data);
    });

    start();

    await waitForMessage(messages, (message) => isMessageOfType(message, "hydrate"));
    dispatchRemotePresentationSnapshot("remote-main", createTestPresentationSnapshot([alpha, beta]));

    const alphaGroupId = "remote:remote-main:group:P1alpha";
    await waitForMessage(messages, (message) =>
      isMessageOfType(message, "sidebarGroupsChanged") &&
      message.groups.some((group) => group.groupId === alphaGroupId),
    );
    const listRequest = await waitForMessage(appModalHostMessages, (message) =>
      isRemoteGxserverRequest(message, "/api/listRecentProjects", "remote-main"),
    );
    respondToRemoteGxserverRequest(listRequest, { recentProjects: [] });

    vscode.postMessage({
      groupId: alphaGroupId,
      type: "closeWorkspaceProjectForGroup",
    } as never);

    const closeRequest = await waitForMessage(appModalHostMessages, (message) =>
      isRemoteGxserverRequest(message, "/api/closeProjectToRecent", "remote-main"),
    );
    expect(closeRequest.params).toEqual({ projectId: alpha.projectId });
    respondToRemoteGxserverRequest(closeRequest, { recentProjects: [remoteRecent] });

    const groupsChanged = await waitForMessage(messages, (message) =>
      isMessageOfType(message, "sidebarGroupsChanged") &&
      message.removedGroupIds.includes(alphaGroupId),
    );
    const hudChanged = await waitForMessage(messages, (message) =>
      isMessageOfType(message, "sidebarHudChanged") &&
      message.hud.recentProjects.some(
        (project) => project.projectId === "remote:remote-main:project:P1alpha",
      ),
    );

    expect(groupsChanged.groups.map((group) => group.groupId)).not.toContain(alphaGroupId);
    expect(hudChanged.hud.recentProjects).toEqual([
      expect.objectContaining({
        projectId: "remote:remote-main:project:P1alpha",
        remoteMachineId: "remote-main",
        remoteMachineName: "Remote Main",
        title: alpha.name,
      }),
    ]);
  });

  test("restores a remote recent project through the owning gxserver and refreshes machine-scoped rows", async () => {
    const alpha = createTestDomainProject("P1alpha", "Alpha");
    const zetaRecent = createTestRecentProject(
      "P3zeta",
      "Zeta",
      "2026-06-25T15:00:00.000Z",
    );
    const restoredSnapshot = createTestPresentationSnapshot([alpha], 2);
    const appModalHostMessages: unknown[] = [];
    installGpuiRuntimeTestHost({
      appModalHostMessages,
      initialActiveProjectId: "P0missing",
      projects: [],
      runtimeSettings: createTestRemoteRuntimeSettings(),
      snapshot: createTestPresentationSnapshot([]),
    });

    const { messageSource, start, vscode } = createGpuiSidebarRuntime();
    const messages: unknown[] = [];
    messageSource.addEventListener("message", (event) => {
      messages.push((event as MessageEvent).data);
    });

    start();

    await waitForMessage(messages, (message) => isMessageOfType(message, "hydrate"));

    vscode.postMessage({
      projectId: "remote:remote-main:project:P1alpha",
      type: "restoreRecentProject",
    } as never);

    const restoreRequest = await waitForMessage(appModalHostMessages, (message) =>
      isRemoteGxserverRequest(message, "/api/restoreRecentProject", "remote-main"),
    );
    expect(restoreRequest.params).toEqual({ projectId: alpha.projectId });
    respondToRemoteGxserverRequest(restoreRequest, {
      project: restoredSnapshot.projects[0],
      recentProjects: [zetaRecent],
    });

    const snapshotRequest = await waitForMessage(appModalHostMessages, (message) =>
      isRemoteGxserverRequest(message, "/api/readPresentationSnapshot", "remote-main"),
    );
    expect(snapshotRequest.params).toEqual({});
    respondToRemoteGxserverRequest(snapshotRequest, { snapshot: restoredSnapshot });

    const groupsChanged = await waitForMessage(messages, (message) =>
      isMessageOfType(message, "sidebarGroupsChanged") &&
      message.groups.some(
        (group) => group.groupId === "remote:remote-main:group:P1alpha",
      ),
    );
    const hudChanged = await waitForMessage(messages, (message) =>
      isMessageOfType(message, "sidebarHudChanged") &&
      message.hud.recentProjects.length === 1 &&
      message.hud.recentProjects[0]?.projectId === "remote:remote-main:project:P3zeta",
    );

    expect(groupsChanged.groupOrder).toContain("remote:remote-main:group:P1alpha");
    expect(hudChanged.hud.recentProjects).toEqual([
      expect.objectContaining({
        projectId: "remote:remote-main:project:P3zeta",
        remoteMachineId: "remote-main",
        remoteMachineName: "Remote Main",
        title: zetaRecent.title,
      }),
    ]);
  });

  test("removes a remote recent project through the owning gxserver and replaces machine-scoped rows", async () => {
    const zetaRecent = createTestRecentProject(
      "P3zeta",
      "Zeta",
      "2026-06-25T15:00:00.000Z",
    );
    const appModalHostMessages: unknown[] = [];
    installGpuiRuntimeTestHost({
      appModalHostMessages,
      initialActiveProjectId: "P0missing",
      projects: [],
      runtimeSettings: createTestRemoteRuntimeSettings(),
      snapshot: createTestPresentationSnapshot([]),
    });

    const { messageSource, start, vscode } = createGpuiSidebarRuntime();
    const messages: unknown[] = [];
    messageSource.addEventListener("message", (event) => {
      messages.push((event as MessageEvent).data);
    });

    start();

    await waitForMessage(messages, (message) => isMessageOfType(message, "hydrate"));

    vscode.postMessage({
      projectId: "remote:remote-main:project:P1alpha",
      type: "removeRecentProject",
    } as never);

    const removeRequest = await waitForMessage(appModalHostMessages, (message) =>
      isRemoteGxserverRequest(message, "/api/removeRecentProject", "remote-main"),
    );
    expect(removeRequest.params).toEqual({ projectId: "P1alpha" });
    respondToRemoteGxserverRequest(removeRequest, { recentProjects: [zetaRecent] });

    const hudChanged = await waitForMessage(messages, (message) =>
      isMessageOfType(message, "sidebarHudChanged") &&
      message.hud.recentProjects.length === 1 &&
      message.hud.recentProjects[0]?.projectId === "remote:remote-main:project:P3zeta",
    );

    expect(hudChanged.hud.recentProjects).toEqual([
      expect.objectContaining({
        projectId: "remote:remote-main:project:P3zeta",
        remoteMachineId: "remote-main",
        remoteMachineName: "Remote Main",
        title: zetaRecent.title,
      }),
    ]);
  });
});

function createTestDomainProject(
  projectId: GxserverProjectId,
  name: string,
): GxserverProjectDomainState {
  return {
    attentionRules: {},
    completionRules: {},
    createdAt: "2026-06-25T14:00:00.000Z",
    customAgentOrder: [],
    customAgents: [],
    customCommandOrder: [],
    customCommands: [],
    deletedDefaultCommandIds: [],
    gitConfig: {},
    isFavorite: false,
    isPinned: false,
    isRecentProject: false,
    launchSettings: {},
    name,
    notificationRules: {},
    path: `/tmp/gpui-${name.toLocaleLowerCase()}`,
    previousSessionHistory: [],
    projectBoardConfig: {},
    projectId,
    runtimeSettings: {},
    updatedAt: "2026-06-25T14:00:00.000Z",
  };
}

function createTestRecentProject(
  projectId: GxserverProjectId,
  title: string,
  recentClosedAt: string,
): GxserverRecentProjectDomainState {
  return {
    path: `/tmp/gpui-${title.toLocaleLowerCase()}`,
    projectId,
    recentClosedAt,
    sessionCount: 0,
    title,
  };
}

function createTestPresentationSnapshot(
  projects: readonly GxserverProjectDomainState[],
  revision = 1,
): GxserverPresentationSnapshot {
  return {
    generatedAt: "2026-06-25T14:00:00.000Z",
    groups: projects.map((project): GxserverPresentationGroup => ({
      groupId: createGxserverPresentationProjectGroupId(project.projectId),
      projectId: project.projectId,
      sessionIds: [],
      sortKey: project.name,
      title: project.name,
    })),
    projects: projects.map((project): GxserverPresentationProject => ({
      createdAt: project.createdAt,
      groupIds: [createGxserverPresentationProjectGroupId(project.projectId)],
      isFavorite: project.isFavorite,
      isPinned: project.isPinned,
      path: project.path,
      projectId: project.projectId,
      sortKey: project.name,
      title: project.name,
      updatedAt: project.updatedAt,
    })),
    revision: revision as GxserverPresentationSnapshot["revision"],
    sessions: [],
  };
}

function createTestPresentationSnapshotWithSessions(
  project: GxserverProjectDomainState,
  sessionIds: readonly string[],
  revision = 1,
): GxserverPresentationSnapshot {
  const base = createTestPresentationSnapshot([project], revision);
  const groupId = createGxserverPresentationProjectGroupId(project.projectId);
  return {
    ...base,
    groups: base.groups.map((group) =>
      group.projectId === project.projectId
        ? { ...group, sessionIds: sessionIds as readonly GxserverSessionId[] }
        : group,
    ),
    sessions: sessionIds.map((sessionId, index) =>
      createTestPresentationSession(project, groupId, sessionId, index),
    ),
  };
}

function createTestPresentationSnapshotWithProjectSessions(
  projectsWithSessions: readonly (readonly [
    GxserverProjectDomainState,
    readonly string[],
  ])[],
  revision = 1,
): GxserverPresentationSnapshot {
  const projects = projectsWithSessions.map(([project]) => project);
  const base = createTestPresentationSnapshot(projects, revision);
  const sessionIdsByProjectId = new Map(
    projectsWithSessions.map(([project, sessionIds]) => [project.projectId, sessionIds]),
  );
  const groups = base.groups.map((group) => ({
    ...group,
    sessionIds: (sessionIdsByProjectId.get(group.projectId) ?? []) as readonly GxserverSessionId[],
  }));
  const sessions = projectsWithSessions.flatMap(([project, sessionIds]) => {
    const groupId = createGxserverPresentationProjectGroupId(project.projectId);
    return sessionIds.map((sessionId, index) =>
      createTestPresentationSession(project, groupId, sessionId, index),
    );
  });
  return {
    ...base,
    groups,
    sessions,
  };
}

function createTestPresentationSession(
  project: GxserverProjectDomainState,
  groupId: string,
  sessionId: string,
  index: number,
): GxserverPresentationSession {
  return {
    actions: {
      acknowledgeAttention: true,
      attach: true,
      focus: true,
      kill: true,
      readText: true,
      sendMessage: true,
      sendText: true,
      sleep: true,
      wake: true,
    },
    activity: "idle",
    createdAt: "2026-06-25T14:00:00.000Z",
    groupId,
    isFavorite: false,
    isGeneratingFirstPromptTitle: false,
    isPinned: false,
    isPrimaryTitleTerminalTitle: false,
    isTemporaryTitle: false,
    kind: "agent",
    lifecycleState: "running",
    providerSessionState: "exists",
    projectId: project.projectId,
    sessionId: sessionId as GxserverSessionId,
    sortKey: `${index}:${sessionId}`,
    surface: "workspace",
    title: sessionId,
    titleSource: "agent",
    updatedAt: "2026-06-25T14:00:00.000Z",
    visibleInSidebarByDefault: true,
    zmxName: sessionId as GxserverPresentationSession["zmxName"],
  };
}

function installGpuiRuntimeTestHost({
  appModalHostMessages,
  closeResponseProject,
  closeResponseRecent,
  commandActionPayloads,
  commandRunEndPayloads,
  focusDebugPayloads,
  focusStatePayloads,
  initialActiveProjectId,
  initialFocusedSessionId,
  initialRecentProjects = [],
  initialVisibleSessionIds,
  nativeProjectPathActions,
  projects,
  removeRecentProjectId,
  removeResponseRecentProjects,
  restoreProjectId,
  restoreResponseProject,
  restoreResponseRecentProjects,
  restoredProjects,
  restoredSnapshot,
  runtimeSettings,
  sidebarCommands = [],
  snapshot,
}: {
  appModalHostMessages?: unknown[];
  closeResponseProject?: GxserverProjectDomainState;
  closeResponseRecent?: GxserverRecentProjectDomainState;
  commandActionPayloads?: unknown[];
  commandRunEndPayloads?: unknown[];
  focusDebugPayloads?: unknown[];
  focusStatePayloads?: Array<{
    focusedSessionId?: string;
    type: string;
    version: number;
    visibleSessionIds: string[];
  }>;
  initialActiveProjectId: GxserverProjectId;
  initialFocusedSessionId?: string;
  initialRecentProjects?: readonly GxserverRecentProjectDomainState[];
  initialVisibleSessionIds?: readonly string[];
  nativeProjectPathActions?: unknown[];
  projects: readonly GxserverProjectDomainState[];
  removeRecentProjectId?: GxserverProjectId;
  removeResponseRecentProjects?: readonly GxserverRecentProjectDomainState[];
  restoreProjectId?: GxserverProjectId;
  restoreResponseProject?: GxserverProjectDomainState;
  restoreResponseRecentProjects?: readonly GxserverRecentProjectDomainState[];
  restoredProjects?: readonly GxserverProjectDomainState[];
  restoredSnapshot?: GxserverPresentationSnapshot;
  runtimeSettings?: GpuiSidebarRuntimeSettings;
  sidebarCommands?: readonly SidebarCommandButton[];
  snapshot: GxserverPresentationSnapshot;
}): { calls: Array<{ params: Record<string, unknown>; pathname: string }> } {
  const appUserData: GxserverAppUserData = {
    pinnedPrompts: [],
    scratchPadContent: "",
  };
  const sidebarHud: GxserverSidebarHudResponse = {
    agents: [],
    commands: [...sidebarCommands],
  };
  const calls: Array<{ params: Record<string, unknown>; pathname: string }> = [];
  let didRestore = false;
  vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input));
    const params = parseRequestParams(init?.body);
    calls.push({ params, pathname: url.pathname });
    switch (url.pathname) {
      case "/api/readPresentationSnapshot":
        return createGxserverRpcResponse({
          snapshot: didRestore && restoredSnapshot ? restoredSnapshot : snapshot,
        });
      case "/api/readAppUserData":
        return createGxserverRpcResponse(appUserData);
      case "/api/listProjects":
        return createGxserverRpcResponse({
          projects: didRestore && restoredProjects ? restoredProjects : projects,
        });
      case "/api/listRecentProjects":
        return createGxserverRpcResponse({ recentProjects: initialRecentProjects });
      case "/api/readSidebarHud":
        return createGxserverRpcResponse(sidebarHud);
      case "/api/closeProjectToRecent":
        if (!closeResponseProject || !closeResponseRecent) {
          throw new Error("Unexpected closeProjectToRecent call.");
        }
        expect(params).toEqual({ projectId: closeResponseProject.projectId });
        return createGxserverRpcResponse({
          project: closeResponseProject,
          recentProjects: [closeResponseRecent],
        });
      case "/api/restoreRecentProject":
        if (!restoreProjectId || !restoreResponseRecentProjects) {
          throw new Error("Unexpected restoreRecentProject call.");
        }
        expect(params).toEqual({ projectId: restoreProjectId });
        didRestore = true;
        return createGxserverRpcResponse({
          ...(restoreResponseProject ? { project: restoreResponseProject } : {}),
          recentProjects: restoreResponseRecentProjects,
        });
      case "/api/removeRecentProject":
        if (!removeRecentProjectId || !removeResponseRecentProjects) {
          throw new Error("Unexpected removeRecentProject call.");
        }
        expect(params).toEqual({ projectId: removeRecentProjectId });
        return createGxserverRpcResponse({
          recentProjects: removeResponseRecentProjects,
        });
      case "/api/runGitAction":
      case "/api/runGitHubAction":
        return createGxserverRpcResponse({
          action: typeof params.action === "string" ? params.action : "isInsideWorkTree",
          exitCode: 1,
          stderr: "",
          stdout: "",
        });
      default:
        throw new Error(`Unexpected gxserver endpoint: ${url.pathname}`);
    }
  }));
  vi.stubGlobal("WebSocket", TestWebSocket);
  vi.stubGlobal(
    "window",
    createTestWindow({
      appModalHostMessages,
      commandActionPayloads,
      commandRunEndPayloads,
      focusDebugPayloads,
      focusStatePayloads,
      initialActiveProjectId,
      initialFocusedSessionId,
      initialVisibleSessionIds,
      nativeProjectPathActions,
      runtimeSettings,
    }),
  );
  return { calls };
}

function createTestRemoteRuntimeSettings(): GpuiSidebarRuntimeSettings {
  return {
    settings: {
      remoteMachines: [
        {
          id: "remote-main",
          name: "Remote Main",
          sshHost: "remote-main.example.invalid",
        },
      ],
    },
  };
}

function createTestWindow({
  appModalHostMessages,
  commandActionPayloads,
  commandRunEndPayloads,
  focusDebugPayloads,
  focusStatePayloads,
  initialActiveProjectId,
  initialFocusedSessionId,
  initialVisibleSessionIds,
  nativeProjectPathActions,
  runtimeSettings,
}: {
  appModalHostMessages?: unknown[];
  commandActionPayloads?: unknown[];
  commandRunEndPayloads?: unknown[];
  focusDebugPayloads?: unknown[];
  focusStatePayloads?: Array<{
    focusedSessionId?: string;
    type: string;
    version: number;
    visibleSessionIds: string[];
  }>;
  initialActiveProjectId: GxserverProjectId;
  initialFocusedSessionId?: string;
  initialVisibleSessionIds?: readonly string[];
  nativeProjectPathActions?: unknown[];
  runtimeSettings?: GpuiSidebarRuntimeSettings;
}): EventTarget & {
  clearTimeout: typeof clearTimeout;
  ghostexGpui: NonNullable<Window["ghostexGpui"]>;
  setTimeout: typeof setTimeout;
  webkit?: NonNullable<Window["webkit"]>;
} {
  const eventTarget = new EventTarget() as EventTarget & {
    clearTimeout: typeof clearTimeout;
    ghostexGpui: NonNullable<Window["ghostexGpui"]>;
    setTimeout: typeof setTimeout;
    webkit?: NonNullable<Window["webkit"]>;
  };
  eventTarget.clearTimeout = globalThis.clearTimeout;
  eventTarget.setTimeout = globalThis.setTimeout;
  eventTarget.ghostexGpui = {
    gxserverBootstrap: {
      authToken: "test-token",
      baseUrl: "http://gxserver.test",
      clientId: "test-client",
      ...(initialFocusedSessionId ? { focusedSessionId: initialFocusedSessionId } : {}),
      initialActiveProjectId,
      protocolVersion: GXSERVER_PROTOCOL_VERSION,
      ...(initialVisibleSessionIds ? { visibleSessionIds: initialVisibleSessionIds } : {}),
    },
    postActiveProjectContext: vi.fn(() => true),
    postGxserverPresentationFocusState: vi.fn((payload: string) => {
      focusStatePayloads?.push(JSON.parse(payload));
      return true;
    }),
    ...(focusDebugPayloads
      ? {
          postSessionFocusDebugLog: vi.fn((payload: string) => {
            focusDebugPayloads.push(JSON.parse(payload));
            return true;
          }),
        }
      : {}),
    ...(commandActionPayloads
      ? {
          postSidebarCommandAction: vi.fn((payload: string) => {
            commandActionPayloads.push(JSON.parse(payload));
            return true;
          }),
        }
      : {}),
    ...(commandRunEndPayloads
      ? {
          postSidebarCommandRunEnd: vi.fn((payload: string) => {
            commandRunEndPayloads.push(JSON.parse(payload));
            return true;
          }),
        }
      : {}),
    ...(nativeProjectPathActions
      ? {
          postNativeProjectPathAction: vi.fn((payload: string) => {
            nativeProjectPathActions.push(JSON.parse(payload));
            return true;
          }),
        }
      : {}),
    ...(runtimeSettings ? { runtimeSettings } : {}),
  };
  if (appModalHostMessages) {
    eventTarget.webkit = {
      messageHandlers: {
        ghostexAppModalHost: {
          postMessage: (message: unknown) => {
            appModalHostMessages.push(message);
          },
        },
      },
    };
  }
  return eventTarget;
}

class TestWebSocket extends EventTarget {
  close(): void {}
  send(_data: string): void {}
}

function parseRequestParams(body: BodyInit | null | undefined): Record<string, unknown> {
  if (typeof body !== "string") {
    return {};
  }
  const parsed = JSON.parse(body) as { params?: Record<string, unknown> };
  return parsed.params ?? {};
}

function createGxserverRpcResponse(result: unknown): Response {
  return {
    ok: true,
    text: async () => JSON.stringify({
      ok: true,
      product: "gxserver",
      protocolVersion: GXSERVER_PROTOCOL_VERSION,
      result,
    }),
  } as Response;
}

type RemoteGxserverSidebarRequest = {
  params: Record<string, unknown>;
  path: string;
  remoteMachineId: string;
  requestId: string;
  timeoutMs?: number;
  type: "gpuiRemoteGxserverSidebarRequest";
};

function isRemoteGxserverRequest(
  message: unknown,
  path: string,
  remoteMachineId: string,
): message is RemoteGxserverSidebarRequest {
  return Boolean(message) &&
    typeof message === "object" &&
    (message as Partial<RemoteGxserverSidebarRequest>).type ===
      "gpuiRemoteGxserverSidebarRequest" &&
    (message as Partial<RemoteGxserverSidebarRequest>).path === path &&
    (message as Partial<RemoteGxserverSidebarRequest>).remoteMachineId === remoteMachineId &&
    typeof (message as Partial<RemoteGxserverSidebarRequest>).requestId === "string";
}

function createStatusTestGroup(sessions: SidebarSessionItem[]): SidebarSessionGroup {
  return {
    canFocusMode: true,
    groupId: createGxserverPresentationProjectGroupId("P1alpha"),
    isActive: true,
    isFocusModeActive: false,
    layoutVisibleCount: 1,
    projectContext: {
      canRemoveProject: true,
      editor: {
        diffStats: createDefaultSidebarProjectDiffStats(),
        isOpen: false,
        isSleeping: false,
        projectId: "P1alpha",
        status: "idle",
      },
      path: "/redacted",
    },
    sessions,
    title: "Alpha",
    viewMode: "grid",
    visibleCount: 1,
  };
}

function createStatusTestSession(
  sessionId: string,
  overrides: Partial<SidebarSessionItem> = {},
): SidebarSessionItem {
  return {
    activity: "idle",
    alias: "Agent",
    column: 0,
    displayTitle: "Session",
    isFocused: false,
    isLive: true,
    isRunning: true,
    isVisible: true,
    nativePaneState: "mounted",
    providerSessionState: "exists",
    row: 0,
    sessionId,
    sessionKind: "terminal",
    sessionPersistenceName: `persist-${sessionId}`,
    sessionPersistenceProvider: "zmx",
    shortcutLabel: "1",
    ...overrides,
  };
}

function dispatchRemotePresentationSnapshot(
  remoteMachineId: string,
  snapshot: GxserverPresentationSnapshot,
): void {
  window.dispatchEvent(new CustomEvent("ghostex-gpui-sidebar-remote-event", {
    detail: {
      payload: {
        snapshot,
        type: "presentationSnapshot",
      },
      remoteMachineId,
      type: "remoteGxserverPresentation",
    },
  }));
}

function respondToRemoteGxserverRequest(
  request: RemoteGxserverSidebarRequest,
  result: unknown,
): void {
  window.dispatchEvent(new CustomEvent("ghostex-gpui-sidebar-remote-event", {
    detail: {
      ok: true,
      remoteMachineId: request.remoteMachineId,
      requestId: request.requestId,
      result,
      type: "remoteGxserverResponse",
    },
  }));
}

async function waitForMessage<T>(
  messages: readonly unknown[],
  predicate: (message: unknown) => message is T,
): Promise<T> {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    const match = messages.find(predicate);
    if (match) {
      return match;
    }
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
  throw new Error("Timed out waiting for sidebar runtime message.");
}

function isMessageOfType<TType extends string>(
  message: unknown,
  type: TType,
): message is { type: TType } & Record<string, any> {
  return Boolean(message) &&
    typeof message === "object" &&
    (message as { type?: unknown }).type === type;
}
