import { AnimatePresence, motion, useIsPresent, useReducedMotion } from 'motion/react';
import type { ReactNode } from 'react';
import { useSidebarCollapseAnimationDuration } from './sidebar-collapse-animation';

/**
 * CDXC:Sidebar 2026-09-16 DECISION:
 * User: animate the session sections when collapsing and expanding them.
 * Retain exiting rows until their height animation finishes, including rows hidden when Compact reallocates its visible slots.
 */
export function CollapsibleSessionRow({ children, visible }: { children: ReactNode; visible: boolean }) {
  return (
    <AnimatePresence initial={false}>
      {visible ? <AnimatedSessionRow>{children}</AnimatedSessionRow> : null}
    </AnimatePresence>
  );
}

function AnimatedSessionRow({ children }: { children: ReactNode }) {
  const isPresent = useIsPresent();
  const reducedMotion = useReducedMotion();
  const durationMs = useSidebarCollapseAnimationDuration();
  return (
    <motion.div
      className='session-section-row'
      aria-hidden={!isPresent}
      inert={!isPresent ? true : undefined}
      initial={{ height: 0, opacity: 0, overflow: 'hidden' }}
      animate={{ height: 'auto', opacity: 1, transitionEnd: { overflow: 'visible' } }}
      exit={{ height: 0, opacity: 0, overflow: 'hidden' }}
      transition={{ duration: reducedMotion ? 0 : durationMs / 1000, ease: [0.22, 1, 0.36, 1] }}
    >
      {children}
    </motion.div>
  );
}
