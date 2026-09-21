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

use ghostex_gx_chat_core::{Effect, HostRequest, OpenTarget, RequestKind, UserAction};
use serde_json::{Map, Value};

/// Who performs one effect.
pub(super) enum Routed {
    /// This thread: storage, the boot read, the timer.
    Host(Effect),
    /// The view, through the frame's `requests` array.
    Renderer(Box<HostRequest>),
    /// The core itself, as a gesture it asked to have replayed at it.
    SelfAction(Box<UserAction>),
}

/// The host actions the core emits that nothing performs, and why each is here.
///
/// CDXC:SessionChat 2026-09-22 WHY:
/// One left, and it is a no-op on the TypeScript side too. `suggestionSend` is the slash picker
/// saying "the draft is already the whole command, send it instead of completing it", which
/// `native-host.ts` answers by pushing nothing at all: its arm keeps only a completion that carries
/// `content`, so `{send: true}` falls out of the switch. The send happens in the VIEW, one step
/// earlier: `keyboard.rs` reads `suggestions.sendOnEnter` off the snapshot and calls `send` itself
/// rather than dispatching `suggestionKey`, so the core's inner rule (the same rule, in
/// `composer/suggestions.rs`) is only reached when the view's snapshot is a turn stale. The host
/// CANNOT perform it: a send needs the composer field, the draft id and the draft revision, all of
/// which are the view's. Performing it here would make the Rust brain send where the QuickJS brain
/// swallows the key, which is a behaviour change the parity window must not make. It stays counted
/// by name so a rise in `hostActionsDropped` is visible; the name is a code constant, never a
/// user's data.
///
/// `selectModel` and `switchDraftAgentForProvider` left this list on 2026-09-22: core agent 3
/// resolved both inside the crate (`menus/picker/settle.rs`, `menus/picker/actions.rs`), so the
/// model pick now goes down the durable outbox lane and the provider switch looks its own agent up.
pub(super) const UNPERFORMED_HOST_ACTIONS: &[&str] = &["suggestionSend"];

/// Sorts one effect into its performer.
///
/// Exhaustive on purpose. An effect a later family adds and nobody routes would otherwise vanish
/// without a trace, which is the failure mode `SEAM.md` section 5 records for `actionComplete`.
pub(super) fn route(effect: Effect) -> Routed {
    match effect {
        Effect::ReadStorage { .. }
        | Effect::ReadStorageBatch { .. }
        | Effect::WriteStorage { .. }
        | Effect::WriteStorageBatch { .. }
        | Effect::ReadComposerBoot { .. }
        | Effect::FlushStorage { .. }
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
            Routed::Renderer(Box::new(dispatched("openLink", params)))
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
            Routed::Renderer(Box::new(dispatched("openFile", params)))
        }
        // The QuickJS brain never pushed either kind: a clipboard write only ever reached the view
        // inside `markdownSaved`, and a toast is a raw `{type: "toast"}` app message rather than a
        // `sessionChatHostAction`. Both go out as their own dispatch arm rather than as a `host`
        // method the app shell would silently drop, so the first family to emit one is drawn
        // instead of counted.
        Effect::Copy { text } => {
            let mut params = Map::new();
            params.insert("text".into(), Value::String(text));
            Routed::Renderer(Box::new(HostRequest {
                id: None,
                kind: RequestKind::Other("copy".to_string()),
                method: String::new(),
                params,
            }))
        }
        Effect::Toast { level, message } => {
            let mut params = Map::new();
            params.insert("level".into(), Value::String(level));
            params.insert("message".into(), Value::String(message));
            Routed::Renderer(Box::new(HostRequest {
                id: None,
                kind: RequestKind::Other("toast".to_string()),
                method: String::new(),
                params,
            }))
        }
        // `{kind: 'returnedPrompt', method: 'restore', params: {text}}`, which is what
        // `native-host.ts:1179` pushes for `restoreReturned`. The view compares it against its own
        // composer text before it applies it, so the text crosses and the decision stays the
        // view's. Before this arm the effect fell through to the wildcard and was counted as
        // `effectsUnrouted`: a prompt the agent handed back reached no composer.
        Effect::RestoreReturnedPrompt { text } => {
            let mut params = Map::new();
            params.insert("text".into(), Value::String(text));
            Routed::Renderer(Box::new(HostRequest {
                id: None,
                kind: RequestKind::ReturnedPrompt,
                method: "restore".to_string(),
                params,
            }))
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
        // `selectOption` is a gesture the core asked to have replayed at itself: its params are
        // already a `UserAction`, `"type"` and all, because `native-host.ts` called its own
        // `action` switch here rather than pushing a request. Feeding it back is what makes a model
        // menu's option pick land; forwarding it to the app shell would drop it.
        Effect::HostAction { action, params } if action == "selectOption" => {
            match serde_json::from_value::<UserAction>(*params) {
                Ok(action) => Routed::SelfAction(Box::new(action)),
                Err(_) => Routed::Renderer(Box::new(HostRequest {
                    id: None,
                    kind: RequestKind::Other(UNROUTED.to_string()),
                    method: String::new(),
                    params: Map::new(),
                })),
            }
        }
        Effect::HostAction { action, params } => {
            Routed::Renderer(Box::new(dispatched(&action, object(*params))))
        }
        // `Effect` is `#[non_exhaustive]`: a core newer than this host is a missing arm, not a
        // crash. Every variant this build knows is spelled out above, so an arm can only be missing
        // when the crate grows one, and `gxChat.host.summary` counts it as `effectsUnrouted`.
        _ => Routed::Renderer(Box::new(HostRequest {
            id: None,
            kind: RequestKind::Other(UNROUTED.to_string()),
            method: String::new(),
            params: Map::new(),
        })),
    }
}

