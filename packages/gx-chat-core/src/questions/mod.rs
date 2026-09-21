//! Family c: questions, approvals and notices. The blocking question card, the async question
//! strip a working agent collects answers in, and the dismissible notices.
//!
//! This directory is family c's alone. It owns `ChatState::questions` and the document keys listed
//! for family c in `docs/2026-09-21/rust-chat/FAMILIES.md`.

pub mod actions;
pub mod document;

pub use crate::questions::actions::handle;
pub use crate::questions::document::document;
