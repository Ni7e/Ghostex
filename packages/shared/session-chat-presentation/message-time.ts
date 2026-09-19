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
];

const pad = (value: number) => String(value).padStart(2, '0');

function clockTime(date: Date): string {
  const hours = date.getHours();
  return `${hours % 12 || 12}:${pad(date.getMinutes())} ${hours < 12 ? 'AM' : 'PM'}`;
}

function ordinalSuffix(day: number): string {
  if (day % 100 >= 11 && day % 100 <= 13) return 'th';
  return day % 10 === 1 ? 'st' : day % 10 === 2 ? 'nd' : day % 10 === 3 ? 'rd' : 'th';
}

/**
 * CDXC:SessionChat 2026-09-19 WHY:
 * The label under a message follows t3code's day-aware timestamp: today `5:48 AM`, yesterday `yesterday at 5:48 AM`, older `26/07 5:48 AM`, with the year once it differs; the hover title is `5:48 AM, 26th July 2026`.
 * GPUI chat projects its rows in QuickJS, which has no `Intl`, so the text is assembled by hand and React calls the same function to keep both renderers identical.
 */
export function sessionChatMessageTime(
  timestamp: number | null | undefined,
  now: number = Date.now()
): { label: string; title: string } | null {
  if (typeof timestamp !== 'number' || !Number.isFinite(timestamp)) return null;
  const date = new Date(timestamp);
  const today = new Date(now);
  const time = clockTime(date);
  const startOfToday = new Date(today.getFullYear(), today.getMonth(), today.getDate()).getTime();
  const startOfMessageDay = new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
  // Rounded so a 23- or 25-hour DST day still counts as one calendar day.
  const dayDiff = Math.round((startOfToday - startOfMessageDay) / 86_400_000);
  const dayMonth = `${pad(date.getDate())}/${pad(date.getMonth() + 1)}`;
  const label =
    dayDiff <= 0
      ? time
      : dayDiff === 1
        ? `yesterday at ${time}`
        : date.getFullYear() === today.getFullYear()
          ? `${dayMonth} ${time}`
          : `${dayMonth}/${date.getFullYear()} ${time}`;
  const day = date.getDate();
  return { label, title: `${time}, ${day}${ordinalSuffix(day)} ${MONTHS[date.getMonth()]} ${date.getFullYear()}` };
}
