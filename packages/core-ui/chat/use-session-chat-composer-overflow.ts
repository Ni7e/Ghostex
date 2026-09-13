import { useLayoutEffect, useRef, useState } from 'react';

/**
 * CDXC:SessionChat 2026-09-13 DECISION:
 * User: move composer buttons into More actions one at a time from left to right, early enough to avoid covering the context ring and effort controls.
 * Measure the full toolbar and uncompressed options together, so changing a model, font size, or pane width uses the same spacing budget.
 */
export function useSessionChatComposerOverflow(editingHostAction: boolean) {
  const toolbarRef = useRef<HTMLDivElement>(null);
  const [overflowed, setOverflowed] = useState<string[]>([]);

  useLayoutEffect(() => {
    const toolbar = toolbarRef.current;
    const footer = toolbar?.closest<HTMLElement>('.ghostex-chat-composer-footer');
    const options = footer?.querySelector<HTMLElement>('.ghostex-chat-composer-footer-options');
    const actions = toolbar?.parentElement;
    if (!toolbar || !footer || !options || !actions) return;

    const measure = () => {
      if (footer.getBoundingClientRect().width === 0) return;

      // Measure existing controls synchronously, then restore their layout before paint.
      // Measuring the compressed row would make buttons alternate between fitting and overflowing.
      footer.dataset.composerMeasuring = 'true';
      let next: string[];
      try {
        const footerStyle = getComputedStyle(footer);
        const available =
          footer.clientWidth - parseFloat(footerStyle.paddingLeft) - parseFloat(footerStyle.paddingRight);
        const gap = parseFloat(getComputedStyle(toolbar).columnGap) || 0;
        const clearance = 16;
        let required =
          options.getBoundingClientRect().width +
          actions.getBoundingClientRect().width +
          (parseFloat(footerStyle.columnGap) || 0) +
          clearance;
        next = [];
        for (const action of toolbar.querySelectorAll<HTMLElement>(':scope > [data-composer-action]')) {
          if (required <= available) break;
          next.push(action.dataset.composerAction!);
          required -= action.getBoundingClientRect().width + gap;
        }
      } finally {
        delete footer.dataset.composerMeasuring;
      }
      setOverflowed((previous) => (previous.join(',') === next.join(',') ? previous : next));
    };

    measure();
    const resize = new ResizeObserver(measure);
    resize.observe(footer);
    resize.observe(options);
    resize.observe(actions);
    // Labels and optional controls can change without changing their compressed width.
    const mutations = new MutationObserver(measure);
    mutations.observe(options, { childList: true, characterData: true, subtree: true });
    mutations.observe(toolbar, { childList: true, characterData: true, subtree: true });
    document.fonts.addEventListener('loadingdone', measure);
    return () => {
      resize.disconnect();
      mutations.disconnect();
      document.fonts.removeEventListener('loadingdone', measure);
    };
  }, [editingHostAction]);

  return { toolbarRef, isOverflowed: (id: string) => overflowed.includes(id) };
}
