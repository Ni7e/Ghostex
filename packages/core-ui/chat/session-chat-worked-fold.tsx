import { useCallback, useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import {
  SESSION_CHAT_WORKED_FOLD_ANIMATION as timing,
  SESSION_CHAT_WORKED_FOLD_EASING,
} from '@/packages/shared/session-chat-presentation/worked-fold-animation';
import './session-chat-worked-fold.css';

/**
 * How a finished turn's "Worked for Xs" fold is moving: folding away the rows that were live a
 * moment ago, or opening or closing because the reader toggled it. GPUI plays the same motion in
 * apps/desktop/src/app/native_chat/worked_fold_motion.rs.
 */
export type SessionChatWorkedMotion = 'fold' | 'open' | 'close';

function reducedMotion(): boolean {
  return typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
}

function motionMs(motion: SessionChatWorkedMotion): number {
  return motion === 'fold'
    ? Math.max(timing.collapseDelayMs + timing.collapseMs, timing.headingDelayMs + timing.headingMs)
    : timing.toggleMs;
}

/**
 * The fold's motion. `foldingFromLive` is read once, when the folded turn mounts: its rows were on
 * screen as live rows in the previous render, so they fold away instead of being swapped out.
 * `armed` is false for the first painted frame of a motion, which shows its starting state, and
 * true once the transitions toward its end state are running.
 */
export function useSessionChatWorkedFold(foldingFromLive: boolean, open: boolean) {
  const [motion, setMotion] = useState<SessionChatWorkedMotion | null>(() =>
    foldingFromLive && !open && !reducedMotion() ? 'fold' : null
  );
  const [armed, setArmed] = useState(false);
  const motionRef = useRef(motion);
  motionRef.current = motion;
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const frame = useRef<number | undefined>(undefined);

  const arm = useCallback(() => {
    if (frame.current !== undefined) cancelAnimationFrame(frame.current);
    // Two frames: the first commits the starting state, the second starts the transitions from it.
    frame.current = requestAnimationFrame(() => {
      frame.current = requestAnimationFrame(() => {
        frame.current = undefined;
        setArmed(true);
      });
    });
  }, []);
  const settleAfter = useCallback((next: SessionChatWorkedMotion) => {
    clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      setMotion(null);
      setArmed(false);
    }, motionMs(next));
  }, []);

  useLayoutEffect(() => {
    if (motionRef.current === 'fold') {
      arm();
      settleAfter('fold');
    }
  }, [arm, settleAfter]);
  useEffect(
    () => () => {
      clearTimeout(timer.current);
      if (frame.current !== undefined) cancelAnimationFrame(frame.current);
    },
    []
  );

  /** The reader opened or closed the log. A reversal mid-way continues from what is on screen. */
  const toggled = useCallback(
    (nextOpen: boolean) => {
      if (reducedMotion()) {
        clearTimeout(timer.current);
        setMotion(null);
        setArmed(false);
        return;
      }
      const next: SessionChatWorkedMotion = nextOpen ? 'open' : 'close';
      const current = motionRef.current;
      if (current !== 'open' && current !== 'close') {
        setArmed(false);
        arm();
      }
      setMotion(next);
      settleAfter(next);
    },
    [arm, settleAfter]
  );

  const style = {
    '--worked-fold-easing': SESSION_CHAT_WORKED_FOLD_EASING,
    '--worked-dim-opacity': String(timing.dimOpacity),
    '--worked-dim-ms': `${motion === 'fold' ? timing.dimMs : timing.toggleMs}ms`,
    '--worked-heading-offset': `${timing.headingOffsetPx}px`,
    '--worked-heading-ms': `${timing.headingMs}ms`,
    '--worked-heading-delay': `${timing.headingDelayMs}ms`,
  } as CSSProperties;

  return { motion, armed, toggled, style };
}

/** A part of a moving fold whose height eases between nothing and its natural height. */
export function SessionChatWorkedPart({
  children,
  delayMs = 0,
  ms,
  open,
  shutOpacity,
}: {
  children: ReactNode;
  delayMs?: number;
  ms: number;
  open: boolean;
  /** How visible the part is while shut; parts that arrive fade in from 0. */
  shutOpacity?: number;
}) {
  return (
    <div
      className='ghostex-chat-worked-part'
      data-open={open ? 'true' : 'false'}
      style={
        {
          '--worked-part-ms': `${ms}ms`,
          '--worked-part-delay': `${delayMs}ms`,
          ...(shutOpacity === undefined ? {} : { '--worked-part-shut-opacity': String(shutOpacity) }),
        } as CSSProperties
      }
    >
      <div className='ghostex-chat-worked-part-inner'>{children}</div>
    </div>
  );
}

export { timing as SESSION_CHAT_WORKED_FOLD_TIMING };
