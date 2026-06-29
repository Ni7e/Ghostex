import { readFileSync } from "node:fs";
import { describe, expect, test } from "vitest";

const nativeSidebarSource = readFileSync(new URL("./native-sidebar.tsx", import.meta.url), "utf8");
const appDelegateSource = readFileSync(
  new URL("../macos/ghostexHost/Sources/ghostexHost/AppDelegate.swift", import.meta.url),
  "utf8",
);
const settingsModalSource = readFileSync(
  new URL("../../sidebar/settings-modal.tsx", import.meta.url),
  "utf8",
);

function sourceBetween(source: string, start: string, end: string): string {
  const startIndex = source.indexOf(start);
  const endIndex = source.indexOf(end, startIndex + start.length);
  expect(startIndex).toBeGreaterThanOrEqual(0);
  expect(endIndex).toBeGreaterThan(startIndex);
  return source.slice(startIndex, endIndex);
}

describe("native sidebar App Shots source", () => {
  test("stages captured app context in any live agent session", () => {
    /*
     * CDXC:AppShots 2026-06-12-11:12:
     * App Shots are an agent-session workflow, not a Codex-specific workflow.
     * The native sidebar should reuse the focused or recent live agent session
     * and create the configured default prompt agent only when no agent target
     * is available.
     */
    const appShotsSource = sourceBetween(
      nativeSidebarSource,
      "function handleNativeAppShotCaptured",
      "function formatNativeAppShotPrompt",
    );

    expect(appShotsSource).toContain("stageNativeAppShotInAgentSession");
    expect(appShotsSource).toContain("const agent = resolveDefaultPromptAgent()");
    expect(appShotsSource).toContain("isNativeAppShotAgentSession(recentTarget)");
    expect(appShotsSource).toContain("isNativeAppShotAgentSession(focusedSession)");
    expect(appShotsSource).toContain("return Boolean(agentName)");
    expect(appShotsSource).not.toContain("resolveSidebarAgentButtonById(DEFAULT_PROMPT_AGENT_ID)");
    expect(appShotsSource).not.toContain("agentName === DEFAULT_PROMPT_AGENT_ID");
    expect(appShotsSource).not.toContain("Codex agent is available for App Shots");
    expect(appShotsSource).not.toContain("Codex session for the App Shot");
  });

  test("keeps App Shots failure diagnostics free of raw app names and paths", () => {
    const captureHandlerSource = sourceBetween(
      nativeSidebarSource,
      "function handleNativeAppShotCaptured",
      "/*\nCDXC:AppShots",
    );

    expect(captureHandlerSource).toContain("hasAppName");
    expect(captureHandlerSource).toContain("hasImagePath");
    expect(captureHandlerSource).toContain("errorName");
    expect(captureHandlerSource).not.toContain("appName: appShot.appName");
    expect(captureHandlerSource).not.toContain("imagePath: appShot.imagePath");
    expect(captureHandlerSource).not.toContain("message,");
  });

  test("describes App Shots as an agent-session feature in Settings", () => {
    const settingsSource = sourceBetween(
      settingsModalSource,
      "CDXC:AppShots 2026-06-12-11:12:",
      'title="Desktop Control Runtime"',
    );

    expect(settingsSource).toContain("focused or recent agent session");
    expect(settingsSource).toContain("routine captures should paste only the image link");
    expect(settingsSource).toContain("Include App Shots metadata");
    expect(settingsSource).toContain('badge="Beta"');
    expect(settingsSource).not.toContain("available Accessibility text");
    expect(settingsSource).not.toContain("recent Codex session");
  });

  test("keeps App Shots instant by avoiding Accessibility text extraction", () => {
    /*
     * CDXC:AppShots 2026-06-15-02:01:
     * App Shots should capture the screenshot and cheap WindowServer metadata
     * only. Do not traverse the Accessibility tree or include extracted app
     * text in the staged agent prompt.
     */
    const nativeCaptureSource = sourceBetween(
      appDelegateSource,
      "private struct AppShotCapture",
      "func presentAppToast",
    );
    const promptSource = sourceBetween(
      nativeSidebarSource,
      "function formatNativeAppShotPrompt",
      "window.addEventListener",
    );

    expect(nativeCaptureSource).toContain("appShotWindowSize");
    expect(nativeCaptureSource).toContain("windowHeight");
    expect(nativeCaptureSource).toContain("windowWidth");
    expect(nativeCaptureSource).not.toContain("AXUIElement");
    expect(nativeCaptureSource).not.toContain("kAX");
    expect(nativeCaptureSource).not.toContain("accessibilityTextForFrontmostWindow");
    expect(nativeCaptureSource).not.toContain("collectAccessibilityText");
    expect(promptSource).toContain("Window size");
    expect(promptSource).toContain("settings.appShotsMetadataEnabled");
    expect(promptSource).toContain("return `\\n${lines.join(\"\\n\")}\\n`");
    expect(promptSource).not.toContain("App shot from ${appName}.");
    expect(promptSource).not.toContain("Use this app shot as context for my next request.");
    expect(promptSource).not.toContain("Available app text");
    expect(promptSource).not.toContain("APP_SHOT_TEXT_MAX_LENGTH");
    expect(promptSource).not.toContain("appShot.text");
  });

  test("keeps native App Shots disabled unless explicitly enabled", () => {
    const settingsSource = sourceBetween(
      appDelegateSource,
      "func readAppShotsSettings() -> NativeAppShotsSettings",
      "func readHotkeys() -> [String: String]",
    );

    expect(settingsSource).toContain("CDXC:AppShots 2026-06-13-19:51:");
    expect(settingsSource).toContain("NativeAppShotsSettings(enabled: false");
    expect(settingsSource).toContain('settings["appShotsEnabled"] as? Bool ?? false');
    expect(settingsSource).not.toContain("enabled: true");
    expect(settingsSource).not.toContain("?? true");
  });
});
