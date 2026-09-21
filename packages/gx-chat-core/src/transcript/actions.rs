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
use crate::wire::ChatRpcMethod;

fn param<'a>(action: &'a UserAction, key: &str) -> Option<&'a Value> {
    action.params.get(key)
}

fn text(action: &UserAction, key: &str) -> String {
    param(action, key).and_then(Value::as_str).unwrap_or_default().to_string()
}

/// The open rows the renderer reports, in the order it reports them.
fn open_rows(action: &UserAction) -> Vec<OpenRow> {
    let Some(Value::Array(rows)) = param(action, "open") else {
        return Vec::new();
    };
    rows.iter()
        .map(|row| OpenRow {
            key: row.get("key").and_then(Value::as_str).unwrap_or_default().to_string(),
            kind: row.get("kind").and_then(Value::as_str).unwrap_or_default().to_string(),
            message_id: row.get("messageId").and_then(Value::as_str).unwrap_or_default().to_string(),
            index: row.get("index").and_then(Value::as_u64).unwrap_or_default() as usize,
        })
        .collect()
}

fn position_effect(href: &str, path: String) -> Effect {
    let position: Option<FilePosition> = file_position_from_href(href);
    Effect::Open(OpenTarget::File {
        path,
        line: position.map(|position| position.line as u32),
        column: position.and_then(|position| position.column).map(|column| column as u32),
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
        ActionKind::ToggleSummary => {
            state.transcript_view.summary_mode = !state.transcript_view.summary_mode;
            state.transcript_view.invalidate();
            rows::refresh(state, context);
            // The stored value is the composer's boot input, so the host persists it.
            vec![Effect::HostAction {
                action: "summary".to_string(),
                params: Box::new(json!({ "enabled": state.transcript_view.summary_mode })),
            }]
        }
        ActionKind::SetVerbose => {
            let enabled = param(action, "enabled").and_then(Value::as_bool);
            state.transcript_view.verbose_override = enabled;
            vec![Effect::HostAction {
                action: "verbose".to_string(),
                params: Box::new(json!({ "enabled": enabled })),
            }]
        }
        ActionKind::LoadWork => {
            // The failure belongs to the row that asked for it, not to the composer's error bar, so
            // it never reaches the outer handler.
            let id = text(action, "id");
            state
                .transcript_view
                .deferred_work
                .insert(id, crate::document::DeferredWorkRow { loading: true, error: ghostex_gx_protocol::Tri::Absent });
            state.transcript_view.detail_revision += 1;
            vec![Effect::SendRpc {
                request_id: 0,
                method: ChatRpcMethod::ReadSessionChat,
                params: Box::new(param(action, "work").cloned().unwrap_or(Value::Null)),
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
            let busy = state.transcript_view.rewind.as_ref().is_some_and(|request| request.busy);
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
            vec![Effect::SendRpc {
                request_id: 0,
                method: ChatRpcMethod::RewindSessionChat,
                params: Box::new(json!({ "messageId": message_id })),
            }]
        }
        ActionKind::SavePrompt => {
            let message_id = text(action, "messageId");
            let prompt = text(action, "prompt");
            let saving = state.transcript_view.saved_prompts.get(&message_id).map(String::as_str)
                == Some("saving");
            if saving || js_trim(&prompt).is_empty() {
                return Vec::new();
            }
            state.transcript_view.saved_prompts.insert(message_id, "saving".to_string());
            vec![Effect::SendRpc {
                request_id: 0,
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
            vec![Effect::SendRpc {
                request_id: 0,
                method: ChatRpcMethod::ReadSessionChatImage,
                params: Box::new(json!({ "path": text(action, "path") })),
            }]
        }
        _ => Vec::new(),
    }
}
