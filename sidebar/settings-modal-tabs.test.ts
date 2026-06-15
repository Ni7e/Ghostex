import { describe, expect, test } from "vitest";
import {
  resolveSettingsModalTabForVisibility,
  shouldShowOSIntegrationSettingsTab,
} from "./settings-modal-tabs";

describe("settings modal tabs", () => {
  test("hides macOS OS Integration unless Debugging Mode is enabled", () => {
    /*
     * CDXC:OSIntegration 2026-06-15-14:00:
     * Settings should not expose macOS OS Integration during ordinary app use.
     * A direct or remembered OS Integration tab request must land on Settings
     * unless Debugging Mode makes the debug-only tab visible.
     */
    expect(
      shouldShowOSIntegrationSettingsTab({
        debuggingMode: false,
        isFirstLaunchSetup: false,
      }),
    ).toBe(false);
    expect(
      shouldShowOSIntegrationSettingsTab({
        debuggingMode: true,
        isFirstLaunchSetup: true,
      }),
    ).toBe(false);
    expect(
      shouldShowOSIntegrationSettingsTab({
        debuggingMode: true,
        isFirstLaunchSetup: false,
      }),
    ).toBe(true);

    expect(
      resolveSettingsModalTabForVisibility("osIntegration", {
        showOSIntegrationSettingsTab: false,
      }),
    ).toBe("settings");
    expect(
      resolveSettingsModalTabForVisibility("osIntegration", {
        showOSIntegrationSettingsTab: true,
      }),
    ).toBe("osIntegration");
    expect(
      resolveSettingsModalTabForVisibility("integrations", {
        showOSIntegrationSettingsTab: false,
      }),
    ).toBe("integrations");
  });
});
