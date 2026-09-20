//! Drag and drop: the moves that write an order rather than call the daemon.
//!
//! Per-concern files: `inventory` is the list a move is computed against, which is the
//! PROJECTION's membership and not the drawn list; `session_move` is the `moveSession` payload,
//! which decides the set and the order and posts one of two messages; `order_write` is what those
//! messages do, which is either an edit of the workspace session groups document (under the
//! pending-push guard in `crate::workspace_groups`) or the daemon's own `/api/updateSessionOrder`.
//!
//! NOT HERE, and named rather than half-done: `moveGroup` (project reorder), `moveToSpace`,
//! `moveToCollection`, `moveCollection`, `moveSpace`, `projectMembership` and `spaceMembership`.
//! Every one of them writes the project-collections document or the Spaces document, each of which
//! is a separate client-owned document with its own debounced write-through and its own pending
//! flag, and the collections one also carries `nextCollectionNumber`, an in-memory monotonic
//! overlay the store does not model. Project reorder is not separable from them: `moveGroup` calls
//! `updateNativeProjectDropMembership`, so a project dragged into the middle of a collection JOINS
//! that collection in the same gesture, and a port that wrote only the project order would reorder
//! the row and silently drop it out of its folder.

mod inventory;
mod order_write;
mod session_move;

pub use order_write::{
    owns_order_write_message, plan_order_write, OrderWrite, OrderWritePlan,
    ORDER_WRITE_MESSAGE_TYPES,
};
pub use session_move::{owns_session_move_command, plan_session_move, SessionMovePlan};
