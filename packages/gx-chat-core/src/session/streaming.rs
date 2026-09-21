//! The synthetic streaming bubble, and how a send is classified.
//!
//! Ported from `packages/core-ui/chat/session-chat-streaming.ts` and
//! `session-chat-send-classification.ts`.

use ghostex_gx_protocol::{ChatBlock, ChatMessage, ChatRole, ChatSource};

use crate::session::constants::STREAMING_ID;
use crate::session::text::is_js_space;

fn assistant_text(message: Option<&ChatMessage>) -> String {
    let Some(message) = message.filter(|message| matches!(message.role, ChatRole::Assistant))
    else {
        return String::new();
    };
    message
        .blocks
        .iter()
        .filter_map(|block| match block {
            ChatBlock::Text { text } => Some(text.as_str()),
            _ => None,
        })
        .collect::<String>()
        .trim_matches(is_js_space)
        .to_string()
}

/// Show the hook's assistant preview as a synthetic bubble only while it LEADS the transcript
/// (strictly longer and not a substring of the last assistant turn), and only while working. A
/// stale preview from a finished turn never shows.
pub fn derive_streaming_text(
    messages: &[ChatMessage],
    preview_text: Option<&str>,
    working: bool,
) -> Option<String> {
    if !working {
        return None;
    }
    let text = preview_text?.trim_matches(is_js_space);
    if text.is_empty() {
        return None;
    }
    let last = assistant_text(messages.last());
    if last.contains(text) || text.chars().count() <= last.chars().count() {
        return None;
    }
    Some(text.to_string())
}

/// The bubble itself.
pub fn streaming_message(text: &str) -> ChatMessage {
    ChatMessage {
        id: STREAMING_ID.to_string(),
        role: ChatRole::Assistant,
        blocks: vec![ChatBlock::Text {
            text: text.to_string(),
        }],
        async_questions: None,
        timestamp: None,
        source: ChatSource::Hook,
        turn_id: None,
        byte_offset: None,
        queued: false,
        deferred_work: None,
        startup_delivery: None,
    }
}

/// How a composer send is treated.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum SendClassification {
    /// Ordinary prose: it gets an optimistic echo.
    Chat,
    /// A catalog slash command: it gets a "Ran /x" marker and no echo.
    Command,
    /// A `!` shell line.
    LocalCommand,
    /// A `/token` or `$token` the catalog does not know: sent as is, no echo, no marker.
    UnknownToken,
}

/// `classifySessionChatSend`.
///
/// The first token is NOT trimmed: a leading space means prose, because the agent TUIs only treat
/// LINE-LEADING tokens as commands.
pub fn classify_send(
    draft: &str,
    catalog_command_names: &[String],
    skill_prefix: Option<&str>,
) -> SendClassification {
    let first_token = draft.split(is_js_space).next().unwrap_or_default();
    if catalog_command_names
        .iter()
        .any(|name| first_token == format!("/{name}"))
    {
        return SendClassification::Command;
    }
    if first_token.starts_with('/') {
        return SendClassification::UnknownToken;
    }
    if first_token.starts_with('!') {
        return SendClassification::LocalCommand;
    }
    if skill_prefix == Some("$") && first_token.starts_with('$') {
        // `$` is Codex grammar only; elsewhere `$PATH` is prose.
        return SendClassification::UnknownToken;
    }
    SendClassification::Chat
}
