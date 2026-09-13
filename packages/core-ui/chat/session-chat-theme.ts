import { systemColorScheme, useSystemColorScheme } from '../use-system-color-scheme';
export { subscribeSystemColorScheme as subscribeSystemChatTheme } from '../use-system-color-scheme';
import type { SessionChatTheme, SessionChatThemeSetting } from '@/packages/shared/session-chat';
import { resolveContentThemeSetting } from '@/packages/shared/appearance';
import type { SidebarThemeSetting } from '@/packages/shared/session-grid-contract-core';

export function resolveSessionChatTheme(
  setting: SessionChatThemeSetting,
  appTheme: SidebarThemeSetting = 'dark-2'
): SessionChatTheme {
  const resolved = resolveContentThemeSetting(setting, appTheme);
  return resolved === 'system' ? systemColorScheme() : resolved;
}

export function useSessionChatTheme(
  setting: SessionChatThemeSetting,
  appTheme: SidebarThemeSetting = 'dark-2'
): SessionChatTheme {
  const systemTheme = useSystemColorScheme();
  const resolved = resolveContentThemeSetting(setting, appTheme);
  return resolved === 'system' ? systemTheme : resolved;
}
