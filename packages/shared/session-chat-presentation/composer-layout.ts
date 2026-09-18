export interface ChatComposerMeasurements {
  available: number;
  options: number;
  actions: number;
  footerGap: number;
  actionGap: number;
  clearance: number;
  hasOverflowOptions: boolean;
  controls: { id: string; width: number }[];
}

/** CDXC:SessionChat 2026-09-17 DECISION:
 * User: GPUI and React chat must stay visually in sync. Both renderers measure their controls and move them into More actions in the same order.
 */
export function fitChatComposerControls(measurements: ChatComposerMeasurements) {
  let required = measurements.options + measurements.actions + measurements.footerGap + measurements.clearance;
  const overflowed: string[] = [];
  for (const control of measurements.controls) {
    if (required <= measurements.available) break;
    overflowed.push(control.id);
    required -= control.width + measurements.actionGap;
  }
  return { overflowed, optionsOverflowed: required > measurements.available && measurements.hasOverflowOptions };
}
