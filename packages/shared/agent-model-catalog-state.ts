import { initializeClientStorage, storageScope, type ScopedStorage } from '@/packages/client-storage';
/*
CDXC:AgentProviders 2026-09-02:
Where a client's current agent model catalog comes from, in order:

1. The snapshot bundled with the build (`agent-model-catalog.json` at the repo
   root, the same file that is published), so a fresh install renders a full
   dropdown before any network call.
2. The copy the last successful remote fetch cached in localStorage, when it
   is newer than the bundled one (an older build keeps benefiting from a
   catalog update it already saw).
3. The remote document from the repo's main branch, fetched on load and
   re-read while the client runs (`refreshAgentModelCatalog`), or pushed by
   gxserver. Whenever GitHub is reachable and the file parses, it is the
   source of truth and replaces whatever was showing; the bundled and cached
   copies only cover the time before that fetch lands, or a fetch that fails.

"Newer" between the bundled and cached copies is the document's `updatedAt`,
so a fresh build carrying a newer snapshot is not shadowed by a stale cache.

Subscribers (the composer's option pills, through `useAgentModelCatalog`)
re-render when the current catalog changes. Reads outside React go through
`currentAgentModelCatalog()`.
*/

import bundledCatalogJson from '../../agent-model-catalog.json';
import {
  AGENT_MODEL_CATALOG_URL,
  newerAgentModelCatalog,
  parseAgentModelCatalog,
  type AgentModelCatalog,
} from './agent-model-catalog';

const clientStorage = storageScope(['modelCatalog']);

const STORAGE_KEY = 'ghostex.agentModelCatalog.v1';

const bundledCatalog: AgentModelCatalog = (() => {
  const parsed = parseAgentModelCatalog(bundledCatalogJson);
  if (parsed === null) {
    throw new Error('agent-model-catalog.json does not parse as a schema v1 catalog');
  }
  return parsed;
})();

function storage(): ScopedStorage | null {
  try {
    return typeof window === 'undefined' ? null : clientStorage;
  } catch {
    return null;
  }
}

function readCachedCatalog(): AgentModelCatalog | null {
  const raw = storage()?.getItem(STORAGE_KEY);
  if (!raw) {
    return null;
  }
  try {
    return parseAgentModelCatalog(JSON.parse(raw));
  } catch {
    return null;
  }
}

function writeCachedCatalog(catalog: AgentModelCatalog): void {
  try {
    storage()?.setItem(STORAGE_KEY, JSON.stringify(catalog));
  } catch {
    // Quota or private mode: the in-memory catalog still serves this load.
  }
}

let current: AgentModelCatalog = bundledCatalog;
if (typeof window !== 'undefined')
  void initializeClientStorage()
    .then(() => {
      const cached = readCachedCatalog();
      if (cached) replaceCatalog(newerAgentModelCatalog(current, cached));
    })
    .catch(() => {});

const listeners = new Set<() => void>();

function replaceCatalog(next: AgentModelCatalog): void {
  if (next === current) {
    return;
  }
  current = next;
  for (const listener of listeners) {
    listener();
  }
}

export function currentAgentModelCatalog(): AgentModelCatalog {
  return current;
}

/** Receives the service-owned catalog in a renderer runtime without starting another network request. */
export function adoptAgentModelCatalog(value: unknown): void {
  const catalog = parseAgentModelCatalog(value);
  if (!catalog) throw new Error('The shared agent model catalog is invalid.');
  replaceCatalog(catalog);
}

