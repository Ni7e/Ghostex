//! Family b's user actions: the row details, the transcript modes, the rewind sheet, saved
//! prompts, deferred work and the links and images a row opens.
//!
//! Ported from the family b arms of `action` in
//! `packages/shared/session-chat-controller/native-host.ts`, plus `native-message-actions.ts`.

use serde_json::{json, Value};

use crate::action::{ActionKind, UserAction};
use crate::effect::{Effect, OpenTarget};
use crate::state::{ChatContext, ChatState, OpenRow, RewindRequest};
use crate::transcript::file_position::FilePosition;
use crate::transcript::jsstr::js_trim;
use crate::transcript::links::{classify_link_href, file_position_from_href, LinkTarget};
use crate::transcript::rows;
use crate::wire::{ChatRpcMethod, RpcOutcome};

fn param<'a>(action: &'a UserAction, key: &str) -> Option<&'a Value> {
    action.params.get(key)
}

fn text(action: &UserAction, key: &str) -> String {
    param(action, key)
        .and_then(Value::as_str)
        .unwrap_or_default()
        .to_string()
}

/// The open rows the renderer reports, in the order it reports them.
fn open_rows(action: &UserAction) -> Vec<OpenRow> {
    let Some(Value::Array(rows)) = param(action, "open") else {
        return Vec::new();
    };
    rows.iter()
        .map(|row| OpenRow {
            key: row
                .get("key")
                .and_then(Value::as_str)
                .unwrap_or_default()
                .to_string(),
            kind: row
                .get("kind")
                .and_then(Value::as_str)
                .unwrap_or_default()
                .to_string(),
            message_id: row
                .get("messageId")
                .and_then(Value::as_str)
                .unwrap_or_default()
                .to_string(),
            index: row.get("index").and_then(Value::as_u64).unwrap_or_default() as usize,
        })
        .collect()
}

fn position_effect(href: &str, path: String) -> Effect {
    let position: Option<FilePosition> = file_position_from_href(href);
    Effect::Open(OpenTarget::File {
        path,
        line: position.map(|position| position.line as u32),
        column: position
            .and_then(|position| position.column)
            .map(|column| column as u32),
    })
}

