//! Family d's part of the document: the queue, the draft, the composer chrome, suggestions,
//! references, the note and the host-action menu.

use crate::document::Document;
use crate::state::{ChatContext, ChatState};

/// Writes family d's keys into `into`.
///
/// `queue.capabilities.supported` stays false until family a has folded a `queue` field, even an
/// empty one: that presence is the daemon capability probe, and every control hides rather than
/// calling an endpoint that would answer 404.
pub fn document(state: &ChatState, _context: &ChatContext, into: &mut Document) {
    into.draft.client_id = state.identity.client_id.clone();
}
