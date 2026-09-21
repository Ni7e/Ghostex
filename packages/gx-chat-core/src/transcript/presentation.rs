//! Projecting one message, and the item list the renderer walks.
//!
//! Ported from `packages/shared/session-chat-controller/native-presentation.ts`.

use ghostex_gx_protocol::{ChatBlock, ChatMessage, ChatRole};
use serde_json::{Map, Value};

use crate::document::TranscriptItem;
use crate::state::{ChatContext, ChatState, TranscriptViewState, EAGER_TAIL_ITEMS};
use crate::transcript::agent_message::{
    agent_display_name, parse_agent_message, parse_inter_agent_message,
};
use crate::transcript::file_changes::{split_file_changes, FileChange};
use crate::transcript::foreign::{
    is_pending_message_id, is_terminal_tool_message, is_working, terminal_tool_activity,
};
use crate::transcript::images::{image_source, ImageRef};
use crate::transcript::jsstr::js_trim;
use crate::transcript::markdown_links::markdown_references;
use crate::transcript::message_text::{
    message_action_content, normalize_user_message_markdown, split_reasoning_headline,
    user_turn_copy_markdown,
};
use crate::transcript::message_time::message_time;
use crate::transcript::native_markdown::native_markdown;
use crate::transcript::noise::suppressed_turn_presentation;
use crate::transcript::prose::prose_markdown;
use crate::transcript::question_exchange::answered_question_exchange;
use crate::transcript::simple::{simple_edit_label, tool_count_label};
use crate::transcript::system_cards::classify_system_card;
use crate::transcript::tool_fold::{pair_tool_blocks, split_blocks, ToolPair};
use crate::transcript::tool_rows::tool_run_shows_all_rows;
use crate::transcript::transcript::{completed_chat_work, project_chat_transcript, TranscriptProjection};
use crate::transcript::transcript_rows::{file_rows, tool_detail, tool_fold, tool_rows};
use crate::transcript::turns::{partition_completed_work, worked_duration_label, RenderItem};

/// A message's file changes and tool calls, in the order their rows are numbered.
pub fn message_tool_rows(message: &ChatMessage) -> (Vec<FileChange<'_>>, Vec<ToolPair<'_>>) {
    let (_, tools) = split_blocks(&message.blocks);
    let (remaining, changes) = split_file_changes(tools);
    let pairs = pair_tool_blocks(remaining);
    (changes, pairs)
}

fn image_blocks(blocks: &[&ChatBlock]) -> Vec<ImageRef> {
    blocks
        .iter()
        .copied()
        .filter_map(|block| match block {
            ChatBlock::ImageRef { path, url, alt } => {
                Some(ImageRef { path: path.clone(), url: url.clone(), alt: alt.clone() })
            }
            _ => None,
        })
        .collect()
}

/// CDXC:SessionChat 2026-09-02:
/// A rewind target is a prompt the agent has actually taken: the same "genuine user prompt" test the
/// transcript already uses for its turn boundaries (a suppressed harness turn is not one, a `queued`
/// row is still held by the agent's queue) plus the optimistic local echo, which has no transcript
/// row for the daemon to rewind to yet.
pub fn message_can_rewind(message: &ChatMessage, copy_text: &str, suppressed: &Value) -> bool {
    message.role == ChatRole::User
        && suppressed.is_null()
        && !copy_text.is_empty()
        && !message.queued
        && message.startup_delivery.is_none()
        && !is_pending_message_id(&message.id)
}

/// Agents whose own rewind flow Ghostex drives; anything else never offers the action.
pub fn agent_supports_rewind(agent: Option<&str>) -> bool {
    matches!(agent, Some("claude") | Some("codex"))
}

/// The message's own wire keys, which the projection spreads before it adds its own.
fn message_keys(message: &ChatMessage) -> Map<String, Value> {
    match serde_json::to_value(message) {
        Ok(Value::Object(entries)) => entries,
        _ => Map::new(),
    }
}

