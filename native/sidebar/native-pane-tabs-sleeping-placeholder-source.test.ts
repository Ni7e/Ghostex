import { readFileSync } from "node:fs";
import { describe, expect, test } from "vitest";

const terminalWorkspaceSource = readFileSync(
  new URL("../macos/ghostexHost/Sources/ghostexHost/TerminalWorkspaceView.swift", import.meta.url),
  "utf8",
);

function sourceSection(startNeedle: string, endNeedle: string, fromIndex = 0): string {
  const startIndex = terminalWorkspaceSource.indexOf(startNeedle, fromIndex);
  expect(startIndex).toBeGreaterThanOrEqual(0);
  const endIndex = terminalWorkspaceSource.indexOf(endNeedle, startIndex + startNeedle.length);
  expect(endIndex).toBeGreaterThan(startIndex);
  return terminalWorkspaceSource.slice(startIndex, endIndex);
}

describe("native pane tab sleeping placeholders", () => {
  test("keeps selected sleeping tabs as native pane owners without a full relayout", () => {
    /*
     * CDXC:SleepingPanePlaceholders 2026-06-13-20:27:
     * Native tab clicks can use the optimized owner-selection path. That path
     * must treat selected sleeping tabs as valid pane owners, create the black
     * placeholder in the existing pane rect, and move old awake renderers away.
     */
    const ownerSelectionSource = sourceSection(
      "private func applyPaneOwnerSelection(",
      "private func isPaneSessionVisible(_ sessionId: String, role: PaneContentLayoutRole)",
    );

    expect(ownerSelectionSource).toContain("isPaneSessionLayoutVisible($0, role: role)");
    expect(ownerSelectionSource).toContain("let mountedTabSessionIds = tabSessionIds.filter");
    expect(ownerSelectionSource).toContain(
      "activeSessionId.flatMap { tabSessionIds.contains($0) ? $0 : nil }",
    );
    expect(ownerSelectionSource).toContain("sessionIds: Set(tabSessionIds)");
    expect(ownerSelectionSource).toContain("for sessionId in tabSessionIds where sessionId != selectedSessionId");
    expect(ownerSelectionSource).toContain("setSleepingPanePlaceholderFrame(");
    expect(ownerSelectionSource).not.toContain(
      "activeSessionId.flatMap { activeTabSessionIds.contains($0) ? $0 : nil }",
    );
  });

  test("does not repaint sleeping placeholder chrome back to an awake sibling", () => {
    /*
     * CDXC:SleepingPanePlaceholders 2026-06-13-20:27:
     * Chrome-only metadata sync must not filter the active tab through mounted
     * renderers. A selected sleeping placeholder has no renderer but still owns
     * the active titlebar and tab highlight.
     */
    const chromeSyncSource = sourceSection(
      "private func syncPaneTabChrome(in node: NativeTerminalLayout)",
      "private func setWebPaneFrame(",
    );

    expect(chromeSyncSource).toContain("let tabSessionIds = sessionIds.filter { isPaneSessionLayoutVisible($0) }");
    expect(chromeSyncSource).toContain("let mountedTabSessionIds = tabSessionIds.filter");
    expect(chromeSyncSource).toContain(
      "activeSessionId.flatMap { tabSessionIds.contains($0) ? $0 : nil }",
    );
    expect(chromeSyncSource).toContain("setPaneTabs(tabSessionIds, activeSessionId: selectedSessionId");
    expect(chromeSyncSource).not.toContain(
      "activeSessionId.flatMap { activeTabSessionIds.contains($0) ? $0 : nil }",
    );
  });

  test("centers the press-any-key wake affordance in sleeping placeholders", () => {
    /*
     * CDXC:SleepingPanePlaceholders 2026-06-13-21:26:
     * The wake affordance should say "Press Any Key to Wake" and keep enough
     * label width for the final glyph instead of clipping the last letter.
     */
    const placeholderContentSource = sourceSection(
      "private final class SleepingPanePlaceholderContentView",
      "private protocol TerminalPaneOwnedOverlayLayer",
    );

    expect(placeholderContentSource).toContain(
      'private let wakeLabel = NSTextField(wrappingLabelWithString: "Press Any Key to Wake")',
    );
    expect(placeholderContentSource).toContain("wakeLabel.font = NSFont.systemFont(ofSize: 13, weight: .medium)");
    expect(placeholderContentSource).toContain("wakeLabel.alignment = .center");
    expect(placeholderContentSource).toContain("wakeLabel.lineBreakMode = .byCharWrapping");
    expect(placeholderContentSource).toContain("wakeLabel.maximumNumberOfLines = 0");
    expect(placeholderContentSource).toContain("wakeLabel.cell?.wraps = true");
    expect(placeholderContentSource).toContain("let maxLabelWidth = max(bounds.width - 8, 0)");
    expect(placeholderContentSource).toContain("paragraphStyle.lineBreakMode = .byCharWrapping");
    expect(placeholderContentSource).toContain("let labelWidth = min(max(ceil(labelSize.width) + 8, 1), maxLabelWidth)");
    expect(placeholderContentSource).toContain("let labelHeight = min(max(ceil(labelSize.height), 18), maxLabelHeight)");
    expect(placeholderContentSource).toContain("x: bounds.midX - (labelWidth / 2)");
    expect(placeholderContentSource).toContain("y: bounds.midY - (labelHeight / 2)");
    expect(placeholderContentSource).not.toContain("wakeLabel.lineBreakMode = .byTruncatingTail");
    expect(placeholderContentSource).not.toContain("x: max(12, bounds.maxX - labelWidth - 12)");
    expect(placeholderContentSource).not.toContain("y: max(8, bounds.minY + 8)");
  });

  test("wakes selected sleeping placeholders from alphanumeric key presses", () => {
    /*
     * CDXC:SleepingPanePlaceholders 2026-06-13-21:26:
     * Press Any Key to Wake means letter and number keys only; command/control/
     * option/function shortcuts should keep their normal AppKit routing.
     */
    const activeSetSource = sourceSection(
      "func setActiveTerminalSet(",
      "func setSessionPaneChrome(",
    );
    const focusSource = sourceSection(
      "private func focusSleepingPanePlaceholder(",
      "func createProjectEditorPane(",
    );
    const focusTargetSource = sourceSection(
      "private func workspaceFocusTarget(",
      "private func isViewHiddenFromWindow",
    );
    const responderLookupSource = sourceSection(
      "private func sessionId(containing responder: NSResponder) -> String?",
      "private func projectEditorId(containing responder: NSResponder) -> String?",
    );
    const placeholderContentSource = sourceSection(
      "private final class SleepingPanePlaceholderContentView",
      "private protocol TerminalPaneOwnedOverlayLayer",
    );

    expect(activeSetSource).toContain("command.focusedSessionId.flatMap { isPaneSessionLayoutVisible($0) ? $0 : nil }");
    expect(activeSetSource).toContain("isCommandPaneSessionLayoutVisible($0) ? $0 : nil");
    expect(activeSetSource).toContain('focusSleepingPanePlaceholder(sessionId: focusedSessionId, reason: "setActiveTerminalSet")');
    expect(focusSource).toContain("session.contentView.window?.makeFirstResponder(session.contentView)");
    expect(focusSource).toContain("sendEvent(.terminalFocused(sessionId: sessionId))");
    expect(focusTargetSource).toContain("session.contentView");
    expect(focusTargetSource).toContain('"sleepingPlaceholder"');
    expect(responderLookupSource).toContain("for (sessionId, session) in sleepingPanePlaceholderSessions");
    expect(responderLookupSource).toContain("responderView === session.contentView || responderView.isDescendant(of: session.contentView)");
    expect(placeholderContentSource).toContain("override var acceptsFirstResponder: Bool");
    expect(placeholderContentSource).toContain("override func keyDown(with event: NSEvent)");
    expect(placeholderContentSource).toContain("Self.isAlphanumericWakeKey(event)");
    expect(placeholderContentSource).toContain("window?.makeFirstResponder(self)");
    expect(placeholderContentSource).toContain("private static func isAlphanumericWakeKey(_ event: NSEvent) -> Bool");
    expect(placeholderContentSource).toContain("flags.isDisjoint(with: [.command, .control, .option, .function, .help])");
    expect(placeholderContentSource).toContain("event.charactersIgnoringModifiers?.lowercased()");
    expect(placeholderContentSource).toContain("(UInt32(97)...UInt32(122)).contains(scalar.value)");
    expect(placeholderContentSource).toContain("(UInt32(48)...UInt32(57)).contains(scalar.value)");
  });

  test("sleep teardown preserves split placeholders instead of pruning layout", () => {
    /*
     * CDXC:SessionSleep 2026-06-18-03:10:
     * Sidebar Sleep closes the renderer but must keep the pane as a black wake
     * placeholder. Native close cleanup therefore needs an explicit preserve
     * flag instead of treating sleep like a tab/pane close that prunes splits.
     */
    const hostProtocolSource = readFileSync(
      new URL("../macos/ghostexHost/Sources/ghostexHost/HostProtocol.swift", import.meta.url),
      "utf8",
    );
    const sidebarSource = readFileSync(
      new URL("native-sidebar.tsx", import.meta.url),
      "utf8",
    );
    const closeSource = sourceSection(
      "private func closeTerminal(",
      "  /**\n   CDXC:T3Code",
    );

    expect(hostProtocolSource).toContain("let preserveLayoutPlaceholder: Bool?");
    expect(sidebarSource).toContain("preserveLayoutPlaceholder: true");
    expect(closeSource).toContain("preserveLayoutPlaceholder: Bool = false");
    expect(closeSource).toContain("if preserveLayoutPlaceholder {");
    expect(closeSource).toContain("sleepingSessionIds.insert(sessionId)");
    expect(closeSource).toContain("} else {\n      terminalLayout = prunedLayout(removing: sessionId, from: terminalLayout)\n    }");
  });
});
