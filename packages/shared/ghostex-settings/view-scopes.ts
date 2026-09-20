import { isRecord } from './primitives';
import type { ProjectViewSpace } from './project-views';

/**
 * CDXC:Extensions 2026-09-20 DECISION:
 * User (ruling 3A): "Rewrite to overrides: a `default` of shown or hidden, plus per-project and
 * per-space overrides, resolved project then space then default." This supersedes the
 * 2026-09-18 decision that scoped a view with an "Available in" allow-list ('all' | 'selected' |
 * 'spaces'), which could only say where a view IS shown: hiding one view in the project you are in
 * meant enumerating every other project, and the list broke as soon as a project was added.
 *
 * A view with NO entry is shown everywhere, so the stored map only ever holds what the user narrowed.
 * SEE-ALSO: apps/desktop/src/app/view_scopes.rs applies this same rule to the native work area header,
 * packages/shared/ghostex-settings/project-views.ts owns the separate custom-view availability rule.
 */
export type GhostexViewScopeState = 'shown' | 'hidden';

export type GhostexViewScopeSpaceRef = Pick<ProjectViewSpace, 'sectionKey' | 'spaceId'>;

export type GhostexViewScope = {
  /** What happens where nothing else says otherwise. */
  default: GhostexViewScopeState;
  /** Per-project override, keyed by the machine-scoped project id. */
  projects: Record<string, GhostexViewScopeState>;
  /** Per-space override, keyed by `viewScopeSpaceKey`. */
  spaces: Record<string, GhostexViewScopeState>;
};

/** Keyed by `viewScopeKey`; an absent entry means the view is shown everywhere. */
export type GhostexViewScopes = Record<string, GhostexViewScope>;

export const DEFAULT_GHOSTEX_VIEW_SCOPE: GhostexViewScope = { default: 'shown', projects: {}, spaces: {} };

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

/**
 * A space override is keyed by section and space together, because two gxserver sections (this
 * computer and each remote machine) mint their space ids independently.
 */
export function viewScopeSpaceKey(space: GhostexViewScopeSpaceRef): string {
  return `${space.sectionKey}:${space.spaceId}`;
}

/**
 * The section key itself contains a colon for a remote machine (`remote:<machineId>`), so the space id
 * is everything after the LAST one. Used to keep an override editable after its space has gone away.
 */
export function parseViewScopeSpaceKey(key: string): GhostexViewScopeSpaceRef | undefined {
  const separator = key.lastIndexOf(':');
  if (separator <= 0 || separator === key.length - 1) return undefined;
  return { sectionKey: key.slice(0, separator), spaceId: key.slice(separator + 1) };
}

const UNSAFE_KEYS = ['__proto__', 'constructor', 'prototype'];
const text = (value: unknown, max = 256) => (typeof value === 'string' ? value.trim().slice(0, max) : '');
const scopeState = (value: unknown): GhostexViewScopeState | undefined =>
  value === 'shown' || value === 'hidden' ? value : undefined;

function normalizeOverrides(value: unknown): Record<string, GhostexViewScopeState> {
  if (!isRecord(value)) return {};
  const overrides: Record<string, GhostexViewScopeState> = {};
  for (const [rawKey, rawState] of Object.entries(value)) {
    const key = text(rawKey, 512);
    const state = scopeState(rawState);
    if (!key || UNSAFE_KEYS.includes(key) || !state) continue;
    overrides[key] = state;
  }
  return overrides;
}

/**
 * CDXC:Extensions 2026-09-20 WHY:
 * Settings files written before the override model hold the old allow-list, and it maps onto the new
 * model exactly: 'all' is the default-shown scope, 'selected' is default hidden plus those projects
 * shown, 'spaces' is default hidden plus those spaces shown. Converting on read means no rewrite pass
 * and no moment where a user's narrowing silently widens.
 * SEE-ALSO: apps/desktop/src/app/view_scopes.rs converts the same three values for the native reader,
 * which reads the settings file directly rather than through this normalizer.
 */
