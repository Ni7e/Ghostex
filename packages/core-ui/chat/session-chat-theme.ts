import { systemColorScheme, useSystemColorScheme } from '../use-system-color-scheme';
export { subscribeSystemColorScheme as subscribeSystemChatTheme } from '../use-system-color-scheme';
import type { SessionChatTheme, SessionChatThemeSetting } from '@/packages/shared/session-chat';

export function resolveSessionChatTheme(setting: SessionChatThemeSetting): SessionChatTheme {
  return setting === 'system' ? systemColorScheme() : setting;
}

export function useSessionChatTheme(setting: SessionChatThemeSetting): SessionChatTheme {
  const systemTheme = useSystemColorScheme();
  return setting === 'system' ? systemTheme : setting;
}