/// Handles one action family b owns.
pub fn handle(state: &mut ChatState, action: &UserAction, context: &ChatContext) -> Vec<Effect> {
    match action.kind {
        ActionKind::RowDetails => {
            state.transcript_view.open_rows = open_rows(action);
            state.transcript_view.row_details = rows::row_details(state, context);
            Vec::new()
        }
        // `summaryMode = await composer('summary', …)`: the mode changes when the WRITE lands,
        // not when the row is clicked, so a refused write leaves the transcript as it was. The
        // flip is applied by `crate::transcript::settle` on `Event::StorageWritten`.
        ActionKind::ToggleSummary => {
            let next = !state.transcript_view.summary_mode;
            state.transcript_view.pending_summary_mode = Some(next);
            vec![Effect::WriteStorage {
                key: crate::composer::storage::summary_key(&state.identity.session_key),
                value: Some(crate::composer::storage::encode_summary(next).to_string()),
                durable: false,
            }]
        }
        ActionKind::SetVerbose => {
            let enabled = param(action, "enabled").and_then(Value::as_bool);
            state.transcript_view.pending_verbose_override = Some(enabled);
            vec![Effect::WriteStorage {
                key: crate::composer::storage::verbose_key(&state.identity.session_key),
                value: Some(
                    crate::composer::storage::encode_verbose(enabled == Some(true)).to_string(),
                ),
                durable: false,
            }]
        }
        ActionKind::LoadWork => {
            // The failure belongs to the row that asked for it, not to the composer's error bar, so
            // it never reaches the outer handler.
            let id = text(action, "id");
            state.transcript_view.deferred_work.insert(
                id,
                crate::document::DeferredWorkRow {
                    loading: true,
                    error: ghostex_gx_protocol::Tri::Absent,
                },
            );
            state.transcript_view.detail_revision += 1;
            let request_id = state.core.allocate_request_id();
            state
                .transcript_view
                .deferred_requests
                .insert(request_id, text(action, "id"));
            // One page, where `readWork` (`presentation/deferred-work.ts`) walks back through
            // `beforeOffset` until it meets the section's first message. The walk and its LRU cache
            // are not ported; a section longer than one page comes back short.
            let work = param(action, "work").cloned().unwrap_or(Value::Null);
            vec![Effect::SendRpc {
                request_id,
                method: ChatRpcMethod::ReadSessionChat,
                params: Box::new(json!({
                    "beforeOffset": work.get("beforeOffset").cloned().unwrap_or(Value::Null),
                    "limit": 200,
                    "historyMode": "detail",
                })),
            }]
        }
        ActionKind::RewindOpen => {
            state.transcript_view.rewind = Some(RewindRequest {
                message_id: text(action, "messageId"),
                prompt: text(action, "prompt"),
                agent: state.session.agent.clone().unwrap_or_default(),
                ..RewindRequest::default()
            });
            Vec::new()
        }
        ActionKind::RewindCancel => {
            let busy = state
                .transcript_view
                .rewind
                .as_ref()
                .is_some_and(|request| request.busy);
            if !busy {
                state.transcript_view.rewind = None;
            }
            Vec::new()
        }
        ActionKind::RewindSubmit => {
            let Some(request) = state.transcript_view.rewind.as_mut() else {
                return Vec::new();
            };
            if request.busy || request.completed {
                return Vec::new();
            }
            request.busy = true;
            request.error = None;
            let message_id = request.message_id.clone();
            let request_id = state.core.allocate_request_id();
            if let Some(request) = state.transcript_view.rewind.as_mut() {
                request.request_id = Some(request_id);
            }
            vec![Effect::SendRpc {
                request_id,
                method: ChatRpcMethod::RewindSessionChat,
                params: Box::new(json!({ "messageId": message_id })),
            }]
        }
        ActionKind::SavePrompt => {
            let message_id = text(action, "messageId");
            let prompt = text(action, "prompt");
            let saving = state
                .transcript_view
                .saved_prompts
                .get(&message_id)
                .map(String::as_str)
                == Some("saving");
            if saving || js_trim(&prompt).is_empty() {
                return Vec::new();
            }
            state
                .transcript_view
                .saved_prompts
                .insert(message_id.clone(), "saving".to_string());
            let request_id = state.core.allocate_request_id();
            state
                .transcript_view
                .save_prompt_requests
                .insert(request_id, message_id);
            vec![Effect::SendRpc {
                request_id,
                method: ChatRpcMethod::SaveStashedPrompt,
                params: Box::new(json!({ "content": prompt })),
            }]
        }
        ActionKind::OpenMarkdownLink => {
            let href = text(action, "href");
            match classify_link_href(&href) {
                LinkTarget::File(path) => vec![position_effect(&href, path)],
                LinkTarget::Url(url) => vec![Effect::Open(OpenTarget::Url { url })],
                LinkTarget::Inert => Vec::new(),
            }
        }
        ActionKind::LoadImage => {
            /*
            The picture behind an "[Image #N](path)" reference lives on the session's machine, so the
            native chat cannot open it directly either: the bytes come back over the same transport
            React reads them through, and the Chat Lab's preview backend answers the same call. A
            file that has gone reports back as unreadable rather than raising the composer's error
            bar.
            */
            let request_id = state.core.allocate_request_id();
            let path = text(action, "path");
            state
                .transcript_view
                .image_requests
                .insert(request_id, path.clone());
            vec![Effect::SendRpc {
                request_id,
                method: ChatRpcMethod::ReadSessionChatImage,
                params: Box::new(json!({ "path": path })),
            }]
        }
        _ => Vec::new(),
    }
}

