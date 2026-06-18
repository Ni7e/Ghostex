import { readFileSync } from "node:fs";
import { describe, expect, test } from "vitest";

const appDelegateSource = readFileSync(
  new URL("../macos/ghostexHost/Sources/ghostexHost/AppDelegate.swift", import.meta.url),
  "utf8",
);

function sourceBetween(source: string, start: string, end: string): string {
  const startIndex = source.indexOf(start);
  const endIndex = source.indexOf(end, startIndex + start.length);
  expect(startIndex).toBeGreaterThanOrEqual(0);
  expect(endIndex).toBeGreaterThan(startIndex);
  return source.slice(startIndex, endIndex);
}

describe("workspace Open Folder native source", () => {
  test("opens the workspace folder itself instead of revealing it from its parent", () => {
    /*
     * CDXC:WorkspaceActions 2026-06-18-03:46:
     * Open Folder should land inside the selected project folder in Finder. Source coverage must keep the native handler on NSWorkspace.open for the directory URL instead of the Finder reveal/select API, which opens the parent folder.
     */
    const handlerSource = sourceBetween(
      appDelegateSource,
      "@MainActor private func openWorkspaceInFinder(_ command: OpenWorkspaceInFinder) {",
      "@MainActor private func openWorkspaceInIde(_ command: OpenWorkspaceInIde) {",
    );

    expect(handlerSource).toContain(
      "FileManager.default.fileExists(atPath: path, isDirectory: &isDirectory), isDirectory.boolValue",
    );
    expect(handlerSource).toContain(
      "NSWorkspace.shared.open(URL(fileURLWithPath: path, isDirectory: true))",
    );
    expect(handlerSource).not.toContain("activateFileViewerSelecting");
  });
});
