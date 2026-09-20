//! The pending-push guard: why a local move does not jump back and then forward.
//!
//! CDXC:Sessions 2026-09-21 WHY:
//! The workspace session groups document is edited locally and pushed to gxserver as a DEBOUNCED
//! write-through, so between the edit and the push there is a window in which the daemon still
//! holds the old document and can echo it. Applying that echo is the oscillation the user sees as a
//! row jumping back and then forward: the local move lands, the stale echo undoes it, the push
//! lands, the daemon's next echo redoes it. The guard is one flag, and it is the whole feature:
//! while a push is outstanding or has failed, an echo is IGNORED rather than merged, because the
//! local document is newer by construction and the server's is the copy that is behind.
//!
//! **The pending flag is cleared by REVISION, not by identity.** The TypeScript captures the
//! document by reference and clears the flag only if `this.workspaceGroups === pushed`, which is
//! the object-identity way of asking "did anything change while that push was in flight". A port
//! that compared `Arc` addresses would be the fourth pointer-identity key this port has rejected,
//! and it would also be wrong the moment a document is rebuilt with equal contents. Every edit
//! bumps a counter instead, the push carries the counter it left with, and the answer that clears
//! the flag is `pushed_revision == revision`.
//!
//! **A failed push retries for ever, and keeps the flag up while it does.** That is deliberate in
//! the TypeScript and preserved here: a document that cannot reach the server is still the newest
//! one, so an echo must not be allowed to overwrite it just because the network is down.
//!
//! **Two echoes are not ignored, even when nothing is pending.** An echo equal to what is already
//! held does nothing at all (no storage write, no redraw), and an EMPTY server document with a
//! non-empty local one schedules a push instead of adopting, because adopting it would delete every
//! group the user has. That second one is why "ignore the echo while pending" is not the whole
//! rule: the empty case is how a fresh server learns the client's document.
//!
//! SEE-ALSO: apps/desktop/sidebar/gxserver-runtime/workspace-groups-sync.ts
//! (`persistWorkspaceGroups`, `scheduleWorkspaceGroupsServerSync`, `pushWorkspaceGroupsToGxserver`,
//! `adoptWorkspaceGroupsFromGxserver`), packages/gx-core/src/workspace_groups/document.rs.

use serde_json::Value;

use super::document::WorkspaceGroupsDocument;

/// `GPUI_WORKSPACE_GROUPS_SERVER_SYNC_DELAY_MS`.
pub const WORKSPACE_GROUPS_SYNC_DELAY_MS: u64 = 400;
/// `GPUI_WORKSPACE_GROUPS_SERVER_SYNC_RETRY_DELAY_MS`.
pub const WORKSPACE_GROUPS_SYNC_RETRY_DELAY_MS: u64 = 5_000;

/// What the host must do after a call into the guard. Every one of these is an edge the core
/// cannot have: a clock, a client-storage write, a socket.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum WorkspaceGroupsEffect {
    /// Write the document to the stored key, or REMOVE the key when the document is empty, which is
    /// what `writeStoredGpuiWorkspaceSessionGroupsState` does with an empty state.
    WriteStorage { document: Value, remove: bool },
    /// Book the push for this many milliseconds from now, replacing any booking already made.
    SchedulePush { delay_ms: u64 },
}

/// What an echo from the daemon did.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum AdoptOutcome {
    /// A push is outstanding, so the local document is newer and the echo is dropped. This is the
    /// case the whole guard exists for.
    IgnoredPending,
    /// The echo says what is already held.
    IgnoredEqual,
    /// The server has nothing and the client has something, so the client's is pushed up rather
    /// than the client's being erased.
    ScheduledPush,
    /// The server's document is newer and is taken.
    Adopted,
}

/// The document plus everything needed to decide whether an echo may be applied.
#[derive(Clone, Debug, Default)]
pub struct WorkspaceGroupsSync {
    document: WorkspaceGroupsDocument,
    /// Bumped by every local edit. The push carries the value it left with.
    revision: u64,
    /// A push is booked, in flight, or has failed and is waiting to be retried.
    pending: bool,
    /// Whether a push is already booked, which is the TypeScript's `timeoutId !== undefined`: a
    /// failed push re-books only when nothing else has.
    booked: bool,
}

impl WorkspaceGroupsSync {
    pub fn document(&self) -> &WorkspaceGroupsDocument {
        &self.document
    }

