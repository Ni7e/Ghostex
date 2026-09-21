//! Family b: the transcript rows. Messages, tool grouping, diffs, file changes, markdown, row
//! details and the rewind sheet.
//!
//! This directory is family b's alone. It owns `ChatState::transcript_view` and the document keys
//! listed for family b in `docs/2026-09-21/rust-chat/FAMILIES.md`.

pub mod actions;
pub mod document;
pub mod rows;

pub use crate::transcript::actions::handle;
pub use crate::transcript::document::document;
pub use crate::transcript::rows::{row_details, rows};
