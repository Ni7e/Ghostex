import { readFileSync } from "node:fs";
import { describe, expect, test } from "vitest";

const terminalWorkspaceSource = readFileSync(
  new URL("../macos/ghostexHost/Sources/ghostexHost/TerminalWorkspaceView.swift", import.meta.url),
  "utf8",
);

function sourceBetween(start: string, end: string): string {
  const startIndex = terminalWorkspaceSource.indexOf(start);
  const endIndex = terminalWorkspaceSource.indexOf(end, startIndex + start.length);
  expect(startIndex).toBeGreaterThanOrEqual(0);
  expect(endIndex).toBeGreaterThan(startIndex);
  return terminalWorkspaceSource.slice(startIndex, endIndex);
}

describe("native pane focused border source", () => {
  test("keys focused border to the live keyboard responder instead of pane count or mode", () => {
    /*
     * CDXC:NativePaneChrome 2026-06-13-22:17:
     * Focused pane borders should appear in single-pane Agents layouts and in
     * Source/Browser/Kanban companion panes, but only when typing will route to
     * that pane. Source coverage keeps the border predicate tied to AppKit's
     * live first responder instead of split count or project-editor mode.
     */
    const borderPredicateSource = sourceBetween(
      "private func shouldShowFocusedPaneBorder(for sessionId: String) -> Bool",
      "private func commandPanelOwnsResponder() -> Bool",
    );

    expect(borderPredicateSource).toContain("currentResponderSessionId() == sessionId");
    expect(borderPredicateSource).toContain("focusedPaneBorderSettledSessionIds.contains(sessionId)");
    expect(borderPredicateSource).toContain("isFocusedPaneBorderEligible(for: sessionId)");
    expect(borderPredicateSource).toContain("projectEditorCompanionSessionId == sessionId");
    expect(borderPredicateSource).toContain("activeSessionIds.contains(sessionId)");
    expect(borderPredicateSource).toContain("isPlaceholderPaneSession(sessionId)");
    expect(terminalWorkspaceSource).toContain("sleepingSessionIds.contains(sessionId) || isMountingPlaceholderSession(sessionId)");
    expect(borderPredicateSource).not.toContain("orderedVisiblePaneOwnerSessionIds().count > 1");

    const terminalFrameSource = sourceBetween(
      "private func setFrame(",
      "private func setWebPaneFrame(",
    );
    const webPaneFrameSource = sourceBetween(
      "private func setWebPaneFrame(",
      "private func scheduleDeferredWebPaneLayout",
    );
    expect(terminalFrameSource).toContain("session.borderView.setSuppressesFocusedBorder(false)");
    expect(webPaneFrameSource).toContain("session.borderView.setSuppressesFocusedBorder(false)");
    expect(terminalFrameSource).not.toContain("webPaneMode == .projectEditorCompanion");
    expect(webPaneFrameSource).not.toContain("mode == .projectEditorCompanion");
  });

  test("repaints focused borders when AppKit typing focus changes", () => {
    /*
     * CDXC:NativePaneChrome 2026-06-13-22:17:
     * A selected terminal must not keep a focused border after AppKit moves
     * first responder to project-editor, sidebar, titlebar, modal, or window
     * chrome. Repaint native pane borders on responder transitions and after
     * explicit web/editor/companion focus succeeds.
     */
    const responderChangeSource = sourceBetween(
      "func windowFirstResponderChanged(_ responder: NSResponder?, reason: String)",
      "func windowKeyDownDispatch(_ event: NSEvent)",
    );
    const projectEditorFocusSource = sourceBetween(
      "func focusProjectEditorPane(",
      "private func syncProjectEditorTabBars()",
    );
    const webPaneFocusSource = sourceBetween(
      "func focusWebPane(sessionId rawSessionId: String",
      "func createProjectEditorPane",
    );
    const companionFocusSource = sourceBetween(
      "private func activateProjectEditorCompanionPane(",
      "private func syncProjectEditorCompanionRetargetIfEditorStable",
    );

    expect(responderChangeSource).toContain("updateAllTerminalBorders()");
    expect(responderChangeSource).toContain("invalidateFocusedPaneBorderSettlement");
    expect(projectEditorFocusSource).toContain("let didFocusProjectEditor =");
    expect(projectEditorFocusSource).toContain("projectEditorId(containing: $0)");
    expect(projectEditorFocusSource).toContain("invalidateFocusedPaneBorderSettlement");
    expect(projectEditorFocusSource).toContain("updateAllTerminalBorders()");
    expect(webPaneFocusSource).toContain("let didFocusWebPane: Bool");
    expect(webPaneFocusSource).toContain("invalidateFocusedPaneBorderSettlement");
    expect(webPaneFocusSource).toContain("updateAllTerminalBorders()");
    expect(companionFocusSource).toContain("let makeFirstResponderResult: Bool");
    expect(companionFocusSource).toContain("invalidateFocusedPaneBorderSettlement");
    expect(companionFocusSource).toContain("updateAllTerminalBorders()");
  });

  test("defers focused border display until pane focus geometry settles", () => {
    /*
     * CDXC:NativePaneChrome 2026-06-13-23:19:
     * The focused outline should never fly from stale/offscreen layer geometry.
     * Source coverage requires a deferred settlement pass after focus/layout
     * changes and no-action Core Animation frame updates for border layers.
     */
    const borderSettlementSource = sourceBetween(
      "private func shouldShowFocusedPaneBorder(for sessionId: String) -> Bool",
      "private func commandPanelOwnsResponder() -> Bool",
    );
    const layerGeometrySource = sourceBetween(
      "private func moveOffscreen(_ layer: CALayer)",
      "private func updateAllTerminalBorders()",
    );
    const terminalWorkspaceSourceWithoutHelper = terminalWorkspaceSource.replace(
      /private func setPaneBorderFrame\([\s\S]*?private func performWithoutLayerActions/,
      "private func performWithoutLayerActions",
    );

    expect(borderSettlementSource).toContain("scheduledFocusedPaneBorderSettlementSessionIds");
    expect(borderSettlementSource).toContain("DispatchQueue.main.async");
    expect(borderSettlementSource).toContain("layoutSubtreeIfNeeded()");
    expect(borderSettlementSource).toContain("isFocusedPaneBorderGeometrySettled(for: sessionId)");
    expect(borderSettlementSource).toContain("focusedPaneBorderSettledSessionIds = [sessionId]");
    expect(layerGeometrySource).toContain("CATransaction.setDisableActions(true)");
    expect(layerGeometrySource).toContain("setPaneBorderFrame(");
    expect(terminalWorkspaceSourceWithoutHelper).not.toMatch(/borderView\.frame\s*=/);
  });
});
