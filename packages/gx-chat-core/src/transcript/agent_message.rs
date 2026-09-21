//! The two headers another agent's message can arrive with.
//!
//! Ported from `packages/shared/session-chat-presentation/agent-message.ts`.

use crate::transcript::jsstr::{is_js_space, js_trim, split_newlines};

/// A `Message from <sender>` header and the body under it.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct AgentMessage {
    pub sender: String,
    pub body: String,
}

/// `^Message from (\S+)\n\n([\s\S]*)$`.
pub fn parse_agent_message(text: &str) -> Option<AgentMessage> {
    let rest = text.strip_prefix("Message from ")?;
    let sender_len: usize =
        rest.chars().take_while(|character| !is_js_space(*character)).map(char::len_utf8).sum();
    if sender_len == 0 || !rest[sender_len..].starts_with("\n\n") {
        return None;
    }
    Some(AgentMessage {
        sender: rest[..sender_len].to_string(),
        body: js_trim(&rest[sender_len + 2..]).to_string(),
    })
}

/// A message another Ghostex agent session sent with `ghostex agents send` or
/// `agents create --task`.
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct InterAgentMessage {
    pub agent_name: String,
    pub session_title: String,
    pub session_id: String,
    pub agent_id: String,
    pub agent_session_id: String,
    pub reply_to: String,
    pub body: String,
}

/// `^([A-Za-z ]+): (.*)$` against one line.
fn header_field(line: &str) -> Option<(&str, &str)> {
    let name_len = line.bytes().take_while(|byte| byte.is_ascii_alphabetic() || *byte == b' ').count();
    if name_len == 0 || !line[name_len..].starts_with(": ") {
        return None;
    }
    Some((&line[..name_len], &line[name_len + 2..]))
}

/// CDXC:SessionChat 2026-09-18 DECISION:
/// User: messages between agents render as a message from the sending agent, not as the user's own
/// prompt bubble, and the sender header must never show as a heading. Accepts the current header (a
/// blank line before the body) and the pre-2026-09-18 `MESSAGE FROM` header that ended in a dashed
/// line, so transcripts recorded before the format change render the same way.
/// SEE-ALSO: server/src/ghostex_cli/agents/identity.rs writes the header.
pub fn parse_inter_agent_message(text: &str) -> Option<InterAgentMessage> {
    let lines = split_newlines(text);
    let opener = js_trim(lines.first().copied().unwrap_or_default());
    if opener != "Message from another agent" && opener != "MESSAGE FROM" {
        return None;
    }
    let mut message = InterAgentMessage::default();
    let mut seen_agent_name = false;
    let mut seen_reply_to = false;
    let mut index = 1;
    while index < lines.len() {
        let Some((name, raw)) = header_field(lines[index]) else {
            break;
        };
        // The CLI writes `unavailable` for an identifier it could not resolve.
        let value = js_trim(raw);
        let value = if value == "unavailable" { "" } else { value };
        match name {
            "Agent" => {
                seen_agent_name = true;
                message.agent_name = value.to_string();
            }
            "Session" => message.session_title = value.to_string(),
            "Session ID" => message.session_id = value.to_string(),
            "Agent ID" => message.agent_id = value.to_string(),
            "Agent Session ID" => message.agent_session_id = value.to_string(),
            "Reply to" => {
                seen_reply_to = true;
                message.reply_to = value.to_string();
            }
            _ => break,
        }
        index += 1;
    }
    let separator = js_trim(lines.get(index).copied().unwrap_or_default());
    let dashed = separator.len() >= 3 && separator.bytes().all(|byte| byte == b'-');
    if !seen_agent_name || !seen_reply_to || (!separator.is_empty() && !dashed) {
        return None;
    }
    message.body = js_trim(&lines[(index + 1).min(lines.len())..].join("\n")).to_string();
    Some(message)
}

/// `/root/windows_support` is addressed as `windows_support` by the agents themselves.
pub fn agent_display_name(sender: &str) -> String {
    sender.split('/').filter(|segment| !segment.is_empty()).next_back().unwrap_or(sender).to_string()
}
