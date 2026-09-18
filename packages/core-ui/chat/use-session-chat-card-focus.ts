import { useLayoutEffect, useRef, type RefObject } from 'react';
import type { SessionChatComposerHandle } from './session-chat-composer';
import { sessionChatKeyboardPopupOpen } from './session-chat-caret-navigation';

const CARD_SELECTOR = '.ghostex-chat-prompt-card, [data-chat-async-questions="true"]';
const TYPING_IGNORE_SELECTOR = '[data-session-chat-typing-redirect-ignore="true"]';

/** Plain card buttons consume activation keys; typed text belongs to the draft. */
export function sessionChatCardButtonAllowsTyping(target: Element): boolean {
  return (
    target.matches('button, [role="button"]') &&
    !!target.closest(CARD_SELECTOR) &&
    !target.closest(TYPING_IGNORE_SELECTOR) &&
    !target.matches('[aria-haspopup]:not([aria-haspopup="false"])')
  );
}

/**
 * CDXC:FocusRouting 2026-09-13 WHY:
 * Answering or dismissing a chat card can disable or remove its focused control, leaving DOM focus on the page body where the chat's typing handler cannot receive keys.
 * Buttons that remain on screen also need to pass typing to the composer instead of being treated as text inputs by the interactive-target guard.
 * Return that card's focus to its composer as soon as the control retires, including optimistic removals and asynchronous answers; a focus move to another control or pane cancels the handoff.
 */
export function useSessionChatCardFocus(
  rootRef: RefObject<HTMLDivElement | null>,
  composerRef: RefObject<SessionChatComposerHandle | null>,
  composerVisible: boolean,
  sessionKey?: string
): void {
  const composerVisibleRef = useRef(composerVisible);
  composerVisibleRef.current = composerVisible;
  const restoreRef = useRef<(() => void) | null>(null);

  useLayoutEffect(() => {
    const root = rootRef.current;
    const cards = root?.querySelector('[data-chat-composer-overlay="true"]');
    if (!root || !cards) return;
    const doc = root.ownerDocument;
    const win = doc.defaultView;
    let focusedControl: HTMLElement | null = null;

    const clear = (): void => {
      focusedControl = null;
      observer.disconnect();
    };
    const restore = (): void => {
      if (!focusedControl || (cards.contains(focusedControl) && !focusedControl.matches(':disabled'))) return;
      const active = doc.activeElement;
      if (
        !doc.hasFocus() ||
        root.getClientRects().length === 0 ||
        (active !== doc.body && active !== focusedControl && active !== root) ||
        sessionChatKeyboardPopupOpen(root)
      ) {
        clear();
        return;
      }
      // Question cards temporarily hide the composer. Keep the handoff until
      // the parent has committed the question's visibility change.
      if (!composerVisibleRef.current) return;
      clear();
      composerRef.current?.focus();
    };
    const observer = new MutationObserver(restore);
    const trackFocus = (): void => {
      clear();
      const active = doc.activeElement;
      if (
        !(active instanceof HTMLElement) ||
        !cards.contains(active) ||
        !active.closest(CARD_SELECTOR) ||
        active.closest(TYPING_IGNORE_SELECTOR)
      )
        return;
      focusedControl = active;
      observer.observe(cards, { childList: true, subtree: true, attributes: true, attributeFilter: ['disabled'] });
    };

    restoreRef.current = restore;
    trackFocus();
    doc.addEventListener('focusin', trackFocus);
    win?.addEventListener('blur', clear);
    return () => {
      clear();
      restoreRef.current = null;
      doc.removeEventListener('focusin', trackFocus);
      win?.removeEventListener('blur', clear);
    };
  }, [composerRef, rootRef, sessionKey]);

  useLayoutEffect(() => {
    restoreRef.current?.();
  }, [composerVisible]);
}
