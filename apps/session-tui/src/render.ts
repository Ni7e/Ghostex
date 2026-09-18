// Strip terminal control text from names before painting trusted ANSI sequences.
export function clean(value: unknown): string {
  return String(value ?? '')
    .replace(/[\x00-\x1f\x7f-\x9f]/gu, ' ')
    .replace(/[\u202a-\u202e\u2066-\u2069]/gu, '');
}
function cellWidth(char: string): number {
  if (/\p{Mark}/u.test(char) || char === '\u200d' || char === '\ufe0f') return 0;
  const c = char.codePointAt(0)!;
  return /\p{Extended_Pictographic}/u.test(char) ||
    (c >= 0x1100 &&
      (c <= 0x115f ||
        (c >= 0x2e80 && c <= 0xa4cf) ||
        (c >= 0xac00 && c <= 0xd7a3) ||
        (c >= 0xf900 && c <= 0xfaff) ||
        (c >= 0xff01 && c <= 0xff60)))
    ? 2
    : 1;
}
export function textWidth(value: string): number {
  return Array.from(clean(value)).reduce((width, char) => width + cellWidth(char), 0);
}
export function fit(value: string, columns: number): string {
  let result = '',
    width = 0;
  for (const char of clean(value)) {
    const w = cellWidth(char);
    if (width + w > columns) break;
    result += char;
    width += w;
  }
  return result + ' '.repeat(Math.max(0, columns - width));
}
export const ansi = {
  reset: '\x1b[0m',
  cyan: '\x1b[36m',
  dim: '\x1b[90m',
  yellow: '\x1b[33m',
  selected: '\x1b[7m',
  green: '\x1b[32m',
};
export type Line = { text: string; style?: keyof typeof ansi };
export function paint(lines: Line[]) {
  const width = Math.max(1, process.stdout.columns ?? 80),
    height = Math.max(1, process.stdout.rows ?? 24);
  const body = Array.from({ length: height }, (_, i) => {
    const line = lines[i];
    return (
      (line?.style ? ansi[line.style] : '') +
      fit(line?.text ?? '', Math.max(1, width - 1)) +
      ansi.reset +
      '\x1b[K'
    );
  }).join('\r\n');
  process.stdout.write('\x1b[H' + body);
}
