import { useSyncExternalStore } from 'react';

export type WorkareaTheme = 'light' | 'dark';
const THEME_EVENT = 'ghostex-workarea-theme-changed';

/** CDXC:Theming 2026-09-13 DECISION:
 * User: Docs, Kanban and Automate follow the app's light theme.
 * The native host sends the resolved appearance at startup and on changes so these pages do not depend on the terminal or Browser content theme.
 */
export function applyWorkareaTheme(theme: WorkareaTheme): void {
  document.documentElement.dataset.workareaTheme = theme;
  document.documentElement.style.colorScheme = theme;
  document.documentElement.classList.toggle('dark', theme === 'dark');
  document.body.dataset.sidebarTheme = theme === 'light' ? 'plain-light' : 'plain-dark';
}

export function getWorkareaTheme(): WorkareaTheme {
  return document.documentElement.dataset.workareaTheme === 'light' ? 'light' : 'dark';
}

export function installWorkareaTheme(): void {
  const target = window as Window & { ghostexGpui?: { workareaTheme?: WorkareaTheme } };
  const initial = target.ghostexGpui?.workareaTheme ?? new URLSearchParams(location.search).get('appTheme');
  applyWorkareaTheme(initial === 'light' ? 'light' : 'dark');
  window.addEventListener(THEME_EVENT, (event) => {
    const theme = (event as CustomEvent<WorkareaTheme>).detail;
    if (theme === 'light' || theme === 'dark') applyWorkareaTheme(theme);
  });
}

function subscribe(listener: () => void): () => void {
  window.addEventListener(THEME_EVENT, listener);
  return () => window.removeEventListener(THEME_EVENT, listener);
}

export function useWorkareaTheme(): WorkareaTheme {
  return useSyncExternalStore(subscribe, getWorkareaTheme, () => 'dark');
}
