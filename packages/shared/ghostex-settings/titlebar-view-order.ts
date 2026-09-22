import type { GhostexInstalledExtension } from '../ghostex-extensions';
import type { ghostexSettings } from './types';
import { PROJECT_WEBSITE_PROVIDERS } from './project-websites';

export type TitlebarViewOrderItem = {
  id: string;
  title: string;
  source: 'Built-in' | 'Extension' | 'Custom view';
  visible: boolean;
};

export function normalizeTitlebarViewOrder(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return [
    ...new Set(
      value.filter(
        (id): id is string =>
          typeof id === 'string' &&
          /^(agents|source|browser|kanban|automate|manage|terminal|extension:[a-z0-9]+(?:-[a-z0-9]+)*)$/u.test(id)
      )
    ),
  ];
}

/**
 * CDXC:Titlebar 2026-09-09 DECISION:
 * User: one Settings popup controls the order of built-in, extension, and custom views together.
 * SEE-ALSO: apps/desktop/src/app/workarea.rs applies these mode slugs to the native titlebar list before numbered shortcuts resolve it.
 */
export function titlebarViewOrderItems(
  settings: ghostexSettings,
  installed: readonly GhostexInstalledExtension[]
): TitlebarViewOrderItem[] {
  const items: TitlebarViewOrderItem[] = [
    { id: 'agents', title: 'Agents', source: 'Built-in', visible: true },
    { id: 'source', title: 'Code', source: 'Built-in', visible: !settings.codeViewTabHidden },
    { id: 'browser', title: 'Browser', source: 'Built-in', visible: !settings.browserViewTabHidden },
    { id: 'kanban', title: 'Kanban', source: 'Built-in', visible: !settings.kanbanViewTabHidden },
    { id: 'automate', title: 'Automate', source: 'Built-in', visible: !settings.automateViewTabHidden },
    { id: 'manage', title: 'Docs', source: 'Built-in', visible: !settings.docsViewTabHidden },
    { id: 'terminal', title: 'Terminal', source: 'Built-in', visible: !settings.terminalViewTabHidden },
    { id: 'extension:storybook', title: 'Storybook', source: 'Built-in', visible: !settings.storybookViewTabHidden },
  ];
  items.push(
    ...PROJECT_WEBSITE_PROVIDERS.map((provider): TitlebarViewOrderItem => ({
      id: `extension:${provider.id}`,
      title: provider.title,
      source: 'Built-in',
      visible: !settings[provider.hiddenSettingsKey],
    }))
  );
  items.push(
    ...installed
      .filter(
        (extension) =>
          extension.id !== 'storybook' &&
          !PROJECT_WEBSITE_PROVIDERS.some((provider) => provider.id === extension.id) &&
          extension.manifest.placements?.includes('view') &&
          extension.state.placement === 'view' &&
          !settings.customViews.some((view) => view.id === extension.id)
      )
      .map((extension): TitlebarViewOrderItem => ({
        id: `extension:${extension.id}`,
        title: extension.manifest.title,
        source: 'Extension',
        visible: extension.state.enabled,
      }))
      .sort((left, right) => (left.title < right.title ? -1 : left.title > right.title ? 1 : 0))
  );
  items.push(
    ...settings.customViews.map((view): TitlebarViewOrderItem => ({
      id: `extension:${view.id}`,
      title: view.name,
      source: 'Custom view',
      visible: view.enabled,
    }))
  );
  const positions = new Map(settings.titlebarViewOrder.map((id, index) => [id, index]));
  return items.sort((left, right) => (positions.get(left.id) ?? Infinity) - (positions.get(right.id) ?? Infinity));
}
