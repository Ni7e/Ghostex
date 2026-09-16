import './session-question-indicator.css';
import { AppTooltip } from './app-tooltip';

/**
 * CDXC:SessionStatus 2026-09-13 DECISION:
 * User: show attention whenever an async question appears, even while the agent keeps working. Combine the orange working spinner with a pink attention dot until the questions are answered or skipped.
 * Pink replaces the previously requested blue question dot.
 */
export function SessionQuestionIndicator({ working }: { working: boolean }) {
  const label = working ? 'Working · answer requested' : 'Answer requested';
  return (
    <AppTooltip content={label}>
      <span className='session-question-indicator' data-working={working} role='img' aria-label={label} />
    </AppTooltip>
  );
}
