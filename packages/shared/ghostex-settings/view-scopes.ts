import { isRecord } from './primitives';
import type { ProjectViewSpace } from './project-views';

/**
 * CDXC:Extensions 2026-09-18 DECISION:
 * User: every built-in view and every extension gets the same Edit button and the same "Available in"
 * picker the custom views already have, so a workarea, a titlebar button, or a store extension can be
 * limited to chosen projects or chosen spaces instead of only being on or off app-wide.
 * SEE-ALSO: packages/shared/ghostex-settings/project-views.ts owns the equivalent custom-view rule,
 * apps/desktop/src/app/view_scopes.rs applies this scope to the native titlebar.
 */
export type GhostexViewScopeAvailability = 'all' | 'selected' | 'spaces';

export type GhostexViewScopeSpaceRef = Pick<ProjectViewSpace, 'sectionKey' | 'spaceId'>;

export type GhostexViewScope = {
  availability: GhostexViewScopeAvailability;
  projectIds: string[];
  spaceRefs: GhostexViewScopeSpaceRef[];
};

/** Keyed by `viewScopeKey`; an absent entry means the view is available everywhere. */
export type GhostexViewScopes = Record<string, GhostexViewScope>;

export const DEFAULT_GHOSTEX_VIEW_SCOPE: GhostexViewScope = { availability: 'all', projectIds: [], spaceRefs: [] };

/**
 * Scope keys are namespaced so an official descriptor id can never collide with an installed
 * extension name. The official namespace uses the descriptor id (`code`, `docs`), not the titlebar
 * mode slug (`source`, `manage`), because the descriptor list is the shared contract both surfaces read.
 */
export function officialViewScopeKey(officialExtensionId: string): string {
  return `official:${officialExtensionId}`;
}

export function extensionViewScopeKey(extensionId: string): string {
  return `extension:${extensionId}`;
}

const text = (value: unknown, max = 256) => (typeof value === 'string' ? value.trim().slice(0, max) : '');

export function normalizeGhostexViewScope(value: unknown): GhostexViewScope {
  if (!isRecord(value)) return { ...DEFAULT_GHOSTEX_VIEW_SCOPE };
  const availability: GhostexViewScopeAvailability =
    value.availability === 'selected' || value.availability === 'spaces' ? value.availability : 'all';
  return {
    availability,
    projectIds: Array.isArray(value.projectIds)
      ? [...new Set(value.projectIds.flatMap((id) => (text(id, 512) ? [text(id, 512)] : [])))]
      : [],
    spaceRefs: Array.isArray(value.spaceRefs)
      ? value.spaceRefs.flatMap((entry) => {
          if (!isRecord(entry)) return [];
          const sectionKey = text(entry.sectionKey);
          const spaceId = text(entry.spaceId);
          return sectionKey && spaceId ? [{ sectionKey, spaceId }] : [];
        })
      : [],
  };
}

/**
 * An "all projects" entry carries no information, so it is dropped: the stored map only ever holds the
 * views the user actually narrowed, and a view that is later renamed or uninstalled leaves no residue.
 */
export function normalizeGhostexViewScopes(value: unknown): GhostexViewScopes {
  if (!isRecord(value)) return {};
  const scopes: GhostexViewScopes = {};
  for (const [key, entry] of Object.entries(value)) {
    if (!key || key.length > 256 || ['__proto__', 'constructor', 'prototype'].includes(key)) continue;
    const scope = normalizeGhostexViewScope(entry);
    if (scope.availability === 'all') continue;
    scopes[key] = scope;
  }
  return scopes;
}

export function ghostexViewScope(scopes: GhostexViewScopes | undefined, key: string): GhostexViewScope {
  return scopes?.[key] ?? { ...DEFAULT_GHOSTEX_VIEW_SCOPE };
}

export function setGhostexViewScope(
  scopes: GhostexViewScopes | undefined,
  key: string,
  scope: GhostexViewScope
): GhostexViewScopes {
  const next = { ...(scopes ?? {}) };
  if (scope.availability === 'all') delete next[key];
  else next[key] = scope;
  return normalizeGhostexViewScopes(next);
}

/** The one-line summary the Extensions row shows under a narrowed view. */
export function viewScopeDescription(
  scope: GhostexViewScope,
  {
    projects = [],
    spaces = [],
  }: { projects?: readonly { name: string; projectId: string }[]; spaces?: readonly ProjectViewSpace[] } = {}
): string {
  if (scope.availability === 'selected') {
    const names = scope.projectIds.map(
      (projectId) => projects.find((project) => project.projectId === projectId)?.name ?? 'Unavailable project'
    );
    return names.length ? `Projects: ${names.join(', ')}` : 'No projects chosen';
  }
  if (scope.availability === 'spaces') {
    const names = scope.spaceRefs.map(
      (ref) =>
        spaces.find((space) => space.sectionKey === ref.sectionKey && space.spaceId === ref.spaceId)?.name ??
        'Unavailable space'
    );
    return names.length ? `Spaces: ${names.join(', ')}` : 'No spaces chosen';
  }
  return 'All projects';
}

/**
 * The single membership rule every surface applies. `projectSpaceRefs` is the set of spaces the ACTIVE
 * project resolves into, already including group and worktree-parent inheritance, so this stays a pure
 * intersection instead of re-deriving sidebar membership per surface.
 */
export function isViewScopeVisible({
  projectId,
  projectSpaceRefs,
  scope,
}: {
  projectId: string | undefined;
  projectSpaceRefs: readonly GhostexViewScopeSpaceRef[];
  scope: GhostexViewScope;
}): boolean {
  if (scope.availability === 'all') return true;
  if (!projectId) return false;
  if (scope.availability === 'selected') return scope.projectIds.includes(projectId);
  return scope.spaceRefs.some((ref) =>
    projectSpaceRefs.some((current) => current.sectionKey === ref.sectionKey && current.spaceId === ref.spaceId)
  );
}
