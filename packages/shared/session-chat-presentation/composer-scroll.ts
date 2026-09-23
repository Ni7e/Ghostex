export const COMPOSER_SCROLL_THRESHOLD_PX = 24;
export const COMPOSER_SCROLL_RESET_MS = 120;
export const COMPOSER_BOTTOM_THRESHOLD_PX = 10;

export interface SessionChatComposerScrollGesture {
  accumulatedDeltaPx: number;
  collapseSuppressed: boolean;
  lastEventAt: number;
}

export function createSessionChatComposerScrollGesture(): SessionChatComposerScrollGesture {
  return { accumulatedDeltaPx: 0, collapseSuppressed: false, lastEventAt: -Infinity };
}

export function resetSessionChatComposerScrollGesture(gesture: SessionChatComposerScrollGesture): void {
  gesture.accumulatedDeltaPx = 0;
  gesture.collapseSuppressed = false;
  gesture.lastEventAt = -Infinity;
}

export function suppressSessionChatComposerScrollGesture(
  gesture: SessionChatComposerScrollGesture,
  now: number,
  gestureResetMs: number
): void {
  if (now - gesture.lastEventAt <= gestureResetMs) gesture.collapseSuppressed = true;
}

export function recordSessionChatComposerScrollGesture(
  gesture: SessionChatComposerScrollGesture,
  input: {
    now: number;
    deltaPx: number;
    collapseThresholdPx: number;
    collapseEligible: boolean;
    canScrollInGestureDirection: boolean;
    scrollsTowardLogicalEnd: boolean;
  }
): boolean {
  gesture.lastEventAt = input.now;
  if (
    gesture.collapseSuppressed ||
    !input.collapseEligible ||
    !input.canScrollInGestureDirection ||
    input.scrollsTowardLogicalEnd
  ) {
    gesture.accumulatedDeltaPx = 0;
    return false;
  }
  gesture.accumulatedDeltaPx += input.deltaPx;
  if (gesture.accumulatedDeltaPx < input.collapseThresholdPx) return false;
  gesture.accumulatedDeltaPx = 0;
  return true;
}

export function canCollapseSessionChatComposer(input: {
  maximized: boolean;
  noteOpen: boolean;
  suggestionsOpen: boolean;
  hasError: boolean;
  attachmentCount: number;
  pendingAttachments: number;
  queuedPrompts: number;
}): boolean {
  return (
    !input.maximized &&
    !input.noteOpen &&
    !input.suggestionsOpen &&
    !input.hasError &&
    input.attachmentCount === 0 &&
    input.pendingAttachments === 0 &&
    input.queuedPrompts === 0
  );
}

/**
 * CDXC:SessionChat 2026-09-23 DECISION:
 * User: when an agent session's height is constrained (vertical splits especially), show its chat box collapsed until the user clicks it to expand, even at the bottom of the conversation. A pane shorter than `constrainedPaneHeightPx` (composer-animation.json, in chat pixels, so zoom counts) keeps the box collapsed while the box does not have focus; clicking it focuses and expands it, and leaving it collapses it again. The scroll gesture and the Keep chat box expanded setting play no part there, and every other reason the box cannot collapse (a question card, the note, suggestions, an error, attachments, a queue, a maximized box) still wins.
 * SEE-ALSO: apps/desktop/src/app/native_chat/composer_scroll.rs (`composer_collapsed`), packages/core-ui/chat/use-session-chat-composer-collapse.ts.
 */
export function sessionChatComposerHeightConstrained(paneHeightPx: number, constrainedPaneHeightPx: number): boolean {
  return paneHeightPx > 0 && paneHeightPx < constrainedPaneHeightPx;
}
