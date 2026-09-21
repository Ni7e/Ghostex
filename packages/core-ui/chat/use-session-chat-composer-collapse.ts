import { useCallback, useEffect, useRef, useState, type RefObject } from 'react';

const RELEASE_DURATION_MS = 200;
const RELEASE_EASING = 'cubic-bezier(0.32, 0.72, 0, 1)';
/** The compact grid's column gap; the row narrows by the footer's width plus this while the footer rises beside it. */
const COMPACT_GRID_GAP_PX = 12;

/**
 * The collapse animates exactly these styles. The driver writes this table every tracking frame
 * and removes every property on release — the writes and the clears are the same list and cannot
 * drift apart. `selector: null` targets the composer element itself.
 */
type ClipStyle = { selector: string | null; property: string; value: (f: ClipFrame) => string };

type ClipFrame = {
  natural: number;
  clip: number;
  rise: number;
  riseFraction: number;
  lineHeight: number;
  wrapperExtension: number;
  footerNarrowing: number;
};

const CLIP_STYLES: ClipStyle[] = [
  {
    selector: null,
    property: 'height',
    value: (f) => `${f.natural - f.clip}px`,
  },
  {
    selector: null,
    property: 'display',
    value: () => 'flex',
  },
  {
    selector: null,
    property: 'flex-direction',
    value: () => 'column',
  },
  {
    selector: null,
    property: 'justify-content',
    value: () => 'flex-end',
  },
  {
    selector: null,
    property: 'overflow',
    value: () => 'clip',
  },
  {
    selector: '.ghostex-chat-composer-row',
    property: 'flex-shrink',
    value: () => '1',
  },
  {
    selector: '.ghostex-chat-composer-row',
    property: 'flex-grow',
    value: () => '1',
  },
  {
    selector: '.ghostex-chat-composer-row',
    property: 'min-height',
    value: () => '0',
  },
  {
    selector: '.ghostex-chat-composer-row',
    property: 'align-items',
    value: () => 'stretch',
  },
  {
    selector: '.ghostex-chat-composer-row',
    property: 'margin-right',
    value: (f) => `${f.footerNarrowing * f.riseFraction}px`,
  },
  {
    selector: '.ghostex-chat-composer-lexical, .ghostex-chat-composer-input',
    property: 'min-height',
    value: () => '0',
  },
  {
    selector: '.ghostex-chat-composer-lexical, .ghostex-chat-composer-input',
    property: 'overflow',
    value: () => 'clip',
  },
  {
    selector: '.ghostex-chat-composer-lexical, .ghostex-chat-composer-input',
    property: 'margin-bottom',
    value: (f) => `-${f.wrapperExtension}px`,
  },
  {
    selector: '.ghostex-chat-composer-lexical-content, .ghostex-chat-composer-plain-input',
    property: 'min-height',
    value: () => '0',
  },
  {
    selector: '.ghostex-chat-composer-lexical-content, .ghostex-chat-composer-plain-input',
    property: 'height',
    value: (f) => `${f.lineHeight + f.wrapperExtension * (1 - f.riseFraction)}px`,
  },
  {
    selector: '.ghostex-chat-composer-lexical-content, .ghostex-chat-composer-plain-input',
    property: 'overflow',
    value: () => 'clip',
  },
  {
    selector: '.ghostex-chat-composer-footer',
    property: 'margin-top',
    value: (f) => `-${f.rise}px`,
  },
  {
    selector: '.ghostex-chat-composer-footer-options',
    property: 'opacity',
    value: (f) => String(1 - f.riseFraction),
  },
  {
    selector: '.ghostex-chat-composer-footer-options',
    property: 'pointer-events',
    value: (f) => (f.rise > 0 ? 'none' : ''),
  },
];

