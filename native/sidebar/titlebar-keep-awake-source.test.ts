import { readFileSync } from "node:fs";
import { describe, expect, test } from "vitest";

const titlebarHostSource = readFileSync(new URL("./titlebar-host.tsx", import.meta.url), "utf8");
const nativeSidebarSource = readFileSync(new URL("./native-sidebar.tsx", import.meta.url), "utf8");
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
      "const openKeepAwakeMenuFromTitlebar = useCallback",
    );
    const openKeepAwakeMenuSource = sourceBetween(
      titlebarHostSource,
      "const openKeepAwakeMenuFromTitlebar = useCallback",
      "const openPowerSettings = () =>",
    );
    const keepAwakeButtonSource = sourceBetween(
      titlebarHostSource,
      '<TitlebarAppTooltip content="Keep awake">',
      '<ButtonGroup\n              className="titlebar-open-group"\n              data-titlebar-dropdown-anchor\n            >',
    );
    const runtimeSyncEffectSource = sourceBetween(
      titlebarHostSource,
      "const syncKeepAwakeRuntime = (syncState: KeepAwakeRuntimeSyncState | undefined) =>",
      "useEffect(() => {\n    /*\n     * CDXC:TitlebarKeepAwake 2026-06-19-13:13:",
    );
    const externalDisplayEffectSource = sourceBetween(
      titlebarHostSource,
      "const shouldCheckExternalDisplay =",
      "const shouldCheckBattery =",
    );

    expect(titlebarHostSource).toContain("const KEEP_AWAKE_RUNTIME_SYNC_STORAGE_KEY");
    expect(titlebarHostSource).toContain("const KEEP_AWAKE_RUNTIME_CHANGED_EVENT");
    expect(titlebarHostSource).toContain("const [keepAwakeAutoStartSuppressed, setKeepAwakeAutoStartSuppressed]");
    expect(titlebarHostSource).toContain("function publishKeepAwakeRuntimeSync");
    expect(titlebarHostSource).toContain("function readKeepAwakeRuntimeSyncState");

    expect(stopKeepAwakeSource).toContain("options: { suppressAutoStart?: boolean } = {}");
    expect(stopKeepAwakeSource).toContain("setKeepAwakeAutoStartSuppressed(true)");
    expect(stopKeepAwakeSource).toContain("publishKeepAwakeRuntimeSync({");
    expect(stopKeepAwakeSource).toContain("suppressAutoStart: options.suppressAutoStart !== false");

    expect(startKeepAwakeSource).toContain("await stopKeepAwake({ suppressAutoStart: false })");
    expect(startKeepAwakeSource).toContain("setKeepAwakeAutoStartSuppressed(false)");
    expect(startKeepAwakeSource).toContain("publishKeepAwakeRuntimeSync({ suppressAutoStart: false })");

    /*
     * CDXC:TitlebarKeepAwake 2026-06-15-23:25:
     * The titlebar button should only open the Keep Awake dropdown. Clicks and
     * double-clicks must not start or stop keep-awake directly, because duration
     * and "Don't keep awake" choices now live in the menu.
     *
     * CDXC:TitlebarKeepAwake 2026-06-15-23:25:
     * Re-clicking the Keep Awake trigger while the dropdown is open should close
     * the menu, matching the other titlebar dropdown buttons.
     */
    expect(openKeepAwakeMenuSource).toContain('showTitlebarDropdownPanel("keepAwake", event.currentTarget)');
    expect(openKeepAwakeMenuSource).not.toContain("closeWhenAlreadyOpen: false");
    expect(keepAwakeButtonSource).toContain('<TitlebarAppTooltip content="Keep awake">');
    expect(keepAwakeButtonSource).toContain('aria-label="Keep awake"');
    expect(keepAwakeButtonSource).toContain("onClick={openKeepAwakeMenuFromTitlebar}");
    expect(keepAwakeButtonSource).toContain("onDoubleClick={openKeepAwakeMenuFromTitlebar}");
    expect(titlebarHostSource).not.toContain("const toggleKeepAwake");

    /*
     * CDXC:TitlebarKeepAwake 2026-06-19-13:13:
     * Keep Awake is beta-only in the macOS titlebar. When Show Beta features is
     * off, the titlebar must hide the button and stop or suppress the runtime
     * instead of leaving an invisible caffeinate process active.
     */
    expect(titlebarHostSource).toContain(
      "const keepAwakeFeatureEnabled = projectState.keepAwake.featureEnabled === true",
    );
    expect(titlebarHostSource).toContain(
      "void stopKeepAwake({ suppressAutoStart: true })",
    );
    expect(titlebarHostSource).toContain("!keepAwakeFeatureEnabled ||");
    expect(titlebarHostSource).toContain("!projectState.keepAwake.activateOnLaunch ||");
    expect(titlebarHostSource).toContain(
      "keepAwakeFeatureEnabled && !projectState.keepAwake.hideTitlebarControl",
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
    expect(runtimeSyncEffectSource).toContain("setKeepAwakeRuntime(storedRuntime)");
    expect(runtimeSyncEffectSource).toContain("setKeepAwakeAutoStartSuppressed(true)");

    expect(externalDisplayEffectSource).toContain("!keepAwakeRuntime");
    expect(externalDisplayEffectSource).toContain("!keepAwakeAutoStartSuppressed");
  });

  test("carries beta-gated titlebar visibility through native layout sync", () => {
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
    expect(hostProtocolSource).toContain("let featureEnabled: Bool?");
    expect(hostProtocolSource).toContain("let hideTitlebarControl: Bool?");
    expect(appDelegateSource).toContain('"featureEnabled": keepAwake.featureEnabled ?? false');
    expect(appDelegateSource).toContain('"hideTitlebarControl": keepAwake.hideTitlebarControl ?? true');
  });
});
