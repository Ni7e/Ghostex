//! Family e: menus and pickers. The model picker, the option pills and their menus, accounts,
//! context details and the fork branch picker.
//!
//! This directory is family e's alone. It owns `ChatState::menus` and the document keys listed for
//! family e in `docs/2026-09-21/rust-chat/FAMILIES.md`.
//!
//! Family e is split in two: e1 owns this directory (session options, option pills, option menus,
//! option state and dispatch, accounts and the account switch, native controls, chat settings) and
//! e2 owns the two subdirectories `picker/` (model picker, model menu, model selection, model
//! favorites, fork branches) and `context/` (context meter, editor and details). `document.rs` and
//! `actions.rs` here call into both, so neither half edits the other's files.

pub mod actions;
pub mod context;
pub mod document;
pub mod picker;

pub use crate::menus::actions::handle;
pub use crate::menus::document::document;
