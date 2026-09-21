//! Family b's rows: the list the renderer walks, and the details of the rows it draws open.
//!
//! The producer these replace is `projectChatTranscript` plus `NativeChatPresentation.update`
//! (`packages/shared/session-chat-controller/native-presentation.ts`). Its three caches are load
//! bearing (`docs/2026-09-21/rust-chat/SEAM.md` section 2c) and the port must keep them.

use crate::document::{RowDetails, TranscriptItem};
use crate::state::{ChatContext, ChatState};

/// The whole transcript list, from which family a computes the splice against what the host last
/// saw.
///
/// The input is `ChatState::messages.composed`, which family a builds: the authoritative rows plus
/// markers, terminal statuses, the streaming bubble and the pending echoes, in that order.
pub fn rows(state: &ChatState, _context: &ChatContext) -> Vec<TranscriptItem> {
    let _ = state;
    Vec::new()
}

/// Details for the rows the renderer currently draws open, keyed by its own row key.
///
/// The open set is reported by `Event::Measured(Measurement::OpenRowDetails)`, so only the rows on
/// screen ever build their diff lines or tool output.
pub fn row_details(state: &ChatState, _context: &ChatContext) -> RowDetails {
    let _ = state;
    RowDetails::new()
}
