import type {
  GxserverAnswerSessionChatPromptParams,
  SessionChatTerminalDialog,
  SessionChatTerminalNotice,
  SessionChatTerminalNoticeAction,
} from '../session-chat';

export type TerminalPromptAnswer = Omit<GxserverAnswerSessionChatPromptParams, 'projectId' | 'sessionId'>;

const ACTION_LABELS: Record<string, string> = {
  up: '↑ Previous',
  down: '↓ Next',
  left: '← Left',
  right: 'Right →',
  pageUp: 'Page up',
  pageDown: 'Page down',
  home: 'First',
  end: 'Last',
  tab: 'Next field',
  toggle: 'Toggle selected',
  confirm: 'Confirm',
  cancel: 'Back / Cancel',
  sessionOnly: 'Use for this session',
  sort: 'Change sort',
  reset: 'Reset to auto',
  day: 'Day view',
  week: 'Week view',
  projects: 'Toggle all projects',
  branch: 'Toggle current branch',
};

export function terminalDialogPresentation(dialog: SessionChatTerminalDialog) {
  const submitLabel =
    dialog.title === 'Ready to code?'
      ? 'Request changes'
      : dialog.title.startsWith('Tell us more (')
        ? 'Send feedback'
        : dialog.title === 'Custom review instructions'
          ? 'Start review'
          : dialog.title === 'Add marketplace'
            ? 'Add marketplace'
            : dialog.footer.includes('Enter to continue')
              ? 'Continue'
              : dialog.footer.includes('Enter to add')
                ? 'Add directory'
                : dialog.footer.includes('submit')
                  ? 'Submit'
                  : 'Save';
  const multilineInput =
    dialog.input === 'text' &&
    (dialog.title.startsWith('Tell us more (') ||
      dialog.title === 'Custom review instructions' ||
      dialog.title === 'Submit feedback / bug report');
  /**
   * CDXC:SessionChat 2026-09-08 DECISION:
   * User: always show the exit action at the bottom beside the other buttons for /usage and similar agent dialogs, so leaving them never requires switching to the terminal.
   */
  const visibleActions = dialog.actions.filter((action) => dialog.input !== 'text' || action !== 'confirm');
  const cancelLabel = dialog.footer.toLowerCase().includes('esc to clear')
    ? 'Clear / Back'
    : dialog.footer.includes('go back')
      ? 'Back'
      : dialog.footer.includes('close') || dialog.footer.includes('q to quit')
        ? 'Close'
        : 'Cancel';
  return {
    submitLabel,
    multilineInput,
    cancelLabel,
    actions: visibleActions.map((action) => ({
      action,
      label:
        action === 'cancel'
          ? cancelLabel
          : action === 'confirm' && dialog.footer.includes('set as default')
            ? 'Set as default'
            : (ACTION_LABELS[action] ?? action),
    })),
  };
}

export function terminalNoticeChoiceAnswer(
  notice: SessionChatTerminalNotice | null,
  choiceIndex: number
): TerminalPromptAnswer {
  return notice?.dialog
    ? { choiceIndex, kind: 'terminalDialog', dialogId: notice.dialog.id }
    : { choiceIndex, kind: 'terminalChoice' };
}

export function terminalNoticeActionAnswer(
  notice: SessionChatTerminalNotice,
  action: SessionChatTerminalNoticeAction
): TerminalPromptAnswer | null {
  if (action.kind === 'recoverCodexConversation' && notice.conversationLock)
    return { kind: 'recoverCodexConversation', conversationLock: notice.conversationLock };
  if (action.kind === 'sendKeys' && action.send !== undefined) return { kind: 'approval', approvalSend: action.send };
  if (action.kind === 'trustAndRemember') return { kind: 'trustAndRemember' };
  return null;
}

/**
 * Whether a notice action may be triggered by the primary shortcut. Trust and
 * Remember is deliberately click-only: a shortcut meant to accept one prompt
 * must not also change what happens on every later one.
 */
export function terminalNoticeActionShortcutEligible(action: SessionChatTerminalNoticeAction): boolean {
  return action.kind !== 'trustAndRemember';
}
