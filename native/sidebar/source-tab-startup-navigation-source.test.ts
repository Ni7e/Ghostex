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

describe("source tab startup navigation source", () => {
  test("defers first code-server navigation until the runtime readiness gate passes", () => {
    /*
    CDXC:EditorPanes 2026-06-19-11:50:
    First Source-tab open after app restart must keep Chromium on about:blank until the native code-server readiness wait succeeds, so users never see the transient code-server page-not-found document before VS Code loads.
    */
    const makeProjectEditorBrowserTab = sourceBetween(
      "private func makeProjectEditorBrowserTab(",
      "private func makeProjectEditorBrowserPlaceholderView()",
    );
    const loadProjectEditorPaneWhenReady = sourceBetween(
      "private func loadProjectEditorPaneWhenReady(",
      "private func configureProjectEditorChromiumCallbacks(",
    );

    expect(makeProjectEditorBrowserTab).toContain(
      'let usesDeferredCodeServerNavigation = !isPlaceholder && projectEditorMode == "code"',
    );
    expect(makeProjectEditorBrowserTab).toContain(
      'let initialChromiumURL = usesDeferredCodeServerNavigation ? "about:blank" : tabUrl',
    );
    expect(makeProjectEditorBrowserTab).toContain("initialURL: initialChromiumURL");
    expect(makeProjectEditorBrowserTab).not.toContain("initialURL: tabUrl");
    expect(loadProjectEditorPaneWhenReady).toContain(
      "NativeCodeServerRuntimeLauncher.waitUntilResponsive(timeout: 10.0)",
    );
    expect(loadProjectEditorPaneWhenReady).toContain("session.chromiumView?.loadURLString(url)");
  });
});
