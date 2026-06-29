import { readFileSync } from "node:fs";
import { describe, expect, test } from "vitest";

const titlebarHostSource = readFileSync(new URL("./titlebar-host.tsx", import.meta.url), "utf8");
const nativeSidebarSource = readFileSync(new URL("./native-sidebar.tsx", import.meta.url), "utf8");
const sidebarAppSource = readFileSync(new URL("../../sidebar/sidebar-app.tsx", import.meta.url), "utf8");
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

describe("native titlebar keep-awake source", () => {
  test("syncs dropdown stop state back to the main titlebar without auto restart", () => {
    /*
     * CDXC:TitlebarKeepAwake 2026-06-15-10:12:
     * Don't keep awake can be clicked inside a native child dropdown window, so
     * the source must publish runtime changes across titlebar windows and mark
     * explicit off as suppressing auto-start until keep-awake is started again.
     */
    const stopKeepAwakeSource = sourceBetween(
      titlebarHostSource,
      "const stopKeepAwake = useCallback",
      "const startKeepAwake = useCallback",
    );
    const startKeepAwakeSource = sourceBetween(
      titlebarHostSource,
      "const startKeepAwake = useCallback",
      "useEffect(() => {\n    if (isDropdownPanel || !window.__ghostex_TITLEBAR__)",
    );
    const runKeepAwakeBridgeSource = sourceBetween(
      titlebarHostSource,
      "const runKeepAwakeCommand = (command: TitlebarKeepAwakeCommand)",
      "const openPowerSettings = () =>",
    );
    const sidebarKeepAwakeDropdownSource = sourceBetween(
      sidebarAppSource,
      "function SidebarReferenceKeepAwakeDropdown({",
      "function SidebarReferencePrimaryMenuItem({",
    );
    const runtimeSyncStateSource = sourceBetween(
      titlebarHostSource,
      "const syncKeepAwakeRuntimeState = useCallback",
      "const closeTitlebarDropdownPanel = useCallback",
    );
    const runtimeSyncEffectSource = sourceBetween(
      titlebarHostSource,
      "useEffect(() => {\n    const handleStorage",
      "useEffect(() => {\n    /*\n     * CDXC:ExperimentalFeatures 2026-06-28-07:41:",
    );
    const titlebarBridgeSource = sourceBetween(
      titlebarHostSource,
      "window.__ghostex_TITLEBAR__ = {",
      "if (isRecord(window.__ghostex_PENDING_TITLEBAR_PROJECT_STATE__))",
    );
    const titlebarBlankMouseDownSource = sourceBetween(
      titlebarHostSource,
      "const requestTitlebarBlankMouseDown = useCallback",
      "useEffect(() => {\n    if (initialTitlebarDropdownPanelKind)",
    );
    const keepAwakeDropdownSource = sourceBetween(
      titlebarHostSource,
      '{kind === "keepAwake" ? (',
      '{kind === "resources" ? (',
    );
    const externalDisplayEffectSource = sourceBetween(
      titlebarHostSource,
      "const shouldCheckExternalDisplay =",
      "const shouldCheckBattery =",
    );

    expect(titlebarHostSource).toContain("const KEEP_AWAKE_RUNTIME_SYNC_STORAGE_KEY");
    expect(titlebarHostSource).toContain("const KEEP_AWAKE_RUNTIME_CHANGED_EVENT");
    expect(titlebarHostSource).toContain("const KEEP_AWAKE_WORKING_SESSION_GRACE_MS = 20 * 60_000");
    expect(titlebarHostSource).toContain("const [keepAwakeAutoStartSuppressed, setKeepAwakeAutoStartSuppressed]");
    expect(titlebarHostSource).toContain("function publishKeepAwakeRuntimeSync");
    expect(titlebarHostSource).toContain("function readKeepAwakeRuntimeSyncState");
    expect(titlebarHostSource).toContain("function syncKeepAwakeRuntimeToMainTitlebar");
    expect(titlebarHostSource).toContain('type: "syncTitlebarKeepAwakeRuntime"');
    expect(titlebarHostSource).toContain("type TitlebarKeepAwakeCommand =");

    expect(stopKeepAwakeSource).toContain("options: { suppressAutoStart?: boolean } = {}");
    expect(stopKeepAwakeSource).toContain("setKeepAwakeAutoStartSuppressed(true)");
    expect(stopKeepAwakeSource).toContain("publishKeepAwakeRuntimeSync(syncState)");
    expect(stopKeepAwakeSource).toContain("runtime: null");
    expect(stopKeepAwakeSource).toContain("suppressAutoStart: options.suppressAutoStart !== false");
    expect(stopKeepAwakeSource).toContain("syncKeepAwakeRuntimeToMainTitlebar(syncState)");

    expect(startKeepAwakeSource).toContain("await stopKeepAwake({ suppressAutoStart: false })");
    expect(startKeepAwakeSource).toContain("setKeepAwakeAutoStartSuppressed(false)");
    expect(startKeepAwakeSource).toContain('source: options.source ?? "manual"');
    expect(startKeepAwakeSource).toContain("const syncState = { runtime: nextRuntime, suppressAutoStart: false }");
    expect(startKeepAwakeSource).toContain("publishKeepAwakeRuntimeSync(syncState)");
    expect(startKeepAwakeSource).toContain("syncKeepAwakeRuntimeToMainTitlebar(syncState)");
    expect(titlebarHostSource).toContain('void startKeepAwake(0, { source: "automatic" })');
    expect(titlebarHostSource).toContain('keepAwakeRuntime?.source === "automatic"');
    expect(titlebarHostSource).toContain("projectState.keepAwake.delayedSendSessionCount > 0");
    expect(titlebarHostSource).toContain("projectState.keepAwake.workingSessionCount > 0");
    expect(titlebarBridgeSource).toContain("syncKeepAwakeRuntime: syncKeepAwakeRuntimeState");
    expect(keepAwakeDropdownSource).toContain("onClick={() => closeAfter(() => onStartKeepAwake(option.value))}");
    expect(keepAwakeDropdownSource).toContain("onClick={() => closeAfter(onStopKeepAwake)}");
    expect(keepAwakeDropdownSource).not.toContain("void onStartKeepAwake(option.value)");

    /*
     * CDXC:SidebarTopChrome 2026-06-29-01:43:
     * The visible Keep Awake trigger moved from the titlebar to the sidebar
     * shortcut row. The sidebar renders the normal dropdown while the titlebar
     * host remains the caffeinate runtime owner through a compact bridge.
     */
    expect(titlebarHostSource).toContain("runKeepAwakeCommand?: (command: TitlebarKeepAwakeCommand) => void");
    expect(runKeepAwakeBridgeSource).toContain('if (command.action === "stop")');
    expect(runKeepAwakeBridgeSource).toContain("void stopKeepAwake()");
    expect(runKeepAwakeBridgeSource).toContain("void startKeepAwake(command.durationMinutes)");
    expect(titlebarHostSource).not.toContain("openKeepAwakeMenuFromTitlebar");
    expect(titlebarHostSource).not.toContain('<TitlebarAppTooltip content="Keep awake">');
    expect(sidebarAppSource).toContain('label="Keep awake"');
    expect(sidebarAppSource).toContain('type: "runTitlebarKeepAwakeCommand"');
    expect(sidebarKeepAwakeDropdownSource).toContain("KEEP_AWAKE_DURATION_OPTIONS.map");
    expect(sidebarKeepAwakeDropdownSource).toContain("label=\"Don't keep awake\"");
    expect(titlebarHostSource).not.toContain("const toggleKeepAwake");

    /*
     * CDXC:ExperimentalFeatures 2026-06-28-07:41:
     * Keep Awake is experimental-only in macOS chrome. When Enable Experimental
     * Features is off, chrome must hide the sidebar button and stop or suppress
     * the runtime instead of leaving an invisible caffeinate process active.
     */
    expect(titlebarHostSource).toContain(
      "const keepAwakeFeatureEnabled = projectState.keepAwake.featureEnabled === true",
    );
    expect(titlebarHostSource).toContain(
      "void stopKeepAwake({ suppressAutoStart: true })",
    );
    expect(titlebarHostSource).toContain("!keepAwakeFeatureEnabled ||");
    expect(titlebarHostSource).toContain("!projectState.keepAwake.activateOnLaunch ||");
    expect(sidebarAppSource).toContain(
      "effectiveSettings.showBetaFeatures && !effectiveSettings.hideKeepAwakeTitlebarControl",
    );
    expect(titlebarHostSource).toContain("const featureEnabled = settings.showBetaFeatures");
    expect(titlebarHostSource).toContain(
      "hideTitlebarControl: !featureEnabled || settings.hideKeepAwakeTitlebarControl",
    );

    expect(runtimeSyncEffectSource).toContain('window.addEventListener("storage", handleStorage)');
    expect(runtimeSyncEffectSource).toContain(
      "window.addEventListener(KEEP_AWAKE_RUNTIME_CHANGED_EVENT, handleLocalSync)",
    );
    expect(runtimeSyncEffectSource).toContain(
      "if (event.key === KEEP_AWAKE_RUNTIME_STORAGE_KEY && event.newValue === null)",
    );
    expect(runtimeSyncEffectSource).toContain("syncKeepAwakeRuntimeState(");
    expect(runtimeSyncStateSource).toContain('Object.prototype.hasOwnProperty.call(syncState, "runtime")');
    expect(runtimeSyncStateSource).toContain("setKeepAwakeRuntime(syncState.runtime ?? undefined)");
    expect(runtimeSyncStateSource).toContain("setKeepAwakeAutoStartSuppressed(syncState.suppressAutoStart === true)");
    expect(runtimeSyncStateSource).toContain("setKeepAwakeRuntime(storedRuntime)");
    expect(runtimeSyncStateSource).toContain("setKeepAwakeAutoStartSuppressed(true)");
    expect(titlebarBlankMouseDownSource).toContain("if (nativeDropdownOpen)");
    expect(titlebarBlankMouseDownSource).toContain("closeTitlebarDropdownPanel()");
    expect(titlebarBlankMouseDownSource).toContain('postNative({ type: "titlebarBlankMouseDown" })');
    expect(hostProtocolSource).toContain("case syncTitlebarKeepAwakeRuntime(SyncTitlebarKeepAwakeRuntime)");
    expect(hostProtocolSource).toContain("case runTitlebarKeepAwakeCommand(RunTitlebarKeepAwakeCommand)");
    expect(hostProtocolSource).toContain("struct SyncTitlebarKeepAwakeRuntime: Decodable");
    expect(hostProtocolSource).toContain("struct RunTitlebarKeepAwakeCommand: Decodable");
    expect(hostProtocolSource).toContain("let runtime: TitlebarKeepAwakeRuntime?");
    expect(appDelegateSource).toContain("func syncTitlebarKeepAwakeRuntime(_ command: SyncTitlebarKeepAwakeRuntime)");
    expect(appDelegateSource).toContain("func runTitlebarKeepAwakeCommand(_ command: RunTitlebarKeepAwakeCommand)");
    expect(appDelegateSource).toContain("window.__ghostex_TITLEBAR__?.syncKeepAwakeRuntime");
    expect(appDelegateSource).toContain("window.__ghostex_TITLEBAR__?.runKeepAwakeCommand");

    expect(externalDisplayEffectSource).toContain("!keepAwakeRuntime");
    expect(externalDisplayEffectSource).toContain("!keepAwakeAutoStartSuppressed");
  });

  test("carries experimental titlebar visibility through native layout sync", () => {
    /*
     * CDXC:TitlebarKeepAwake 2026-06-19-13:13:
     * Settings changes must reach the isolated titlebar webview through the
     * sidebar-to-AppKit layout sync, including the beta gate and the effective
     * hide flag for the Keep Awake button.
     */
    expect(nativeSidebarSource).toContain("featureEnabled: settings.showBetaFeatures");
    expect(nativeSidebarSource).toContain(
      "hideTitlebarControl: !settings.showBetaFeatures || settings.hideKeepAwakeTitlebarControl",
    );
    expect(nativeSidebarSource).toContain("createTitlebarKeepAwakeSessionState(titlebarResourceGroups)");
    expect(nativeSidebarSource).toContain("delayedSendSessionCount: keepAwakeSessionState.delayedSendSessionCount");
    expect(nativeSidebarSource).toContain("whileWorkingSessions: settings.keepAwakeWhileWorkingSessions");
    expect(nativeSidebarSource).toContain("workingSessionCount: keepAwakeSessionState.workingSessionCount");
    expect(hostProtocolSource).toContain("let delayedSendSessionCount: Int?");
    expect(hostProtocolSource).toContain("let featureEnabled: Bool?");
    expect(hostProtocolSource).toContain("let hideTitlebarControl: Bool?");
    expect(hostProtocolSource).toContain("let whileWorkingSessions: Bool?");
    expect(hostProtocolSource).toContain("let workingSessionCount: Int?");
    expect(appDelegateSource).toContain('"delayedSendSessionCount": keepAwake.delayedSendSessionCount ?? 0');
    expect(appDelegateSource).toContain('"featureEnabled": keepAwake.featureEnabled ?? false');
    expect(appDelegateSource).toContain('"hideTitlebarControl": keepAwake.hideTitlebarControl ?? true');
    expect(appDelegateSource).toContain('"whileWorkingSessions": keepAwake.whileWorkingSessions ?? false');
    expect(appDelegateSource).toContain('"workingSessionCount": keepAwake.workingSessionCount ?? 0');
  });
});
