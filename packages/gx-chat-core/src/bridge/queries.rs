//! The five pure helpers, answered as the bridge would answer them.
//!
//! Serialized straight from the typed answer, never through a [`Value`]: the renderer compares the
//! answer's TEXT (the replay fingerprints it, and `JSON.stringify` writes an object's keys in
//! insertion order), and a detour through `serde_json::Value` would re-order them.

use serde_json::Value;

use crate::bridge::call::BridgeQuery;
use crate::composer::keys::ComposerKeyEvent;
use crate::composer::queries::{
    composer_key_intent, composer_references, reference_menu, send_blocked_toast, transcript_menu,
};
use crate::state::{ChatContext, ChatState};

/// Answers one pure helper, serialized exactly as the bridge returns it.
///
/// `None` means the arguments were not the shape the helper takes, which is a refusal rather than
/// an empty answer.
pub fn answer_query(
    state: &ChatState,
    context: &ChatContext,
    query: BridgeQuery,
    arguments: &[Value],
) -> Option<String> {
    let first = arguments.first();
    Some(match query {
        BridgeQuery::ComposerReferences => {
            to_json(&composer_references(first.and_then(Value::as_str)?))
        }
        BridgeQuery::ComposerKeyIntent => {
            let event: ComposerKeyEvent = serde_json::from_value(first?.clone()).ok()?;
            let platform = arguments.get(1).and_then(Value::as_str);
            to_json(&composer_key_intent(&event, platform))
        }
        BridgeQuery::ReferenceMenu => to_json(&reference_menu(first.and_then(Value::as_str)?)),
        BridgeQuery::TranscriptMenu => {
            let request = first?;
            let href = request.get("href").and_then(Value::as_str);
            let selection = request
                .get("selection")
                .and_then(Value::as_str)
                .unwrap_or_default();
            let question_active = request.get("questionActive") == Some(&Value::Bool(true));
            to_json(&transcript_menu(href, selection, question_active))
        }
        BridgeQuery::SendBlockedToast => {
            // The renderer passes the reason it already has; when it passes none, the helper asks
            // the composer for the current one, which is what `sendBlockedToast()` does.
            let reason = match first.and_then(Value::as_str) {
                Some(reason) => reason.to_string(),
                None => crate::composer::document::send_blocked(state, context)?,
            };
            to_json(&send_blocked_toast(&reason))
        }
    })
}

fn to_json<T: serde::Serialize>(value: &T) -> String {
    serde_json::to_string(value).unwrap_or_else(|_| "null".to_string())
}
