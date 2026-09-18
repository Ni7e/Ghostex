/*
 * CDXC:SessionChat 2026-09-05 DECISION:
 * User: the agent CLI's horizontal rules must be truncated in the Terminal View
 * hover preview instead of being copied verbatim. A zmx session is 200 columns
 * wide, so a rule row carried nothing but width: it pinned the tooltip to its
 * max width and each rule wrapped onto a second line, framing the real content
 * in four ragged bars. Supersedes the earlier "keep full-width rules verbatim"
 * rule of this formatter; indentation, blank rows, and text content are still
 * verbatim.
 */
const RULE_RUN_PATTERN = '[─━═╌╍┄┅┈┉▔‾⎯–—_-]{8,}';
const RULE_RUN = new RegExp(RULE_RUN_PATTERN, 'u');
const RULE_RUNS = new RegExp(RULE_RUN_PATTERN, 'gu');
/** Narrow enough to stay a frame, wide enough to still read as a rule. */
const MIN_RULE_COLUMNS = 24;
const MAX_RULE_COLUMNS = 72;

function previewColumns(line: string): number {
  return Array.from(line.trimEnd()).length;
}

/**
 * Rules are shortened to the widest row that is not itself a rule, so the box
 * still frames the content it was drawn around instead of dictating the
 * tooltip's width.
 */
function ruleColumnsFor(lines: readonly string[]): number {
  let widest = 0;
  for (const line of lines) {
    if (RULE_RUN.test(line)) {
      continue;
    }
    widest = Math.max(widest, previewColumns(line));
  }
  return Math.min(MAX_RULE_COLUMNS, Math.max(MIN_RULE_COLUMNS, widest));
}

/**
 * Keeps the captured terminal rows for the hover preview: indentation, blank
 * rows, and text content verbatim, with every long run of rule characters cut
 * down to `columns`. The server owns the bounded screen-tail size.
 */
export function formatSessionTerminalTailPreview(lines: readonly string[]): string {
  const columns = ruleColumnsFor(lines);
  return lines
    .map((line) =>
      line.replace(RULE_RUNS, (run) => {
        const chars = Array.from(run);
        return chars.length <= columns ? run : chars.slice(0, columns).join('');
      })
    )
    .join('\n');
}
