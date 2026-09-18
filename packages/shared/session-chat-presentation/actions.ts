import type { ghostexHotkeySettings } from '../ghostex-hotkeys';

export const chatHostActionDefinitions = [
  { id: 'rename', label: 'Rename', hotkey: 'renameActiveSession' },
  { id: 'sleep', label: 'Sleep', hotkey: 'sleepFocusedSession' },
  { id: 'delayedActions', label: 'Delayed actions', hotkey: 'delayedSend' },
  { id: 'closeAfterDone', label: 'Close After Done', hotkey: 'closeAfterDone' },
  { id: 'splitSessionRight', label: 'Split Right', hotkey: 'splitSessionRight' },
  { id: 'fork', label: 'Fork Session', hotkey: 'forkSession' },
  { id: 'fullReload', label: 'Full Reload', hotkey: 'reloadSession' },
  { id: 'switchAccount', label: 'Switch Account' },
  { id: 'promptEditor', label: 'Prompt editor', hotkey: 'promptEditor' },
  { id: 'stashPrompt', label: 'Stash prompt', hotkey: 'stashPrompt' },
  { id: 'stashedPrompts', label: 'Saved prompts', hotkey: 'stashedPrompts' },
  { id: 'attachPath', label: 'Attach a file or folder', hotkey: 'attachFileOrFolder' },
  { id: 'exportTranscript', label: 'Handoff / Export', hotkey: 'exportTranscript' },
] as const satisfies readonly { id: string; label: string; hotkey?: keyof ghostexHotkeySettings }[];

export const COMPOSER_MENU_EXCLUDED_HOST_ACTION_IDS = new Set(['attachPath', 'promptEditor', 'stashPrompt', 'stashedPrompts']);
export const AGENT_HOST_ACTION_IDS = new Set(['fork', 'fullReload', 'rename', 'sleep', 'switchAccount']);

export function sessionChatDesktopHostActions(shortcut: (key: keyof ghostexHotkeySettings) => string | undefined) {
  return chatHostActionDefinitions.map(({ id, label, ...definition }) => ({
    id, label, ...('hotkey' in definition ? { shortcut: shortcut(definition.hotkey) } : {}),
  }));
}