/**
 * CDXC:SessionChat 2026-09-05 DECISION:
 * User: collapse the chat text box when scrolling up through the conversation and expand it again at the bottom.
 *
 * CDXC:SessionChat 2026-09-18 DECISION:
 * User: the collapse must move the whole box downwards and do the swallowing at the bottom border, so the placeholder rides down with the scroll instead of being occluded by the top border pulling over it.
 *
 * CDXC:SessionChat 2026-09-18 DECISION:
 * User: the whole collapse must stay one continuous scroll-driven movement — "no trigger at all". The composer footer keeps its position and is never occluded while the box travels; over the second segment it rises beside the row's first line as the left icon options fade out under the same scroll, and the compact form is the original slim bar at its original height with the placeholder occluded to its top line. The text-to-top-border gap and the content-to-box gap stay constant through every state.
 *
 * CDXC:SessionChat 2026-09-19 WHY: (supersedes the 2026-09-17 snap design and every interim iteration — the top-edge clip, the grid hand-off, the footer-swallowing variant, the footer-less held clip, the animated hand-off, the momentum-suppression window, and the bottom-threshold restore — each was a state machine fighting the scroll, and each produced a flicker)
 * An upward wheel over the transcript engages the tracking on the event itself — one tick ahead of the scroll it produces — and from then on the composer's geometry is one pure function: `height = naturalHeight − clamp(distanceFromBottom, 0, travel + rise)`, with distance measured from the bottom of the transcript. The size is the scrollbar's position: expanded near the bottom, compact past the travel, linear in between — it cannot desync from the scrollbar, so there is no momentum suppression and no bottom threshold to get stuck against. Segment one (`progress ≤ travel`) bottom-packs the children and squishes the editor row against the footer pinned at the box's bottom border; the editor's clip box is extended down to the composer's bottom border, so the placeholder's lines stay visible and slide under the icons row. Segment two keeps shrinking the box while a negative top margin raises the footer beside the row's first line and the row narrows by the footer's width plus the grid gap; the footer options fade out and drop pointer events under the same scroll. At the end the held inline styles already match the compact grid's geometry, so the grid attribute flips without painting a pixel and only cleans up the transient overlap. Scrolling back down walks the same continuum backwards through the same inline writes; when the scroll returns to the bottom the box is already at its natural size and the clip simply releases. Wheel-only engagement means session restores and keyboard scrolling never engage the tracking. The `collapsed` boolean drives the view bookkeeping (inset high-water mark, scroll-to-end chrome). The transcript inset must hold the expanded height through the whole tracking phase — if the inset shrank with the composer, the scroll distance from the bottom would collapse back to zero and the driver would have nothing left to measure (SEE-ALSO: the holdRef on use-session-chat-composer-inset.ts). The release tween keeps overflow clamped inline so the re-revealed editor space slides up under the border instead of painting past it.
 */
