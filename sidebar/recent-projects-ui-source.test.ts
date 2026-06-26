import { readFileSync } from "node:fs";
import { describe, expect, test } from "vitest";

const sidebarAppSource = readFileSync(new URL("./sidebar-app.tsx", import.meta.url), "utf8");

function sourceBetween(source: string, start: string, end: string): string {
  const startIndex = source.indexOf(start);
  const endIndex = source.indexOf(end, startIndex + start.length);
  expect(startIndex).toBeGreaterThanOrEqual(0);
  expect(endIndex).toBeGreaterThan(startIndex);
  return source.slice(startIndex, endIndex);
}

function functionSource(source: string, declaration: string, nextDeclaration: string): string {
  return sourceBetween(source, declaration, nextDeclaration);
}

function compactSource(source: string): string {
  return source.replace(/\s+/g, " ").trim();
}

function postMessageObjectProperties(messageBody: string): Array<{ key: string; value?: string }> {
  return messageBody
    .split(",")
    .map((propertySource) => compactSource(propertySource))
    .filter(Boolean)
    .map((propertySource) => {
      const [ keySource, ...valueParts ] = propertySource.split(":");
      const key = keySource.trim().replace(/^["'](.+)["']$/, "$1");
      const value = valueParts.length > 0 ? valueParts.join(":").trim() : undefined;
      return { key, value };
    });
}

function expectOnlyProjectIdPostMessage(source: string, type: string): void {
  const messages = [ ...source.matchAll(/vscode\.postMessage\(\s*\{([\s\S]*?)\}\s*\)/g) ];
  expect(messages).toHaveLength(1);
  const messageBody = messages[0]?.[1] ?? "";
  expect(messageBody).not.toMatch(
    /\b(?:path|projectPath|title|remoteMachineId|remoteMachineName|sessionCount)\b/,
  );
  const messageProperties = postMessageObjectProperties(messageBody);
  expect(messageProperties).toHaveLength(2);
  expect(messageProperties.map(({ key }) => key).sort()).toEqual([ "projectId", "type" ]);
  expect(messageProperties.find(({ key }) => key === "projectId")?.value ?? "projectId").toBe(
    "projectId",
  );
  expect(messageProperties.find(({ key }) => key === "type")?.value).toBe(`"${type}"`);
}

describe("Recent Projects shared UI source", () => {
  test("guards the drawer on recent projects and keeps the shared visible labels", () => {
    /*
     * CDXC:RecentProjects 2026-06-25-21:19:
     * The shared React sidebar should render the Recent Projects drawer only when the host provides at least one recent project. The drawer must expose the accessible and visible "Recent Projects" label, and an opened search with no matches must show "No projects match that search.".
     */
    const drawerSource = sourceBetween(
      sidebarAppSource,
      "{recentProjects.length > 0 ? (",
      "<GitCommitModal",
    );
    const filteredRecentProjectsSource = sourceBetween(
      sidebarAppSource,
      "const filteredRecentProjects = useMemo(",
      "const handleRecentProjectsListPointerMove = (",
    );
    const drawerCompactSource = compactSource(drawerSource);

    expect(drawerCompactSource).toMatch(/<section\b[^>]*\baria-label="Recent Projects"/);
    expect(drawerCompactSource).toMatch(
      /<span\b[^>]*className="recent-projects-drawer-title group-title[^"]*"[^>]*>\s*Recent Projects\s*<\/span>/,
    );
    expect(filteredRecentProjectsSource).toContain(
      "filterRecentProjects(recentProjects, recentProjectsQuery)",
    );
    expect(drawerSource).toContain("filteredRecentProjects.length > 0 ? (");
    expect(drawerSource).toContain(
      '<div className="recent-projects-empty">No projects match that search.</div>',
    );
    expect(drawerSource).toContain(") : null}");
  });

  test("restores by trusted project id and resets drawer UI state", () => {
    /*
     * CDXC:RecentProjects 2026-06-25-21:19:
     * Restoring a Recent Projects row is a trusted-id command: clear the local search text, close the drawer, dismiss any row context menu, and post only the selected projectId plus restoreRecentProject type.
     */
    const restoreSource = functionSource(
      sidebarAppSource,
      "const restoreRecentProject = (projectId: string) => {",
      "const openRecentProjectContextMenu = (",
    );

    expect(restoreSource).toContain('setRecentProjectsQuery("");');
    expect(restoreSource).toContain("setIsRecentProjectsOpen(false);");
    expect(restoreSource).toContain("setRecentProjectContextMenuPosition(undefined);");
    expectOnlyProjectIdPostMessage(restoreSource, "restoreRecentProject");
  });

  test("keeps recent project context menu actions ordered and id-authorized only", () => {
    /*
     * CDXC:RecentProjects 2026-06-25-21:19:
     * Recent Projects context-menu filesystem actions must derive authority from the scoped project id, never from a row path. Keep the user-facing order Copy Path, Open Folder, separator, Remove Project so macOS and GPUI parity depends on the shared component.
     */
    const copySource = functionSource(
      sidebarAppSource,
      "const copyRecentProjectPath = (projectId: string) => {",
      "const openRecentProjectInFinder = (projectId: string) => {",
    );
    const openSource = functionSource(
      sidebarAppSource,
      "const openRecentProjectInFinder = (projectId: string) => {",
      "const removeRecentProject = (projectId: string) => {",
    );
    const removeSource = functionSource(
      sidebarAppSource,
      "const removeRecentProject = (projectId: string) => {",
      "const setActiveSessionsSortMode = (sortMode: SidebarActiveSessionsSortMode) => {",
    );
    const menuSource = sourceBetween(
      sidebarAppSource,
      "{recentProjectContextMenuPosition ? (",
      "</SidebarContextMenuPortal>",
    );
    const menuItemSource = menuSource.slice(
      menuSource.indexOf('<button\n                    className="session-context-menu-item"'),
    );

    expectOnlyProjectIdPostMessage(copySource, "copyRecentProjectPath");
    expectOnlyProjectIdPostMessage(openSource, "openRecentProjectInFinder");
    expectOnlyProjectIdPostMessage(removeSource, "removeRecentProject");

    const orderedMenuMarkers = [
      "Copy Path",
      "Open Folder",
      'role="separator"',
      "Remove Project",
    ];
    const orderedMenuMarkerIndexes = orderedMenuMarkers.map((marker) => {
      const markerIndex = menuItemSource.indexOf(marker);
      expect(markerIndex).toBeGreaterThanOrEqual(0);
      return markerIndex;
    });
    for (let index = 1; index < orderedMenuMarkerIndexes.length; index += 1) {
      expect(orderedMenuMarkerIndexes[index - 1]).toBeLessThan(orderedMenuMarkerIndexes[index]);
    }

    expect(menuSource).toContain("copyRecentProjectPath(recentProjectContextMenuPosition.projectId)");
    expect(menuSource).toContain(
      "openRecentProjectInFinder(recentProjectContextMenuPosition.projectId)",
    );
    expect(menuSource).toContain("removeRecentProject(recentProjectContextMenuPosition.projectId)");
    expect(menuSource).not.toMatch(/\bproject\.path\b|\brecentProjectContextMenuPosition\.path\b/);
  });
});
