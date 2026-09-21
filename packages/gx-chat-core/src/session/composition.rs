//! The composed list: the authoritative transcript plus everything that has no record yet.
//!
//! Ported from the `assembled` / `surfaced` / `boundaried` / `messages` chain of
//! `packages/shared/session-chat-controller/controller.ts`. Order matters and is the contract:
//! transcript, then terminal statuses, then app commands, then markers, then the streaming
//! bubble, then the pending tool row, then the pending echoes.

use ghostex_gx_protocol::{ChatBlock, ChatMessage, ChatRole, ChatSource};

use crate::session::app_commands::{
    app_commands_as_messages, reconcile_local_command_output,
    retire_markers_covered_by_local_commands,
};
use crate::session::assembler::{Assembler, Row};
use crate::session::markers::{
    apply_marker_boundaries, markers_as_messages, retire_interrupt_markers,
};
use crate::session::pending::{pending_sends_as_messages, visible_pending_sends};
use crate::session::startup_sends::pending_with_startup_sends;
use crate::session::streaming::{derive_streaming_text, streaming_message};
use crate::session::terminal::{
    terminal_stream_is_tool, terminal_stream_retired, unreconciled_terminal_statuses,
    visible_terminal_tool,
};
use crate::session::text::{collapse_whitespace, is_js_space, parse_command_envelope};
use crate::state::ChatState;
use crate::transcript::noise::{classify_suppressed_turn, SuppressedTurn};

/// `countSessionChatCompactionRecords`: how many compactions the authoritative transcript records.
///
/// A compaction record is a suppressed turn whose status label is one of the two the agent writes.
/// The optimistic "Ran /compact" marker retires against this count: once the agent has said the
/// compaction happened, a client-side "we sent it" row would sit BELOW the result it announced.
///
/// The classifier is family b's (`crate::transcript::noise`, from
/// `packages/core-ui/chat/session-chat-noise.ts`); the two labels are compared as literals here
/// because they are private to that module, and `session_chat.rs` in gxserver holds the same
/// spellings.
pub fn compaction_records(messages: &[ChatMessage]) -> usize {
    messages
        .iter()
        .filter(|message| {
            matches!(
                classify_suppressed_turn(message),
                Some(SuppressedTurn::Status { ref label, .. })
                    if label == "Context compacted" || label == "Compaction completed"
            )
        })
        .count()
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

/// The list a pending echo is reconciled against.
///
/// CDXC:SessionChat 2026-09-15 WHY:
/// Startup sends hydrate as pending bubbles even for `/usage`. Its command acknowledgment can
/// arrive before any transcript exists, and it never needs an assistant reply, so pending
/// reconciliation must include the server's live local-command records.
pub fn pending_transcript(state: &ChatState, boundaried: &[ChatMessage]) -> Vec<ChatMessage> {
    let local: Vec<serde_json::Value> = state
        .session
        .app_commands
        .iter()
        .filter(|entry| {
            entry
                .get("localCommand")
                .and_then(serde_json::Value::as_bool)
                == Some(true)
        })
        .cloned()
        .collect();
    let mut rows = boundaried.to_vec();
    rows.extend(app_commands_as_messages(&local, boundaried));
    rows
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
/// Everything with no authoritative record yet rides in the tail, in the order `controller.ts`
/// builds it; the head is the transcript with the archived local commands reconciled into it.
pub fn compose(
    state: &ChatState,
    catalog: &[String],
    preview_text: Option<&str>,
    working: bool,
) -> Vec<ChatMessage> {
    let boundaried = boundaried_transcript(state, catalog);
    let queue = state.session.queue_prompts.clone().unwrap_or_default();
    let startup_pending = pending_with_startup_sends(&state.pending.sends, &queue);
    let against = pending_transcript(state, &boundaried);
    let pending_messages =
        pending_sends_as_messages(&visible_pending_sends(&startup_pending, &against));
    let transcript = reconcile_local_command_output(&boundaried, &state.session.app_commands);

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
    let marker_messages = retire_markers_covered_by_local_commands(
        &marker_messages,
        &state.session.app_commands,
        &transcript,
        &state.pending.markers,
    );

    // Order, from `controller.ts`: the transient terminal statuses, then the app-command rows, then
    // the markers, then the streaming bubble, then the pending tool row, then the pending echoes.
    let mut tail: Vec<ChatMessage> =
        unreconciled_terminal_statuses(&state.pending.terminal_status_messages, &boundaried);
    tail.extend(app_commands_as_messages(
        &state.session.app_commands,
        &transcript,
    ));
    tail.extend(marker_messages);

    let visible_tool = visible_terminal_tool(state, working);
    // The terminal's live message wins over the hook preview: it is the same bubble, read from the
    // screen the agent is painting instead of a status line.
    let terminal_stream_text = state.pending.terminal_stream.as_ref().filter(|stream| {
        (stream.live || working)
            && !visible_tool.is_some_and(|tool| terminal_stream_is_tool(stream, tool))
            && !terminal_stream_retired(stream, &boundaried)
    });
    let mut with_pending = boundaried.clone();
    with_pending.extend(pending_messages.iter().cloned());
    let streaming_text = match terminal_stream_text {
        Some(stream) => Some(stream.text.clone()),
        None => derive_streaming_text(&with_pending, preview_text, working),
    };
    if let Some(text) = streaming_text {
        tail.push(streaming_message(&text));
    }
    if let Some(tool) = visible_tool {
        tail.push(tool.clone());
    }
    tail.extend(pending_messages);

    let mut composed = transcript;
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
