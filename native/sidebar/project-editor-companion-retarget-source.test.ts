import { readFileSync } from "node:fs";
import { describe, expect, test } from "vitest";

const terminalWorkspaceSource = readFileSync(
  new URL("../macos/ghostexHost/Sources/ghostexHost/TerminalWorkspaceView.swift", import.meta.url),
  "utf8",
);
const hostProtocolSource = readFileSync(
  new URL("../macos/ghostexHost/Sources/ghostexHost/HostProtocol.swift", import.meta.url),
  "utf8",
);
const appDelegateSource = readFileSync(
  new URL("../macos/ghostexHost/Sources/ghostexHost/AppDelegate.swift", import.meta.url),
  "utf8",
);
const nativeSidebarSource = readFileSync(new URL("./native-sidebar.tsx", import.meta.url), "utf8");

function sourceBetween(source: string, start: string, end: string): string {
  const startIndex = source.indexOf(start);
  const endIndex = source.indexOf(end, startIndex + start.length);
  expect(startIndex).toBeGreaterThanOrEqual(0);
  expect(endIndex).toBeGreaterThan(startIndex);
  return source.slice(startIndex, endIndex);
}

describe("project editor companion retarget source", () => {
  test("allows mounted terminals to retarget the companion even if mounting state overlaps", () => {
    /*
     * CDXC:ProjectEditorCompanion 2026-06-15-09:55:
     * Source/Browser/Kanban sidebar clicks must surface the selected session in
     * the companion pane. Mounting state should block only true placeholders
     * without a render surface, not already-mounted terminal or web-pane views.
     */
    const eligibilitySource = sourceBetween(
      terminalWorkspaceSource,
      "private func isProjectEditorCompanionEligibleSession",
      "func focusProjectEditorCompanionSession",
    );
    expect(eligibilitySource).toContain("!isMountingPlaceholderSession(sessionId)");
    expect(eligibilitySource).not.toContain("!mountingSessionIds.contains(sessionId)");
    expect(terminalWorkspaceSource).toContain(
      "mountingSessionIds.contains(sessionId) && !hasPaneRenderSurface(sessionId)",
    );

    const focusCommandSource = sourceBetween(
      terminalWorkspaceSource,
      "func focusProjectEditorCompanionSession",
      "private func scheduleDelayedProjectEditorCompanionClick",
    );
    expect(focusCommandSource).toContain('"mountingSessionIds"');
    expect(focusCommandSource).toContain('"hasPaneRenderSurface"');
    expect(focusCommandSource).toContain('"isMountingPlaceholderSession"');
  });

  test("moves the old rendered companion surface before focusing the requested session", () => {
    /*
     * CDXC:ProjectEditorCompanion 2026-06-13-22:39:
     * Source/Browser/Kanban sidebar clicks can update sidebar selection before
     * the explicit native focus command runs. Source coverage keeps native
     * retargeting keyed to the actually rendered companion surface so the old
     * terminal is hidden before the clicked terminal is focused.
     */
    expect(terminalWorkspaceSource).toContain(
      "private var projectEditorCompanionRenderedSessionId: String?",
    );

    const retargetSource = sourceBetween(
      terminalWorkspaceSource,
      "private func syncProjectEditorCompanionRetargetIfEditorStable",
      "private func scheduleDelayedProjectEditorCompanionClick",
    );
    const moveOldSurfaceIndex = retargetSource.indexOf(
      "moveRenderedProjectEditorCompanionSurfaceOffscreen(",
    );
    const syncNewSurfaceIndex = retargetSource.indexOf(
      "syncProjectEditorCompanionPane(layout: companionLayout)",
    );
    expect(moveOldSurfaceIndex).toBeGreaterThanOrEqual(0);
    expect(syncNewSurfaceIndex).toBeGreaterThan(moveOldSurfaceIndex);
    expect(retargetSource).toContain("previousSessionId: previousSessionId");

    const syncPaneSource = sourceBetween(
      terminalWorkspaceSource,
      "private func syncProjectEditorCompanionPane(layout: ProjectEditorCompanionLayout?)",
      "private func moveRenderedProjectEditorCompanionSurfaceOffscreen",
    );
    const syncPaneMoveIndex = syncPaneSource.indexOf(
      "moveRenderedProjectEditorCompanionSurfaceOffscreen(except: layout.sessionId)",
    );
    const setFrameIndex = syncPaneSource.indexOf(
      "setFrame(layout.contentFrame, for: layout.sessionId, webPaneMode: .projectEditorCompanion)",
    );
    const rememberRenderedIndex = syncPaneSource.indexOf(
      "projectEditorCompanionRenderedSessionId = layout.sessionId",
    );
    expect(syncPaneMoveIndex).toBeGreaterThanOrEqual(0);
    expect(setFrameIndex).toBeGreaterThan(syncPaneMoveIndex);
    expect(rememberRenderedIndex).toBeGreaterThan(setFrameIndex);

    const helperSource = sourceBetween(
      terminalWorkspaceSource,
      "private func moveRenderedProjectEditorCompanionSurfaceOffscreen",
      "private func syncProjectEditorCompanionRightSeparator",
    );
    expect(helperSource).toContain("projectEditorCompanionRenderedSessionId");
    expect(helperSource).toContain("movePaneSessionOffscreen(candidateSessionId)");
    expect(helperSource).toContain("previousSessionId");
  });

  test("rejects delayed synthetic clicks that would hit a stale companion session", () => {
    /*
     * CDXC:ProjectEditorCompanion 2026-06-13-22:39:
     * The delayed sidebar-focus click may reinforce typing focus, but it must
     * not be allowed to leave focus on any session except the one requested by
     * the sidebar card click.
     */
    const delayedClickSource = sourceBetween(
      terminalWorkspaceSource,
      "private func performDelayedProjectEditorCompanionClick",
      "private func projectEditorCompanionFocusTargetView",
    );
    const renderedGuardIndex = delayedClickSource.indexOf(
      "guard projectEditorCompanionRenderedSessionId == sessionId",
    );
    const hitTargetGuardIndex = delayedClickSource.indexOf(
      "guard projectEditorCompanionHitTargetMatches(",
    );
    const sendEventIndex = delayedClickSource.indexOf("targetWindow.sendEvent(mouseDown)");
    expect(renderedGuardIndex).toBeGreaterThanOrEqual(0);
    expect(hitTargetGuardIndex).toBeGreaterThan(renderedGuardIndex);
    expect(sendEventIndex).toBeGreaterThan(hitTargetGuardIndex);
    expect(delayedClickSource).toContain('"skipReason": "renderedSessionMismatch"');
    expect(delayedClickSource).toContain('"skipReason": "hitTargetMismatch"');
    expect(delayedClickSource).toContain(
      'event: "nativeFocusTrace.projectEditorCompanionDelayedClickMismatchCorrected"',
    );

    const hitTargetSource = sourceBetween(
      terminalWorkspaceSource,
      "private func projectEditorCompanionHitTargetMatches",
      "private func syntheticCompanionMouseEvent",
    );
    expect(hitTargetSource).toContain("contentView.hitTest(contentPoint)");
    expect(hitTargetSource).toContain("hitView === targetView || hitView.isDescendant(of: targetView)");
  });

  test("uses one explicit native companion retarget command from the sidebar", () => {
    const sidebarPostSource = sourceBetween(
      nativeSidebarSource,
      "function postNativeFocusProjectEditorCompanionForCurrentIntent",
      "function summarizeNativeLayoutLeafSessionIds",
    );
    expect(sidebarPostSource).toContain('type: "retargetProjectEditorCompanionSession"');
    expect(sidebarPostSource).not.toContain('type: "focusProjectEditorCompanionSession"');

    expect(hostProtocolSource).toContain(
      "case retargetProjectEditorCompanionSession(SessionCommand)",
    );
    expect(hostProtocolSource).toContain("case retargetProjectEditorCompanionSession");
    expect(hostProtocolSource).toContain(
      "self = .retargetProjectEditorCompanionSession(try SessionCommand(from: decoder))",
    );

    const sidebarCommandSource = sourceBetween(
      appDelegateSource,
      "private func handleSidebarCommand(_ command: HostCommand)",
      "private enum SidebarWorkspaceFocusKind",
    );
    expect(sidebarCommandSource).toContain(
      "case .retargetProjectEditorCompanionSession(let command):",
    );
    expect(sidebarCommandSource).toContain("kind: .projectEditorCompanion");
  });

  test("expanding the companion focuses the rendered companion session", () => {
    /*
     * CDXC:ProjectEditorCompanion 2026-06-16-08:19:
     * Reopening the Source/Browser/Kanban companion pane should focus the
     * selected companion session, especially after the Commands panel was
     * collapsed without switching back to Agents.
     */
    const helperSource = sourceBetween(
      nativeSidebarSource,
      "function focusProjectEditorCompanionSessionAfterExpand",
      "/**\n * CDXC:CommandsPanel 2026-05-14-09:41",
    );
    const toggleSource = sourceBetween(
      nativeSidebarSource,
      "function toggleProjectEditorCompanionFromTitlebar(): void {",
      "function openProjectGitEditorSurface",
    );

    expect(helperSource).toContain("focusedWorkspaceSessionIdForProject(project)");
    expect(helperSource).toContain(
      "focusTerminal(createCombinedProjectSessionId(project.projectId, sessionId));",
    );
    expect(toggleSource).toContain(
      "if (!nextHidden && focusProjectEditorCompanionSessionAfterExpand(project))",
    );
  });
});
