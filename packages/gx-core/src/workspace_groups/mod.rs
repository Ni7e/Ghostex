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

pub use crate::doc_sync::AdoptOutcome;
pub use document::{ProjectWorkspaceGroups, WorkspaceGroupsDocument, WorkspaceSubgroup};
pub use edits::WORKSPACE_SESSION_GROUP_MAX_COUNT;
pub use sync::{
    workspace_groups_hand_back_script, workspace_groups_request_script, WorkspaceGroupsEffect,
    WorkspaceGroupsSync, WORKSPACE_GROUPS_HAND_OFF_MESSAGE_TYPE,
    WORKSPACE_GROUPS_SCRIPT_PLACEHOLDER, WORKSPACE_GROUPS_SYNC_DELAY_MS,
    WORKSPACE_GROUPS_SYNC_RETRY_DELAY_MS,
};
