import { readFileSync } from "node:fs";
import { describe, expect, test } from "vitest";

const terminalWorkspaceViewSource = readFileSync(
  new URL("../macos/ghostexHost/Sources/ghostexHost/TerminalWorkspaceView.swift", import.meta.url),
  "utf8",
);
const nativeSidebarSource = readFileSync(new URL("./native-sidebar.tsx", import.meta.url), "utf8");

function sourceBetween(source: string, start: string, end: string): string {
  const startIndex = source.indexOf(start);
  const endIndex = source.indexOf(end, startIndex + start.length);
  expect(startIndex).toBeGreaterThan(-1);
  expect(endIndex).toBeGreaterThan(startIndex);
  return source.slice(startIndex, endIndex);
}

describe("native pane tabs overflow menu source", () => {
  test("keeps per-session actions out of overflow while retaining tab context actions", () => {
    /*
     * CDXC:PaneTabs 2026-06-19-07:48:
     * The far-right native tab-bar overflow menu must omit per-session commands,
     * but the clicked tab's context menu must keep those commands because it has
     * explicit tab scope for Rename, Delayed Send, Close After Done, Fork, Reload,
     * and Pop Out/Restore Pane.
     */
    const excludedActionsSource = sourceBetween(
      terminalWorkspaceViewSource,
      "  private static let collapsedActionMenuExcludedActions: Set<TerminalTitleBarAction> = [",
      "  private static func collapsedActionMenuVisibleActions",
    );
    const layoutSource = sourceBetween(
      terminalWorkspaceViewSource,
      "    var nextLayoutHiddenActions = Set<TerminalTitleBarAction>()",
      "    let minimumContentWidthForCollapsedControls =",
    );
    const overflowMenuSource = sourceBetween(
      terminalWorkspaceViewSource,
      "  private func showCollapsedActionMenu(from _: NSButton, source: String) {",
      "  @objc private func performCollapsedActionMenuItem",
    );
    const tabContextMenuSource = sourceBetween(
      terminalWorkspaceViewSource,
      "  private func primaryTabContextMenuActions() -> [TerminalTitleBarAction] {",
      "  private func addTabActionMenuItem",
    );

    for (const action of [
      ".rename",
      ".delayedSend",
      ".closeAfterDone",
      ".fork",
      ".reload",
      ".popOut",
      ".restorePopOut",
    ]) {
      expect(excludedActionsSource).toContain(action);
    }
    expect(layoutSource).toContain(
      "let collapsedMenuCandidateActions = nonCloseActions.filter { $0 != .newTerminal && $0 != .openBrowser }",
    );
    expect(layoutSource).toContain(
      "let collapsedMenuEligibleActions = Self.collapsedActionMenuVisibleActions(from: collapsedMenuCandidateActions)",
    );
    expect(layoutSource).toContain("&& !collapsedMenuCandidateActions.isEmpty");
    expect(terminalWorkspaceViewSource).toContain(
      "if canReserveCollapsedActionMenu && !collapsedMenuEligibleActions.isEmpty",
    );
    expect(overflowMenuSource).toContain(
      "let actions = Self.collapsedActionMenuVisibleActions(from: collapsedActionMenuActions)",
    );
    expect(tabContextMenuSource).toContain(
      "contextMenuActions.contains(.restorePopOut) ? .restorePopOut : .popOut",
    );
    expect(tabContextMenuSource).toContain(
      "return [.rename, .delayedSend, .closeAfterDone, .fork, .reload, popOutAction]",
    );
  });

  test("keeps command-panel tabs on panel-only actions while workspace tab menus retain session actions", () => {
    /**
     * CDXC:CommandPanelTabs 2026-06-27-01:55:
     * Command-panel sessions must publish only command-panel titlebar actions: pin/unpin plus close while the panel is visible, and expand while it is hidden.
     * Workspace tab context menus must remain the source of Rename, Delayed Send, Close After Done, Fork, Reload, and Pop Out/Restore Pane rows so GPUI does not copy those workspace-only actions or their primary-action separator into command-pane tab right-click menus.
     */
    const sidebarTitleBarActionsSource = sourceBetween(
      nativeSidebarSource,
      "    sessionTitleBarActions[nativeSessionId] =",
      "    if (session.isSleeping === true) {",
    );
    const commandPanelActionSource = sourceBetween(
      sidebarTitleBarActionsSource,
      'session.kind === "terminal" && session.surface === "commands"',
      "        : getNativePaneTitleBarActions(session);",
    );
    const commandPanelSwiftSource = sourceBetween(
      terminalWorkspaceViewSource,
      "  private func commandPanelTitleBarActions() -> [TerminalTitleBarAction] {",
      "  private func persistenceLabelFrame",
    );
    const tabContextMenuSource = sourceBetween(
      terminalWorkspaceViewSource,
      "  private func primaryTabContextMenuActions() -> [TerminalTitleBarAction] {",
      "  private func addTabActionMenuItem",
    );
    const tabRightClickSource = sourceBetween(
      terminalWorkspaceViewSource,
      "  override func rightMouseDown(with event: NSEvent) {",
      "  private func primaryTabContextMenuActions() -> [TerminalTitleBarAction] {",
    );

    expect(commandPanelActionSource).toContain("commandsPanel.isVisible");
    expect(commandPanelActionSource).toContain(
      'commandsPanel.mode === "pinned" ? "unpinCommandsPanel" : "pinCommandsPanel"',
    );
    expect(commandPanelActionSource).toContain('"closeCommandsPanel"');
    expect(commandPanelActionSource).toContain(': ["expandCommandsPanel"]');
    expect(sidebarTitleBarActionsSource).toContain(": getNativePaneTitleBarActions(session)");

    expect(commandPanelSwiftSource).toContain(
      "commandsPanelMode == \"pinned\" ? .unpinCommandsPanel : .pinCommandsPanel",
    );
    expect(commandPanelSwiftSource).toContain(".closeCommandsPanel");
    expect(commandPanelSwiftSource).toContain("return [.expandCommandsPanel]");

    for (const action of [
      '"rename"',
      '"delayedSend"',
      '"closeAfterDone"',
      '"fork"',
      '"reload"',
      '"popOut"',
      '"restorePopOut"',
      ".rename",
      ".delayedSend",
      ".closeAfterDone",
      ".fork",
      ".reload",
      ".popOut",
      ".restorePopOut",
    ]) {
      expect(commandPanelActionSource).not.toContain(action);
      expect(commandPanelSwiftSource).not.toContain(action);
    }

    expect(tabContextMenuSource).toContain(
      "contextMenuActions.contains(.restorePopOut) ? .restorePopOut : .popOut",
    );
    expect(tabContextMenuSource).toContain(
      "return [.rename, .delayedSend, .closeAfterDone, .fork, .reload, popOutAction]",
    );
    expect(tabRightClickSource).toContain("if !primaryActions.isEmpty");
    expect(tabRightClickSource).toContain("menu.addItem(NSMenuItem.separator())");
  });
});
