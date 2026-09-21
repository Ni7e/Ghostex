//! Family a: the wire fold, the merge, pagination, the pending echoes, persistence, and the
//! controller core.
//!
//! This directory is family a's alone. It owns `ChatState::identity`, `ChatState::session`,
//! `ChatState::messages`, `ChatState::pending` and `ChatState::core`, and it publishes the
//! document keys listed for family a in `docs/2026-09-21/rust-chat/FAMILIES.md`.

pub mod actions;
pub mod document;

pub use crate::session::actions::handle;
pub use crate::session::document::document;