    pub fn revision(&self) -> u64 {
        self.revision
    }

    pub fn is_pending(&self) -> bool {
        self.pending
    }

    /// Whether a push is booked. The host fires its timer and calls `push_started`; a probe has to
    /// ask first, because firing a timer nobody booked is not a thing that can happen in the app
    /// and the TypeScript's `clearTimeout`/`undefined` pair says so.
    pub fn is_booked(&self) -> bool {
        self.booked
    }

    /// The state read from the stored key at startup. Not an edit: it neither bumps the revision
    /// nor schedules a push, because nothing has changed that the server does not have.
    pub fn restore(&mut self, document: WorkspaceGroupsDocument) {
        self.document = document;
    }

    /// A local edit. `persistWorkspaceGroups`: write the key, then book the debounced push.
    ///
    /// The booking REPLACES an earlier one, so a drag that moves a row five times pushes once, 400
    /// ms after the last move rather than five times.
    pub fn edit(&mut self, document: WorkspaceGroupsDocument) -> Vec<WorkspaceGroupsEffect> {
        let remove = document.is_empty();
        let json = document.to_json();
        self.document = document;
        self.revision = self.revision.saturating_add(1);
        self.pending = true;
        self.booked = true;
        vec![
            WorkspaceGroupsEffect::WriteStorage {
                document: json,
                remove,
            },
            WorkspaceGroupsEffect::SchedulePush {
                delay_ms: WORKSPACE_GROUPS_SYNC_DELAY_MS,
            },
        ]
    }

    /// The booked push is running now. What comes back is the document to send and the revision to
    /// hand to `push_finished`, which is what makes the flag safe to clear.
    pub fn push_started(&mut self) -> (Value, u64) {
        self.booked = false;
        (self.document.to_json(), self.revision)
    }

    /// The push came home. `ok` false is any failure at all, including a timeout: the TypeScript's
    /// `catch` does not distinguish them and neither does this.
    ///
    /// A success clears the flag ONLY if nothing was edited while the call was in flight, which is
    /// what `this.workspaceGroups === pushed` asks. A failure leaves the flag up and re-books,
    /// unless something else already has.
    pub fn push_finished(&mut self, revision: u64, ok: bool) -> Vec<WorkspaceGroupsEffect> {
        if ok {
            if revision == self.revision {
                self.pending = false;
            }
            return Vec::new();
        }
        if self.booked || !self.pending {
            return Vec::new();
        }
        self.booked = true;
        vec![WorkspaceGroupsEffect::SchedulePush {
            delay_ms: WORKSPACE_GROUPS_SYNC_RETRY_DELAY_MS,
        }]
    }

    /// An echo from the daemon. `None` is the `serverState === undefined` case, which is not an
    /// echo at all and is ignored before the guard is even asked.
    pub fn adopt(
        &mut self,
        server_state: Option<&Value>,
    ) -> (AdoptOutcome, Vec<WorkspaceGroupsEffect>) {
        let Some(server_state) = server_state else {
            return (AdoptOutcome::IgnoredPending, Vec::new());
        };
        if self.pending {
            return (AdoptOutcome::IgnoredPending, Vec::new());
        }
        let parsed = WorkspaceGroupsDocument::parse(server_state);
        if parsed.is_empty() {
            if self.document.is_empty() {
                return (AdoptOutcome::IgnoredEqual, Vec::new());
            }
            // The server has nothing and the user has groups: push, never adopt. Adopting here
            // would delete every group the user has because a server that has not been written yet
            // looks exactly like a server that was emptied.
            self.pending = true;
            self.booked = true;
            return (
                AdoptOutcome::ScheduledPush,
                vec![WorkspaceGroupsEffect::SchedulePush {
                    delay_ms: WORKSPACE_GROUPS_SYNC_DELAY_MS,
                }],
            );
        }
        if parsed == self.document {
            return (AdoptOutcome::IgnoredEqual, Vec::new());
        }
        let json = parsed.to_json();
        self.document = parsed;
        // NOT a revision bump: this document came FROM the server, so there is nothing to push
        // back and bumping would make the next push's success fail to clear its own flag.
        (
            AdoptOutcome::Adopted,
            vec![WorkspaceGroupsEffect::WriteStorage {
                document: json,
                remove: false,
            }],
        )
    }
}
