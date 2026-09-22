//! How the document is put together: one call per port family, in a fixed order.
//!
//! Family a runs first and writes the session facts every other family reads; the other five then
//! write their own keys over that. No family writes a key another one owns, so the six can be
//! ported in parallel and a replay can be gated on one family's keys alone
//! (`tooling/gx-chat-core/replay-diff.ts --keys`).
//!
//! The order below is not a dependency chain: every family reads [`crate::state::ChatState`], not
//! the half-built document. It is fixed only so two runs of the same state produce the same bytes.

use crate::document::{Document, MinimapMarker, RowDetails, TranscriptItem};
use crate::state::{ChatContext, ChatState};
use crate::{composer, extras, menus, questions, session, transcript};

/// The whole document for this state.
pub fn assemble(state: &ChatState, context: &ChatContext) -> Document {
    let mut document = Document::default();
    session::document(state, context, &mut document);
    transcript::document(state, context, &mut document);
    questions::document(state, context, &mut document);
    composer::document(state, context, &mut document);
    menus::document(state, context, &mut document);
    extras::document(state, context, &mut document);
    document
}

/// The parts of a frame that do not ride inside the document.
///
/// They are produced whole here; turning them into splices against what the host last saw is
/// family a's, in [`crate::ChatCore`].
#[derive(Clone, Debug, Default, PartialEq)]
pub struct FrameParts {
    /// The main transcript list. Family b.
    pub items: Vec<TranscriptItem>,
    /// The open subagent's transcript. Family f.
    pub subagent_items: Vec<TranscriptItem>,
    /// The minimap rail. Family f.
    pub minimap: Vec<MinimapMarker>,
    /// Details for the rows the renderer draws open. Family b.
    pub row_details: RowDetails,
    /// One identity per entry of `items`, compared beside the value when the splice is cut.
    ///
    /// `take` compares items by object identity, and a completed turn's item is a new object
    /// whenever its `deferred` is a new object with the same value
    /// ([`crate::state::MessagesState::deferred_objects`]); every other field is reused by value.
    /// Zero for an item with no such reference.
    pub item_identities: Vec<u64>,
}

/// Everything a frame carries beside the document.
pub fn frame_parts(state: &ChatState, context: &ChatContext) -> FrameParts {
    let items = transcript::rows(state, context);
    let item_identities = items
        .iter()
        .map(|item| match item {
            TranscriptItem::CompletedWork {
                id,
                deferred: Some(_),
                ..
            } => state
                .messages
                .deferred_objects
                .get(id)
                .copied()
                .unwrap_or_default(),
            _ => 0,
        })
        .collect();
    FrameParts {
        items,
        item_identities,
        subagent_items: extras::subagent_rows(state, context),
        minimap: extras::markers(state, context),
        row_details: transcript::row_details(state, context),
    }
}
