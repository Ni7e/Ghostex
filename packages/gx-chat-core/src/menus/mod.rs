//! Family e: menus and pickers. The model picker, the option pills and their menus, accounts,
//! context details and the fork branch picker.
//!
//! This directory is family e's alone. It owns `ChatState::menus` and the document keys listed for
//! family e in `docs/2026-09-21/rust-chat/FAMILIES.md`.

pub mod actions;
pub mod document;

pub use crate::menus::actions::handle;
pub use crate::menus::document::document;
