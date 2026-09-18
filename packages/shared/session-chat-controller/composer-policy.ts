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
