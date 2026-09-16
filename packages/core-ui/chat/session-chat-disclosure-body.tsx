/*
CDXC:SessionChat 2026-09-16 DECISION:
User: opening and closing a card's body animates smoothly, both ways, and the same motion is applied to every card above the composer.
The body grows from the header (height and fade together, the content easing down a few pixels) and shrinks back the same way; the header's own corner and spacing changes transition alongside it.
The Web Animations API drives it rather than a CSS transition, because a closing body has to stay mounted until its animation really finishes, and `finished` reports that reliably where `transitionend` does not (reduced motion, hidden tabs, a re-open mid-close).
*/

import { useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { cn } from '@/packages/components/utils';

const OPEN_MS = 260;
const CLOSE_MS = 200;
const EASING = 'cubic-bezier(0.2, 0, 0, 1)';

function motionMs(ms: number): number {
  return typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : ms;
}

export interface SessionChatDisclosureBodyProps {
  open: boolean;
  children: ReactNode;
  className?: string;
  id?: string;
  role?: string;
}

/**
 * The collapsible part of a status card. It owns the 0.5rem gap to the header
 * so the gap grows and shrinks with the body instead of popping in and out.
 * Closed and settled, it renders nothing.
 */
export function SessionChatDisclosureBody({ open, children, className, id, role }: SessionChatDisclosureBodyProps) {
  const ref = useRef<HTMLDivElement>(null);
  const innerRef = useRef<HTMLDivElement>(null);
  const animationsRef = useRef<[Animation, Animation] | null>(null);
  const [rendered, setRendered] = useState(open);

  useLayoutEffect(() => {
    if (open && !rendered) {
      setRendered(true);
      return;
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
    const duration = motionMs(open ? OPEN_MS : CLOSE_MS);
    element.style.overflow = 'hidden';
    const animations: [Animation, Animation] = [
      element.animate(
        [
          { height: `${from}px`, opacity: open ? (midway ? 1 : 0) : 1 },
          { height: `${to}px`, opacity: open ? 1 : 0 },
        ],
        { duration, easing: EASING, fill: 'forwards' }
      ),
      inner.animate(
        [
          { transform: open && !midway ? 'translateY(-6px)' : 'translateY(0)' },
          { transform: open ? 'translateY(0)' : 'translateY(-6px)' },
        ],
        { duration, easing: EASING, fill: 'forwards' }
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
          return;
        }
        // Settled closed: keep the forward-filled end state until React has
        // unmounted the element. Cancelling first would show the full body
        // for one frame before it disappears.
        setRendered(false);
      })
      .catch(() => {
        // Cancelled by a newer animation; that one owns the element now.
      });
  }, [open, rendered]);

  if (!rendered) {
    return null;
  }

  return (
    <div className={cn('ghostex-chat-disclosure-body', className)} id={id} ref={ref} role={role}>
      <div className='ghostex-chat-disclosure-body-inner' ref={innerRef}>
        {children}
      </div>
    </div>
  );
}