/// One projected message: the message plus everything the renderer needs to draw it without
/// re-parsing markdown.
pub fn project_message(
    message: &ChatMessage,
    agent_path: &str,
    working_directory: Option<&str>,
    context: &ChatContext,
) -> Value {
    let (prose, tools) = split_blocks(&message.blocks);
    let images = image_blocks(&prose);
    let body = js_trim(&prose_markdown(&message.blocks)).to_string();
    let is_user = message.role == ChatRole::User;
    let displayed_body = if is_user { normalize_user_message_markdown(&body) } else { body.clone() };
    let agent_message = parse_agent_message(&body);
    let (remaining, changes) = split_file_changes(tools);
    let tool_pairs = pair_tool_blocks(remaining);
    let copy_text = if is_user {
        let blocks: Vec<&ChatBlock> =
            prose.iter().copied().filter(|block| matches!(block, ChatBlock::ImageRef { .. })).collect();
        user_turn_copy_markdown(&displayed_body, &blocks)
    } else {
        body.clone()
    };
    // Code-block headers, GitHub alerts, and typed file paths, marked for the native renderer.
    let native_body = native_markdown(&displayed_body, is_user);
    let suppressed = suppressed_turn_presentation(message);
    let rows = tool_rows(&tool_pairs, agent_path);
    let system_card = classify_system_card(message, &displayed_body);
    let reasoning = split_reasoning_headline(&body);
    let questions: Vec<Value> = {
        let (_, all_tools) = split_blocks(&message.blocks);
        pair_tool_blocks(all_tools).iter().filter_map(answered_question_exchange).collect()
    };
    let mut changed_paths: Vec<&str> = Vec::new();
    for change in &changes {
        if !changed_paths.contains(&change.path.as_str()) {
            changed_paths.push(&change.path);
        }
    }

    let mut projected = message_keys(message);
    projected.insert("text".to_string(), native_body.clone().into());
    projected.insert("copyText".to_string(), copy_text.clone().into());
    projected.insert(
        "canRewind".to_string(),
        message_can_rewind(message, &copy_text, &suppressed).into(),
    );
    projected.insert("actionContent".to_string(), message_action_content(&body));
    projected.insert("time".to_string(), message_time(message.timestamp, context));
    projected.insert("markdownReferences".to_string(), Value::Array(markdown_references(&native_body)));
    projected.insert(
        "reasoning".to_string(),
        serde_json::json!({ "headline": reasoning.headline, "body": reasoning.body }),
    );
    projected.insert(
        "agentMessage".to_string(),
        match &agent_message {
            Some(agent_message) => serde_json::json!({
                "sender": agent_message.sender,
                "body": agent_message.body,
                "name": agent_display_name(&agent_message.sender),
            }),
            None => Value::Null,
        },
    );
    projected.insert(
        "interAgentMessage".to_string(),
        match is_user.then(|| parse_inter_agent_message(&body)).flatten() {
            Some(inter) => serde_json::json!({
                "agentName": inter.agent_name,
                "sessionTitle": inter.session_title,
                "sessionId": inter.session_id,
                "agentId": inter.agent_id,
                "agentSessionId": inter.agent_session_id,
                "replyTo": inter.reply_to,
                "body": inter.body,
            }),
            None => Value::Null,
        },
    );
    projected.insert("questions".to_string(), Value::Array(questions));
    projected.insert(
        "images".to_string(),
        Value::Array(images.iter().map(image_source).collect()),
    );
    projected.insert("suppressed".to_string(), suppressed);
    /* The expanded subagent-message card renders its body as Markdown, so it needs the same marks
    and reference links the turn's own body gets; the collapsed clamp keeps the raw text React
    clamps. */
    projected.insert(
        "systemCard".to_string(),
        match system_card {
            Value::Object(mut card) if card.get("kind") == Some(&Value::String("agent-message".into())) => {
                let body = card.get("body").and_then(Value::as_str).unwrap_or_default().to_string();
                card.insert("markdown".to_string(), native_markdown(&body, false).into());
                Value::Object(card)
            }
            other => other,
        },
    );
    projected.insert(
        "files".to_string(),
        Value::Array(file_rows(&changes, &message.id, working_directory)),
    );
    projected.insert("simpleFileLabel".to_string(), simple_edit_label(changed_paths.len()).into());
    /* React counts only the work rows for this label: an answered question is conversation, so its
    card sits outside the group and is not one of the "N tool calls". */
    let call_rows = rows
        .iter()
        .filter(|row| {
            row.get("hasCall") == Some(&Value::Bool(true))
                && row.get("exchange") != Some(&Value::Bool(true))
        })
        .count();
    projected.insert("simpleToolLabel".to_string(), tool_count_label(call_rows).into());
    projected.insert("tools".to_string(), Value::Array(rows));
    projected.insert("toolFold".to_string(), tool_fold(&tool_pairs));
    projected.insert("toolsShowAllRows".to_string(), tool_run_shows_all_rows(!body.is_empty()).into());
    projected.insert(
        "terminalTool".to_string(),
        if is_terminal_tool_message(message) { terminal_tool_activity(message) } else { Value::Null },
    );
    Value::Object(projected)
}

