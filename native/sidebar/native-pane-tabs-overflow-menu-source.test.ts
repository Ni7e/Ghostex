import { readFileSync } from "node:fs";
import { describe, expect, test } from "vitest";

const terminalWorkspaceViewSource = readFileSync(
  new URL("../macos/ghostexHost/Sources/ghostexHost/TerminalWorkspaceView.swift", import.meta.url),
  "utf8",
);

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
});
