/**
 * FROZEN copy of the TypeScript sidebar page, which was deleted on 2026-09-21 (M4d part 2). It is
 * kept only so the parity gates beside it still have the behaviour the app shipped on that date to
 * compare the Rust store against: a clean run proves Rust still matches THAT, not that it matches
 * the app. Never edit this file to make a gate pass; change the Rust and re-record, or delete the
 * gate.
 */
import { closeAppModal, openAppModal } from '@/packages/core-ui/app-modal-host-bridge';
import { sidebarStore } from '@/packages/core-ui/sidebar-store-model';
import { resolveSessionSnoozeWakeTime } from '@/packages/shared/session-snooze';
import type { NativeSidebarCommand } from '@/packages/shared/native-sidebar';
import type { SidebarPostMessage } from './metadata';

export function runNativeSessionAction(
  command: Extract<NativeSidebarCommand, { type: 'sessionAction' }>,
  post: SidebarPostMessage
): void {
  const session = sidebarStore.getState().sessionsById[command.sessionId];
  if (!session) return;
  const title = session.primaryTitle?.trim() || session.terminalTitle?.trim() || session.alias;
  switch (command.action) {
    case 'rename':
      closeAppModal('SettingsDismissal:sessionRowRename');
      openAppModal({
        type: 'open',
        modal: 'renameSession',
        sessionId: session.sessionId,
        sessionAgentIcon: session.agentIcon,
        initialTitle: title,
      });
      break;
    case 'note':
      closeAppModal('SettingsDismissal:sessionRowNote');
      openAppModal({
        type: 'open',
        modal: 'sessionNote',
        sessionId: session.sessionId,
        sessionTitle: title,
        initialNote: session.sessionNote ?? '',
      });
      break;
    case 'firstMessage':
      if (session.firstUserMessage?.trim())
        openAppModal({ type: 'open', modal: 'firstUserMessage', title, message: session.firstUserMessage.trim() });
      break;
    case 'snooze':
      if (command.sessionTag !== undefined)
        post({ type: 'setSessionTag', sessionId: session.sessionId, sessionTag: command.sessionTag });
      if (command.preset)
        post({
          type: 'snoozeSession',
          sessionId: session.sessionId,
          snoozedUntil: resolveSessionSnoozeWakeTime(command.preset).toISOString(),
        });
      break;
    case 'delayedSend':
      openAppModal({
        type: 'open',
        modal: 'delayedSend',
        title,
        sessionId: session.sessionId,
        agentIcon: session.agentIcon,
        closeAfterDoneActive: session.closeAfterDone === true,
        delayedSendDeadlineAt: session.delayedSendDeadlineAt,
        delayedSendRemainingLabel: session.delayedSendRemainingLabel,
        sendWhenAllProjectSessionsStopActive: session.sendWhenAllProjectSessionsStopActive === true,
        sendWhenAgentStopsActive: session.sendWhenAgentStopsActive === true,
        sendWhenSpecificAgentFinishes: session.sendWhenSpecificAgentFinishes,
        supportsSendWhenAgentStops: true,
        supportsSendWhenAllProjectSessionsStop: true,
      });
      break;
  }
}
