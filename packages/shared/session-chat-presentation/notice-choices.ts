/** Options a collapsed picker shows before the user expands it. */
export const COLLAPSED_CHOICE_COUNT = 2;
/**
 * Label suffixes dropped in the collapsed state so both options fit on one line.
 * CDXC:SessionChat 2026-09-18 DECISION: User: remove "(y)", "(default)" and "(n)" from the collapsed Yes/No buttons. Terminal key hints like "(y)" are single characters, so any trailing one-character hint is dropped along with "(recommended)" and "(default)", repeatedly so "No (default) (n)" reads "No".
 */
const COLLAPSED_LABEL_SUFFIX = /\s*\((?:recommended|default|[a-z0-9])\)$/i;

export function collapsedChoiceLabel(label: string): string {
  // CDXC:SessionChat 2026-09-07 WHY: Rate-limit continuation labels wrapped in the compact two-button layout. Shorten their shared prefix while preserving the timing, whether an explicit reset time or "shortly"; expanding still shows the terminal's full wording.
  let trimmed = label.trim().replace(/^Wait here, then continue automatically\b/i, 'Continue automatically');
  for (
    let next = trimmed.replace(COLLAPSED_LABEL_SUFFIX, '');
    next && next !== trimmed;
    next = trimmed.replace(COLLAPSED_LABEL_SUFFIX, '')
  ) {
    trimmed = next.trimEnd();
  }
  return trimmed;
}
