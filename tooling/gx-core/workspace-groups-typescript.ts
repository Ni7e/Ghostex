/**
 * The TypeScript half of the workspace-groups guard gate.
 *
 * Drives the SHIPPED `persistWorkspaceGroups`, `scheduleWorkspaceGroupsServerSync`,
 * `pushWorkspaceGroupsToGxserver` and `adoptWorkspaceGroupsFromGxserver` through the same event
 * scripts the Rust probe wrote, and records what is held after EVERY event. Nothing about the guard
 * is reimplemented here; three edges are replaced and each one is an edge rather than a decision:
 *
 * - `window.setTimeout` is a manual queue, so "the booked push runs now" is an event in the script
 *   instead of a 400 ms wait. The bulk pacing probe learned this the hard way: driving the real
 *   timer under the harness's window shim hung the gate before it printed a line.
 * - `client.updateWorkspaceSessionGroups` returns a promise the script resolves or rejects, which
 *   is what makes an echo DURING a push expressible at all.
 * - client storage is the harness's shim, so a write is counted rather than persisted.
 */
import { resetBrowserStorage } from './browser-shim';
import { GpuiSidebarRuntime } from '@/apps/desktop/sidebar/gxserver-runtime/core';
import {
  parseGpuiWorkspaceSessionGroupsState,
  readStoredGpuiWorkspaceSessionGroupsState,
} from '@/apps/desktop/sidebar/workspace-session-groups';

type Json = Record<string, any>;

/** One script, run against the shipped guard. */
export async function runTypeScriptWorkspaceGroupsCase(
  start: Json,
  script: string[],
  documents: Json[]
): Promise<Json[]> {
  resetBrowserStorage();
  const timers: (() => void)[] = [];
  const realSetTimeout = globalThis.window.setTimeout;
  const realClearTimeout = globalThis.window.clearTimeout;
  // A manual timer queue. The id is the index; clearing replaces the callback with a no-op, which
  // is what `clearTimeout` means for a booking that was replaced by a newer one.
  (globalThis.window as any).setTimeout = (fn: () => void) => {
    timers.push(fn);
    return timers.length;
  };
  (globalThis.window as any).clearTimeout = (id: number) => {
    if (typeof id === 'number' && id >= 1 && id <= timers.length) timers[id - 1] = () => {};
  };
  let writes = 0;
  const runtime = Object.create(GpuiSidebarRuntime.prototype) as Json;
  runtime.workspaceGroups = parseGpuiWorkspaceSessionGroupsState(start);
  runtime.workspaceGroupsServerSyncPending = false;
  runtime.workspaceGroupsServerSyncTimeoutId = undefined;
  let settle: ((ok: boolean) => void) | undefined;
  runtime.client = {
    updateWorkspaceSessionGroups: () =>
      new Promise<void>((resolve, reject) => {
        settle = (ok: boolean) => (ok ? resolve() : reject(new Error('offline')));
      }),
  };
  const steps: Json[] = [];
  try {
    for (const event of script) {
      switch (event) {
        case 'editA':
        case 'editB': {
          runtime.workspaceGroups = parseGpuiWorkspaceSessionGroupsState(documents[event === 'editA' ? 1 : 2]);
          writes += 1;
          runtime.persistWorkspaceGroups();
          break;
        }
        case 'echoNone':
          runtime.adoptWorkspaceGroupsFromGxserver(undefined);
          break;
        case 'echoEmpty':
          runtime.adoptWorkspaceGroupsFromGxserver({});
          break;
        case 'echoA':
          runtime.adoptWorkspaceGroupsFromGxserver(documents[1]);
          break;
        case 'echoB':
          runtime.adoptWorkspaceGroupsFromGxserver(documents[2]);
          break;
        case 'pushStart': {
          // Fire whichever booking is outstanding, which is what the real timer would do.
          const id = runtime.workspaceGroupsServerSyncTimeoutId;
          if (typeof id === 'number' && id >= 1 && id <= timers.length) {
            const fn = timers[id - 1];
            timers[id - 1] = () => {};
            fn();
          }
          await flush();
          break;
        }
        case 'pushOk':
        case 'pushFail': {
          settle?.(event === 'pushOk');
          settle = undefined;
          await flush();
          break;
        }
      }
      steps.push({
        event,
        document: runtime.workspaceGroups,
        pending: runtime.workspaceGroupsServerSyncPending === true,
      });
    }
  } finally {
    (globalThis.window as any).setTimeout = realSetTimeout;
    (globalThis.window as any).clearTimeout = realClearTimeout;
  }
  void writes;
  void readStoredGpuiWorkspaceSessionGroupsState;
  return steps;
}

/** Lets the promise chain inside `pushWorkspaceGroupsToGxserver` run to its `catch`. */
async function flush(): Promise<void> {
  for (let index = 0; index < 8; index += 1) await Promise.resolve();
}
