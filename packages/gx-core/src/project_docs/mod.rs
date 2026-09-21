//! The two client-owned documents the project moves write, and the ordering rule they share.
//!
//! `collections` and `spaces` are the documents and their guard policies; `collection_edits` and
//! `space_edits` are the functions the moves apply to them; `worktree_order` is the nesting rule,
//! which the sidebar list and the project drag must agree on and which therefore has one
//! implementation rather than one each.

mod collection_edits;
mod collections;
mod space_edits;
mod spaces;
mod worktree_order;

pub use collection_edits::{
    create_collection, move_projects_to_collection, reorder_collection_projects,
};
pub use collections::{
    collections_hand_back_script, collections_request_script, CollectionsDocument,
    COLLECTIONS_HAND_OFF_MESSAGE_TYPE, COLLECTIONS_SCRIPT_PLACEHOLDER, COLLECTIONS_SYNC_DELAY_MS,
    COLLECTIONS_SYNC_RETRY_DELAY_MS,
};
pub use space_edits::{
    apply_space_row_reorder, move_members_to_space, reorder_spaces, toggle_space_member,
    SpaceMemberKind,
};
pub use spaces::{
    spaces_hand_back_script, SpacesDocument, SPACES_HAND_OFF_MESSAGE_TYPE,
    SPACES_SCRIPT_PLACEHOLDER, SPACES_SYNC_DELAY_MS, SPACES_SYNC_RETRY_DELAY_MS,
};
pub use worktree_order::{
    can_drop_project_with_worktrees, move_projects_with_worktrees, order_projects_with_worktrees,
    DropPosition, ProjectOrderItem,
};
