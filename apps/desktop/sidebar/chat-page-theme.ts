import { resolveSessionChatTheme } from '@/packages/core-ui/chat/session-chat-theme';
import { normalizeSessionChatTheme, type SessionChatTheme } from '@/packages/shared/session-chat';

/**
 * CDXC:Theming 2026-09-13 SEE-ALSO:
 * chat.html paints before this module loads; session_chat_surfaces.rs supplies initialTheme before CEF's system appearance override is ready.
 * Keep all three on the same initial palette, including when activation waits for the server bootstrap.
 */
export function initialSessionChatTheme(params: URLSearchParams): SessionChatTheme {
  const initial = params.get('initialTheme');
  return initial === 'light' || initial === 'dark'
    ? initial
    : resolveSessionChatTheme(normalizeSessionChatTheme(params.get('theme')));
}

export function applyDocumentSessionChatTheme(theme: SessionChatTheme): void {
  const background = theme === 'light' ? '#fdfdfd' : '#0d0d0d';
  document.documentElement.style.colorScheme = theme;
  document.documentElement.style.setProperty('--ghostex-chat-page-background', background);
  document.documentElement.style.backgroundColor = background;
  document.body.style.backgroundColor = background;
}
