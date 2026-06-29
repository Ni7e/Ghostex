import { describe, expect, test } from "vitest";
import {
  createGxserverPresentationSidebarSession,
} from "./gxserver-presentation-sidebar-projection";
import type {
  GxserverPresentationSession,
  GxserverProjectId,
  GxserverSessionId,
  GxserverZmxSessionName,
} from "./gxserver-protocol";

describe("gxserver presentation sidebar projection", () => {
  test("carries title, lifecycle, activity, tag, and zmx metadata into sidebar rows", () => {
    const projectId = "P3a91" as GxserverProjectId;
    const sessionId = "G8v20" as GxserverSessionId;
    const session = createPresentationSession({
      displayTitle: "ghostex@remote: ~/ghostex",
      displayTitleTooltip: "ghostex@remote: ~/ghostex",
      lifecycleState: "running",
      primaryTitle: "Remote Ghostex",
      providerSessionState: "exists",
      sessionId,
      sessionPersistenceProvider: "zmx",
      sessionTag: "blocked",
      terminalTitle: "ghostex@remote: ~/ghostex",
      zmxName: "S7k-P3a91-G8v20" as GxserverZmxSessionName,
    });

    const row = createGxserverPresentationSidebarSession({
      createProjectSessionId: (projectId, sessionId) =>
        `remote:machine-1:session:${projectId}:${sessionId}`,
      focusedSessionId: sessionId,
      index: 0,
      isActiveProject: true,
      presentation: session,
      projectId,
      resolveAgentIcon: () => "codex",
    });

    expect(row).toMatchObject({
      activity: "idle",
      agentIcon: "codex",
      displayTitle: "ghostex@remote: ~/ghostex",
      displayTitleTooltip: "ghostex@remote: ~/ghostex",
      isFocused: true,
      isLive: true,
      isRunning: true,
      lifecycleState: "running",
      primaryTitle: "Remote Ghostex",
      providerSessionState: "exists",
      sessionId: "remote:machine-1:session:P3a91:G8v20",
      sessionPersistenceName: "S7k-P3a91-G8v20",
      sessionPersistenceProvider: "zmx",
      sessionTag: "blocked",
      terminalTitle: "ghostex@remote: ~/ghostex",
    });
  });
});

function createPresentationSession(
  overrides: Partial<GxserverPresentationSession> = {},
): GxserverPresentationSession {
  return {
    actions: {
      acknowledgeAttention: false,
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
    createdAt: "2026-06-30T00:00:00.000Z",
    groupId: "P3a91:active",
    isFavorite: false,
    isGeneratingFirstPromptTitle: false,
    isPinned: false,
    isPrimaryTitleTerminalTitle: true,
    isTemporaryTitle: false,
    kind: "terminal",
    lifecycleState: "running",
    projectId: "P3a91" as GxserverProjectId,
    providerSessionState: "exists",
    sessionId: "G8v20" as GxserverSessionId,
    sortKey: "0:G8v20",
    surface: "workspace",
    title: "Remote Session",
    titleSource: "terminal-auto",
    updatedAt: "2026-06-30T00:00:00.000Z",
    visibleInSidebarByDefault: true,
    zmxName: "S7k-P3a91-G8v20" as GxserverZmxSessionName,
    ...overrides,
  };
}
