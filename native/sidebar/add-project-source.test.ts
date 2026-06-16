import { readFileSync } from "node:fs";
import { describe, expect, test } from "vitest";

const nativeSidebarSource = readFileSync(new URL("./native-sidebar.tsx", import.meta.url), "utf8");

function sourceBetween(start: string, end: string): string {
  return sourceBetweenIn(nativeSidebarSource, start, end);
}

function sourceBetweenIn(source: string, start: string, end: string): string {
  const startIndex = source.indexOf(start);
  const endIndex = source.indexOf(end, startIndex + start.length);
  expect(startIndex).toBeGreaterThanOrEqual(0);
  expect(endIndex).toBeGreaterThan(startIndex);
  return source.slice(startIndex, endIndex);
}

describe("native sidebar add project source", () => {
  test("keeps the native folder picker callback wired to gxserver-backed add project", () => {
    /*
    CDXC:NativeWorkspacePicker 2026-06-08-18:21:
    Selecting a folder in the macOS Add Project picker must not disappear at
    the WebKit boundary. The Swift callback still calls
    `__ghostex_NATIVE_WORKSPACE_BAR__.addProject`, so native-sidebar must keep
    that compatibility bridge and route it into the gxserver-backed addProject
    implementation.
    */
    const workspaceBarBridgeSource = sourceBetween(
      "window.__ghostex_NATIVE_WORKSPACE_BAR__ = {",
      "window.__ghostex_NATIVE_HOTKEYS__ = {",
    );

    expect(workspaceBarBridgeSource).toContain("addProject(path, name)");
    expect(workspaceBarBridgeSource).toContain("void addProject(path, name);");
  });

  test("publishes the project shell before optional first-terminal creation", () => {
    /*
    CDXC:ProjectSidebarOwnership 2026-06-06-23:16:
    Add Project visibility must not depend on first-terminal creation. A 3.6-to-4.0 upgrade or a post-startup project add can have gxserver project state before zmx attach metadata is ready, so the rendered sidebar contract must publish the empty project group first.
    */
    const addProjectSource = sourceBetween(
      "async function addProject(",
      "async function cloneRepositoryFromModal",
    );
    const afterFocusBeforeEmptyCheck = sourceBetweenIn(
      addProjectSource,
      "focusProject(projectId);",
      "if (activeSnapshot().sessions.length === 0)",
    );
    const publishIndex = addProjectSource.indexOf("publish();", addProjectSource.indexOf("focusProject(projectId);"));
    const createTerminalIndex = addProjectSource.indexOf("createTerminal(DEFAULT_TERMINAL_SESSION_TITLE,");

    expect(afterFocusBeforeEmptyCheck).toContain("publish();");
    expect(publishIndex).toBeGreaterThan(addProjectSource.indexOf("focusProject(projectId);"));
    expect(publishIndex).toBeLessThan(createTerminalIndex);
    expect(addProjectSource).toContain("revealFocusedSidebarSessionAfterCreate: true");
  });
});