/// The dispatch kind an effect this build does not know rides under.
///
/// The view has no arm for it, so it draws nothing; the counter is how it is noticed.
pub(super) const UNROUTED: &str = "unrouted";

/// `{kind: "broker", method, params}`: what the view forwards to the app runtime's transport.
fn broker(method: &str, params: Map<String, Value>) -> HostRequest {
    HostRequest {
        id: None,
        kind: RequestKind::Broker,
        method: method.to_string(),
        params,
    }
}

/// The request one [`Effect::HostAction`] rides in.
///
/// CDXC:SessionChat 2026-09-22 WHY:
/// Five of the core's host actions are NOT `sessionChatHostAction`s. The QuickJS brain pushed each
/// under a dispatch kind of its own, because the view has to read its own composer field, its own
/// selection, its own draft revision or its own image cache before it can perform them
/// (`native-host.ts` lines 1130, 1216, 1247, 1296, 1498). Routed through `host` they would reach
/// `receive_session_chat_host_action`, which has no arm for any of them and drops them: a send
/// would clear no field, a failed send would restore no text, and a draft arriving from another
/// client would reach no composer. The method and the parameter shape are the view's, not the
/// core's, so both are built here.
fn dispatched(action: &str, mut params: Map<String, Value>) -> HostRequest {
    let method = |params: &Map<String, Value>, fallback: &str| {
        params
            .get("method")
            .and_then(Value::as_str)
            .unwrap_or(fallback)
            .to_string()
    };
    match action {
        // `insertAttachments` reads `paths` and the view supplies the selection.
        "attachmentReferences" => HostRequest {
            id: None,
            kind: RequestKind::AttachmentReferences,
            method: "insert".to_string(),
            params,
        },
        // `receive_chat_image` reads `method == "loaded"` and then `base64Data` and `mediaType`
        // from `params` itself, where the core nests the whole read answer under `image`
        // (`transcript/actions.rs`, re-checked 2026-09-22). The nesting is the core's deliberate
        // shape and the flattening is the view's wire form, so the translation lives here: a read
        // that failed carries `path` and `error` and no `image`, which is exactly the `failed`
        // method the view's early return wants.
        "chatImage" => {
            let loaded = params.remove("image").filter(Value::is_object);
            let found = loaded.is_some();
            if let Some(Value::Object(image)) = loaded {
                for (key, value) in image {
                    params.entry(key).or_insert(value);
                }
            }
            HostRequest {
                id: None,
                kind: RequestKind::ChatImage,
                method: if found { "loaded" } else { "failed" }.to_string(),
                params,
            }
        }
        // The view dispatches these three on the request's `method`, which is the gesture that
        // produced them: `send`, `queue`, `compact` or `handoff`.
        "draftSubmitted" => HostRequest {
            id: None,
            kind: RequestKind::DraftSubmitted,
            method: method(&params, "send"),
            params,
        },
        "submissionFailed" => HostRequest {
            id: None,
            kind: RequestKind::SubmissionFailed,
            method: method(&params, "send"),
            params,
        },
        "draftReceived" => HostRequest {
            id: None,
            kind: RequestKind::DraftReceived,
            method: "handoff".to_string(),
            params,
        },
        // Everything else is `{kind: "host", method: <action>, params}`, which the view turns into
        // `{type: "sessionChatHostAction", action, ...params}`.
        _ => HostRequest {
            id: None,
            kind: RequestKind::Host,
            method: action.to_string(),
            params,
        },
    }
}

/// A params object, or an empty one for a payload that is not an object.
fn object(value: Value) -> Map<String, Value> {
    match value {
        Value::Object(map) => map,
        _ => Map::new(),
    }
}
