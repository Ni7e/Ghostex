/**
 * The gxserver runtime's LOCAL server-sync trio for the two project documents, frozen on
 * 2026-09-21, the day it was deleted.
 *
 * **What this costs, said out loud.** `queueSidebarProjectCollectionsServerSync` /
 * `pushSidebarProjectCollectionsToGxserver` / `forwardSidebarProjectCollectionsFromGxserver`, and
 * the identical Spaces trio, were the runtime's debounced write-through and its
 * forward-suppression for THIS COMPUTER's copies of the two documents. They stopped being reachable
 * when Rust became the only desktop writer of both (M4d part 2 blocker 3): nothing posts an
 * `updateSidebarProjectCollections` or `updateSidebarSpaces` message without a `remoteMachineId`
 * any more, and the page that used to adopt what the forward posted is deleted. Only the REMOTE
 * arms of those two message types are still live, and they are direct tunnel calls with no queue,
 * no debounce and no pending flag.
 *
 * The gates still need the reference, because the rule the trio expresses is exactly what the Rust
 * writer reimplements (`doc_sync::DocumentSync`, `gx_store/client_document.rs`): a push suppresses
 * the forward while it is outstanding, a failure re-books, and a forward whose JSON equals the last
 * one is dropped. So the trio is copied here VERBATIM, exactly as `workspace-groups-typescript.ts`
 * froze K4's four functions and `project-collections-typescript.ts` froze the page's adopt. What a
 * clean run then proves is that Rust still matches the behaviour the app shipped on 2026-09-21, not
 * that it matches the app: nothing in the product runs this code any more.
 *
 * The class is a plain object rather than a `GpuiSidebarRuntime` prototype because the methods are
 * gone from the runtime; the fields, the delays and the bodies are unchanged.
 */

/** The delays the runtime used, both documents, both the first push and the retry. */
export const FROZEN_PROJECT_DOCS_SYNC_DELAY_MS = 400;
export const FROZEN_PROJECT_DOCS_SYNC_RETRY_DELAY_MS = 5000;

type Json = Record<string, any>;

/** A minimal stand-in for the runtime's `client`, which is all the trio touched. */
type FrozenSyncClient = { update: (state: Json) => Promise<unknown> };

/** A minimal stand-in for the runtime's `messageSource`, which only the forward posts to. */
type FrozenMessageSource = { postMessage: (message: Json) => void };

/**
 * One document's half of the trio, with the runtime's four fields as instance state.
 *
 * `isState` is the runtime's `isSidebarProjectCollectionsState` / `isSidebarSpacesState` guard and
 * `messageType` its `sidebarProjectCollectionsChanged` / `sidebarSpacesChanged`, both passed in so
 * one frozen body serves both documents exactly as the two identical copies did.
 */
export class FrozenProjectDocServerSync {
  latestUpdate: Json | undefined;
  timeoutId: number | undefined;
  pending = false;
  lastForwardedJson: string | undefined;

  constructor(
    private readonly options: {
      client: FrozenSyncClient | undefined;
      messageSource: FrozenMessageSource;
      isState: (value: unknown) => boolean;
      messageType: string;
      stateKey: string;
    }
  ) {}

  /** `queueSidebar*ServerSync`, verbatim. */
  queue(state: Json): void {
    this.latestUpdate = state;
    this.pending = true;
    if (this.timeoutId !== undefined) {
      window.clearTimeout(this.timeoutId);
    }
    this.timeoutId = window.setTimeout(() => {
      this.timeoutId = undefined;
      void this.push();
    }, FROZEN_PROJECT_DOCS_SYNC_DELAY_MS);
  }

  /** `pushSidebar*ToGxserver`, verbatim. */
  async push(): Promise<void> {
    const client = this.options.client;
    const pushed = this.latestUpdate;
    if (!client || !pushed) {
      return;
    }
    try {
      const normalized = await client.update(pushed);
      if (this.latestUpdate === pushed) {
        this.pending = false;
        if (this.options.isState(normalized)) {
          this.forward(normalized as Json);
        }
      }
    } catch {
      // The shipped body also re-read `this.client === client`, which cannot change here because
      // the harness never swaps the client; it is kept so the body reads as the one that shipped.
      if (this.options.client === client && this.timeoutId === undefined && this.pending) {
        this.timeoutId = window.setTimeout(() => {
          this.timeoutId = undefined;
          void this.push();
        }, FROZEN_PROJECT_DOCS_SYNC_RETRY_DELAY_MS);
      }
    }
  }

  /** `forwardSidebar*FromGxserver`, verbatim. */
  forward(state: Json): void {
    if (this.pending) {
      return;
    }
    const stateJson = JSON.stringify(state);
    if (stateJson === this.lastForwardedJson) {
      return;
    }
    this.lastForwardedJson = stateJson;
    this.options.messageSource.postMessage({
      [this.options.stateKey]: state,
      type: this.options.messageType,
    });
  }
}
