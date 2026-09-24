/*
CDXC:SessionChat 2026-09-16 DECISION:
User: opening and closing a card's body animates smoothly, both ways, and the same motion is applied to every card above the composer.
The body grows from the header (height and fade together, the content easing down a few pixels) and shrinks back the same way; the header's own corner and spacing changes transition alongside it.
The Web Animations API drives it rather than a CSS transition, because a closing body has to stay mounted until its animation really finishes, and `finished` reports that reliably where `transitionend` does not (reduced motion, hidden tabs, a re-open mid-close).
Since 2026-09-24 the timing is the shared manual-toggle time in packages/shared/session-chat-presentation/worked-fold-animation.json (the user's decision there: every expand and collapse animates, at double the automatic fold's speed), and the same body animates the transcript's expansions, not only the cards.
*/

import { useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { cn } from '@/packages/components/utils';
import { SESSION_CHAT_WORKED_FOLD_EASING } from '@/packages/shared/session-chat-presentation/worked-fold-animation';
import { sessionChatToggleMs, useSessionChatHeightTransition } from './session-chat-height-transition';

export interface SessionChatDisclosureBodyProps {
  open: boolean;
  children: ReactNode;
  className?: string;
  id?: string;
  role?: string;
  /**
   * True (the default) for a status card's body, which takes the card's row gap and its half-rem
   * gap to the header. False for a transcript expansion, which brings its own spacing.
   */
  gap?: boolean;
  /**
   * The gap the parent's flex or grid layout puts before this body, as a CSS length. The body
   * carries it inside (a negative margin outside, padding inside), so a body eased to nothing
   * leaves no gap behind and the settled layout is unchanged.
   */
  gapBefore?: string;
  /** The same for the gap after the body, for a body that comes first in its parent. */
  gapAfter?: string;
  /** Called once the body has settled open or closed. */
  onSettled?: (open: boolean) => void;
  /** A value whose change eases the open body between its old and new height (a fold inside it). */
  transitionKey?: unknown;
}

/**
 * The collapsible part of a status card. It owns the 0.5rem gap to the header
 * so the gap grows and shrinks with the body instead of popping in and out.
 * Closed and settled, it renders nothing.
 */
export function SessionChatDisclosureBody({
  open,
  children,
  className,
  id,
  role,
  gap = true,
  gapBefore,
  gapAfter,
  onSettled,
  transitionKey,
}: SessionChatDisclosureBodyProps) {
  const ref = useRef<HTMLDivElement>(null);
  const innerRef = useRef<HTMLDivElement>(null);
  const onSettledRef = useRef(onSettled);
  onSettledRef.current = onSettled;
  useSessionChatHeightTransition(innerRef, transitionKey);
  const animationsRef = useRef<[Animation, Animation] | null>(null);
  const [rendered, setRendered] = useState(open);
  // A body that mounts already open is settled, not opening: no appear animation.
  const settledRef = useRef(open);

  useLayoutEffect(() => {
    if (open && !rendered) {
      setRendered(true);
      return;
    }
    if (settledRef.current) {
      settledRef.current = false;
      if (open) {
        return;
      }
    }
    const element = ref.current;
    const inner = innerRef.current;
    if (!element || !inner) {
      return;
    }
    const previous = animationsRef.current;
    const midway = previous !== null && previous[0].playState === 'running';
    // A fresh mount starts from nothing; a close, or a re-open mid-close,
    // starts from wherever the body is right now.
    const from = midway || !open ? element.getBoundingClientRect().height : 0;
    previous?.forEach((animation) => animation.cancel());
    element.style.height = '';
    const to = open ? element.getBoundingClientRect().height : 0;
    const duration = sessionChatToggleMs();
    element.style.overflow = 'hidden';
    const animations: [Animation, Animation] = [
      element.animate(
        [
          { height: `${from}px`, opacity: open ? (midway ? 1 : 0) : 1 },
          { height: `${to}px`, opacity: open ? 1 : 0 },
        ],
        { duration, easing: SESSION_CHAT_WORKED_FOLD_EASING, fill: 'forwards' }
      ),
      inner.animate(
        [
          { transform: open && !midway ? 'translateY(-6px)' : 'translateY(0)' },
          { transform: open ? 'translateY(0)' : 'translateY(-6px)' },
        ],
        { duration, easing: SESSION_CHAT_WORKED_FOLD_EASING, fill: 'forwards' }
      ),
    ];
    animationsRef.current = animations;
    animations[0].finished
      .then(() => {
        animationsRef.current = null;
        if (open) {
          // Settled open: drop the fixed end height so the body can grow with
          // its content again.
          animations.forEach((animation) => animation.cancel());
          element.style.overflow = '';
          onSettledRef.current?.(true);
          return;
        }
        // Settled closed: keep the forward-filled end state until React has
        // unmounted the element. Cancelling first would show the full body
        // for one frame before it disappears.
        setRendered(false);
        onSettledRef.current?.(false);
      })
      .catch(() => {
        // Cancelled by a newer animation; that one owns the element now.
      });
  }, [open, rendered]);

  if (!rendered) {
    return null;
  }

  const style = {
    ...(gapBefore ? { '--disclosure-gap-before': gapBefore } : {}),
    ...(gapAfter ? { '--disclosure-gap-after': gapAfter } : {}),
  } as CSSProperties;
  return (
    <div
      className={cn('ghostex-chat-disclosure-body', !gap && 'is-plain', className)}
      id={id}
      ref={ref}
      role={role}
      style={style}
    >
      <div className={gap ? 'ghostex-chat-disclosure-body-inner' : 'ghostex-chat-disclosure-body-plain'} ref={innerRef}>
        {children}
      </div>
    </div>
  );
}
