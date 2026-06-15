import { readFileSync } from "node:fs";
import { describe, expect, test } from "vitest";

const nativeSidebarSource = readFileSync(new URL("./native-sidebar.tsx", import.meta.url), "utf8");
const terminalWorkspaceSource = readFileSync(
  new URL("../macos/ghostexHost/Sources/ghostexHost/TerminalWorkspaceView.swift", import.meta.url),
  "utf8",
);

function sourceBetween(source: string, start: string, end: string): string {
  const startIndex = source.indexOf(start);
  const endIndex = source.indexOf(end, startIndex + start.length);
  expect(startIndex).toBeGreaterThanOrEqual(0);
  expect(endIndex).toBeGreaterThan(startIndex);
  return source.slice(startIndex, endIndex);
}

describe("pending native terminal owner source", () => {
  test("selects zmx tab creation immediately through a mounting placeholder", () => {
    /*
     * CDXC:TerminalCreationFocus 2026-06-14-18:48:
     * Creating a zmx terminal can select the new tab before Swift has mounted
     * its Ghostty surface. The native layout command must mark that tab as
     * mounting so AppKit renders a non-wake placeholder instead of preserving
     * the previous tab owner.
     */
    const syncLayoutSource = sourceBetween(
      nativeSidebarSource,
      "function syncNativeLayout",
      "function getFocusedWorkspaceTabSessionIds",
    );
    expect(syncLayoutSource).toContain("workspaceMountingSessionIds");
    expect(syncLayoutSource).toContain("commandPanelMountingSessionIds");
    expect(syncLayoutSource).toContain("isNativeTerminalSurfaceCreationPendingForProject");
    expect(syncLayoutSource).toContain("mountingSessionIds");
    expect(syncLayoutSource).toContain("focusedNativeSessionId = snapshot.focusedSessionId");
    expect(syncLayoutSource).not.toContain("resolvePendingNativeWorkspaceOwnerSessionId");
    expect(syncLayoutSource).not.toContain("pendingNativeWorkspaceOwnerSessionId");
  });

  test("keeps native tab-owner selection stable for mounting placeholders and malformed commands", () => {
    /*
     * CDXC:PaneTabs 2026-06-14-18:48:
     * Swift must treat mounting ids as placeholder-capable owners, and still be
     * resilient if a future layout command asks for an unmounted tab owner
     * without including the mounting marker.
     *
     * CDXC:TerminalCreationFocus 2026-06-14-19:02:
     * Mounting placeholders for new terminals should stay black and blank;
     * the centered wake/status label belongs only to sleeping placeholders.
     */
    const swiftResolverSource = sourceBetween(
      terminalWorkspaceSource,
      "private func resolvedPaneTabOwnerSessionId",
      "private func paneContentLayoutRegion",
    );
    expect(swiftResolverSource).toContain("canOwnPaneTabSurface(requestedSessionId)");
    expect(terminalWorkspaceSource).toContain("isMountingPlaceholderSession(_ sessionId: String)");
    expect(terminalWorkspaceSource).toContain("mountingSessionIds.contains(sessionId) && !hasPaneRenderSurface(sessionId)");
    expect(swiftResolverSource).toContain("activeTabSessionIds.first(where: canOwnPaneTabSurface)");
    expect(swiftResolverSource).toContain("nativePaneLayoutTrace.pendingSurfaceOwnerPreserved");
    expect(swiftResolverSource).toContain('"requestedSessionId"');
    expect(swiftResolverSource).toContain('"mountedOwnerSessionId"');
    expect(swiftResolverSource).not.toContain("activeProjectPath");
    expect(swiftResolverSource).not.toContain("sessionTitles");

    const layoutTreeSource = sourceBetween(
      terminalWorkspaceSource,
      "private func layoutTree",
      "private func applyPaneOwnerSelectionFromCurrentLayout",
    );
    expect(layoutTreeSource).toContain("let requestedSelectedSessionId =");
    expect(layoutTreeSource).toContain("resolvedPaneTabOwnerSessionId(");

    const ownerSelectionSource = sourceBetween(
      terminalWorkspaceSource,
      "private func applyPaneOwnerSelection(",
      "private func isPaneSessionVisible(_ sessionId: String, role: PaneContentLayoutRole) -> Bool",
    );
    expect(ownerSelectionSource).toContain("let requestedSelectedSessionId =");
    expect(ownerSelectionSource).toContain("resolvedPaneTabOwnerSessionId(");

    const placeholderSource = sourceBetween(
      terminalWorkspaceSource,
      "private func setSleepingPanePlaceholderFrame",
      "private func setFrame(",
    );
    expect(placeholderSource).toContain("isMountingPlaceholderSession(ownerSessionId) ? .mounting : .sleeping");
    expect(placeholderSource).toContain("Mounting terminal tabs use the same stable visual slot");

    const contentSource = sourceBetween(
      terminalWorkspaceSource,
      "private final class SleepingPanePlaceholderContentView",
      "private protocol TerminalPaneOwnedOverlayLayer",
    );
    expect(contentSource).toContain("case mounting");
    expect(contentSource).toContain('wakeLabel.stringValue = ""');
    expect(contentSource).toContain("wakeLabel.isHidden = true");
    expect(contentSource).not.toContain('wakeLabel.stringValue = "Starting Terminal..."');
    expect(contentSource).toContain("guard mode == .sleeping");
  });
});
