import { sidebarStore } from '@/packages/core-ui/sidebar-store-model';

export function nativeChatSettings(sessionKey: string) {
  const state = sidebarStore.getState();
  return {
    hideAccountEmails: state.hud.settings?.hideAccountEmails === true,
    title: state.sessionsById[sessionKey]?.displayTitle?.trim() || null,
  };
}

export function subscribeNativeChatSettings(
  sessionKey: string,
  changed: (settings: ReturnType<typeof nativeChatSettings>) => void
) {
  let previous = nativeChatSettings(sessionKey);
  return sidebarStore.subscribe(() => {
    const next = nativeChatSettings(sessionKey);
    if (next.title === previous.title && next.hideAccountEmails === previous.hideAccountEmails) return;
    previous = next;
    changed(next);
  });
}
