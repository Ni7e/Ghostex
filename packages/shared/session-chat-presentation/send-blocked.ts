import { createAppToastRequest, type AppToastRequest } from '../app-toast-contract';

export const SESSION_CHAT_SEND_BLOCKED_TITLE = 'Message not sent';

/**
 * CDXC:SessionChat 2026-09-18 SEE-ALSO:
 * The 2026-09-03 decision in `packages/core-ui/chat/session-chat-send-blocked-toast.tsx` is that a
 * blocked Send raises a red toast naming the reason instead of disabling the composer. React posts
 * this request over the app-modal bridge; GPUI chat emits the same request to its native toast host.
 */
export function sessionChatSendBlockedToastRequest(reason: string): AppToastRequest {
  const description = reason.trim();
  return createAppToastRequest('error', SESSION_CHAT_SEND_BLOCKED_TITLE, description === '' ? undefined : description);
}
