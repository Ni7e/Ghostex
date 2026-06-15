export type SettingsModalTab =
  | "settings"
  | "integrations"
  | "osIntegration"
  | "remote"
  | "projects"
  | "agents"
  | "actions"
  | "openTargets"
  | "hotkeys";

export type SettingsModalTabVisibilityOptions = {
  showOSIntegrationSettingsTab: boolean;
};

export function shouldShowOSIntegrationSettingsTab({
  debuggingMode,
  isFirstLaunchSetup,
}: {
  debuggingMode: boolean;
  isFirstLaunchSetup: boolean;
}): boolean {
  /*
   * CDXC:OSIntegration 2026-06-15-14:00:
   * The macOS OS Integration settings are a Debugging Mode surface. Hide the tab
   * during ordinary Settings use, including first-launch setup, so default app
   * handler controls are available only while debug UI is enabled.
   */
  return debuggingMode && !isFirstLaunchSetup;
}

export function resolveSettingsModalTabForVisibility(
  tab: SettingsModalTab,
  { showOSIntegrationSettingsTab }: SettingsModalTabVisibilityOptions,
): SettingsModalTab {
  if (tab === "osIntegration" && !showOSIntegrationSettingsTab) {
    return "settings";
  }
  return tab;
}
