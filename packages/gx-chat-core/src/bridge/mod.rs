//! The QuickJS bridge's own traffic, fed into a [`crate::ChatCore`].
//!
//! `globalThis.nativeChat` is the single seam between the chat brain and everything else
//! (`docs/2026-09-21/rust-chat/SEAM.md`). Two readers of that traffic exist and they must agree:
//! `examples/replay.rs`, which feeds a recording back, and the desktop host running the Rust core
//! in SHADOW beside the live QuickJS brain. So the translation lives here rather than in either.
//!
//! The API is in `docs/2026-09-21/rust-chat/REPLAY.md` under "Shadow mode API".

mod call;
mod compare;
mod queries;
mod record;
mod translate;

pub use crate::bridge::call::{BridgeCall, BridgeQuery};
pub use crate::bridge::compare::{comparable_document, comparable_value, EXCLUDED_POINTERS};
pub use crate::bridge::queries::answer_query;
pub use crate::bridge::record::recorded_context;
pub use crate::bridge::translate::{context_preferences_events, BridgeOutcome, BridgeTranslator};