/// CDXC:SessionChat 2026-09-18 WHY:
/// Projecting a message parses its markdown twice (bare file paths, then references), and a
/// 139-message transcript took about 800ms of QuickJS before its first item existed. The transcript
/// follows its tail, so only the newest items are projected before the first publish; older ones
/// ship as plain-text placeholders and are backfilled in batches on the runtime's timer, newest
/// first, each batch republishing.
fn placeholder(message: &ChatMessage) -> Value {
    let text = js_trim(
        &message
            .blocks
            .iter()
            .filter_map(|block| match block {
                ChatBlock::Text { text } => Some(text.as_str()),
                _ => None,
            })
            .collect::<Vec<_>>()
            .join("\n"),
    )
    .to_string();
    let mut projected = message_keys(message);
    projected.insert("text".to_string(), text.clone().into());
    projected.insert("copyText".to_string(), text.into());
    projected.insert("pending".to_string(), true.into());
    Value::Object(projected)
}

/// The projection pass, with the placeholder queue it filled.
pub struct Projection {
    pub items: Vec<TranscriptItem>,
    pub final_ids: Vec<String>,
    /// Ids that shipped as placeholders and want a backfill batch.
    pub backfill: Vec<String>,
}

struct Builder<'a> {
    view: &'a TranscriptViewState,
    context: &'a ChatContext,
    eager_from: usize,
    backfill: Vec<String>,
}

impl Builder<'_> {
    fn projected(&self, message: &ChatMessage) -> bool {
        self.view.projected.get(&message.id) == Some(message)
    }

    fn project(&self, message: &ChatMessage) -> Value {
        project_message(
            message,
            &self.view.agent_path,
            self.view.working_directory.as_deref(),
            self.context,
        )
    }

    /// The full projection when it is cheap or the row is near the tail; otherwise a stable
    /// plain-text stand-in queued for backfill.
    fn message_or_placeholder(&mut self, message: &ChatMessage, eager: bool) -> Value {
        if eager || self.projected(message) {
            return self.project(message);
        }
        self.backfill.push(message.id.clone());
        placeholder(message)
    }

    fn eager(&self, index: usize) -> bool {
        index >= self.eager_from
    }
}

fn message_id(item: &TranscriptItem) -> String {
    match item {
        TranscriptItem::Message { message } => {
            message.get("id").and_then(Value::as_str).unwrap_or_default().to_string()
        }
        TranscriptItem::Summary { id, .. } | TranscriptItem::CompletedWork { id, .. } => id.clone(),
        TranscriptItem::Unknown(_) => String::new(),
    }
}

