import { fit, textWidth } from './render';

/** CDXC:Sessions 2026-09-17 DECISION:
 * User: wrap spaces onto additional rows when they do not fit on one line.
 * Rendering and mouse hit targets use the same terminal-cell positions.
 */
export function wrapSpaces(
  spaces: { id: string; name: string }[],
  selected: string | undefined,
  width: number
) {
  const lines = [''];
  const hits: { id: string; x: number; end: number; line: number }[] = [];
  for (const [index, space] of spaces.entries()) {
    const label = fit(
      `${space.id === selected ? '[' : ''}${index + 1}:${space.name}${space.id === selected ? ']' : ''}`,
      width
    ).trimEnd();
    let line = lines.length - 1;
    if (lines[line] && textWidth(lines[line]!) + 2 + textWidth(label) > width) {
      lines.push('');
      line++;
    }
    if (lines[line]) lines[line] += '  ';
    const x = textWidth(lines[line]!) + 1;
    lines[line] += label;
    hits.push({ id: space.id, x, end: x + textWidth(label) - 1, line });
  }
  return { lines, hits };
}
