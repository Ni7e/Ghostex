import {
  parseSidebarSpacesFromGxserver,
  serializeSidebarSpacesForGxserver,
  applySidebarSpaceEditorResult,
  EMPTY_SIDEBAR_SPACES_STATE,
  type SidebarSpacesState,
} from '@/packages/core-ui/spaces';
import {
  readSidebarProjectCollections,
  writeSidebarProjectCollections,
  parseSidebarProjectCollectionsFromGxserver,
  serializeSidebarProjectCollectionsForGxserver,
  type SidebarProjectCollectionsState,
} from '@/packages/core-ui/project-collections';
import type { ExtensionToSidebarMessage, SidebarToExtensionMessage } from '@/packages/shared/session-grid-contract';

export type SidebarPostMessage = (message: SidebarToExtensionMessage) => void;

export class NativeSidebarMetadata {
  private adoptedCollections = new Set<string>();
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
        this.adoptSpaces('local', message.sidebarSpaces);
        if (message.type === 'hydrate' || message.remoteSidebarProjectCollectionsByMachineId !== undefined) {
          this.collections = { local: this.collections.local };
          for (const [id, value] of Object.entries(message.remoteSidebarProjectCollectionsByMachineId ?? {}))
            this.adoptCollections(id, value, post);
        }
        this.adoptCollections('local', message.sidebarProjectCollections, post);
        break;
      case 'sidebarSpacesChanged':
        this.adoptSpaces(message.remoteMachineId ?? 'local', message.sidebarSpaces);
        break;
      case 'sidebarProjectCollectionsChanged':
        this.adoptCollections(message.remoteMachineId ?? 'local', message.sidebarProjectCollections, post);
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

  updateSpaces(machineId: string, spaces: SidebarSpacesState, post: SidebarPostMessage): void {
    this.spaces[machineId] = spaces;
    post({
      type: 'updateSidebarSpaces',
      state: serializeSidebarSpacesForGxserver(spaces),
      ...(machineId !== 'local' ? { remoteMachineId: machineId } : {}),
    });
  }

  private adoptSpaces(id: string, value: unknown): void {
    const parsed = parseSidebarSpacesFromGxserver(value);
    if (parsed) this.spaces[id] = parsed;
  }

  private adoptCollections(id: string, value: unknown, post: SidebarPostMessage): void {
    const parsed = parseSidebarProjectCollectionsFromGxserver(value);
    if (!parsed) return;
    const previous = this.collections[id];
    const firstAdoption = !this.adoptedCollections.has(id);
    this.adoptedCollections.add(id);
    if (firstAdoption && id === 'local' && !parsed.collections.length && previous?.collections.length) {
      post({ type: 'updateSidebarProjectCollections', state: serializeSidebarProjectCollectionsForGxserver(previous) });
      return;
    }
    this.collections[id] = {
      ...parsed,
      nextCollectionNumber: Math.max(parsed.nextCollectionNumber, previous?.nextCollectionNumber ?? 1),
    };
    if (id === 'local') writeSidebarProjectCollections(this.collections[id]);
  }
}
