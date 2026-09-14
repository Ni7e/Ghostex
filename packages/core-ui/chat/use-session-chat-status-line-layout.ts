import { useLayoutEffect, useRef, useState } from 'react';
import type { SessionChatContextDetailItem } from './session-chat-context-details';

/**
 * CDXC:SessionChat 2026-09-14 DECISION:
 * User: center every status-line row, avoid a row with only one item where possible, and show separators only between items on the same row.
 * This supersedes the 2026-09-04 container-only centering and left-aligned wrapped rows.
 */
function balancedRowStarts(widths: number[], available: number, separator: number): number[] {
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

export function useSessionChatStatusLineLayout(items: readonly SessionChatContextDetailItem[]) {
  const ref = useRef<HTMLDivElement>(null);
  const [rowStarts, setRowStarts] = useState<number[]>([0]);

  useLayoutEffect(() => {
    const line = ref.current;
    if (!line) return;
    const measure = () => {
      const style = getComputedStyle(line);
      const available = line.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight);
      if (available <= 0) return;

      const separator = line.querySelector<HTMLElement>('.ghostex-chat-status-line-separator');
      const separatorWidth = separator ? parseFloat(getComputedStyle(separator).width) : 0;
      // Read natural widths, independent of the previous row breaks or truncation.
      line.dataset.statusMeasuring = 'true';
      let widths: number[];
      try {
        widths = Array.from(
          line.querySelectorAll<HTMLElement>('.ghostex-chat-status-line-item'),
          (item) => item.getBoundingClientRect().width
        );
      } finally {
        delete line.dataset.statusMeasuring;
      }
      const next = balancedRowStarts(widths, available, separatorWidth);
      setRowStarts((previous) => (previous.join(',') === next.join(',') ? previous : next));
    };

    measure();
    const resize = new ResizeObserver(measure);
    resize.observe(line);
    for (const item of line.querySelectorAll('.gx-account-text')) resize.observe(item);
    const mutations = new MutationObserver(measure);
    mutations.observe(line, { childList: true, characterData: true, subtree: true });
    document.fonts.addEventListener('loadingdone', measure);
    return () => {
      resize.disconnect();
      mutations.disconnect();
      document.fonts.removeEventListener('loadingdone', measure);
    };
  }, [items]);

  return { ref, rowStarts };
}
