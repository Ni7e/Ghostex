/**
 * CDXC:AppModal 2026-09-20 WHY:
 * Quick Access runs in the QuickJS native runtime, which ships no `Intl`. The four React modals group
 * their rows with `Intl.DateTimeFormat(undefined, { weekday, year, month, day })`; calling that here threw
 * `Intl is not defined` inside the publish callback, which escaped `tickNativeTimers` and stalled every
 * other timer in that tick, so the whole surface went blank and the sidebar's own timers were starved with it.
 * This reproduces that formatter's `en-US` output ("Friday, September 18, 2026") with plain Date fields.
 * SEE-ALSO: packages/shared/native-runtime/platform.ts lists the globals the runtime actually provides.
 */

const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'] as const;

const MONTHS = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
] as const;

/** The day heading for an epoch-millisecond timestamp. */
export function quickAccessDayLabel(timestamp: number): string {
  const date = new Date(timestamp);
  if (Number.isNaN(date.getTime())) return 'Unknown day';
  return `${WEEKDAYS[date.getDay()]}, ${MONTHS[date.getMonth()]} ${date.getDate()}, ${date.getFullYear()}`;
}
