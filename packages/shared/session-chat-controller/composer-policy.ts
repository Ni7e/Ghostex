export const SESSION_CHAT_STOP_BUTTON_COOLDOWN_MS = 2_000;

export function sessionChatSendBlockedReason(state: {
  canSend: boolean;
  accountSwitchBusy: boolean;
  conversationLocked: boolean;
  terminalChoicePending: boolean;
  noticeCardVisible: boolean;
  sessionOptionSwitching: boolean;
}): string | null {
  if (!state.canSend) return 'Input is held by another device.';
  if (state.accountSwitchBusy) return 'Wait for the account switch to complete.';
  if (state.conversationLocked)
    return 'This conversation is open elsewhere. Use Continue here or close it in the other app and retry.';
  if (state.terminalChoicePending)
    return state.noticeCardVisible
      ? 'Answer the question above first.'
      : 'Your answer is still being applied. Try again in a moment.';
  if (state.sessionOptionSwitching) return 'Claude is still switching mode. Try again in a moment.';
  return null;
}

/**
 * CDXC:SessionChat 2026-09-24 DECISION:
 * User: changing the model (and accepting Claude's confirmation) must never stop the next message
 * from sending; show the message as sent and apply it in the background. So a block that clears on
 * its own (an answer still being applied, a mode or model switch, an account switch) holds the send
 * instead of refusing it: the echo appears at once and the message reaches the agent when
 * `sessionChatSendBlockedReason` clears. Only a block that needs the user (another device holds
 * input, the conversation is open elsewhere, a question waiting for an answer) still refuses with
 * the red toast. This supersedes the mode-switch case of the 2026-09-03 toast decision.
 */
export function sessionChatSendRefusedReason(state: {
  canSend: boolean;
  conversationLocked: boolean;
  terminalChoicePending: boolean;
  noticeCardVisible: boolean;
}): string | null {
  if (!state.canSend) return 'Input is held by another device.';
  if (state.conversationLocked)
    return 'This conversation is open elsewhere. Use Continue here or close it in the other app and retry.';
  if (state.terminalChoicePending && state.noticeCardVisible) return 'Answer the question above first.';
  return null;
}

export const DESKTOP_SESSION_CHAT_PLACEHOLDER =
  'Press Enter to send a message and Tab to Queue.\nUse @ to mention a file and $ for using skills.';

export function sessionChatComposerPlaceholder(state: {
  canSend: boolean;
  terminalChoicePending: boolean;
  controlsOnly: boolean;
  noticeCardVisible: boolean;
  sessionOptionSwitching: boolean;
}): string | undefined {
  if (!state.canSend) return 'Input is held by another device.';
  if (state.terminalChoicePending) {
    if (state.controlsOnly) return 'Use the controls above to continue.';
    return state.noticeCardVisible ? 'Answer the question above to continue.' : 'Applying your answer…';
  }
  if (state.sessionOptionSwitching) return 'Switching Claude mode…';
  return undefined;
}
