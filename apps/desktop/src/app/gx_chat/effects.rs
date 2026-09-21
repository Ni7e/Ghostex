//! Where each `Effect` goes: this thread, or the renderer's own dispatch.
//!
//! The core returns `Vec<Effect>` from every `handle`. Half of them are I/O this host performs off
//! the UI thread (gxserver is not one of them: see below); the other half are things only the view
//! can do, because it owns the composer field, the clipboard, the window and the app shell. Those
//! ride back in the frame's `requests` array in the exact wire form
//! `apps/desktop/src/app/native_chat/state.rs` already dispatches, so no drawing or dispatch code
//! changes when the brain does.
//!
//! CDXC:SessionChat 2026-09-22 WHY:
//! `Effect::SendRpc` is forwarded as a `rpc` request rather than called from this thread, and the
//! socket stays the one the app runtime already owns. `packages/gx-client` deliberately refuses to
//! subscribe to a session chat (a second subscriber starts a new epoch and rebroadcasts a snapshot
//! to every client) and has no public `POST /api/{method}`, so a Rust-side transport would be a
//! second client against the same daemon, not a reuse of the first. The brain moves first; the
//! transport follows when `gx-client` grows a chat subscription.

use ghostex_gx_chat_core::{Effect, HostRequest, OpenTarget, RequestKind};
use serde_json::{Map, Value};

/// Who performs one effect.
pub(super) enum Routed {
    /// This thread: storage, the boot read, the timer.
    Host(Effect),
    /// The view, through the frame's `requests` array.
    Renderer(Box<HostRequest>),
}

/// Sorts one effect into its performer.
///
/// Exhaustive on purpose. An effect a later family adds and nobody routes would otherwise vanish
/// without a trace, which is the failure mode `SEAM.md` section 5 records for `actionComplete`.
pub(super) fn route(effect: Effect) -> Routed {
    match effect {
        Effect::ReadStorage { .. }
        | Effect::WriteStorage { .. }
        | Effect::ReadComposerBoot { .. }
        | Effect::SetTimer { .. } => Routed::Host(effect),
        Effect::SendRpc {
            request_id,
            method,
            params,
        } => Routed::Renderer(Box::new(HostRequest {
            id: Some(request_id),
            kind: RequestKind::Rpc,
            method: method.as_str().to_string(),
            params: object(*params),
        })),
        Effect::Subscribe { limit, catalog } => {
            let mut params = Map::new();
            params.insert("limit".into(), Value::from(limit));
            params.insert("catalog".into(), Value::Bool(catalog));
            Routed::Renderer(Box::new(broker("subscribe", params)))
        }
        Effect::Unsubscribe => Routed::Renderer(Box::new(broker("unsubscribe", Map::new()))),
        Effect::Reconnect => Routed::Renderer(Box::new(broker("reconnect", Map::new()))),
        Effect::SetComposerText {
            content,
            caret,
            from_history,
        } => {
            let mut params = Map::new();
            params.insert("content".into(), Value::String(content));
            // `caret` is a UTF-16 offset, which is what a JavaScript string index is. The view
            // converts it against its own field (`ensure_input`), so it crosses unchanged.
            params.insert(
                "caret".into(),
                caret.map(Value::from).unwrap_or(Value::Null),
            );
            Routed::Renderer(Box::new(HostRequest {
                id: None,
                kind: RequestKind::Composer,
                // The view reads `request["method"] == "history"` to decide whether the replacement
                // is undoable, so the spelling is load bearing.
                method: if from_history { "history" } else { "insert" }.to_string(),
                params,
            }))
        }
        Effect::ClearComposerIfUnchanged { text } => {
            let mut params = Map::new();
            params.insert("text".into(), Value::String(text));
            Routed::Renderer(Box::new(HostRequest {
                id: None,
                kind: RequestKind::ComposerClearExpected,
                method: String::new(),
                params,
            }))
        }
        Effect::Open(OpenTarget::Url { url }) => {
            let mut params = Map::new();
            params.insert("url".into(), Value::String(url));
            Routed::Renderer(Box::new(host_action("openLink", params)))
        }
        Effect::Open(OpenTarget::File { path, line, column }) => {
            let mut params = Map::new();
            params.insert("path".into(), Value::String(path));
            if let Some(line) = line {
                params.insert("line".into(), Value::from(line));
            }
            if let Some(column) = column {
                params.insert("column".into(), Value::from(column));
            }
            Routed::Renderer(Box::new(host_action("openFile", params)))
        }
        // Neither `Copy` nor `Toast` has an emitter in the core today, and neither has an arm in
        // `apply_output`: a toast is a raw `{type: "toast"}` app message rather than a
        // `sessionChatHostAction`, which is why `send_control.rs` emits it outside the frame. They
        // are routed here so a family that starts emitting one gets a visible missing-arm bug
        // rather than silence, and the arm is written then.
        Effect::Copy { text } => {
            let mut params = Map::new();
            params.insert("text".into(), Value::String(text));
            Routed::Renderer(Box::new(host_action("copyText", params)))
        }
        Effect::Toast { level, message } => {
            let mut params = Map::new();
            params.insert("level".into(), Value::String(level));
            params.insert("message".into(), Value::String(message));
            Routed::Renderer(Box::new(host_action("toast", params)))
        }
        Effect::MarkdownSaved { path } => {
            let mut params = Map::new();
            params.insert("path".into(), Value::String(path));
            Routed::Renderer(Box::new(HostRequest {
                id: None,
                kind: RequestKind::MarkdownSaved,
                method: String::new(),
                params,
            }))
        }
        Effect::HostAction { action, params } => {
            let params = object(*params);
            // Two app-shell actions have their own dispatch arm in the view rather than going
            // through `sessionChatHostAction`, because the view has to read its own composer
            // selection or its own image cache before it can perform them.
            let kind = match action.as_str() {
                "attachmentReferences" => Some(RequestKind::AttachmentReferences),
                "chatImage" => Some(RequestKind::ChatImage),
                _ => None,
            };
            match kind {
                Some(kind) => Routed::Renderer(Box::new(HostRequest {
                    id: None,
                    kind,
                    method: String::new(),
                    params,
                })),
                None => Routed::Renderer(Box::new(host_action(&action, params))),
            }
        }
        // `Effect` is `#[non_exhaustive]`: a core newer than this host is a missing arm, not a
        // crash, and the counter says so.
        _ => Routed::Renderer(Box::new(HostRequest {
            id: None,
            kind: RequestKind::Other("unrouted".to_string()),
            method: String::new(),
            params: Map::new(),
        })),
    }
}

/// `{kind: "broker", method, params}`: what the view forwards to the app runtime's transport.
fn broker(method: &str, params: Map<String, Value>) -> HostRequest {
    HostRequest {
        id: None,
        kind: RequestKind::Broker,
        method: method.to_string(),
        params,
    }
}

/// `{kind: "host", method: <action>, params}`: the view turns it into
/// `{type: "sessionChatHostAction", action, ...params}`.
fn host_action(action: &str, params: Map<String, Value>) -> HostRequest {
    HostRequest {
        id: None,
        kind: RequestKind::Host,
        method: action.to_string(),
        params,
    }
}

/// A params object, or an empty one for a payload that is not an object.
fn object(value: Value) -> Map<String, Value> {
    match value {
        Value::Object(map) => map,
        _ => Map::new(),
    }
}