export function subscribeAgentModelCatalog(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/*
CDXC:AgentProviders 2026-09-22 DECISION:
User: new models must show in the model menu and the quick picker almost as
soon as the catalog is pushed, with a robust combination of every delivery
path. This supersedes the 2026-09-02 once-per-page-load fetch, which left a
desktop app that stays open for days on the lineup it launched with.

A client that has fetched once keeps re-reading the published file every
REFRESH_INTERVAL_MS and whenever a web or mobile page comes back into view,
and any caller (a model menu or chat view mounting) may ask for a refresh,
which reuses the last one when it is younger than REFRESH_MIN_GAP_MS. gxserver
also polls GitHub and pushes what it finds to every connected client
(`adoptPublishedAgentModelCatalog`), so a connected client usually has a new
lineup before its own timer fires. raw.githubusercontent.com caches the file
for up to five minutes, which is the floor on how fast any path can be.
*/
const REFRESH_INTERVAL_MS = 30 * 60_000;
const REFRESH_MIN_GAP_MS = 2 * 60_000;

let refresh: Promise<AgentModelCatalog> | null = null;
let refreshStartedAt = 0;
let refreshTimer: ReturnType<typeof setTimeout> | null = null;
let watchingVisibility = false;

/** Same lineup, so adopting it would only re-render every picker for nothing. */
function sameCatalog(a: AgentModelCatalog, b: AgentModelCatalog): boolean {
  return a === b || JSON.stringify(a) === JSON.stringify(b);
}

function adoptRemoteCatalog(next: AgentModelCatalog): void {
  if (sameCatalog(next, current)) {
    return;
  }
  writeCachedCatalog(next);
  replaceCatalog(next);
}

function scheduleNextRefresh(): void {
  if (typeof setTimeout !== 'function') {
    return;
  }
  if (refreshTimer !== null) {
    clearTimeout(refreshTimer);
  }
  const timer = setTimeout(() => {
    refreshTimer = null;
    void refreshAgentModelCatalog();
  }, REFRESH_INTERVAL_MS);
  // Node and Bun would otherwise keep a test process alive for the interval.
  if (typeof timer === 'object' && timer !== null && 'unref' in timer && typeof timer.unref === 'function') {
    timer.unref();
  }
  refreshTimer = timer;
}

function watchVisibility(): void {
  if (watchingVisibility || typeof document === 'undefined' || typeof document.addEventListener !== 'function') {
    return;
  }
  watchingVisibility = true;
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') {
      void refreshAgentModelCatalog();
    }
  });
}

/**
 * Fetches the published catalog and adopts it as the source of truth when it
 * parses. Resolves to the catalog in effect afterwards, so callers never have
 * to handle a failed fetch themselves.
 */
export function refreshAgentModelCatalog(): Promise<AgentModelCatalog> {
  if (refresh !== null && Date.now() - refreshStartedAt < REFRESH_MIN_GAP_MS) {
    return refresh;
  }
  refreshStartedAt = Date.now();
  scheduleNextRefresh();
  watchVisibility();
  refresh = (async () => {
    if (typeof fetch !== 'function') {
      return current;
    }
    try {
      const response = await fetch(AGENT_MODEL_CATALOG_URL, { cache: 'no-store' });
      if (!response.ok) {
        return current;
      }
      const remote = parseAgentModelCatalog(await response.json());
      if (remote === null) {
        return current;
      }
      adoptRemoteCatalog(remote);
    } catch {
      // Offline or blocked: the bundled or cached catalog stays in effect.
    }
    return current;
  })();
  return refresh;
}

/**
 * Adopts the catalog gxserver pushed (`agentModelCatalogChanged`). It is the
 * same published file, fetched by the server on its own timer, so it only
 * replaces an older lineup: a server whose last fetch predates this client's
 * never rolls it back.
 */
export function adoptPublishedAgentModelCatalog(value: unknown): void {
  const pushed = parseAgentModelCatalog(value);
  if (pushed === null) {
    return;
  }
  adoptRemoteCatalog(newerAgentModelCatalog(current, pushed));
}

/** Test seam: installs a catalog as the current one without any fetch. */
export function setAgentModelCatalogForTests(catalog: AgentModelCatalog | null): void {
  refresh = null;
  refreshStartedAt = 0;
  replaceCatalog(catalog ?? bundledCatalog);
}
