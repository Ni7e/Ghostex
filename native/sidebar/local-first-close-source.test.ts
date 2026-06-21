import { readFileSync } from "node:fs";
import { describe, expect, test } from "vitest";

const nativeSidebarSource = readFileSync(new URL("./native-sidebar.tsx", import.meta.url), "utf8");
const sortableSessionCardSource = readFileSync(
  new URL("../../sidebar/sortable-session-card.tsx", import.meta.url),
  "utf8",
);

function sourceBetween(source: string, start: string, end: string): string {
  const startIndex = source.indexOf(start);
  const endIndex = source.indexOf(end, startIndex + start.length);
  expect(startIndex).toBeGreaterThan(-1);
  expect(endIndex).toBeGreaterThan(startIndex);
  return source.slice(startIndex, endIndex);
}

describe("local-first sidebar close source", () => {
  test("flushes sidebar row removal before background native close work", () => {
    /*
     * CDXC:LocalFirstSidebar 2026-06-12-06:22:
     * Closing a sidebar tab/card must update local React state before native
     * terminal teardown starts. Source coverage keeps the macOS synchronous
     * message bridge from regressing back into blocking the click handler.
     */
    const requestCloseSource = sourceBetween(
      sortableSessionCardSource,
      "  const requestClose = (",
      "  const requestCopyResumeCommand = () => {",
    );
    const postCloseHelperSource = sourceBetween(
      sortableSessionCardSource,
      "function postSidebarSessionCloseInBackground(",
      "function postSidebarSessionsCloseInBackground(",
    );
    const sidebarMessageHandlerIndex = nativeSidebarSource.indexOf(
      "function handleSidebarMessage(message: SidebarToExtensionMessage): void {",
    );
    expect(sidebarMessageHandlerIndex).toBeGreaterThan(-1);
    const sidebarMessageHandlerSource = nativeSidebarSource.slice(sidebarMessageHandlerIndex);
    const nativeCloseCaseSource = sourceBetween(
      sidebarMessageHandlerSource,
      '    case "closeSession":',
      '    case "closeSessions": {',
    );

    expect(requestCloseSource).toContain("flushSync(() => {");
    expect(requestCloseSource.indexOf("flushSync(() => {")).toBeLessThan(
      requestCloseSource.indexOf("postSidebarSessionCloseInBackground(vscode, session.sessionId);"),
    );
    expect(postCloseHelperSource).toContain("globalThis.setTimeout(() => {");
    expect(postCloseHelperSource).toContain('type: "closeSession"');
    expect(nativeCloseCaseSource).toContain("closeNativeSessionsInBackground([message.sessionId]);");
    expect(nativeCloseCaseSource).not.toContain("closeTerminal(message.sessionId);");
  });

  test("closes the final project terminal instead of parking it asleep", () => {
    /*
     * CDXC:LocalFirstSidebar 2026-06-15-20:14:
     * The last visible terminal in a normal project must close all the way so
     * the project can show its empty New Session row. Source coverage keeps the
     * close path from reintroducing the previous last-session sleep branch.
     */
    const closeTerminalSource = sourceBetween(
      nativeSidebarSource,
      "function closeTerminal(",
      "function focusTerminal(",
    );

    expect(nativeSidebarSource).not.toContain("shouldParkLastProjectSidebarSessionOnClose");
    expect(closeTerminalSource).toContain("hideGxserverPresentationSessionLocally(");
    expect(closeTerminalSource).toContain(
      'const transitionResult = applyGxserverSessionTransition(\n    reference,\n    sessionRecord,\n    "close",',
    );
    expect(closeTerminalSource).not.toContain("shouldParkLastProjectSession");
    expect(closeTerminalSource).not.toContain('"sleep" : "close"');
  });

  test("hides the commands panel when manual close removes its final command tab", () => {
    /*
     * CDXC:CommandsPanel 2026-06-15-23:23:
     * Manual command-pane tab close must use the same empty-panel invariant as
     * command process-exit cleanup. When no command sessions remain, the bottom
     * native panel is not visible and must not retain its last resize height.
     */
    const closeTerminalSource = sourceBetween(
      nativeSidebarSource,
      "function closeTerminal(",
      "function focusTerminal(",
    );
    const commandPanelCloseSource = sourceBetween(
      closeTerminalSource,
      'if (sessionRecord?.kind === "terminal" && sessionRecord.surface === "commands") {',
      "  const transitionOrigin = options.transitionOrigin",
    );

    expect(commandPanelCloseSource).toContain(
      "isVisible: sessions.length > 0 ? panel.isVisible : false",
    );
  });

  test("keeps project-editor mode when hiding commands with the companion collapsed", () => {
    /*
     * CDXC:CommandsPanel 2026-06-16-08:19:
     * Hiding the Commands panel from Source, Browser, or Kanban with the
     * companion pane collapsed must not restore workspace-terminal focus and
     * implicitly switch the titlebar back to Agents. The explicit Agents button
     * remains responsible for restoring the last focused workspace terminal.
     */
    const hideCommandsPanelSource = sourceBetween(
      nativeSidebarSource,
      "function hideCommandsPanelForActiveProject(): void {",
      "function toggleCommandsPanelForActiveProject(): void {",
    );
    const commandsPanelFocusPolicySource = sourceBetween(
      nativeSidebarSource,
      "function shouldRestoreSessionFocusAfterCommandsPanelHide",
      "function focusProjectEditorCompanionSessionAfterExpand",
    );
    const agentsModeSource = sourceBetween(
      nativeSidebarSource,
      "function openAgentsModeFromTitlebar(): void {",
      "function toggleProjectEditorCompanionFromTitlebar(): void {",
    );

    expect(hideCommandsPanelSource).toContain("shouldRestoreSessionFocusAfterCommandsPanelHide(project)");
    expect(commandsPanelFocusPolicySource).toContain("surfaceState?.isOpen !== true");
    expect(commandsPanelFocusPolicySource).toContain("project.projectEditorCompanionPaneHidden !== true");
    expect(agentsModeSource.indexOf("agentsModeFocusSessionIdForProject(project)")).toBeLessThan(
      agentsModeSource.indexOf("activateWorkspaceSurfaceForProject(project.projectId)"),
    );
    expect(agentsModeSource).toContain(
      "focusTerminal(createCombinedProjectSessionId(project.projectId, focusSessionId));",
    );
  });

  test("keeps the focused browser pane when hiding commands from agents mode", () => {
    /*
     * CDXC:CommandsPanel 2026-06-21-17:16:
     * Hiding the Commands panel from Agents mode must restore the active workspace
     * pane, not the last remembered terminal. A focused Browser pane is a valid
     * workspace focus target and should stay focused after Commands collapses.
     */
    const restoreTargetSource = sourceBetween(
      nativeSidebarSource,
      "function commandsPanelRestoreSessionId(project: NativeProject): string | undefined {",
      "function agentsModeFocusSessionIdForProject(project: NativeProject): string | undefined {",
    );
    const hideCommandsPanelSource = sourceBetween(
      nativeSidebarSource,
      "function hideCommandsPanelForActiveProject(): void {",
      "function toggleCommandsPanelForActiveProject(): void {",
    );
    const agentsModeSource = sourceBetween(
      nativeSidebarSource,
      "function openAgentsModeFromTitlebar(): void {",
      "function toggleProjectEditorCompanionFromTitlebar(): void {",
    );

    expect(hideCommandsPanelSource).toContain("commandsPanelRestoreSessionId(project)");
    expect(restoreTargetSource).toContain("const sessionId = focusedWorkspaceSessionIdForProject(project);");
    expect(restoreTargetSource).toContain(
      'if (session && (session.kind !== "terminal" || session.surface !== "commands"))',
    );
    expect(restoreTargetSource).toContain("return sessionId;");
    expect(restoreTargetSource).toContain("return rememberedWorkspaceTerminal(project);");
    expect(agentsModeSource).toContain("agentsModeFocusSessionIdForProject(project)");
  });
});