function migratedAllowListViewScope(value: Record<string, unknown>): GhostexViewScope {
  if (value.availability === 'selected') {
    const projects: Record<string, GhostexViewScopeState> = {};
    if (Array.isArray(value.projectIds)) {
      for (const entry of value.projectIds) {
        const projectId = text(entry, 512);
        if (projectId && !UNSAFE_KEYS.includes(projectId)) projects[projectId] = 'shown';
      }
    }
    return { default: 'hidden', projects, spaces: {} };
  }
  if (value.availability === 'spaces') {
    const spaces: Record<string, GhostexViewScopeState> = {};
    if (Array.isArray(value.spaceRefs)) {
      for (const entry of value.spaceRefs) {
        if (!isRecord(entry)) continue;
        const sectionKey = text(entry.sectionKey);
        const spaceId = text(entry.spaceId);
        if (sectionKey && spaceId) spaces[viewScopeSpaceKey({ sectionKey, spaceId })] = 'shown';
      }
    }
    return { default: 'hidden', projects: {}, spaces };
  }
  return { ...DEFAULT_GHOSTEX_VIEW_SCOPE };
}

export function normalizeGhostexViewScope(value: unknown): GhostexViewScope {
  if (!isRecord(value)) return { ...DEFAULT_GHOSTEX_VIEW_SCOPE };
  if (!scopeState(value.default) && typeof value.availability === 'string') {
    return migratedAllowListViewScope(value);
  }
  return {
    default: scopeState(value.default) ?? 'shown',
    projects: normalizeOverrides(value.projects),
    spaces: normalizeOverrides(value.spaces),
  };
}

/** True while the scope says nothing: shown everywhere, with no override narrowing it. */
export function isDefaultGhostexViewScope(scope: GhostexViewScope): boolean {
  return (
    scope.default === 'shown' && Object.keys(scope.projects).length === 0 && Object.keys(scope.spaces).length === 0
  );
}

/**
 * A scope carrying no information is dropped, so the stored map only ever holds the views the user
 * actually narrowed and a view that is later renamed or uninstalled leaves no residue. An override
 * that happens to match the default is KEPT: with a space override in play it is the thing that
 * overrides it, so pruning it would change what the user sees.
 */
export function normalizeGhostexViewScopes(value: unknown): GhostexViewScopes {
  if (!isRecord(value)) return {};
  const scopes: GhostexViewScopes = {};
  for (const [key, entry] of Object.entries(value)) {
    if (!key || key.length > 256 || UNSAFE_KEYS.includes(key)) continue;
    const scope = normalizeGhostexViewScope(entry);
    if (isDefaultGhostexViewScope(scope)) continue;
    scopes[key] = scope;
  }
  return scopes;
}

export function ghostexViewScope(scopes: GhostexViewScopes | undefined, key: string): GhostexViewScope {
  return scopes?.[key] ?? { ...DEFAULT_GHOSTEX_VIEW_SCOPE };
}

/**
 * Drop the overrides that provably cannot change anything, so a user who toggles a card off and back
 * on leaves no residue behind. This never changes what anyone sees: when every space override already
 * matches the default they all resolve to the default, so they go together and the project overrides
 * that match the default go with them. The moment ONE space override differs, every override is kept,
 * because a project's `hidden` is then the only thing that can beat its space's `shown`.
 */
export function prunedGhostexViewScope(scope: GhostexViewScope): GhostexViewScope {
  if (Object.values(scope.spaces).some((state) => state !== scope.default)) return scope;
  return {
    default: scope.default,
    projects: Object.fromEntries(Object.entries(scope.projects).filter(([, state]) => state !== scope.default)),
    spaces: {},
  };
}

export function setGhostexViewScope(
  scopes: GhostexViewScopes | undefined,
  key: string,
  scope: GhostexViewScope
): GhostexViewScopes {
  return normalizeGhostexViewScopes({ ...(scopes ?? {}), [key]: prunedGhostexViewScope(scope) });
}

