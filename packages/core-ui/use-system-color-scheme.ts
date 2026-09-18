import { useSyncExternalStore } from 'react';

export function systemColorScheme(): 'dark' | 'light' {
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

export function subscribeSystemColorScheme(listener: () => void): () => void {
  const media = window.matchMedia('(prefers-color-scheme: dark)');
  media.addEventListener('change', listener);
  return () => media.removeEventListener('change', listener);
}

export function useSystemColorScheme(): 'dark' | 'light' {
  return useSyncExternalStore(subscribeSystemColorScheme, systemColorScheme, () => 'light' as const);
}
