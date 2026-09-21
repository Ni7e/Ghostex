//! Family b's rows: the list the renderer walks, and the details of the rows it draws open.
//!
//! The producers these replace are `projectChatTranscript` plus `NativeChatPresentation.update`
//! (`packages/shared/session-chat-controller/native-presentation.ts`). Its three caches are load
//! bearing (`docs/2026-09-21/rust-chat/SEAM.md` section 2c) and the port keeps them; where they
//! live is described on [`crate::state::TranscriptViewState`].

use crate::document::{RowDetails, TranscriptItem};
use crate::state::{ChatContext, ChatState};
use crate::transcript::presentation;

/// The whole transcript list, from which family a computes the splice against what the host last
/// saw.
///
/// The input is `ChatState::messages.composed`, which family a builds: the authoritative rows plus
/// markers, terminal statuses, the streaming bubble and the pending echoes, in that order.
///
/// Pure, so it can be called from `frame_parts` with a shared borrow. [`refresh`] does the same work
/// once per turn and stores the answer, and this hands that back when it is current.
pub fn rows(state: &ChatState, context: &ChatContext) -> Vec<TranscriptItem> {
    if !state.transcript_view.items.is_empty() {
        return state.transcript_view.items.clone();
    }
    presentation::build(state, context).items
}

/// Details for the rows the renderer currently draws open, keyed by its own row key.
///
/// The open set is reported by `Event::Measured(Measurement::OpenRowDetails)`, so only the rows on
/// screen ever build their diff lines or tool output.
pub fn row_details(state: &ChatState, context: &ChatContext) -> RowDetails {
    let mut details = RowDetails::new();
    for open in &state.transcript_view.open_rows {
        if let Some(detail) =
            presentation::row_detail(state, context, &open.kind, &open.message_id, open.index)
        {
            details.insert(open.key.clone(), detail);
        }
    }
    details
}

/// Rebuilds the item list and the projection bookkeeping into the state.
///
/// Family a calls this once per turn, before `republish`. It is what makes the backfill observable:
/// a row that shipped as a placeholder is queued here, and the next [`advance`] projects a batch of
/// them so the following publish carries the whole row.
pub fn refresh(state: &mut ChatState, context: &ChatContext) {
    let projection = presentation::build(state, context);
    let view = &mut state.transcript_view;
    view.items = projection.items;
    view.final_ids = projection.final_ids;
    view.backfill = projection.backfill;
    state.transcript_view.row_details = row_details(state, context);
}

/// Projects the newest batch of queued placeholders.
///
/// Returns whether anything changed, which is what tells the host to publish again. The TypeScript
/// runs this on a 0 ms timer and takes the LAST `BACKFILL_BATCH` ids, newest first.
pub fn advance(state: &mut ChatState, context: &ChatContext) -> bool {
    if state.transcript_view.backfill.is_empty() {
        return false;
    }
    let view = &mut state.transcript_view;
    let batch_start = view
        .backfill
        .len()
        .saturating_sub(crate::state::BACKFILL_BATCH);
    let batch: Vec<String> = view.backfill.split_off(batch_start);
    let sources: Vec<_> = batch
        .iter()
        .filter_map(|id| {
            state
                .messages
                .composed
                .iter()
                .find(|message| message.id == *id)
                .cloned()
        })
        .collect();
    for message in sources {
        state
            .transcript_view
            .projected
            .insert(message.id.clone(), message);
    }
    state.transcript_view.backfill_revision += 1;
    refresh(state, context);
    true
}
