import { readFileSync } from "node:fs";
import { describe, expect, test } from "vitest";

const titlebarHostSource = readFileSync(new URL("./titlebar-host.tsx", import.meta.url), "utf8");

function sourceBetween(source: string, start: string, end: string): string {
  const startIndex = source.indexOf(start);
  const endIndex = source.indexOf(end, startIndex + start.length);
  expect(startIndex).toBeGreaterThanOrEqual(0);
  expect(endIndex).toBeGreaterThan(startIndex);
  return source.slice(startIndex, endIndex);
}

describe("native titlebar Resources source", () => {
  test("does not double-wrap gxserver presentation session ids for row actions", () => {
    /*
     * CDXC:TitlebarResources 2026-06-15-15:27:
     * Presentation-backed Resources rows already use combined project/session
     * ids from the sidebar projection. Row Focus, Sleep, and Close must forward
     * that route id unchanged so the sidebar focuses the real gxserver session.
     */
    const helperSource = sourceBetween(
      titlebarHostSource,
      "function titlebarResourceSidebarSessionId",
      "function uniqueResourceBundles",
    );
    const inactiveSleepSource = sourceBetween(
      titlebarHostSource,
      "function createInactiveTerminalSleepSessionIds",
      "function hasTitlebarResourceDelayedSend",
    );
    const rowActionSource = sourceBetween(
      titlebarHostSource,
      "function resourceBundleSidebarSessionIds",
      "function resourceBundleProjectEditorIds",
    );

    expect(helperSource).toContain("parseCombinedProjectSessionId(session.sessionId)");
    expect(helperSource).toContain("return session.sessionId;");
    expect(helperSource).toContain("createCombinedProjectSessionId(session.projectId, session.sessionId)");
    expect(inactiveSleepSource).toContain(".map(titlebarResourceSidebarSessionId)");
    expect(rowActionSource).toContain("return [titlebarResourceSidebarSessionId(session)];");
  });

  test("does not expose Close for app-critical browser helper bundles", () => {
    /*
     * CDXC:TitlebarResources 2026-06-15-13:45:
     * Resources may show shared Chromium GPU, network, storage, and unmatched
     * renderer helper rows for CPU/RAM accounting, but those rows must not get
     * row Close, section Quit, or native process-termination actions because
     * killing them can break embedded browser surfaces the app needs.
     */
    const actionabilitySource = sourceBetween(
      titlebarHostSource,
      "function isResourceBundleActionable",
      "function resourceBundleSidebarSessionIds",
    );
    const quitSource = sourceBetween(
      titlebarHostSource,
      "const quitResourceBundles =",
      "const sleepInactiveTerminalSessions =",
    );
    const sectionSource = sourceBetween(
      titlebarHostSource,
      "function TitlebarResourceSection",
      "function TitlebarResourceBundle",
    );
    const rowSource = sourceBetween(
      titlebarHostSource,
      "function TitlebarResourceBundle",
      "function getResourceChildProcessName",
    );

    expect(actionabilitySource).toContain('return !(bundle.type === "browser" && !bundle.browserTab);');
    expect(quitSource).toContain("uniqueResourceBundles(bundles).filter(isResourceBundleActionable)");
    expect(sectionSource).toContain("const actionableBundles = bundles.filter(isResourceBundleActionable);");
    expect(sectionSource).toContain("sectionActionBundles.length > 0 ? (");
    expect(rowSource).toContain("const isActionable = isResourceBundleActionable(bundle);");
    expect(rowSource).toContain("{isActionable ? (");
  });
});
