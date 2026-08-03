import featureFlags from "./feature-flags.json";

/**
 * CDXC:T3CodeDisabled ghostex-mzp9:
 * T3 Code remains in-tree for a future plugin, but shipped UI and native pane
 * creation stay disabled from this single shared switch.
 */
export const T3CODE_ENABLED: boolean = featureFlags.t3Code;