export type GhostexViewScopeOverrideTarget =
  { kind: 'project'; projectId: string } | { kind: 'space'; space: GhostexViewScopeSpaceRef };

/** `'inherit'` removes the override so the next rule down decides again. */
export function withViewScopeOverride(
  scope: GhostexViewScope,
  target: GhostexViewScopeOverrideTarget,
  state: GhostexViewScopeState | 'inherit'
): GhostexViewScope {
  const overrideKey = target.kind === 'project' ? target.projectId : viewScopeSpaceKey(target.space);
  const overrides = { ...(target.kind === 'project' ? scope.projects : scope.spaces) };
  if (state === 'inherit') delete overrides[overrideKey];
  else overrides[overrideKey] = state;
  return target.kind === 'project' ? { ...scope, projects: overrides } : { ...scope, spaces: overrides };
}

/**
 * Write (or clear) ONE override in one call, which is what a view tab's right-click menu needs: it
 * knows the view, the project it is looking at, and whether the user just ticked or unticked it.
 */
export function setViewScopeOverride(
  scopes: GhostexViewScopes | undefined,
  key: string,
  target: GhostexViewScopeOverrideTarget,
  state: GhostexViewScopeState | 'inherit'
): GhostexViewScopes {
  return setGhostexViewScope(scopes, key, withViewScopeOverride(ghostexViewScope(scopes, key), target, state));
}

/**
 * The single precedence rule every surface applies: **project, then space, then default**. Most
 * specific wins, because it is the only rule a user can predict ("I hid it in this project" beats
 * "I showed it in this space" beats the default). Where two of the project's spaces disagree, hidden
 * wins: a deliberate hide should not be undone by a space the user was not thinking about.
 *
 * `projectSpaceRefs` is the set of spaces the ACTIVE project resolves into, already including group
 * and worktree-parent inheritance, so this stays a pure lookup instead of re-deriving sidebar
 * membership per surface.
 */
export function resolveViewScopeState({
  projectId,
  projectSpaceRefs,
  scope,
}: {
  projectId: string | undefined;
  projectSpaceRefs: readonly GhostexViewScopeSpaceRef[];
  scope: GhostexViewScope;
}): GhostexViewScopeState {
  const project = projectId ? scope.projects[projectId] : undefined;
  if (project) return project;
  const spaceStates = projectSpaceRefs.flatMap((ref) => {
    const state = scope.spaces[viewScopeSpaceKey(ref)];
    return state ? [state] : [];
  });
  if (spaceStates.includes('hidden')) return 'hidden';
  if (spaceStates.includes('shown')) return 'shown';
  return scope.default;
}

export function isViewScopeVisible(input: {
  projectId: string | undefined;
  projectSpaceRefs: readonly GhostexViewScopeSpaceRef[];
  scope: GhostexViewScope;
}): boolean {
  return resolveViewScopeState(input) === 'shown';
}

/** The one-line summary the Extensions row shows under a narrowed view. */
export function viewScopeDescription(
  scope: GhostexViewScope,
  {
    projects = [],
    spaces = [],
  }: { projects?: readonly { name: string; projectId: string }[]; spaces?: readonly ProjectViewSpace[] } = {}
): string {
  const shown: string[] = [];
  const hidden: string[] = [];
  for (const [projectId, state] of Object.entries(scope.projects)) {
    const name = projects.find((project) => project.projectId === projectId)?.name ?? 'Unavailable project';
    (state === 'shown' ? shown : hidden).push(name);
  }
  for (const [spaceKey, state] of Object.entries(scope.spaces)) {
    const name = spaces.find((space) => viewScopeSpaceKey(space) === spaceKey)?.name ?? 'Unavailable space';
    (state === 'shown' ? shown : hidden).push(name);
  }
  if (scope.default === 'shown') {
    return hidden.length ? `Everywhere except ${hidden.join(', ')}` : 'All projects';
  }
  if (!shown.length) return 'Hidden everywhere';
  return hidden.length ? `Only ${shown.join(', ')}, except ${hidden.join(', ')}` : `Only ${shown.join(', ')}`;
}
