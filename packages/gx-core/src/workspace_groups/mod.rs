//! The workspace session groups document and the guard that keeps it from oscillating.
//!
//! This is the ORDER-WRITE family, not the action family: nothing here calls the daemon in the
//! moment. A move edits a document the client owns, writes client storage, and schedules a
//! debounced write-through; the daemon's echo of that document is what has to be refused while the
//! write-through is outstanding. `document` is the shape and its parse, `edits` the moves that
//! change it, `sync` is the guard.

mod document;
mod edits;
mod sync;

pub use document::{ProjectWorkspaceGroups, WorkspaceGroupsDocument, WorkspaceSubgroup};
pub use edits::WORKSPACE_SESSION_GROUP_MAX_COUNT;
pub use sync::{
    AdoptOutcome, WorkspaceGroupsEffect, WorkspaceGroupsSync, WORKSPACE_GROUPS_SYNC_DELAY_MS,
    WORKSPACE_GROUPS_SYNC_RETRY_DELAY_MS,
};
