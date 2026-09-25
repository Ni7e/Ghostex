/*
CDXC:SessionChat 2026-09-03:
User decision: the chat composer never blocks typing. When a message cannot be
sent (input held by another device, a terminal picker waiting for an answer),
the text stays fully editable, the Send button only LOOKS disabled, and pressing
it raises a red toast that names the reason. Before this, the composer went
read-only and users could not even fix or copy their draft while the block
lasted. Since 2026-09-24 a block that clears on its own (a model or mode switch,
an answer still being applied) holds the send instead of refusing it; see
`sessionChatSendRefusedReason`.

The toast has two renderers because the hosts differ: the desktop CEF page has
the native app-toast host (`ghostexAppModalHost`), so the desktop shows its
native error toast; the mobile page and the web app have no such bridge and
render the same request in-page through Sonner (`SessionChatSendBlockedToaster`,
mounted once by the composer).
*/

import { Toaster, toast } from 'sonner';
import {
  SESSION_CHAT_SEND_BLOCKED_TITLE as SEND_BLOCKED_TITLE,
  sessionChatSendBlockedToastRequest,
} from '@/packages/shared/session-chat-presentation/send-blocked';
import type { SessionChatTheme } from '@/packages/shared/session-chat';
import { postAppModalHostMessage } from '../app-modal-host-bridge';

export function showSessionChatSendBlockedToast(reason: string, toasterId: string): void {
  const description = reason.trim();
  if (window.webkit?.messageHandlers?.ghostexAppModalHost !== undefined) {
    postAppModalHostMessage(sessionChatSendBlockedToastRequest(reason), 'SessionChatComposer:sendBlockedToast');
    return;
  }
  toast.error(SEND_BLOCKED_TITLE, {
    ...(description === '' ? {} : { description }),
    toasterId,
  });
}

/** In-page renderer for hosts without the native toast host; renders nothing until a toast is raised. */
export function SessionChatSendBlockedToaster({ theme, toasterId }: { theme: SessionChatTheme; toasterId: string }) {
  return (
    <Toaster
      id={toasterId}
      position='bottom-center'
      richColors
      theme={theme}
      toastOptions={{
        style: {
          background: 'var(--popover)',
          border: '1px solid var(--border)',
          color: 'var(--popover-foreground)',
        },
      }}
    />
  );
}
