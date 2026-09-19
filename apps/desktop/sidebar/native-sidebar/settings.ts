import { normalizeghostexSettings, type ghostexSettings } from '@/packages/shared/ghostex-settings';
import { sidebarStore } from '@/packages/core-ui/sidebar-store-model';

let source: unknown = undefined;
let value: ghostexSettings | undefined;

/**
 * CDXC:Sidebar 2026-09-19 WHY:
 * The full settings normalizer (about 270 keys) ran four to eight times per sidebar projection, once per caller and once per collection, on the desktop's QuickJS service thread.
 * The normalized object is kept per saved-settings object identity, which the store replaces only when settings change.
 */
export function nativeSidebarSettings(candidate: unknown = sidebarStore.getState().hud.settings): ghostexSettings {
  if (!value || candidate !== source) {
    source = candidate;
    value = normalizeghostexSettings(candidate);
  }
  return value;
}
