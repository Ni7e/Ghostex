/*
CDXC:SessionChat 2026-09-06 DECISION:
User: a Codex goal shows as a card in the same shape as the Claude Code status cards (the activity row and the pending tool row), chevron on the right, no outline of its own.
Collapsed it shows the first three lines of the goal's text; expanding shows the full goal text and nothing else.
Since 2026-09-16 the shape is the shared status card and the card leads with a target icon instead of the dot (see session-chat-status-card.css).
*/

import { useLayoutEffect, useRef, useState } from 'react';
import { IconTarget } from '@tabler/icons-react';
import { cn } from '@/packages/components/utils';
import {
  SessionChatStatusCard,
  SessionChatStatusCardChevron,
  SessionChatStatusCardLead,
} from './session-chat-status-card';

const STATUS_TONES: Record<string, string> = {
  active: 'bg-primary/15 text-primary',
  complete: 'bg-foreground/10 text-foreground/80',
  paused: 'bg-muted text-muted-foreground',
  cleared: 'bg-muted text-muted-foreground',
  stalled: 'bg-destructive/10 text-destructive',
  'usage limited': 'bg-destructive/10 text-destructive',
  'limited by budget': 'bg-destructive/10 text-destructive',
};

export interface SessionChatGoalCardProps {
  status: string;
  objective: string;
  usage?: string;
}

export function SessionChatGoalCard({ objective, status, usage }: SessionChatGoalCardProps) {
  const [expanded, setExpanded] = useState(false);
  const [overflows, setOverflows] = useState(false);
  const objectiveRef = useRef<HTMLParagraphElement>(null);
  const text = objective.trim();

  // The chevron only appears when the clamp actually hides text.
  useLayoutEffect(() => {
    const element = objectiveRef.current;
    if (!element || expanded) {
      return;
    }
    const measure = (): void => setOverflows(element.scrollHeight > element.clientHeight + 1);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, [expanded, text]);

  const expandable = expanded || overflows;

  return (
    <SessionChatStatusCard
      aria-live='polite'
      className='ghostex-chat-activity-row ghostex-chat-status-card'
      data-kind='codex-goal'
      data-status={status}
      lead={<SessionChatStatusCardLead icon={IconTarget} />}
      role='status'
      title={
        <>
          Goal
          <span
            className={cn(
              'ml-2 rounded-full px-1.5 py-px align-middle text-[11px] leading-4 font-medium',
              STATUS_TONES[status] ?? 'bg-muted text-muted-foreground'
            )}
          >
            {status}
          </span>
        </>
      }
      trailing={
        <>
          {usage ? (
            <span className='ghostex-chat-status-card-lead min-w-0 truncate text-xs text-muted-foreground tabular-nums'>
              {usage}
            </span>
          ) : null}
          {expandable ? (
            <SessionChatStatusCardChevron
              expanded={expanded}
              label={expanded ? 'Show less of the goal' : 'Show the full goal'}
              onClick={() => setExpanded((value) => !value)}
            />
          ) : null}
        </>
      }
    >
      {text ? (
        <p
          className={cn(
            'whitespace-pre-wrap break-words text-foreground/90',
            // Three lines of the objective while collapsed.
            !expanded && 'line-clamp-3'
          )}
          ref={objectiveRef}
        >
          {text}
        </p>
      ) : null}
    </SessionChatStatusCard>
  );
}
