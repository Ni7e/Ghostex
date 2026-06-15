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
      "useEffect(() => {\n    if (!projectState.keepAwake.activateOnLaunch",
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

    expect(runtimeSyncEffectSource).toContain('window.addEventListener("storage", handleStorage)');
    expect(runtimeSyncEffectSource).toContain(
      "window.addEventListener(KEEP_AWAKE_RUNTIME_CHANGED_EVENT, handleLocalSync)",
    );
    expect(runtimeSyncEffectSource).toContain(
      "if (event.key === KEEP_AWAKE_RUNTIME_STORAGE_KEY && event.newValue === null)",
    );
    expect(runtimeSyncEffectSource).toContain("setKeepAwakeRuntime(storedRuntime)");
    expect(runtimeSyncEffectSource).toContain("setKeepAwakeAutoStartSuppressed(true)");

    expect(titlebarHostSource).toContain(
      "if (!projectState.keepAwake.activateOnLaunch || keepAwakeRuntime || keepAwakeAutoStartSuppressed)",
    );
    expect(externalDisplayEffectSource).toContain("!keepAwakeRuntime");
    expect(externalDisplayEffectSource).toContain("!keepAwakeAutoStartSuppressed");
  });
});
