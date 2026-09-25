import { useLayoutEffect, useRef, type RefObject } from 'react';
import {
  SESSION_CHAT_WORKED_FOLD_ANIMATION,
  SESSION_CHAT_WORKED_FOLD_EASING,
} from '@/packages/shared/session-chat-presentation/worked-fold-animation';

/** The manual toggle time, or nothing at all when the reader asked for reduced motion. */
export function sessionChatToggleMs(): number {
  return typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches
    ? 0
    : SESSION_CHAT_WORKED_FOLD_ANIMATION.toggleMs;
}

/**
 * Eases an element between the heights it has before and after `key` changes: a capped block
 * releasing its cap ("Show more"), a clamped preview swapping for the full text, a card whose body
 * gains or loses rows. The element itself stays in the DOM in both states; this only keeps the
 * change from being a jump. Timing and easing come from the shared worked-fold file, the same
 * numbers GPUI's disclosure_motion.rs reads. A change of `key` mid-transition continues from the
 * height on screen.
 */
export function useSessionChatHeightTransition(ref: RefObject<HTMLElement | null>, key: unknown): void {
  const settledHeight = useRef<number | null>(null);
  const animation = useRef<Animation | null>(null);
  const first = useRef(true);

  useLayoutEffect(() => {
    const element = ref.current;
    if (!element) {
      return;
    }
    if (first.current) {
      first.current = false;
      settledHeight.current = element.getBoundingClientRect().height;
      return;
    }
    const running = animation.current !== null && animation.current.playState === 'running';
    const from = running ? element.getBoundingClientRect().height : settledHeight.current;
    animation.current?.cancel();
    animation.current = null;
    const to = element.getBoundingClientRect().height;
    const duration = sessionChatToggleMs();
    if (from === null || duration === 0 || Math.abs(from - to) < 0.5) {
      settledHeight.current = to;
      return;
    }
    const previousOverflow = element.style.overflow;
    element.style.overflow = 'hidden';
    const next = element.animate([{ height: `${from}px` }, { height: `${to}px` }], {
      duration,
      easing: SESSION_CHAT_WORKED_FOLD_EASING,
      fill: 'forwards',
    });
    animation.current = next;
    next.finished
      .then(() => {
        next.cancel();
        element.style.overflow = previousOverflow;
        animation.current = null;
        settledHeight.current = element.getBoundingClientRect().height;
      })
      .catch(() => {
        // Cancelled by a newer transition, which now owns the element.
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  // Content can change between toggles (a streaming block growing under its cap), so the height a
  // transition starts from is the one the last settled commit painted.
  useLayoutEffect(() => {
    const element = ref.current;
    if (element && animation.current === null) {
      settledHeight.current = element.getBoundingClientRect().height;
    }
  });
}
