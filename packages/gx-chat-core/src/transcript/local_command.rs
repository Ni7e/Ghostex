//! The two rows one slash command renders as, and the escaped-markup contract around them.
//!
//! Ported from `packages/core-ui/chat/session-chat-local-command-transcript.ts`.

use ghostex_gx_protocol::{ChatBlock, ChatMessage, ChatRole, ChatSource};

/*
CDXC:SessionChat 2026-09-10 WHY:
The escaped-markup contract, one place for both halves of it. gxserver marks a harness marker whose
payload it escaped (Codex's `!` commands, and the slash commands it archives and replays in
session_chat_local_command.rs), because the reader strips markup out of these rows to find their
text and would otherwise eat a command or an output that contains `<…>`. The attribute string has to
match gxserver's `ESCAPED_MARKUP_ATTRIBUTE` byte for byte.
*/
pub const ESCAPED_MARKUP_ATTRIBUTE: &str = "data-ghostex-escaped=\"html\"";

const CODEX_LOCAL_COMMAND_INPUT: &str = "<bash-input data-ghostex-escaped=\"html\">";
const CODEX_LOCAL_COMMAND_OUTPUT: &str = "<bash-stdout data-ghostex-escaped=\"html\">";

pub fn decode_escaped_markup(text: &str) -> String {
    text.replace("&lt;", "<")
        .replace("&gt;", ">")
        .replace("&amp;", "&")
}

fn text_block(block: Option<&ChatBlock>) -> Option<&str> {
    match block {
        Some(ChatBlock::Text { text }) => Some(text),
        _ => None,
    }
}

/// Splits Codex's two-block local-command row into the command and its output, so each gets its own
/// marker. Identical text to the rows gxserver replays from its archive.
pub fn normalize_local_command_messages(messages: &[ChatMessage]) -> Vec<ChatMessage> {
    let mut normalized = Vec::with_capacity(messages.len());
    for message in messages {
        let command = text_block(message.blocks.first());
        let output = text_block(message.blocks.get(1));
        let splits = message.role == ChatRole::User
            && message.source == ChatSource::Transcript
            && message.blocks.len() == 2
            && command.is_some_and(|text| text.starts_with(CODEX_LOCAL_COMMAND_INPUT))
            && output.is_some_and(|text| text.starts_with(CODEX_LOCAL_COMMAND_OUTPUT));
        if !splits {
            normalized.push(message.clone());
            continue;
        }
        let mut first = message.clone();
        first.id = format!("{}:command", message.id);
        first.blocks = vec![message.blocks[0].clone()];
        let mut second = message.clone();
        second.id = format!("{}:output", message.id);
        second.blocks = vec![message.blocks[1].clone()];
        normalized.push(first);
        normalized.push(second);
    }
    normalized
}
