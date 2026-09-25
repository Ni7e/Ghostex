import providers from '../project-website-providers.json';
import { isRecord, readBoolean } from './primitives';

export type ProjectWebsiteId =
  | 'linear' | 'jira' | 'github'
  | 'sentry' | 'figma' | 'vercel' | 'supabase' | 'github-actions' | 'posthog' | 'custom-website';
export type ProjectWebsiteHiddenKey =
  `${Exclude<ProjectWebsiteId, 'github-actions' | 'custom-website'> | 'githubActions' | 'customWebsite'}ViewTabHidden`;
export const PROJECT_WEBSITE_PROVIDERS = providers as readonly {
  id: ProjectWebsiteId;
  title: string;
  hiddenSettingsKey: ProjectWebsiteHiddenKey;
  workspaceKind: 'linear' | 'site' | 'repository';
  placeholder: string;
  description: string;
  hiddenByDefault: boolean;
}[];
/**
 * CDXC:Workarea 2026-09-24 DECISION:
 * User: Sentry, Figma, Vercel, Supabase, GitHub Actions, PostHog, and Custom Website start disabled in Settings. All use the same user-chosen project/worktree home URL flow as Linear, including GitHub Actions.
 */
export function normalizeProjectWebsiteVisibility(source: Record<string, unknown>): Record<ProjectWebsiteHiddenKey, boolean> {
  return Object.fromEntries(PROJECT_WEBSITE_PROVIDERS.map((provider) => [
    provider.hiddenSettingsKey,
    readBoolean(source, provider.hiddenSettingsKey, provider.hiddenByDefault),
  ])) as Record<ProjectWebsiteHiddenKey, boolean>;
}

export const DEFAULT_PROJECT_WEBSITE_VISIBILITY = normalizeProjectWebsiteVisibility({});

export type ProjectWebsiteSettings = Record<string, { homes: Record<string, string>; workspaces: string[] }>;

/**
 * CDXC:Workarea 2026-09-22 DECISION:
 * User: reusable built-in website views infer the workspace from the URL and remember the exact home, including filters, per project or worktree. Worktrees follow their parent unless they have their own URL; GitHub uses the repository automatically. Right-clicking the view tab reopens the home URL setup screen.
 * SEE-ALSO: apps/desktop/src/app/project_websites/registry.rs consumes the same provider catalog and settings shape.
 */
export function projectWebsiteWorkspace(
  providerId: string,
  value: unknown
): { key: string; label: string } | undefined {
  if (typeof value !== 'string' || !value.trim() || value.length > 8192) return;
  const provider = PROJECT_WEBSITE_PROVIDERS.find((entry) => entry.id === providerId);
  if (!provider || provider.workspaceKind === 'repository') return;
  try {
    const url = new URL(value.trim());
    if (!['http:', 'https:'].includes(url.protocol) || !url.hostname || url.username || url.password) return;
    if (provider.workspaceKind === 'linear') {
      const workspace = url.pathname.split('/').filter(Boolean)[0];
      if (url.hostname !== 'linear.app' || !workspace) return;
      return { key: `${url.origin}/${workspace}`, label: workspace };
    }
    return { key: url.origin, label: url.host };
  } catch {
    return;
  }
}

export function normalizeProjectWebsiteSettings(value: unknown): ProjectWebsiteSettings {
  if (!isRecord(value)) return {};
  return Object.fromEntries(
    PROJECT_WEBSITE_PROVIDERS.flatMap(({ id }) => {
      const settings = value[id];
      if (!isRecord(settings)) return [];
      const homes = Object.fromEntries(
        Object.entries(isRecord(settings.homes) ? settings.homes : {})
          .filter(
            ([key, url]) => !['__proto__', 'constructor', 'prototype'].includes(key) && projectWebsiteWorkspace(id, url)
          )
          .map(([key, url]) => [key, (url as string).trim()])
      );
      const seen = new Set<string>();
      const workspaces = (Array.isArray(settings.workspaces) ? settings.workspaces : []).flatMap((url) => {
        const workspace = projectWebsiteWorkspace(id, url);
        if (!workspace || seen.has(workspace.key)) return [];
        seen.add(workspace.key);
        return [(url as string).trim()];
      });
      return [[id, { homes, workspaces }]];
    })
  );
}
