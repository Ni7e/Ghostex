//! Family a's part of the document: the session facts, the transcript's readiness, and the
//! pagination cursor.
//!
//! It runs first in [`crate::document::assemble`], so it may write any key it owns; the other five
//! families then write theirs over a document that already has this one's.

use ghostex_gx_protocol::Tri;

use crate::document::Document;
use crate::state::{ChatContext, ChatState};

/// Writes family a's keys into `into`.
pub fn document(state: &ChatState, _context: &ChatContext, into: &mut Document) {
    let session = &state.session;
    into.status = session.server_status.as_str().to_string();
    into.error = tri_string(session.error.clone());
    into.lifecycle = match &session.lifecycle {
        Some(lifecycle) => serde_json::to_value(lifecycle)
            .map(Tri::Value)
            .unwrap_or(Tri::Null),
        None => Tri::Null,
    };
    into.agent = tri_string(session.agent.clone());
    into.agent_session_id = tri_string(session.agent_session_id.clone());
    into.session_agent_id = tri_string(session.session_agent_id.clone());
    into.screen_probed = session.screen_probed;
    into.retired_async_question_ids = Tri::Value(session.retired_async_question_ids.clone());
    into.has_more = state.messages.has_more;
    into.earlier_page_cursor = state.messages.before_offset as i64;
    into.loading_earlier = state.messages.loading_earlier;
    into.operation_error = tri_string(state.core.operation_error.clone());
    into.operation_error_code = state.core.operation_error_code.clone();
    into.preview_settings = state
        .core
        .preview_settings
        .as_ref()
        .and_then(|value| serde_json::from_value(value.clone()).ok());
}

/// `None` is a key present with `null`, which is what the TypeScript producer writes for every one
/// of these.
fn tri_string(value: Option<String>) -> Tri<String> {
    match value {
        Some(value) => Tri::Value(value),
        None => Tri::Null,
    }
}