export function useSessionChatComposerCollapse({
  enabled,
  collapseEligible,
  transcriptRef,
  insetHoldRef,
  onCollapsedChange,
}: {
  enabled: boolean;
  collapseEligible: boolean;
  transcriptRef?: RefObject<HTMLDivElement | null>;
  /** Set while the scroll-linked clip needs the transcript inset held at the expanded height. */
  insetHoldRef?: RefObject<boolean>;
  onCollapsedChange?: (collapsed: boolean) => void;
}) {
  const composerRef = useRef<HTMLDivElement>(null);
  const [collapsed, setCollapsed] = useState(false);
  const collapsedRef = useRef(false);
  const clipActiveRef = useRef(false);
  const naturalHeightRef = useRef(0);
  const travelRef = useRef(0);
  const riseRef = useRef(0);
  const lineHeightRef = useRef(0);
  const wrapperExtensionRef = useRef(0);
  const footerNarrowingRef = useRef(0);
  const releaseAnimationRef = useRef<Animation | null>(null);
  const collapseEligibleRef = useRef(false);
  collapseEligibleRef.current = enabled && collapseEligible && !collapsed;

  const changeCollapsed = useCallback(
    (next: boolean) => {
      if (collapsedRef.current === next) return;
      collapsedRef.current = next;
      setCollapsed(next);
      onCollapsedChange?.(next);
    },
    [onCollapsedChange]
  );

  useEffect(() => () => onCollapsedChange?.(false), [onCollapsedChange]);

  const applyClipStyles = useCallback((composer: HTMLElement, frame: ClipFrame) => {
    for (const entry of CLIP_STYLES) {
      const element = entry.selector ? composer.querySelector<HTMLElement>(entry.selector) : composer;
      element?.style.setProperty(entry.property, entry.value(frame));
    }
    composer.dataset.scrollClipping = 'true';
  }, []);

  const clearInlineClipStyles = useCallback((composer: HTMLElement) => {
    composer.removeAttribute('data-scroll-clipping');
    for (const entry of CLIP_STYLES) {
      const element = entry.selector ? composer.querySelector<HTMLElement>(entry.selector) : composer;
      element?.style.removeProperty(entry.property);
    }
  }, []);

  const releaseClip = useCallback(
    (animate: boolean) => {
      const composer = composerRef.current;
      const clippedHeight = composer && clipActiveRef.current ? composer.getBoundingClientRect().height : 0;
      // Cancelling runs the finish cleanup below through oncancel, so a release that
      // interrupts another release (or an engage that re-engages) never leaves the
      // inline clip styles stuck on the element.
      releaseAnimationRef.current?.cancel();
      releaseAnimationRef.current = null;
      if (!clipActiveRef.current) return;
      clipActiveRef.current = false;
      if (insetHoldRef) insetHoldRef.current = false;
      if (!composer) return;
      if (!animate || matchMedia('(prefers-reduced-motion: reduce)').matches || clippedHeight < 1) {
        clearInlineClipStyles(composer);
        return;
      }
      // Hand the height back to the natural layout and keep overflow clamped so the animation
      // reveals the editor space under the border instead of painting it past the box; finish or
      // cancel restores the plain flow. The target is measured live: the editor may have grown or
      // shrunk while the clip was held.
      composer.style.height = '';
      const naturalHeight = composer.getBoundingClientRect().height;
      const animation = composer.animate(
        [{ height: `${clippedHeight}px` }, { height: `${naturalHeight}px` }],
        { duration: RELEASE_DURATION_MS, easing: RELEASE_EASING }
      );
      releaseAnimationRef.current = animation;
      const finish = () => {
        if (releaseAnimationRef.current !== animation) return;
        releaseAnimationRef.current = null;
        clearInlineClipStyles(composer);
      };
      animation.onfinish = finish;
      animation.oncancel = finish;
    },
    [insetHoldRef, clearInlineClipStyles]
  );

  const expand = useCallback(() => {
    if (collapsedRef.current) changeCollapsed(false);
    releaseClip(true);
  }, [changeCollapsed, releaseClip]);

  useEffect(() => {
    if (!enabled || !collapseEligible) {
      releaseClip(false);
      changeCollapsed(false);
    }
  }, [enabled, collapseEligible, changeCollapsed, releaseClip]);

  useEffect(() => {
    if (!enabled) return;
    const getViewport = () =>
      transcriptRef?.current?.querySelector<HTMLDivElement>('[data-slot="message-scroller-viewport"]');

    // Engage: cancel a running release, then measure the natural box and the two travel segments.
    // Segment one squishes the editor row against the footer pinned at the box's bottom border;
    // segment two raises the footer beside the row's first line while the row narrows by the
    // footer's width.
    const engageAt = () => {
      releaseAnimationRef.current?.cancel();
      releaseAnimationRef.current = null;
      const composer = composerRef.current;
      if (!composer || clipActiveRef.current) return;
      const row = composer.querySelector<HTMLElement>('.ghostex-chat-composer-row');
      if (!row) return;
      const input = composer.querySelector<HTMLElement>(
        '.ghostex-chat-composer-lexical-content, .ghostex-chat-composer-plain-input'
      );
      const rowStyle = getComputedStyle(row);
      const composerStyle = getComputedStyle(composer);
      // The row's floor keeps its own bottom padding — removing it inline would change the
      // text-to-top-border gap on the first tracking frame (the natural height still counts it).
      const rowMin =
        (input ? Number.parseFloat(getComputedStyle(input).lineHeight) : Number.parseFloat(rowStyle.lineHeight)) +
        (Number.parseFloat(rowStyle.paddingBottom) || 0);
      const composerRect = composer.getBoundingClientRect();
      const footer = composer.querySelector<HTMLElement>('.ghostex-chat-composer-footer');
      const belowFooter =
        (Number.parseFloat(composerStyle.paddingBottom) || 0) +
        (Number.parseFloat(composerStyle.borderBottomWidth) || 0);
      // The end of segment one is the footer's own footprint: the composer's top edge, the row
      // squished to its first line, then the footer and the composer's bottom padding and border.
      // The footer is measured at its engage-time position, so replace the row's natural height
      // under it with the compact row height instead of using the footer's bottom offset.
      const endHeight = footer
        ? footer.getBoundingClientRect().top -
          composerRect.top -
          row.getBoundingClientRect().height +
          rowMin +
          footer.getBoundingClientRect().height +
          belowFooter
        : row.getBoundingClientRect().top - composerRect.top + rowMin;
      const naturalHeight = composerRect.height;
      const travel = Math.max(naturalHeight - endHeight, 0);
      if (travel < 1) return;
      naturalHeightRef.current = naturalHeight;
      travelRef.current = travel;
      riseRef.current = rowMin;
      lineHeightRef.current = input
        ? Number.parseFloat(getComputedStyle(input).lineHeight)
        : Number.parseFloat(rowStyle.lineHeight);
      // Extend the editor's clip box down to the composer's bottom border (across the icons band
      // and the bottom padding): the placeholder's later lines stay visible and slide under the
      // icons row during the travel instead of being masked one line above the border.
      wrapperExtensionRef.current =
        (footer?.getBoundingClientRect().height ?? 0) + belowFooter + (Number.parseFloat(rowStyle.paddingBottom) || 0);
      footerNarrowingRef.current =
        footer?.querySelector<HTMLElement>('.ghostex-chat-composer-footer-actions')?.getBoundingClientRect().width ??
        footer?.getBoundingClientRect().width ??
        0;
      clipActiveRef.current = true;
      if (insetHoldRef) insetHoldRef.current = true;
    };

    const onWheel = (event: WheelEvent) => {
      if (event.ctrlKey || event.deltaY >= 0 || !(event.target instanceof Element)) return;
      const viewport = getViewport();
      if (!viewport || !viewport.contains(event.target)) return;
      // An upward wheel engages the tracking on the event itself — one tick ahead of the scroll it
      // produces — so the chat content never slides under a box that is waiting for that scroll.
      if (!clipActiveRef.current && !collapsedRef.current && collapseEligibleRef.current) {
        engageAt();
      }
    };

    const onScroll = (event: Event) => {
      const viewport = getViewport();
      const composer = composerRef.current;
      if (!viewport || event.target !== viewport || !composer) return;
      if (!clipActiveRef.current) return;
      const distance = viewport.scrollHeight - viewport.clientHeight - viewport.scrollTop;
      // The whole collapse is one pure function of the scroll distance from the bottom: segment
      // one squishes the row against the pinned footer, segment two raises the footer beside the
      // row's first line. The box's size is the scrollbar's position — it cannot desync — and
      // scrolling back down walks the same continuum in reverse with no state swap, no layout
      // flip, and no timed animation anywhere in the path.
      const progress = Math.min(Math.max(distance, 0), travelRef.current + riseRef.current);
      const frame: ClipFrame = {
        natural: naturalHeightRef.current,
        clip: Math.min(progress, travelRef.current),
        rise: Math.min(Math.max(progress - travelRef.current, 0), riseRef.current),
        lineHeight: lineHeightRef.current,
        wrapperExtension: wrapperExtensionRef.current,
        footerNarrowing: footerNarrowingRef.current,
        riseFraction: riseRef.current > 0 ? frame_rise_helper(progress) : 0,
      };
      function frame_rise_helper(progress: number) {
        return Math.min(Math.max(progress - travelRef.current, 0), riseRef.current) / riseRef.current;
      }
      if (frame.rise >= riseRef.current - 0.5 && !collapsedRef.current) changeCollapsed(true);
      else if (frame.rise < riseRef.current - 0.5 && collapsedRef.current) changeCollapsed(false);
      releaseAnimationRef.current?.cancel();
      releaseAnimationRef.current = null;
      applyClipStyles(composer, frame);
    };

    document.addEventListener('wheel', onWheel, { capture: true, passive: true });
    document.addEventListener('scroll', onScroll, true);
    return () => {
      document.removeEventListener('wheel', onWheel, true);
      document.removeEventListener('scroll', onScroll, true);
      releaseAnimationRef.current?.cancel();
      releaseAnimationRef.current = null;
      releaseClip(false);
    };
  }, [enabled, transcriptRef, applyClipStyles, changeCollapsed, releaseClip, insetHoldRef]);

  return { collapsed: enabled && collapseEligible && collapsed, composerRef, expand };
}
