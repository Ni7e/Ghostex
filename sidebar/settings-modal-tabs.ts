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
  isFirstLaunchSetup,
  showBetaFeatures,
}: {
  isFirstLaunchSetup: boolean;
  showBetaFeatures: boolean;
}): boolean {
  /*
   * CDXC:BetaFeatures 2026-06-16-13:08:
   * OS Integration is currently a beta Settings tab. Hide it during ordinary
   * Settings use and first-launch setup until the user enables Show Beta
   * features from the Advanced Beta section.
   */
  return showBetaFeatures && !isFirstLaunchSetup;
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
