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

import { useEffect, useState } from 'react';
import type { SessionChatTerminalActivity } from '../../shared/session-chat';
import { SessionChatActivityRow } from './session-chat-activity-row';
import { computeSessionChatWorkingStrip } from '@/packages/shared/session-chat-controller/working-strip';
import visual from '@/packages/shared/session-chat-presentation/working-strip.json';
import type { CSSProperties } from 'react';

export interface SessionChatWorkingStripProps {
  working: boolean;
  activity: SessionChatTerminalActivity | null;
}

export function SessionChatWorkingStrip({ working, activity }: SessionChatWorkingStripProps) {
  const status = computeSessionChatWorkingStrip(working, activity, { useEffect, useState });
  if (status.activity) {
    return <SessionChatActivityRow activity={status.activity} className='my-0' />;
  }
  if (!status.label) return null;

  return (
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
        } as CSSProperties
      }
    >
      <div className='ghostex-chat-working-strip-row'>
        <span aria-hidden='true' className='ghostex-chat-working-strip-spark'>
          <svg viewBox='0 0 24 24'>
            <path d={visual.sparkPath} />
          </svg>
        </span>
        <span className='ghostex-chat-working-strip-text'>{status.label}</span>
      </div>
    </div>
  );
}
