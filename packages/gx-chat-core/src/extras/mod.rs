//! Family f: the extras. The minimap, transcript search, the subagent viewer, the agent fleet and
//! task panels, the working strip, the terminal tail, the empty state and Save to Markdown.
//!
//! This directory is family f's alone. It owns `ChatState::extras` and the document keys listed
//! for family f in `docs/2026-09-21/rust-chat/FAMILIES.md`.

pub mod actions;
pub mod document;
pub mod minimap;

pub use crate::extras::actions::handle;
pub use crate::extras::document::document;
pub use crate::extras::minimap::{markers, subagent_rows};
