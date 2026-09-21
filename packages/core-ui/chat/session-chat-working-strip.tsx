/*
CDXC:SessionChat 2026-08-30:
Always-visible "agent is working" indicator, pinned above the composer cards
and OUTSIDE the transcript scroller so the working state stays visible at any
scroll position.

When a terminal activity exists (compaction, background shells, a monitor, a
⏺ status), the strip renders the SAME activity card the transcript used to
show — the card lives here now, and the transcript no longer duplicates it.
Without an activity it shows the pulsing spark plus a whimsical working word.

`working` is the session activity the sidebar spinner shows (`sessionWorking`
in use-session-chat/hook.ts), not the transcript's settled or held working, so the
strip and the sidebar always agree.
*/

import { IconClock } from '@tabler/icons-react';
import { useEffect, useState } from 'react';
import type { SessionChatTerminalActivity } from '../../shared/session-chat';
import { SessionChatActivityRow } from './session-chat-activity-row';
import { computeSessionChatWorkingStrip } from '@/packages/shared/session-chat-controller/working-strip';
import type { SessionChatArmedAction } from '@/packages/shared/session-chat-presentation/armed-actions';
import visual from '@/packages/shared/session-chat-presentation/working-strip.json';
import type { CSSProperties } from 'react';

export interface SessionChatWorkingStripProps {
  working: boolean;
  activity: SessionChatTerminalActivity | null;
  /** Armed Delayed Send / Close After Done, drawn at the right of the working row (armed-actions.ts). */
  armedActions?: readonly SessionChatArmedAction[];
  /** Opens the host's Delayed Actions modal from an armed indicator; omitted means the indicators are not clickable. */
  onArmedActionClick?: () => void;
}

const ARMED_ICON_COLORS: Record<SessionChatArmedAction['id'], string> = {
  delayedSend: visual.delayedSendColor,
  closeAfterDone: visual.closeAfterDoneColor,
};

export function SessionChatWorkingStrip({
  working,
  activity,
  armedActions = [],
  onArmedActionClick,
}: SessionChatWorkingStripProps) {
  const status = computeSessionChatWorkingStrip(working, activity, { useEffect, useState });
  const activityRow = status.activity ? <SessionChatActivityRow activity={status.activity} className='my-0' /> : null;
  const label = status.activity ? null : status.label;
  if (!label && !armedActions.length) return activityRow;

  const row = (
    <div
      aria-live='polite'
      className='ghostex-chat-working-strip'
      role='status'
      style={
        {
          '--working-min-height': `${visual.minHeight / 16}rem`,
          '--working-padding-x': `${visual.paddingX / 16}rem`,
          '--working-gap': `${visual.gap / 16}rem`,
          '--working-spark-box': `${visual.sparkBox / 16}rem`,
          '--working-spark-size': `${visual.sparkSize / 16}rem`,
          '--working-font-size': `${visual.fontSize / 16}rem`,
          '--working-pulse': `${visual.pulseMs}ms`,
          '--working-spin': `${visual.spinMs}ms`,
          '--working-armed-icon-gap': `${visual.armedIconGap / 16}rem`,
          '--working-armed-column-gap': `${visual.armedColumnGap / 16}rem`,
          '--working-armed-row-gap': `${visual.armedRowGap / 16}rem`,
        } as CSSProperties
      }
    >
      <div className='ghostex-chat-working-strip-row'>
        {/* The lead's auto right margin pins the armed items right on the first line; wrapped items start at the left. */}
        <div className='ghostex-chat-working-strip-lead'>
          {label ? (
            <>
              <span aria-hidden='true' className='ghostex-chat-working-strip-spark'>
                <svg viewBox='0 0 24 24'>
                  <path d={visual.sparkPath} />
                </svg>
              </span>
              <span className='ghostex-chat-working-strip-text'>{label}</span>
            </>
          ) : null}
        </div>
        {armedActions.map((action) => {
          const content = (
            <>
              <span aria-hidden='true' className='ghostex-chat-working-strip-armed-icon'>
                <IconClock color={ARMED_ICON_COLORS[action.id]} />
              </span>
              <span className='ghostex-chat-working-strip-armed-text'>{action.label}</span>
            </>
          );
          /** CDXC:DelayedSend 2026-09-21 DECISION: User: clicking an armed Delayed Send or Close After Done indicator on the chat working row opens the Delayed Actions modal so they can be managed there. */
          return onArmedActionClick ? (
            <button
              aria-label={`${action.label}. Manage delayed actions`}
              className='ghostex-chat-working-strip-armed'
              data-armed-action={action.id}
              key={action.id}
              onClick={onArmedActionClick}
              type='button'
            >
              {content}
            </button>
          ) : (
            <span className='ghostex-chat-working-strip-armed' data-armed-action={action.id} key={action.id}>
              {content}
            </span>
          );
        })}
      </div>
    </div>
  );
  return activityRow ? (
    <>
      {activityRow}
      {row}
    </>
  ) : (
    row
  );
}
