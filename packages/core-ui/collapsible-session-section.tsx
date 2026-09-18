import { AnimatePresence, motion, useIsPresent, useReducedMotion } from 'motion/react';
import type { ReactNode } from 'react';
import { useSidebarCollapseAnimationDuration } from './sidebar-collapse-animation';

/**
 * CDXC:Sidebar 2026-09-16 DECISION:
 * User: animate each section as one clipping container while its sessions keep their natural height and positions.
 * This replaces the per-row height animations that compressed large lists during expansion and collapse.
 * Keep exiting section contents mounted until the clipping animation finishes.
 */
export function CollapsibleSessionSection({ children, visible }: { children: ReactNode; visible: boolean }) {
  return (
    <AnimatePresence initial={false}>
      {visible ? <AnimatedSessionSection>{children}</AnimatedSessionSection> : null}
    </AnimatePresence>
  );
}

function AnimatedSessionSection({ children }: { children: ReactNode }) {
  const isPresent = useIsPresent();
  const reducedMotion = useReducedMotion();
  const durationMs = useSidebarCollapseAnimationDuration();
  return (
    <motion.div
      className='session-section-body'
      aria-hidden={!isPresent}
      inert={!isPresent ? true : undefined}
      initial={{ height: 0, opacity: 0, overflow: 'hidden' }}
      animate={{ height: 'auto', opacity: 1, transitionEnd: { overflow: 'visible' } }}
      exit={{ height: 0, opacity: 0, overflow: 'hidden' }}
      transition={{ duration: reducedMotion ? 0 : durationMs / 1000, ease: [0.22, 1, 0.36, 1] }}
    >
      <div className='session-section-content'>{children}</div>
    </motion.div>
  );
}
