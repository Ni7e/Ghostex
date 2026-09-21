import {
  parseSidebarSpacesFromGxserver,
  serializeSidebarSpacesForGxserver,
  applySidebarSpaceEditorResult,
  EMPTY_SIDEBAR_SPACES_STATE,
  type SidebarSpacesState,
} from '@/packages/core-ui/spaces';
import {
  readSidebarProjectCollections,
  parseSidebarProjectCollectionsFromGxserver,
  serializeSidebarProjectCollectionsForGxserver,
  type SidebarProjectCollectionsState,
} from '@/packages/core-ui/project-collections';
import type { ExtensionToSidebarMessage, SidebarToExtensionMessage } from '@/packages/shared/session-grid-contract';

export type SidebarPostMessage = (message: SidebarToExtensionMessage) => void;

/*
CDXC:Projects 2026-09-21 WHY:
The two documents THIS COMPUTER owns are adopted from the app and from nowhere else. The daemon's
echo reaches them through the app's pending-push guard
(apps/desktop/src/app/gx_store/client_document.rs), which is the only thing that knows whether a
push is outstanding; adopting the same echo here as well put a document the guard had just REFUSED
into this page's copy, where it became the base of the page's next edit and silently undid the
user's drag. So every `local` leg below is gone and only a remote machine, whose copies this page
still owns outright, is adopted here.
SEE-ALSO: apps/desktop/sidebar/gxserver-runtime/presentation-stream.ts,
packages/gx-core/src/doc_sync/sync.rs.
*/
export class NativeSidebarMetadata {
  spaces: Record<string, SidebarSpacesState | undefined> = {};
  collections: Record<string, SidebarProjectCollectionsState> = { local: readSidebarProjectCollections() };
  connections: Record<string, { state: string; message?: string }> = {};

  receive(message: ExtensionToSidebarMessage, post: SidebarPostMessage): void {
    switch (message.type) {
      case 'hydrate':
      case 'sessionState':
        if (message.type === 'hydrate' || message.remoteSidebarSpacesByMachineId !== undefined) {
          this.spaces = { local: this.spaces.local };
          for (const [id, value] of Object.entries(message.remoteSidebarSpacesByMachineId ?? {}))
            this.adoptSpaces(id, value);
        }
        if (message.type === 'hydrate' || message.remoteSidebarProjectCollectionsByMachineId !== undefined) {
          this.collections = { local: this.collections.local };
          for (const [id, value] of Object.entries(message.remoteSidebarProjectCollectionsByMachineId ?? {}))
            this.adoptCollections(id, value);
        }
        break;
      case 'sidebarSpacesChanged':
        if (message.remoteMachineId) this.adoptSpaces(message.remoteMachineId, message.sidebarSpaces);
        break;
      case 'sidebarProjectCollectionsChanged':
        if (message.remoteMachineId) this.adoptCollections(message.remoteMachineId, message.sidebarProjectCollections);
        break;
      case 'remoteMachineStatus':
        this.connections[message.machineId] = { state: message.state, message: message.message };
        break;
      case 'applySidebarSpaceEditorResult': {
        const id = message.remoteMachineId ?? 'local';
        const next = applySidebarSpaceEditorResult(this.spaces[id] ?? EMPTY_SIDEBAR_SPACES_STATE, message);
        this.updateSpaces(id, next, post);
        break;
      }
    }
  }

  /*
  CDXC:Spaces 2026-09-21 WHY:
  This page no longer pushes the Spaces document for THIS COMPUTER. It still edits it (the Space
  editor's result, and the membership items the Rust store does not own) and hands the result to the
  app, which is the single synchroniser and the one place the pending-push guard lives
  (apps/desktop/src/app/gx_store/project_docs.rs). `applySidebarSpaces` is the other half. A REMOTE
  machine is unchanged: `updateRemoteSidebarSpaces` is a direct call down that machine's tunnel,
  which the app cannot reach. The document still has no local key at all; gxserver owns it.
  SEE-ALSO: packages/gx-core/src/project_docs/spaces.rs.
  */
  updateSpaces(machineId: string, spaces: SidebarSpacesState, post: SidebarPostMessage): void {
    this.spaces[machineId] = spaces;
    if (machineId !== 'local') {
      post({
        type: 'updateSidebarSpaces',
        state: serializeSidebarSpacesForGxserver(spaces),
        remoteMachineId: machineId,
      });
      return;
    }
    window.webkit?.messageHandlers?.ghostexNativeHost?.postMessage({
      state: serializeSidebarSpacesForGxserver(spaces),
      type: 'persistSidebarSpaces',
    });
  }

  /** The held document, handed back by the app after every change. */
  applySpacesFromHost(state: unknown): void {
    const parsed = parseSidebarSpacesFromGxserver(state);
    if (parsed) this.spaces.local = parsed;
  }

  /** The held collections document, handed back by the app after every change. */
  applyCollectionsFromHost(state: unknown): void {
    const parsed = parseSidebarProjectCollectionsFromGxserver(state);
    if (!parsed) return;
    this.collections.local = parsed;
  }

  /**
   * Posts this page's copy of the collections document as an ordinary hand-off.
   *
   * Called by the app after it had to refuse one, where this copy is the only one carrying that
   * edit. The same message every other edit sends, so there is no second way for a document to
   * cross.
   */
  requestCollections(): void {
    postProjectCollectionsHandOff(this.collections.local);
  }

  private adoptSpaces(id: string, value: unknown): void {
    const parsed = parseSidebarSpacesFromGxserver(value);
    if (parsed) this.spaces[id] = parsed;
  }

  /**
   * A REMOTE machine's copy, which this page still owns: it pushes that document down the machine's
   * own tunnel, with no local key and no app-side guard.
   *
   * The empty push-back of `firstAdoption` went with the `local` leg, because the app makes that
   * decision now for the only machine it was ever made for (`EmptyEchoRule::PushBackFirstEcho`),
   * and a second copy of it here pushed a document the app's guard had not been asked about.
   */
  private adoptCollections(id: string, value: unknown): void {
    const parsed = parseSidebarProjectCollectionsFromGxserver(value);
    if (!parsed) return;
    const previous = this.collections[id];
    this.collections[id] = {
      ...parsed,
      nextCollectionNumber: Math.max(parsed.nextCollectionNumber, previous?.nextCollectionNumber ?? 1),
    };
    // NOT written to client storage: since 2026-09-21 the app is the only writer of that key, and
    // this copy exists only to feed the projection and the menus this page still draws.
  }
}

/** The one post that hands an edited collections document to the app. */
export function postProjectCollectionsHandOff(state: SidebarProjectCollectionsState): void {
  window.webkit?.messageHandlers?.ghostexNativeHost?.postMessage({
    state: serializeSidebarProjectCollectionsForGxserver(state),
    type: 'persistProjectCollections',
  });
}