/// The whole transcript list for the state as it stands.
pub fn build(state: &ChatState, context: &ChatContext) -> Projection {
    let view = &state.transcript_view;
    let projection: TranscriptProjection =
        project_chat_transcript(&state.messages.composed, is_working(state), &[]);
    let summary = view.summary_mode;
    let length = if summary { projection.summary_turns.len() } else { projection.items.len() };
    let mut builder = Builder {
        view,
        context,
        eager_from: length.saturating_sub(EAGER_TAIL_ITEMS),
        backfill: Vec::new(),
    };

    let items: Vec<TranscriptItem> = if summary {
        projection
            .summary_turns
            .iter()
            .enumerate()
            .map(|(index, turn)| {
                let eager = builder.eager(index);
                TranscriptItem::Summary {
                    id: turn.user.id.clone(),
                    user: builder.message_or_placeholder(&turn.user, eager),
                    final_message: turn
                        .final_message
                        .as_ref()
                        .map(|message| builder.message_or_placeholder(message, eager)),
                    active: turn.active,
                    work: turn
                        .active_work
                        .iter()
                        .map(|message| builder.message_or_placeholder(message, eager))
                        .collect(),
                }
            })
            .collect()
    } else {
        projection
            .items
            .iter()
            .enumerate()
            .map(|(index, item)| {
                let eager = builder.eager(index);
                let turn = match item {
                    RenderItem::Message(message) => {
                        return TranscriptItem::Message {
                            message: builder.message_or_placeholder(message, eager),
                        }
                    }
                    RenderItem::CompletedWork(turn) => turn,
                };
                let work =
                    completed_chat_work(turn, view.deferred.get(&turn.user.id).map(Vec::as_slice));
                let (visible_artifacts, collapsed_work) = partition_completed_work(&work);
                /*
                A finished turn's writes leave their rows and collect under one "N files changed"
                fold. The rows come back through the per-message projection so an unchanged turn
                keeps the same cards and ships nothing.
                */
                let mut files: Vec<Value> = Vec::new();
                let sources: Vec<&ChatMessage> =
                    work.iter().chain(turn.final_message.iter()).collect();
                for message in sources {
                    if let Value::Array(rows) =
                        builder.message_or_placeholder(message, eager).get("files").cloned().unwrap_or(Value::Null)
                    {
                        files.extend(rows);
                    }
                }
                let mut changed: Vec<String> = Vec::new();
                for file in &files {
                    if let Some(path) = file.get("path").and_then(Value::as_str) {
                        if !changed.iter().any(|seen| seen == path) {
                            changed.push(path.to_string());
                        }
                    }
                }
                if let Some(deferred) = &turn.user.deferred_work {
                    for path in &deferred.file_paths {
                        if !changed.iter().any(|seen| seen == path) {
                            changed.push(path.clone());
                        }
                    }
                }
                let changed_files = changed.len();
                let deferred_value = turn
                    .user
                    .deferred_work
                    .as_ref()
                    .and_then(|deferred| serde_json::to_value(deferred).ok());
                TranscriptItem::CompletedWork {
                    id: turn.user.id.clone(),
                    label: worked_duration_label(
                        turn.user.timestamp,
                        turn.final_message
                            .as_ref()
                            .and_then(|message| message.timestamp)
                            .or_else(|| {
                                turn.user.deferred_work.as_ref().and_then(|deferred| deferred.completed_at)
                            }),
                    ),
                    files,
                    files_label: format!(
                        "{changed_files} {} changed",
                        if changed_files == 1 { "file" } else { "files" }
                    ),
                    simple_files_label: simple_edit_label(changed_files),
                    expandable: !collapsed_work.is_empty() || turn.user.deferred_work.is_some(),
                    deferred: deferred_value,
                    work: collapsed_work
                        .iter()
                        .map(|message| builder.message_or_placeholder(message, eager))
                        .collect(),
                    /* The turn's answered question cards, hoisted out of the fold. */
                    questions: work
                        .iter()
                        .flat_map(|row| {
                            match builder.message_or_placeholder(row, eager).get("questions").cloned() {
                                Some(Value::Array(rows)) => rows,
                                _ => Vec::new(),
                            }
                        })
                        .collect(),
                    artifacts: visible_artifacts
                        .iter()
                        .map(|message| builder.message_or_placeholder(message, eager))
                        .collect(),
                    final_message: turn
                        .final_message
                        .as_ref()
                        .map(|message| builder.message_or_placeholder(message, eager)),
                }
            })
            .collect()
    };

    let _ = message_id;
    Projection { items, final_ids: projection.final_ids, backfill: builder.backfill }
}

/// What an open row shows, read from the message the row was projected from: a tool's arguments and
/// result, or a file card's diff.
pub fn row_detail(state: &ChatState, kind: &str, message_id: &str, index: usize) -> Option<Value> {
    let source = state
        .messages
        .composed
        .iter()
        .find(|message| message.id == message_id)
        .or_else(|| {
            state
                .transcript_view
                .deferred
                .values()
                .flatten()
                .find(|message| message.id == message_id)
        })?;
    let (files, tools) = message_tool_rows(source);
    if kind == "file" {
        let change = files.get(index)?;
        return Some(serde_json::json!({ "lines": change.lines }));
    }
    tools.get(index).map(tool_detail)
}
