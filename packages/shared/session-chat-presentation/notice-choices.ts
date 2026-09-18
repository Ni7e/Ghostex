/** Options a collapsed picker shows before the user expands it. */
export const COLLAPSED_CHOICE_COUNT = 2;
/** Label suffixes dropped in the collapsed state so both options fit on one line. */
const COLLAPSED_LABEL_SUFFIXES = [' (recommended)'];

export function collapsedChoiceLabel(label: string): string {
  // CDXC:SessionChat 2026-09-07 WHY: Rate-limit continuation labels wrapped in the compact two-button layout. Shorten their shared prefix while preserving the timing, whether an explicit reset time or "shortly"; expanding still shows the terminal's full wording.
  const trimmed = label.trim().replace(/^Wait here, then continue automatically\b/i, 'Continue automatically');
  for (const suffix of COLLAPSED_LABEL_SUFFIXES) {
    if (trimmed.toLowerCase().endsWith(suffix)) {
      return trimmed.slice(0, -suffix.length).trimEnd();
    }
  }
  return trimmed;
}
