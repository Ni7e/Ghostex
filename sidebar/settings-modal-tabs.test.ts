import { describe, expect, test } from "vitest";
import {
  resolveSettingsModalTabForVisibility,
  shouldShowOSIntegrationSettingsTab,
} from "./settings-modal-tabs";

describe("settings modal tabs", () => {
  test("hides macOS OS Integration unless beta features are enabled", () => {
    /*
     * CDXC:BetaFeatures 2026-06-16-13:08:
     * Settings should not expose macOS OS Integration during ordinary app use.
     * A direct or remembered OS Integration tab request must land on General
     * unless Show Beta features makes the beta-only tab visible.
     */
    expect(
      shouldShowOSIntegrationSettingsTab({
        isFirstLaunchSetup: false,
        showBetaFeatures: false,
      }),
    ).toBe(false);
    expect(
      shouldShowOSIntegrationSettingsTab({
        isFirstLaunchSetup: true,
        showBetaFeatures: true,
      }),
    ).toBe(false);
    expect(
      shouldShowOSIntegrationSettingsTab({
        isFirstLaunchSetup: false,
        showBetaFeatures: true,
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
