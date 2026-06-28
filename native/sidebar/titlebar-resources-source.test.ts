import { readFileSync } from "node:fs";
import { describe, expect, test } from "vitest";

const titlebarHostSource = readFileSync(new URL("./titlebar-host.tsx", import.meta.url), "utf8");
const nativeSidebarSource = readFileSync(new URL("./native-sidebar.tsx", import.meta.url), "utf8");
const sharedNativeHostProtocolSource = readFileSync(
  new URL("../../shared/native-ghostty-host-protocol.ts", import.meta.url),
  "utf8",
);
const appDelegateSource = readFileSync(
  new URL("../macos/ghostexHost/Sources/ghostexHost/AppDelegate.swift", import.meta.url),
  "utf8",
);
const hostProtocolSource = readFileSync(
  new URL("../macos/ghostexHost/Sources/ghostexHost/HostProtocol.swift", import.meta.url),
  "utf8",
);

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
      "function createCodeIdeResourceBundles",
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

  test("renders listener-backed dev servers before project session sections", () => {
    /*
     * CDXC:TitlebarResources 2026-06-22-00:30:
     * Running dev servers should be sourced from TCP listeners and rendered as
     * the first Resources body section above project session groups.
     */
    const listenerSource = sourceBetween(
      titlebarHostSource,
      "async function readResourceListeningServers",
      "/**\n * CDXC:TitlebarResources 2026-05-23-10:46:",
    );
    const serverBundleSource = sourceBetween(
      titlebarHostSource,
      "function createResourceServerBundles",
      "const EMPTY_RESOURCE_GROUP_VIEWS",
    );
    const resourcesBodySource = sourceBetween(
      titlebarHostSource,
      'title="Dev Servers"',
      "{visibleGroupViews.length > 0 ? (",
    );

    expect(titlebarHostSource).toContain("CDXC:TitlebarResources 2026-06-22-00:30:");
    expect(listenerSource).toContain('"/usr/sbin/lsof"');
    expect(listenerSource).toContain('"-iTCP"');
    expect(listenerSource).toContain('"-sTCP:LISTEN"');
    expect(listenerSource).toContain('"-F", "pcn"');
    expect(listenerSource).toContain('"-d", "cwd"');
    expect(serverBundleSource).toContain('bundle.type === "session" && bundle.session?.sessionKind === "terminal"');
    expect(serverBundleSource).toContain("ownerByPid.get(server.pid)");
    expect(serverBundleSource).toContain("isResourcePathInsideOrEqualTo(server.cwd, view.group.projectPath)");
    expect(resourcesBodySource).toContain('title="Dev Servers"');
    expect(resourcesBodySource).toContain("bundles={serverBundles}");
  });

  test("renders embedded Code as a shared Code IDE section", () => {
    /*
     * CDXC:TitlebarResources 2026-06-22-13:50:
     * Embedded Code is one shared code-server runtime, so Resources should not
     * attach it to a project group by project-path substring matching. Render it
     * in its own Code IDE section above Browser Tabs and target open Code
     * surfaces through forwarded project editor ids.
     */
    const groupSource = sourceBetween(
      titlebarHostSource,
      "function createResourceGroupViews",
      "function createResourceServerBundles",
    );
    const codeSource = sourceBetween(
      titlebarHostSource,
      "function createCodeIdeResourceBundles",
      "function claimAppRuntimeProcesses",
    );
    const resourcesBodySource = sourceBetween(
      titlebarHostSource,
      'title="Code IDE"',
      'title="Browser Tabs"',
    );
    const projectEditorIdsSource = sourceBetween(
      titlebarHostSource,
      "function resourceBundleProjectEditorIds",
      "function sortResourceBundlesForDisplay",
    );

    expect(titlebarHostSource).toContain("CDXC:TitlebarResources 2026-06-22-13:50:");
    expect(titlebarHostSource).toContain("CDXC:SourceRuntimeOwnership 2026-06-28-04:05:");
    expect(groupSource).toContain("codeIdeBundles");
    expect(groupSource).toContain("bundles: [...bundles, ...browserBundles]");
    expect(groupSource).not.toContain("createProjectCodeServerBundle");
    expect(codeSource).toContain("const runtimePort = codeServerResourcePort()");
    expect(codeSource).toContain("candidate.port === runtimePort");
    expect(codeSource).toContain('candidate.host === "localhost"');
    expect(codeSource).not.toContain("group.projectPath");
    expect(codeSource).toContain("projectEditorIds: Array.from(new Set(codeEditorProjectIds))");
    expect(resourcesBodySource).toContain('title="Code IDE"');
    expect(resourcesBodySource).toContain("bundles={codeIdeBundles}");
    expect(projectEditorIdsSource).toContain("if (bundle.projectEditorIds)");
  });

  test("stops dev servers without closing the owning terminal session", () => {
    /*
     * CDXC:TitlebarResources 2026-06-22-00:30:
     * Dev-server Stop should signal only the listener process tree with SIGINT
     * and must not route the owning terminal session through resource sleep.
     */
    const terminationSource = sourceBetween(
      titlebarHostSource,
      "async function terminateResourceProcesses",
      "function createResourceGroupViews",
    );
    const sidebarIdsSource = sourceBetween(
      titlebarHostSource,
      "function resourceBundleSidebarSessionIds",
      "function resourceBundleProjectEditorIds",
    );
    const quitSource = sourceBetween(
      titlebarHostSource,
      "const quitResourceBundles =",
      "const sleepInactiveTerminalSessions =",
    );
    const rowSource = sourceBetween(
      titlebarHostSource,
      "function TitlebarResourceBundle",
      "function getResourceChildProcessName",
    );

    expect(terminationSource).toContain('options: { gracefulSignal?: "INT" | "TERM" } = {}');
    expect(terminationSource).toContain("const gracefulSignal = options.gracefulSignal ?? \"TERM\";");
    expect(quitSource).toContain('uniqueBundles.every((bundle) => bundle.type === "server") ? "INT" : "TERM"');
    expect(sidebarIdsSource).toContain('if (bundle.type === "server")');
    expect(sidebarIdsSource).toContain("return [];");
    expect(sidebarIdsSource).toContain("function resourceBundleFocusSessionId");
    expect(rowSource).toContain('isServer\n      ? `Stop server ${bundle.label}`');
    expect(rowSource).toContain('"Stopping..."');
    expect(rowSource).toContain('<IconSquareMinus aria-hidden="true" size={13} stroke={1.9} />');
  });

  test("uses neutral styling for dev server stop controls", () => {
    /*
     * CDXC:TitlebarResources 2026-06-22-00:30:
     * Stop Server is scoped to a listener-owned process tree, so it should use
     * the neutral action treatment rather than the destructive quit palette.
     */
    const sectionSource = sourceBetween(
      titlebarHostSource,
      "function TitlebarResourceSection",
      "function TitlebarResourceBundle",
    );
    const rowStyles = sourceBetween(
      titlebarHostSource,
      ".titlebar-resource-section-quit-button {",
      ".titlebar-resources-empty {",
    );

    expect(sectionSource).toContain('hasServer ? "Stop Servers" : "Quit"');
    expect(sectionSource).toContain('data-action={hasTerminalSession ? "sleep" : hasServer ? "stop" : "quit"}');
    expect(rowStyles).toContain('.titlebar-resource-section-quit-button[data-action="stop"]');
    expect(rowStyles).toContain('.titlebar-resource-kill-button[data-action="stop"]');
    expect(rowStyles).toContain('.titlebar-resource-kill-button[data-action="stop"]:focus-visible');
  });

  test("uses active Portless domains as the dev-server main link", () => {
    /*
     * CDXC:PortlessResources 2026-06-23-15:18:
     * When Portless setup is active, a Ghostex-owned live server row should use
     * the route preview hostname as the primary link while keeping raw
     * localhost:port, command name, and pid as row metadata.
     *
     * CDXC:TerminalDevServers 2026-06-23-19:22:
     * The row click path should respect the simplified dev-server open target setting, using the system default browser only for server rows and the internal browser otherwise.
     */
    const portlessJoinSource = sourceBetween(
      titlebarHostSource,
      "function createResourceServerBundles",
      "function resourceServerLabel",
    );
    const rowRenderSource = sourceBetween(
      titlebarHostSource,
      "function TitlebarResourceBundle",
      "function getResourceChildProcessName",
    );
    const displaySource = sourceBetween(
      titlebarHostSource,
      "function getResourceBundleMainLabel",
      "function normalizeTitlebarMode",
    );

    expect(titlebarHostSource).toContain("CDXC:PortlessResources 2026-06-23-15:18:");
    expect(portlessJoinSource).toContain("createPortlessRoutePreviewMap(portless)");
    expect(portlessJoinSource).toContain("portless: portlessPreview");
    expect(rowRenderSource).toContain('className="titlebar-resource-name titlebar-resource-main-link"');
    expect(rowRenderSource).toContain("openResourceBundleMainUrl(bundle, mainUrl, serverOpenTarget)");
    expect(displaySource).toContain("bundle.portless.hostname");
    expect(displaySource).toContain('postNative({ type: "openExternalUrl", url })');
    expect(displaySource).toContain('postTitlebarSidebarCommand({ type: "openBrowserPane", url })');
    expect(displaySource).toContain("resourcePortlessUrl(bundle.portless)");
    expect(displaySource).toContain("resourceServerLocalhostLabel(bundle.server)");
    expect(displaySource).toContain("`${bundle.server.commandName} pid ${pid}`");
  });

  test("shows setup-missing Portless rows with raw localhost and setup or status action", () => {
    /*
     * CDXC:PortlessResources 2026-06-23-15:18:
     * If setup is missing or unavailable, Resources should keep the raw
     * localhost:port link visible and expose an explicit Portless setup/status
     * action without creating a fallback domain row.
     */
    const displaySource = sourceBetween(
      titlebarHostSource,
      "function getResourceBundleMainLabel",
      "function normalizeTitlebarMode",
    );
    const rowRenderSource = sourceBetween(
      titlebarHostSource,
      "function TitlebarResourceBundle",
      "function getResourceChildProcessName",
    );
    const sidebarCommandSource = sourceBetween(
      titlebarHostSource,
      "function postTitlebarSidebarCommand",
      "function closeAppModalFromTitlebarNavigation",
    );

    expect(displaySource).toContain("bundle.server && bundle.portless");
    expect(displaySource).toContain("return resourceServerLocalhostLabel(bundle.server)");
    expect(displaySource).toContain("return resourceServerLocalhostUrl(bundle.server)");
    expect(titlebarHostSource).toContain("getTitlebarPortlessResourcesSetupActionLabel");
    expect(titlebarHostSource).toContain('"Set up"');
    expect(titlebarHostSource).toContain('"Status"');
    expect(rowRenderSource).toContain("showPortlessSetupAction");
    expect(rowRenderSource).toContain("titlebar-resource-portless-action");
    expect(displaySource).toContain('type: "runPortlessSettingsAdminAction"');
    expect(displaySource).toContain('initialTab: "projects"');
    expect(sidebarCommandSource).toContain('type: "runPortlessSettingsAdminAction"');
  });

  test("matches multiple Portless route previews by owner session and port", () => {
    /*
     * CDXC:PortlessResources 2026-06-23-15:18:
     * Multiple live servers in one project/worktree must stay separate rows:
     * the join key includes project id, session id, and port so primary and
     * additional Portless domains do not collapse into one display item.
     */
    const routePreviewMapSource = sourceBetween(
      titlebarHostSource,
      "function createPortlessRoutePreviewMap",
      "function isPortlessResourceSetupActive",
    );

    expect(routePreviewMapSource).toContain("for (const preview of routePreviews)");
    expect(routePreviewMapSource).toContain("createPortlessRoutePreviewKey(preview.projectId, preview.sessionId, preview.port)");
    expect(routePreviewMapSource).toContain("previewsByOwnerAndPort.has(key)");
    expect(routePreviewMapSource).toContain("protocol: preview.protocol");
    expect(routePreviewMapSource).not.toContain("assignedDomains");
  });

  test("excludes external listeners from Portless domain display", () => {
    /*
     * CDXC:PortlessResources 2026-06-23-15:18:
     * Route previews are only decorations for server rows that Resources has
     * already attributed to a visible Ghostex terminal owner. Unowned external
     * listeners must not receive standalone Portless rows.
     */
    const serverBundleSource = sourceBetween(
      titlebarHostSource,
      "function createResourceServerBundles",
      "const EMPTY_RESOURCE_GROUP_VIEWS",
    );
    expect(serverBundleSource).toContain("if (!owner) {\n        return undefined;\n      }");
    expect(serverBundleSource).toContain("owner.bundle.session");
    expect(serverBundleSource).toContain("createPortlessRoutePreviewKeyForSession(owner.bundle.session, server.port)");
    expect(serverBundleSource).not.toContain("portless.presentation?.assignedDomains");
    expect(nativeSidebarSource).toContain("titlebarPortless?: SidebarPortlessState");
    expect(nativeSidebarSource).toContain("titlebarPortless: createSidebarPortlessState({ isLocalGxserver: true })");
    expect(sharedNativeHostProtocolSource).toContain("export type NativeTitlebarPortlessState");
    expect(sharedNativeHostProtocolSource).toContain("titlebarPortless?: NativeTitlebarPortlessState");
    expect(hostProtocolSource).toContain("let titlebarPortless: TitlebarPortlessState?");
    expect(appDelegateSource).toContain('payload["portless"] = portlessPayload');
  });
});
