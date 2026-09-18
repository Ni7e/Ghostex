import { Database } from 'bun:sqlite';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { normalizeghostexSettings } from '@/packages/shared/ghostex-settings';
import {
  normalizeSidebarUiCollapseState,
  getSidebarUiCollapseStateStorageKey,
  type SidebarUiCollapseState,
} from '@/packages/core-ui/sidebar-app/collapse-state';
import type { SidebarHiddenItems } from '@/packages/core-ui/sidebar-hidden-items';
import { appStateDir, configDir, readJson } from './paths';
export type Preferences = {
  collapse: SidebarUiCollapseState;
  hidden: SidebarHiddenItems;
  settings: Pick<
    ReturnType<typeof normalizeghostexSettings>,
    'enableSessionParking' | 'sidebarSpacesEnabled' | 'projectSessionListCollapsedCount'
  >;
  source: string;
};
export async function readPreferences(): Promise<Preferences> {
  const settings = normalizeghostexSettings(await readJson(join(configDir, 'native-sidebar-settings.json')));
  let collapse: unknown;
  let hidden: SidebarHiddenItems = { groupIds: [], collectionKeys: [] };
  const file = join(appStateDir, 'client-storage.sqlite3');
  let source = 'GPUI defaults (no saved native sidebar preferences)';
  if (existsSync(file)) {
    const database = new Database(file, { readonly: true });
    try {
      const get = (key: string) => {
        const row = database.query('SELECT value FROM preferences WHERE key = ?').get(key) as {
          value: string;
        } | null;
        return row ? JSON.parse(row.value) : undefined;
      };
      collapse = get(getSidebarUiCollapseStateStorageKey('main'))?.state;
      const stored = get('ghostex.sidebar.hidden-items.v1');
      if (stored)
        hidden = {
          groupIds: Array.isArray(stored.groupIds)
            ? stored.groupIds.filter((v: unknown) => typeof v === 'string')
            : [],
          collectionKeys: Array.isArray(stored.collectionKeys)
            ? stored.collectionKeys.filter((v: unknown) => typeof v === 'string')
            : [],
        };
      source = 'Saved GPUI sidebar preferences';
    } finally {
      database.close();
    }
  }
  return {
    collapse: normalizeSidebarUiCollapseState(collapse),
    hidden,
    settings: {
      enableSessionParking: settings.enableSessionParking,
      sidebarSpacesEnabled: settings.sidebarSpacesEnabled,
      projectSessionListCollapsedCount: settings.projectSessionListCollapsedCount,
    },
    source,
  };
}
