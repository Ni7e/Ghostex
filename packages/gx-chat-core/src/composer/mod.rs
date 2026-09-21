//! Family d: the composer. Drafts, the queue, submission, suggestions, references, attachments,
//! the session note and the keys.
//!
//! This directory is family d's alone. It owns `ChatState::composer` and the document keys listed
//! for family d in `docs/2026-09-21/rust-chat/FAMILIES.md`.

pub mod actions;
pub mod document;

pub use crate::composer::actions::handle;
pub use crate::composer::document::document;
