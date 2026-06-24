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

describe("native pane pop-out titlebar source", () => {
  test("hides popped-out pane action chrome while preserving close-to-reattach", () => {
    /*
     * CDXC:PanePopOut 2026-06-22-13:49:
     * Popped-out macOS session windows must not show the far-right pane-actions
     * grid button. The red window close control remains the reattach affordance.
     */
    const poppedOutActionsSource = sourceBetween(
      terminalWorkspaceViewSource,
      "  private func poppedOutPaneTitleBarActions(sessionId _: String) -> [TerminalTitleBarAction] {",
      "  private func handlePaneTabActionRequested",
    );
    const poppedOutControllerSource = sourceBetween(
      terminalWorkspaceViewSource,
      "private final class PoppedOutPaneWindowController: NSWindowController, NSWindowDelegate {",
      "private final class PoppedOutTerminalPaneContentView",
    );

    expect(poppedOutActionsSource).toContain("return []");
    expect(poppedOutActionsSource).not.toContain(".restorePopOut");
    expect(poppedOutControllerSource).toContain("func windowShouldClose(_ sender: NSWindow) -> Bool");
    expect(poppedOutControllerSource).toContain("onReattachRequested(sessionId)");
    expect(poppedOutControllerSource).toContain("return false");
  });
});
