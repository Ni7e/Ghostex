import { formatSessionTimerDeadlineCountdown } from '@/packages/core-ui/session-card-presentation';
import type { SidebarSessionItem } from '@/packages/shared/session-grid-contract';

export type SessionChatArmedActionId = 'delayedSend' | 'closeAfterDone';

export type SessionChatArmedAction = { id: SessionChatArmedActionId; label: string };

type SessionChatArmedTimers = Pick<
  SidebarSessionItem,
  | 'closeAfterDone'
  | 'closeAfterDoneDeadlineAt'
  | 'closeAfterDoneRemainingLabel'
  | 'delayedSendDeadlineAt'
  | 'delayedSendRemainingLabel'
  | 'sendWhenSpecificAgentFinishes'
>;

/**
 * CDXC:SessionChat 2026-09-19 DECISION:
 * User: show the armed Delayed Send and Close After Done on the right of the chat's working row, with the same font and icon size as the working indicator, white text, a yellow clock for Delayed Send and a red clock for Close After Done. The row stays (without the working text and spark) when the session is not working, and the indicators wrap to a second, left-aligned line when there is no room.
 * SEE-ALSO: apps/desktop/src/app/gx_store/sidebar_clock.rs rebuilds these labels every second for both desktop chat renderers; packages/core-ui/chat/session-chat-working-strip.tsx and apps/desktop/src/app/native_chat/working_strip.rs draw them.
 */
export function sessionChatArmedActions(session: SessionChatArmedTimers, nowMs: number): SessionChatArmedAction[] {
  const actions: SessionChatArmedAction[] = [];
  if (session.delayedSendDeadlineAt || session.delayedSendRemainingLabel) {
    actions.push({ id: 'delayedSend', label: delayedSendLabel(session, nowMs) });
  }
  if (session.closeAfterDone || session.closeAfterDoneDeadlineAt || session.closeAfterDoneRemainingLabel) {
    const remaining =
      (session.closeAfterDoneDeadlineAt
        ? formatSessionTimerDeadlineCountdown(session.closeAfterDoneDeadlineAt, nowMs)
        : undefined) ?? session.closeAfterDoneRemainingLabel;
    actions.push({
      id: 'closeAfterDone',
      label: remaining ? `Close After Done in ${remaining}` : 'Close After Done armed',
    });
  }
  return actions;
}

function delayedSendLabel(session: SessionChatArmedTimers, nowMs: number): string {
  const countdown = session.delayedSendDeadlineAt
    ? formatSessionTimerDeadlineCountdown(session.delayedSendDeadlineAt, nowMs)
    : undefined;
  if (countdown) return `Delayed Send in ${countdown}`;
  const remaining = session.delayedSendRemainingLabel;
  if (remaining === 'Waiting for agent') {
    return session.sendWhenSpecificAgentFinishes
      ? 'Delayed Send when the chosen agent finishes'
      : 'Delayed Send when the agent finishes';
  }
  if (remaining === 'Waiting for agents') return 'Delayed Send when all agents finish';
  return remaining ? `Delayed Send in ${remaining}` : 'Delayed Send armed';
}
