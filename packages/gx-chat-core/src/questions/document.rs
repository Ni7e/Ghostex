//! Family c's part of the document: `prompt`, `terminalNotice`, `questionCard`, `asyncQuestions`
//! and the notice flags.

use crate::document::Document;
use crate::state::{ChatContext, ChatState};

/// Writes family c's keys into `into`.
///
/// `prompt` and `terminalNotice` are folded by family a with CLEARED-on-omission semantics; this
/// is where they are projected for drawing.
pub fn document(state: &ChatState, _context: &ChatContext, into: &mut Document) {
    let _ = (state, into);
}
