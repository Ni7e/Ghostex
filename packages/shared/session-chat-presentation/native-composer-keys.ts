import { sessionChatCaretMovement, type SessionChatCaretMovement } from '@/packages/core-ui/chat/session-chat-caret-navigation';
import {
  sessionChatEditingShortcut,
  sessionChatTerminalShortcut,
  type SessionChatTextEditCommand,
} from '@/packages/core-ui/chat/session-chat-edit-shortcuts';

/** A GPUI keystroke, as `gpui::Keystroke` names its key and modifiers. */
export interface NativeComposerKeyEvent {
  alt: boolean;
  control: boolean;
  key: string;
  platform: boolean;
  shift: boolean;
}

export type NativeComposerKeyIntent =
  | ({ kind: 'caret' } & SessionChatCaretMovement)
  | { command: SessionChatTextEditCommand | 'selectAll' | 'copy' | 'cut' | 'paste'; kind: 'edit' }
  | null;

/** GPUI key names for the keys the shared rules match by their DOM name. */
const DOM_KEY_NAMES: Readonly<Record<string, string>> = {
  backspace: 'Backspace',
  delete: 'Delete',
  down: 'ArrowDown',
  end: 'End',
  home: 'Home',
  left: 'ArrowLeft',
  right: 'ArrowRight',
  up: 'ArrowUp',
};

function domEvent(event: NativeComposerKeyEvent, ctrlKey: boolean, metaKey: boolean) {
  const key = DOM_KEY_NAMES[event.key] ?? event.key;
  const letter = /^[a-z]$/.test(event.key) ? event.key.toUpperCase().charCodeAt(0) : undefined;
  return {
    altKey: event.alt,
    ctrlKey,
    isComposing: false,
    key,
    ...(letter === undefined ? {} : { keyCode: letter }),
    metaKey,
    preventDefault: () => {},
    shiftKey: event.shift,
  };
}

/**
 * CDXC:SessionChat 2026-09-18 WHY:
 * `detectghostexHotkeyPlatform` reads `navigator`, which the QuickJS chat runtime does not have, so
 * the shared editing rules always answer as macOS there. On Windows and Linux the primary modifier
 * is Control, which under the macOS answer is also the terminal-chord modifier: ask twice, once as
 * Control (Ctrl+U/K/Y/A/E) and once as the primary chord, instead of forking the rules themselves.
 */
export function nativeComposerKeyIntent(
  event: NativeComposerKeyEvent,
  platform: 'linux' | 'mac' | 'windows' = 'mac'
): NativeComposerKeyIntent {
  const caret = sessionChatCaretMovement(domEvent(event, event.control, event.platform));
  if (caret) return { kind: 'caret', ...caret };
  const passes =
    platform === 'mac'
      ? [domEvent(event, event.control, event.platform)]
      : [domEvent(event, event.control, false), domEvent(event, false, event.control)];
  for (const [index, pass] of passes.entries()) {
    // The second pass only exists for the primary chords; it must not re-read a terminal chord.
    if (index > 0 && sessionChatTerminalShortcut(passes[0]!)) break;
    const command = sessionChatEditingShortcut(pass);
    if (command) return { command, kind: 'edit' };
  }
  return null;
}

/** The chords this renderer answers itself, with the kill buffer it keeps. */
export function nativeComposerTerminalCommand(event: NativeComposerKeyEvent): SessionChatTextEditCommand | null {
  const command = sessionChatTerminalShortcut(domEvent(event, event.control, false));
  return command === 'killLineLeft' || command === 'killLineRight' || command === 'yank' ? command : null;
}
