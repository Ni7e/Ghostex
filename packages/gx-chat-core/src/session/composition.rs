//! The composed list: the authoritative transcript plus everything that has no record yet.
//!
//! Ported from the `assembled` / `surfaced` / `boundaried` / `messages` chain of
//! `packages/shared/session-chat-controller/controller.ts`. Order matters and is the contract:
//! transcript, then terminal statuses, then app commands, then markers, then the streaming
//! bubble, then the pending tool row, then the pending echoes.

use ghostex_gx_protocol::{ChatBlock, ChatMessage, ChatRole, ChatSource};

use crate::session::assembler::{Assembler, Row};
use crate::session::markers::{
    apply_marker_boundaries, markers_as_messages, retire_interrupt_markers,
};
use crate::session::pending::{pending_sends_as_messages, visible_pending_sends};
use crate::session::startup_sends::pending_with_startup_sends;
use crate::session::streaming::{derive_streaming_text, streaming_message};
use crate::session::text::{collapse_whitespace, is_js_space, parse_command_envelope};
use crate::state::ChatState;

/// How many compactions the authoritative transcript records.
///
/// The rule lives in `packages/core-ui/chat/session-chat-noise.ts`, which family b ports: a
/// compaction record is a suppressed turn whose status label is "Context compacted" or "Compaction
/// completed". Until that classifier exists here the count is zero, which keeps every `/compact`
/// marker on screen rather than retiring one early. Family b replaces this body.
pub fn compaction_records(_messages: &[ChatMessage]) -> usize {
    0
}

fn text_of(message: &ChatMessage, separator: &str) -> String {
    message
        .blocks
        .iter()
        .filter_map(|block| match block {
            ChatBlock::Text { text } => Some(text.as_str()),
            _ => None,
        })
        .collect::<Vec<_>>()
        .join(separator)
}

/// The text two rows must share to be the same user turn, from `use-session-chat/state.ts`.
fn normalized_text(message: &ChatMessage) -> String {
    collapse_whitespace(&text_of(message, "\n\n"))
        .trim_matches(is_js_space)
        .to_string()
}

/// `surfaceSkillInvocationUserTurns`.
///
/// Claude-family harnesses record a slash input's user turn as a `<command-name>` envelope, hidden
/// by the noise filter, correctly, for most CATALOG commands, since a local command marker is
/// shown instead. But a skill invocation IS the user's chat turn, and `/compact`'s marker retires
/// when compaction finishes, so those durable transcript records must be converted back into
/// readable user turns.
pub fn surface_skill_invocation_user_turns(
    messages: &[ChatMessage],
    catalog_command_names: &[String],
) -> Vec<ChatMessage> {
    let mut changed = false;
    let mut out = Vec::with_capacity(messages.len());
    for message in messages {
        let plain_text = message
            .blocks
            .iter()
            .all(|block| matches!(block, ChatBlock::Text { .. }));
        if message.id.starts_with("local-command:")
            || !matches!(message.role, ChatRole::User)
            || !plain_text
        {
            out.push(message.clone());
            continue;
        }
        let Some(envelope) = parse_command_envelope(&text_of(message, "\n")) else {
            out.push(message.clone());
            continue;
        };
        let catalog_name = envelope.name.trim_start_matches('/').to_lowercase();
        if catalog_name != "compact" && catalog_command_names.contains(&catalog_name) {
            out.push(message.clone());
            continue;
        }
        // The harness canonicalizes a plugin skill to `/plugin:name`, but the user typed the
        // SHORT name.
        let short_name = envelope
            .name
            .trim_start_matches('/')
            .rsplit(':')
            .next()
            .unwrap_or_default()
            .to_string();
        let token = format!("/{short_name}");
        let mut next = message.clone();
        next.blocks = vec![ChatBlock::Text {
            text: if envelope.args.is_empty() {
                token
            } else {
                format!("{token} {}", envelope.args)
            },
        }];
        out.push(next);
        changed = true;
    }
    if changed {
        out
    } else {
        messages.to_vec()
    }
}

/// The transcript after assembly, skill surfacing and the `/clear` boundary.
///
/// This is `boundaried` in the TypeScript, and it is what every later step measures against.
pub fn boundaried_transcript(state: &ChatState, catalog: &[String]) -> Vec<ChatMessage> {
    let mut assembler = Assembler::default();
    assembler.reset(&Row::stamped(&state.messages.list));
    let assembled: Vec<ChatMessage> = assembler
        .rows
        .iter()
        .map(|row| row.message.clone())
        .collect();
    let surfaced = surface_skill_invocation_user_turns(&assembled, catalog);
    apply_marker_boundaries(&surfaced, &state.pending.markers)
}

/// The whole composed list the renderer sees.
///
/// Two contributors are not folded in yet and are named where they belong below: the app-command
/// rows and the terminal status and tool rows. Both are additive tails; neither changes the order
/// of anything already here.
pub fn compose(
    state: &ChatState,
    catalog: &[String],
    preview_text: Option<&str>,
    working: bool,
) -> Vec<ChatMessage> {
    let boundaried = boundaried_transcript(state, catalog);
    let queue = state.session.queue_prompts.clone().unwrap_or_default();
    let startup_pending = pending_with_startup_sends(&state.pending.sends, &queue);
    let pending_messages =
        pending_sends_as_messages(&visible_pending_sends(&startup_pending, &boundaried));

    // A marker whose text an authoritative user row already carries is the same fact twice.
    let authoritative_text: Vec<String> = boundaried
        .iter()
        .filter(|message| matches!(message.source, ChatSource::Transcript))
        .map(normalized_text)
        .filter(|text| !text.is_empty())
        .collect();
    let marker_messages: Vec<ChatMessage> = markers_as_messages(
        &retire_interrupt_markers(&state.pending.markers, &boundaried),
        compaction_records(&state.messages.list),
    )
    .into_iter()
    .filter(|message| {
        !matches!(message.role, ChatRole::User)
            || !authoritative_text.contains(&normalized_text(message))
    })
    .collect();

    let mut tail: Vec<ChatMessage> = Vec::new();
    // Terminal status rows and the pending tool row belong here, between the transcript and the
    // markers (`unreconciledSessionChatTerminalStatuses`), and the app-command rows between them.
    tail.extend(marker_messages);

    let mut with_pending = boundaried.clone();
    with_pending.extend(pending_messages.iter().cloned());
    if let Some(text) = derive_streaming_text(&with_pending, preview_text, working) {
        tail.push(streaming_message(&text));
    }
    tail.extend(pending_messages);

    let mut composed = boundaried;
    composed.extend(tail);
    // An async question older than the retirement stamp is no longer offered.
    if let Some(since) = state.session.async_questions_since {
        for message in &mut composed {
            if message.async_questions.is_some()
                && message.timestamp.is_some_and(|stamp| stamp < since)
            {
                message.async_questions = None;
            }
        }
    }
    composed
}
