/**
 * CDXC:SessionChat 2026-09-19 SEE-ALSO:
 * One status-line row, the height both renderers hold free under the chat box from the first frame so the
 * box never shifts when the values arrive. React applies it as `min-height` in the
 * `.ghostex-chat-status-line.is-reserved` rule of packages/core-ui/styles/chat.css (which also sets the
 * matching 16px line-height); apps/desktop/src/app/native_chat/context_meter.rs reserves the same height.
 */
export const SESSION_CHAT_STATUS_LINE_ROW_HEIGHT_PX = 16;

/**
 * Whether the status line keeps its row of space. Configured items reserve it while their values are still
 * loading, so the first paint already has room for the line the session is going to show.
 */
export function sessionChatStatusLineReserved(input: { hasConfiguredItems: boolean; itemCount: number }): boolean {
  return input.hasConfiguredItems || input.itemCount > 0;
}

/**
 * CDXC:SessionChat 2026-09-14 DECISION:
 * User: center every status-line row, avoid a row with only one item where possible, and show separators only between items on the same row.
 * This supersedes the 2026-09-04 container-only centering and left-aligned wrapped rows.
 */
export function balancedRowStarts(widths: number[], available: number, separator: number): number[] {
  const layouts = [{ rows: 0, singletons: 0, slack: 0, starts: [] as number[] }];
  for (let end = 1; end <= widths.length; end++) {
    let best: (typeof layouts)[number] | undefined;
    let width = 0;
    for (let start = end - 1; start >= 0; start--) {
      width += Math.min(widths[start], available) + (start < end - 1 ? separator : 0);
      if (width > available) break;
      const previous = layouts[start];
      const candidate = {
        rows: previous.rows + 1,
        singletons: previous.singletons + Number(end - start === 1),
        slack: previous.slack + (available - width) ** 2,
        starts: [...previous.starts, start],
      };
      if (
        !best ||
        candidate.rows < best.rows ||
        (candidate.rows === best.rows &&
          (candidate.singletons < best.singletons ||
            (candidate.singletons === best.singletons && candidate.slack < best.slack)))
      ) {
        best = candidate;
      }
    }
    layouts.push(best!);
  }
  return layouts[widths.length].starts;
}
