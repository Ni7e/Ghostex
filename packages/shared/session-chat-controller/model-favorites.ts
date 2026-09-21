import { storageScope } from '@/packages/client-storage';
import { toggleModelMenuFavorite } from '../session-chat-presentation/model-menu';

/**
 * Starred models belong to the person, not to a session or a renderer, so React and GPUI read and
 * write the one list and a star set in either shows in both.
 */
const clientStorage = storageScope(['modelFavorites']);
const STORAGE_KEY = 'ghostex.model-favorites';
const listeners = new Set<() => void>();
let favorites: readonly string[] | null = null;

export function modelFavorites(): readonly string[] {
  if (favorites) return favorites;
  try {
    const stored: unknown = JSON.parse(clientStorage.getItem(STORAGE_KEY) ?? '[]');
    favorites = Array.isArray(stored) ? stored.filter((item): item is string => typeof item === 'string') : [];
  } catch {
    favorites = [];
  }
  return favorites;
}

export function toggleModelFavorite(key: string): void {
  favorites = toggleModelMenuFavorite(modelFavorites(), key);
  try {
    clientStorage.setItem(STORAGE_KEY, JSON.stringify(favorites));
  } catch {
    /* Storage may be unavailable; the star still holds for this run. */
  }
  for (const listener of listeners) listener();
}

export function subscribeModelFavorites(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
