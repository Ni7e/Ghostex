import { storageScope } from '@/packages/client-storage';
import { GPUI_REMOTE_LAST_SEEN_PRESENTATIONS_STORAGE_KEY } from '../constants';
import { isPresentationSnapshot } from './remote-presentation';
import type { GxserverPresentationSnapshot } from '@/packages/shared/gxserver-protocol';

const clientStorage = storageScope(["remotePresentations"]);

const machineKeyPrefix = `${GPUI_REMOTE_LAST_SEEN_PRESENTATIONS_STORAGE_KEY}:machine:`;

/**
 * CDXC:RemoteMachines 2026-09-11 WHY:
 * Persist sanitized last-seen sidebar snapshots per machine so one remote update does not serialize every machine or overwrite another window's unrelated snapshots.
 * Discover stored machines only at startup; migration only fills missing keys so an older legacy copy cannot replace a newer per-machine snapshot.
 */
export class GpuiRemoteLastSeenStore {
  /*
  CDXC:RemoteMachines 2026-09-25 WHY:
  Read only. Rust is the one writer of these keys
  (apps/desktop/src/app/gx_store/remote_last_seen.rs); a legacy single-key
  copy is still read here but no longer migrated.
  */
  read(): Map<string, GxserverPresentationSnapshot> {
    const next = new Map<string, GxserverPresentationSnapshot>();
    try {
      const legacy = clientStorage.getItem(GPUI_REMOTE_LAST_SEEN_PRESENTATIONS_STORAGE_KEY);
      if (legacy !== null) {
        try {
          const raw: unknown = JSON.parse(legacy);
          if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
            for (const [machineId, snapshot] of Object.entries(raw)) {
              if (machineId.trim() && isPresentationSnapshot(snapshot)) {
                next.set(machineId, snapshot);
              }
            }
          }
        } catch {
          // A malformed legacy entry must not hide valid per-machine entries.
        }
      }
      for (let index = 0; index < clientStorage.length; index += 1) {
        const key = clientStorage.key(index);
        if (!key?.startsWith(machineKeyPrefix)) continue;
        try {
          const machineId = decodeURIComponent(key.slice(machineKeyPrefix.length));
          const snapshot: unknown = JSON.parse(clientStorage.getItem(key) ?? 'null');
          if (machineId.trim() && isPresentationSnapshot(snapshot)) {
            next.set(machineId, snapshot);
          }
        } catch {
          // One malformed machine must not discard the other offline snapshots.
        }
      }
    } catch {
      // Storage can be unavailable during early CEF bootstrap.
    }
    return next;
  }
}
