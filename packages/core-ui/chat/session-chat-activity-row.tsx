/*
CDXC:AgentScreenDetection 2026-08-22:
The transcript's progress row: what the agent CLI is doing right now when it is
doing something long, on-screen only, and consequential. Claude Code's
compaction is the case this exists for — for a minute or more the chat could say
nothing better than "the agent is working", while the operation quietly running
was the one that REPLACES the conversation the user is reading.

Since 2026-08-30 this card renders in the pinned working strip above the
composer (session-chat-working-strip.tsx), not inside the transcript, so it
stays visible at any scroll position and never shows twice. The one exception
is a `claude-tool` activity: since 2026-09-04 that card is a pending tool row
at the bottom of the transcript (see session-chat-terminal-status.ts), so the
strip keeps its spinner while a tool runs.

The elapsed clock ticks LOCALLY from `detectedAt`, which the server holds still
for the whole run. The bar only moves when a probe brings a new percentage
(every few seconds), so a clock that also only moved then would read as a frozen
UI; interpolating between samples costs one interval and is the difference
between "working" and "stuck". Nothing here estimates the PERCENTAGE — that
comes off the screen; compaction without a percentage uses a looping bar.
*/

import { useEffect, useState } from 'react';
import { IconInfoCircle, IconLoader2 } from '@tabler/icons-react';
import type { SessionChatTerminalActivity } from '../../shared/session-chat';
import { cn } from '@/packages/components/utils';
import { AppTooltip } from '../app-tooltip';
import { SessionChatStatusCard, SessionChatStatusCardDot } from './session-chat-status-card';

import { computeSessionChatActivity } from '@/packages/shared/session-chat-controller/activity';
export {
  formatSessionChatActivityElapsed,
  sessionChatActivityElapsedSeconds,
} from '@/packages/shared/session-chat-controller/activity';

export interface SessionChatActivityRowProps {
  activity: SessionChatTerminalActivity;
  className?: string;
}

export function SessionChatActivityRow({ activity, className }: SessionChatActivityRowProps) {
  const { elapsedLabel, percent, indeterminate, shellsRunning, hint } = computeSessionChatActivity(activity, {
    useState,
    useEffect,
  })!;

  return (
    <SessionChatStatusCard
      aria-live='polite'
      className={cn('ghostex-chat-activity-row', className)}
      data-kind={activity.kind}
      lead={
        shellsRunning ? (
          <span aria-hidden='true' className='ghostex-chat-status-card-lead'>
            <IconLoader2 className='animate-spin text-primary' stroke={2} />
          </span>
        ) : (
          <SessionChatStatusCardDot />
        )
      }
      role='status'
      title={
        <>
          {activity.label}
          {/* CDXC:SessionChat 2026-09-11 DECISION: User: put the compaction hint in an info-circle tooltip immediately right of the title, replacing the visible hint line. */}
          {activity.kind === 'compacting' ? (
            <AppTooltip content={hint!} side='top'>
              <button
                type='button'
                aria-label='Messaging during compaction'
                className='ml-1.5 inline-flex size-5 shrink-0 translate-y-0.5 items-center justify-center rounded-sm align-baseline text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/20'
              >
                <IconInfoCircle aria-hidden='true' className='size-3.5' stroke={1.5} />
              </button>
            </AppTooltip>
          ) : null}
        </>
      }
      trailing={
        elapsedLabel !== null || percent !== null ? (
          <span className='ghostex-chat-status-card-lead gap-2'>
            {elapsedLabel !== null ? (
              <span className='ghostex-chat-card-hint shrink-0 text-xs text-muted-foreground tabular-nums'>
                {elapsedLabel}
              </span>
            ) : null}
            {percent !== null ? (
              <span className='ghostex-chat-card-hint shrink-0 text-xs font-medium text-foreground/80 tabular-nums'>
                {percent}%
              </span>
            ) : null}
          </span>
        ) : undefined
      }
    >
      {percent !== null || indeterminate ? (
        <div
          aria-label={activity.label}
          aria-valuemax={100}
          aria-valuemin={0}
          aria-valuenow={percent ?? undefined}
          className='h-1 min-w-0 overflow-hidden rounded-full bg-foreground/10'
          role='progressbar'
        >
          <div
            className={cn(
              'h-full rounded-full bg-primary',
              indeterminate ? 'ghostex-chat-compacting-loop' : 'transition-[width] duration-500'
            )}
            style={indeterminate ? undefined : { width: `${percent}%` }}
          />
        </div>
      ) : null}
    </SessionChatStatusCard>
  );
}
