//! Family b's part of the document: the transcript modes, the per-turn deferred work, the rewind
//! sheet and the saved-prompt marks.

use crate::document::Document;
use crate::state::{ChatContext, ChatState};

/// Writes family b's keys into `into`.
///
/// Family b fills this from `native-presentation.ts` and `native-message-actions.ts`. Until then
/// every key keeps the default the contract defines, which is what the TypeScript publishes for an
/// empty transcript.
pub fn document(state: &ChatState, _context: &ChatContext, into: &mut Document) {
    into.summary_mode = state.transcript_view.summary_mode;
    into.verbose_override = state.transcript_view.verbose_override;
}