/// The answers to the four calls family b's row actions make.
///
/// `NativeChatMessageActions.submit` has three outcomes (`native-message-actions.ts`): a rewind
/// that needs synchronization keeps the sheet up with its warning, a plain success puts the prompt
/// back in the composer, and a `messageNotFound` refusal closes the sheet and restores the prompt
/// rather than showing an error. Save prompt has two, and `loadWork` reports its failure on the
/// row that asked rather than on the composer's error bar.
pub fn settle_rpc(state: &mut ChatState, request_id: u64, outcome: &RpcOutcome) -> Vec<Effect> {
    let (result, failure) = match outcome {
        RpcOutcome::Ok { result } => (Some(result.clone()), None),
        RpcOutcome::Err { code, message, .. } => (None, Some((code.clone(), message.clone()))),
    };
    if let Some(message_id) = state
        .transcript_view
        .save_prompt_requests
        .remove(&request_id)
    {
        let status = if failure.is_none() { "saved" } else { "error" };
        state
            .transcript_view
            .saved_prompts
            .insert(message_id, status.to_string());
        return Vec::new();
    }
    if let Some(turn_id) = state.transcript_view.deferred_requests.remove(&request_id) {
        match result {
            Some(result) => {
                let messages = result
                    .get("messages")
                    .and_then(Value::as_array)
                    .map(|rows| {
                        rows.iter()
                            .filter_map(|row| serde_json::from_value(row.clone()).ok())
                            .collect::<Vec<_>>()
                    })
                    .unwrap_or_default();
                state
                    .transcript_view
                    .deferred
                    .insert(turn_id.clone(), messages);
                state.transcript_view.deferred_work.remove(&turn_id);
            }
            None => {
                let message = failure
                    .clone()
                    .map(|(_, message)| message)
                    .unwrap_or_default();
                state.transcript_view.deferred_work.insert(
                    turn_id,
                    crate::document::DeferredWorkRow {
                        loading: false,
                        error: ghostex_gx_protocol::Tri::Value(if message.is_empty() {
                            "Work history could not be loaded.".to_string()
                        } else {
                            message
                        }),
                    },
                );
            }
        }
        state.transcript_view.detail_revision += 1;
        return Vec::new();
    }
    if let Some(path) = state.transcript_view.image_requests.remove(&request_id) {
        return vec![Effect::HostAction {
            action: "chatImage".to_string(),
            params: Box::new(match &result {
                Some(image) => json!({ "path": path, "image": image }),
                None => json!({
                    "path": path,
                    "error": failure.map(|(_, message)| message).unwrap_or_default(),
                }),
            }),
        }];
    }
    let Some(request) = state.transcript_view.rewind.as_mut() else {
        return Vec::new();
    };
    if request.request_id != Some(request_id) {
        return Vec::new();
    }
    request.request_id = None;
    request.busy = false;
    let prompt = request.prompt.clone();
    match result {
        Some(result) => {
            let warning = result
                .get("warning")
                .and_then(Value::as_str)
                .filter(|warning| !warning.is_empty())
                .map(str::to_string);
            // CDXC:SessionChat 2026-09-11 DECISION:
            // User approved Retry synchronization after Codex confirms rewind; the dialog and the
            // draft are preserved while the server reconnects to that branch.
            if result.get("synchronizationPending") == Some(&Value::Bool(true)) {
                request.synchronization_pending = true;
                request.error = Some(
                    warning.unwrap_or_else(|| "The rewind needs synchronization.".to_string()),
                );
                return Vec::new();
            }
            match warning {
                Some(warning) => {
                    request.error = Some(warning);
                    request.completed = true;
                }
                None => state.transcript_view.rewind = None,
            }
            vec![restore_prompt(prompt)]
        }
        None => {
            let (code, message) = failure.unwrap_or_default();
            // CDXC:SessionChat 2026-09-16 DECISION:
            // User: if Rewind finds that the message was never accepted, put its text back in the
            // composer instead of showing an error.
            if code.as_deref() == Some("messageNotFound") {
                state.transcript_view.rewind = None;
                return vec![restore_prompt(prompt)];
            }
            request.error = Some(if message.is_empty() {
                "The conversation could not be rewound.".to_string()
            } else {
                message
            });
            Vec::new()
        }
    }
}

/// Hands the rewound prompt back to the composer, so the reader edits it instead of retyping it.
fn restore_prompt(prompt: String) -> Effect {
    let caret = prompt.encode_utf16().count();
    Effect::SetComposerText {
        content: prompt,
        caret: Some(caret),
        from_history: false,
    }
}
