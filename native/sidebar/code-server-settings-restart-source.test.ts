import { readFileSync } from "node:fs";
import { describe, expect, test } from "vitest";

const nativeSidebarSource = readFileSync(new URL("./native-sidebar.tsx", import.meta.url), "utf8");

function sourceBetween(source: string, start: string, end: string): string {
  const startIndex = source.indexOf(start);
  const endIndex = source.indexOf(end, startIndex + start.length);
  expect(startIndex).toBeGreaterThanOrEqual(0);
  expect(endIndex).toBeGreaterThan(startIndex);
  return source.slice(startIndex, endIndex);
}

describe("code-server settings restart debounce", () => {
  test("debounces settings-link changes and restarts from the latest Settings snapshot", () => {
    /*
    CDXC:EditorPanes 2026-06-18-23:36:
    Selecting Use VS Code Settings should restart embedded code-server only once after the user stops changing the setting. The restart must read the live Settings object at debounce fire time so the final toggle/Insiders action wins.
    */
    const syncSource = sourceBetween(
      nativeSidebarSource,
      "function syncCodeServerRuntimeSettings",
      "function awakeCodeServerProjectIds",
    );
    expect(syncSource).toContain("scheduleCodeServerRuntimeSettingsRestart();");
    expect(syncSource).not.toContain('postNative({ type: "stopCodeServerRuntime" });');
    expect(syncSource).not.toContain("wakeProjectEditorSurface(project)");

    const schedulerSource = sourceBetween(
      nativeSidebarSource,
      "function scheduleCodeServerRuntimeSettingsRestart",
      "function restartCodeServerRuntimeForLatestSettings",
    );
    expect(schedulerSource).toContain("cancelPendingCodeServerRuntimeSettingsRestart();");
    expect(schedulerSource).toContain("window.setTimeout(() => {");
    expect(schedulerSource).toContain("restartCodeServerRuntimeForLatestSettings();");
    expect(schedulerSource).toContain("CODE_SERVER_RUNTIME_SETTINGS_RESTART_DEBOUNCE_MS");
    expect(schedulerSource).toContain("settings.codeServerLinkVscodeUserConfig");
    expect(schedulerSource).toContain("settings.codeServerUseVscodeInsidersUserConfig");

    const cancelSource = sourceBetween(
      nativeSidebarSource,
      "function cancelPendingCodeServerRuntimeSettingsRestart",
      "function scheduleCodeServerRuntimeSettingsRestart",
    );
    expect(cancelSource).toContain("window.clearTimeout(pendingCodeServerRuntimeSettingsRestartTimeout);");
  });

  test("targets only awake Source panes and restarts the shared runtime once", () => {
    const awakeSource = sourceBetween(
      nativeSidebarSource,
      "function awakeCodeServerProjectIds",
      "function cancelPendingCodeServerRuntimeSettingsRestart",
    );
    expect(awakeSource).toContain("surfaceState.isOpen === true");
    expect(awakeSource).toContain("surfaceState.isSleeping !== true");
    expect(awakeSource).toContain('hasAwakeProjectEditorMode(projectId, "code")');

    const restartSource = sourceBetween(
      nativeSidebarSource,
      "function restartCodeServerRuntimeForLatestSettings",
      "function syncAutoSleepSettings",
    );
    expect(restartSource).toContain("awakeCodeServerProjectIds()");
    expect(restartSource).toContain("findProject(projectId)");
    expect(restartSource).toContain('reason: "no-awake-source-pane"');
    expect(restartSource).toContain('postNative({ type: "stopCodeServerRuntime" });');
    expect(restartSource).toContain("postStartCodeServerRuntimeForProject(projects[0]!)");
    expect(restartSource).not.toContain("for (const project");
  });

  test("uses the same latest-settings start command for wake and debounced restart", () => {
    const startHelperSource = sourceBetween(
      nativeSidebarSource,
      "function postStartCodeServerRuntimeForProject",
      "function nativeGhostexHomeDirectory",
    );
    expect(startHelperSource).toContain('type: "startCodeServerRuntime"');
    expect(startHelperSource).toContain("linkVscodeUserConfig: settings.codeServerLinkVscodeUserConfig");
    expect(startHelperSource).toContain("vscodeUserConfigDir: codeServerVscodeUserConfigDirectory()");
    expect(startHelperSource).toContain('nativeProjectEditorIdForProject(project, "code")');

    const wakeSource = sourceBetween(
      nativeSidebarSource,
      "function wakeProjectEditorSurface",
      'appendModeSwitcherDebugLog("titlebarModeSwitch.sidebarWakeAfterStartRuntimePost"',
    );
    expect(wakeSource).toContain("postStartCodeServerRuntimeForProject(project);");
  });
});
