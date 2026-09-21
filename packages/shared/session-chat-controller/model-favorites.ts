import { storageScope } from '@/packages/client-storage';
import { toggleModelMenuFavorite } from '../session-chat-presentation/model-menu';

/**
 * Starred models belong to the person, not to a session or a renderer, so React and GPUI read and
 * write the one list and a star set in either shows in both.
 */
const clientStorage = storageScope(['modelFavorites']);
const STORAGE_KEY = 'ghostex.model-favorites';
const listeners = new Set<() => void>();
let parsed: { raw: string | null; list: readonly string[] } = { raw: null, list: [] };

let adopted: readonly string[] | null = null;
/**
 * CDXC:SessionChat 2026-09-21 WHY:
 * The desktop chat's script runtime has no storage of its own; the shared sidebar service does. Its host asks the service for the list when the picker opens and after each star, and hands the answer here, so every session shows the one saved list.
 * SEE-ALSO: apps/desktop/sidebar/session-chat-runtime/native-composer.ts (`modelFavorites`, `modelFavoriteToggle`).
 */
export function adoptModelFavorites(list: unknown): void {
  adopted = Array.isArray(list) ? list.filter((item): item is string => typeof item === 'string') : [];
}

/**
 * CDXC:SessionChat 2026-09-21 WHY:
 * Every open session runs its own copy of this module, so the saved list is read on each call rather than remembered: a star set in one session is there the next time any other session draws its picker. The parsed list is only reused while the stored text is unchanged, which keeps the React snapshot stable.
 */
export function modelFavorites(): readonly string[] {
  if (adopted) return adopted;
  let raw: string | null = null;
  try {
    raw = clientStorage.getItem(STORAGE_KEY);
  } catch {
    return parsed.list;
  }
  if (raw === parsed.raw) return parsed.list;
  let list: readonly string[] = [];
  try {
    const stored: unknown = JSON.parse(raw ?? '[]');
    if (Array.isArray(stored)) list = stored.filter((item): item is string => typeof item === 'string');
  } catch {
    /* An unreadable list is an empty one. */
  }
  parsed = { raw, list };
  return list;
}

export function toggleModelFavorite(key: string): void {
  clientStorage.setItem(STORAGE_KEY, JSON.stringify(toggleModelMenuFavorite(modelFavorites(), key)));
  for (const listener of listeners) listener();
}

export function subscribeModelFavorites(listener: () => void): () => void {
  listeners.add(listener);
  // Another page writing the list (a second browser tab, another chat page) arrives as a storage change.
  const unsubscribe = clientStorage.subscribe(() => listener());
  return () => {
    listeners.delete(listener);
    unsubscribe();
  };
}
