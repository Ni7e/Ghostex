//! Family f's two frame channels: the minimap rail and the subagent viewer's own transcript.
//!
//! Both ride beside the main transcript so opening the subagent viewer never redraws the main
//! list. Both are also the two channels the desktop host can drop today
//! (`docs/2026-09-21/rust-chat/SEAM.md` section 5, item 1): the Rust host must include them in its
//! change gate.

use crate::document::{MinimapMarker, TranscriptItem};
use crate::state::{ChatContext, ChatState};

/// The minimap rail, shipped whole and only when it changed.
pub fn markers(state: &ChatState, _context: &ChatContext) -> Vec<MinimapMarker> {
    let _ = state;
    Vec::new()
}

/// The open subagent's transcript, on its own channel.
pub fn subagent_rows(state: &ChatState, _context: &ChatContext) -> Vec<TranscriptItem> {
    let _ = state;
    Vec::new()
}
