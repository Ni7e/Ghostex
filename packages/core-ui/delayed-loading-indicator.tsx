import { IconLoader2 } from '@tabler/icons-react';
import { useEffect, useState } from 'react';
import { cn } from '@/packages/components/utils';
import './delayed-loading-indicator.css';

const DEFAULT_LOADING_DELAY_MS = 500;

/**
 * CDXC:DesignSystem 2026-09-09 DECISION:
 * User: Quick Access pages use this spinner-and-text loading state, which appears only when work is still pending after 500ms.
 * Search by Prompt left it on 2026-09-16: the user asked for list and paragraph skeletons there instead (find/find-prompts-skeleton.tsx).
 */
export function DelayedLoadingIndicator({
  className,
  delayMs = DEFAULT_LOADING_DELAY_MS,
  label,
  loading,
}: {
  className?: string;
  delayMs?: number;
  label: string;
  loading: boolean;
}) {
  const [isDelayElapsed, setIsDelayElapsed] = useState(false);

  useEffect(() => {
    if (!loading) {
      setIsDelayElapsed(false);
      return;
    }
    const timeoutId = window.setTimeout(() => setIsDelayElapsed(true), delayMs);
    return () => window.clearTimeout(timeoutId);
  }, [delayMs, loading]);

  if (!loading || !isDelayElapsed) return null;

  return (
    <div aria-live='polite' className={cn('ghostex-delayed-loading-indicator', className)} role='status'>
      <IconLoader2 aria-hidden='true' className='ghostex-delayed-loading-spinner' stroke={1.8} />
      <span>{label}</span>
    </div>
  );
}
