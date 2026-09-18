// Client logic for Ghostex's prompt queue and the synced composer draft
// (plan 016 §4). Pure functions plus the per-client id: the row strip
// (session-chat-queue-rows.tsx) and the composer stay presentation, this file
// stays readable and independently reasoned about.
//
// NAMING COLLISION, READ THIS TWICE: `SessionChatMessage.queued` is the AGENT
// CLI's own internal queue and renders inside the transcript. Nothing here
// touches it. These rows are prompts the agent has never seen.

import type { SessionChatDraft, SessionChatQueuedPrompt } from '../../shared/session-chat';
import type { SessionChatDraftVersion } from '@/packages/shared/session-chat-queue';
import { PointerActivationConstraints } from '@dnd-kit/dom';


export { SESSION_CHAT_QUEUE_VISIBLE_ROWS, SESSION_CHAT_QUEUE_LONG_PRESS_MS, sessionChatQueueRowPreview, sessionChatQueuePromptIds, moveSessionChatQueueRow, isSessionChatQueueRowBusy, lastEditableSessionChatQueueRow, type SessionChatQueueCapabilities, sessionChatQueueCapabilities, isNewerSessionChatDraftStamp, shouldOfferSessionChatDraft, mergeSessionChatDraftState } from '@/packages/shared/session-chat-controller/queue';
// ---------------------------------------------------------------------------
// Draft sync
// ---------------------------------------------------------------------------

export { sessionChatDraftClientId } from '@/packages/shared/session-chat-controller/client-id';

// ---------------------------------------------------------------------------
// Drag-to-reorder activation
// ---------------------------------------------------------------------------

const QUEUE_ROW_DRAG_DISTANCE_PX = 6;
const QUEUE_ROW_DRAG_DELAY_MS = 200;
const QUEUE_ROW_DRAG_DELAY_TOLERANCE_PX = 12;

/**
 * Distance OR Delay, on every pointer type including touch.
 *
 * The sidebar's shared constraints (sidebar-reorder-activation.ts) are
 * hold-only under touch on purpose: a session card IS the scroll surface
 * there, so a distance activation would eat the scroll gesture. A queue row's
 * grab target is a dedicated handle that does nothing else, and the handle
 * carries `touch-action: none`, so distance is safe here and a decisive flick
 * activates instead of being dropped — the recorded dnd-kit failure mode where
 * Delay alone silently cancelled fast drags.
 */
export function getSessionChatQueueDragActivationConstraints() {
  return [
    new PointerActivationConstraints.Delay({
      tolerance: QUEUE_ROW_DRAG_DELAY_TOLERANCE_PX,
      value: QUEUE_ROW_DRAG_DELAY_MS,
    }),
    new PointerActivationConstraints.Distance({
      value: QUEUE_ROW_DRAG_DISTANCE_PX,
    }),
  ];
}
