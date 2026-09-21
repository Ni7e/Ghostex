/**
 * The page's `local` collections adopt, frozen on 2026-09-21, the day it was deleted.
 *
 * **What this costs, said out loud.** `NativeSidebarMetadata.adoptCollections` used to adopt the
 * daemon's echo of THIS COMPUTER's project collections document, and that was the defect: the app's
 * pending-push guard is the only thing that knows whether a local edit is still on its way, so a
 * page that adopted the same echo put a document the guard had REFUSED back into the copy its next
 * edit is computed from. The `local` leg is gone from the page (`metadata.ts`), and only a remote
 * machine, which the page still owns outright, is adopted there.
 *
 * The gate still needs a reference for the empty-echo rule and the monotonic counter, so the leg is
 * copied here VERBATIM, exactly as `workspace-groups-typescript.ts` froze K4's four functions when
 * they were deleted. What a clean run then proves is that Rust still matches the behaviour the app
 * had on 2026-09-21, not that it matches the app: nothing in the product runs this code any more.
 *
 * The other half of K5's guard is NOT frozen and is still driven live: the pending flag and the
 * forward suppression are `queueSidebarProjectCollectionsServerSync` and
 * `forwardSidebarProjectCollectionsFromGxserver` in `gxserver-runtime/workspace-groups-sync.ts`,
 * which the runtime still has. Driving the page alone is the harness bug this gate found on its
 * first run.
 */
import {
  parseSidebarProjectCollectionsFromGxserver,
  serializeSidebarProjectCollectionsForGxserver,
  type SidebarProjectCollectionsState,
} from '@/packages/core-ui/project-collections';

/** What the deleted class field held: one document per machine, plus which ones have been adopted. */
export type FrozenCollectionsHolder = {
  collections: Record<string, SidebarProjectCollectionsState>;
  adopted: Set<string>;
};

export function createFrozenCollectionsHolder(local: SidebarProjectCollectionsState): FrozenCollectionsHolder {
  return { collections: { local }, adopted: new Set<string>() };
}

/** `NativeSidebarMetadata.adoptCollections`, verbatim, with the class fields as arguments. */
export function frozenAdoptCollections(
  holder: FrozenCollectionsHolder,
  id: string,
  value: unknown,
  post: (message: { type: 'updateSidebarProjectCollections'; state: unknown }) => void
): void {
  const parsed = parseSidebarProjectCollectionsFromGxserver(value);
  if (!parsed) return;
  const previous = holder.collections[id];
  const firstAdoption = !holder.adopted.has(id);
  holder.adopted.add(id);
  if (firstAdoption && id === 'local' && !parsed.collections.length && previous?.collections.length) {
    post({ type: 'updateSidebarProjectCollections', state: serializeSidebarProjectCollectionsForGxserver(previous) });
    return;
  }
  holder.collections[id] = {
    ...parsed,
    nextCollectionNumber: Math.max(parsed.nextCollectionNumber, previous?.nextCollectionNumber ?? 1),
  };
}
