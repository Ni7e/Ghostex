import { useLayoutEffect, useRef, useState } from 'react';
import type { SessionChatContextDetailItem } from './session-chat-context-details';

import { balancedRowStarts } from '@/packages/shared/session-chat-presentation/status-line-layout';

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
