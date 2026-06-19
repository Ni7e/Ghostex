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
  test("keeps sparse resource sections packed at the top of the panel", () => {
    /*
     * CDXC:TitlebarResources 2026-06-16-09:49:
     * Resources sections must not stretch apart when too few items fill the
     * fixed-height dropdown. Extra height belongs below the final section.
     */
    const scrollStylesMatch = titlebarHostSource.match(
      /\n  \.titlebar-resources-scroll \{[\s\S]*?\n  \.titlebar-resources-scroll\[data-loading="true"\]/,
    );
    expect(scrollStylesMatch).not.toBeNull();
    const scrollStyles = scrollStylesMatch?.[0] ?? "";

    expect(titlebarHostSource).toContain("CDXC:TitlebarResources 2026-06-16-09:49:");
    expect(scrollStyles).toContain("align-content: start;");
    expect(scrollStyles).toContain("grid-auto-rows: max-content;");
  });

  test("shows pointer cursor only on actual resource buttons", () => {
    /*
     * CDXC:TitlebarResources 2026-06-16-10:36:
     * CPU/RAM metric chips are read-only status, even inside expandable rows.
     * Keep pointer cursor reserved for enabled Resources buttons.
     *
     * CDXC:TitlebarResources 2026-06-16-12:34:
     * The macOS titlebar Resources modal should not show the hand cursor over
     * expandable row chrome; only explicit enabled buttons get pointer feedback.
     */
    const buttonCursorStyles = sourceBetween(
      titlebarHostSource,
      ".titlebar-resources-panel button:not(:disabled) {",
      ".titlebar-resources-header {",
    );
    const rowStyles = sourceBetween(
      titlebarHostSource,
      ".titlebar-resource-row {",
      ".titlebar-resources-empty {",
    );

    expect(titlebarHostSource).toContain("CDXC:TitlebarResources 2026-06-16-10:36:");
    expect(titlebarHostSource).toContain("CDXC:TitlebarResources 2026-06-16-12:34:");
    expect(buttonCursorStyles).toContain("cursor: pointer;");
    expect(buttonCursorStyles).toContain(".titlebar-resources-panel button:disabled");
    expect(buttonCursorStyles).toContain("cursor: default;");
    expect(rowStyles).not.toContain('.titlebar-resource-row[data-expandable="true"]');
    expect(rowStyles).toMatch(/\.titlebar-resource-metrics,\s*\.titlebar-resource-child-metrics \{[\s\S]*cursor: default;/);
    expect(rowStyles).toMatch(/\.titlebar-resource-metric \{[\s\S]*cursor: default;/);
  });

  test("keeps row actions and fixed metric cards aligned across hierarchy levels", () => {
    /*
     * CDXC:TitlebarResources 2026-06-16-07:37:
     * Resources row buttons must remain on the same line as CPU/RAM metrics,
     * and expanded child-process CPU/RAM cards must use the same smaller fixed
     * widths as parent rows.
     */
    const rowMarkup = sourceBetween(
      titlebarHostSource,
      '<div className="titlebar-resource-metrics" aria-label="Resource usage">',
      "function getResourceChildProcessName",
    );
    const rowStyles = sourceBetween(
      titlebarHostSource,
      ".titlebar-resource-row {",
      ".titlebar-resources-empty {",
    );

    expect(rowMarkup).toContain('className="titlebar-resource-child-metrics"');
    expect(rowStyles).toContain("grid-template-columns: minmax(0, 1fr) 24px 24px 200px");
    expect(rowStyles).toContain("grid-template-columns: 86px 106px");
    expect(rowStyles).toContain("grid-template-columns: minmax(0, 1fr) 200px");
    expect(rowStyles).toMatch(/\.titlebar-resource-main \{[\s\S]*grid-row: 1;/);
    expect(rowStyles).toMatch(/\.titlebar-resource-metrics \{[\s\S]*grid-row: 1;/);
    expect(rowStyles).toMatch(/\.titlebar-resource-focus-button \{[\s\S]*grid-row: 1;/);
    expect(rowStyles).toMatch(/\.titlebar-resource-kill-button \{[\s\S]*grid-row: 1;/);
  });

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

  test("keeps provider-live zmx sessions visible without a matched process command", () => {
    const bundleSource = sourceBetween(
      titlebarHostSource,
      "function createSessionResourceBundle",
      "function createProjectCodeServerBundle",
    );
    const sessionTypeSource = sourceBetween(
      titlebarHostSource,
      "type TitlebarResourceSession =",
      "type TitlebarTipIcon =",
    );

    expect(titlebarHostSource).toContain("CDXC:TitlebarResources 2026-06-19-19:21:");
    expect(sessionTypeSource).toContain('providerSessionState?: "exists"');
    expect(sessionTypeSource).toContain('nativePaneState?: "mounted"');
    expect(bundleSource).toContain("!hasRunningZmxProviderForTitlebarResourceSession(session)");
    expect(bundleSource).toContain('session.sessionPersistenceProvider === "zmx"');
    expect(bundleSource).toContain('session.providerSessionState === "exists"');
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
