//! The renderer's four calls, turned into the core's one enum.
//!
//! `apps/desktop/src/app/native_chat/state.rs` pushes exactly three shapes at its runtime thread:
//! `action` (a user gesture), `brokerMessage` (a gxserver frame or a settings push) and `resolve`
//! (an answer to a `rpc` request). `tick` is the thread's own. The QuickJS brain has one entry point
//! per shape; the core has one enum, so a `brokerMessage` fans out by its own `kind`, which is what
//! `packages/gx-chat-core/examples/replay.rs` does with the same records.

use ghostex_gx_chat_core::{
    ChatFrame, ChatSettings, ConnectionUpdate, Event, RpcOutcome, StartConfig, UserAction,
    protocol::{ChatAppendedFrame, ChatSnapshotFrame, ChatStateFrame},
};
use serde_json::Value;

/// The events one renderer call becomes. Empty for a call this build does not model, which the
/// caller counts as a refusal rather than a silent no-op.
pub(super) fn events_for(method: &str, arguments: &[Value]) -> Vec<Event> {
    match method {
        "start" => arguments
            .first()
            .and_then(|value| serde_json::from_value::<StartConfig>(value.clone()).ok())
            .map(|config| vec![Event::Start(Box::new(config))])
            .unwrap_or_default(),
        "action" => arguments
            .first()
            .and_then(|value| serde_json::from_value::<UserAction>(value.clone()).ok())
            .map(|action| vec![Event::Action(Box::new(action))])
            .unwrap_or_default(),
        "tick" => vec![Event::Tick],
        "brokerMessage" => broker_events(arguments.first()),
        "resolve" => Vec::new(),
        _ => Vec::new(),
    }
}

/// The `resolve` the view sends after a `rpc` request settles.
///
/// `arguments` is `[id, result, error]`, and the id is the one the core allocated: the view echoes
/// `request["id"]` back verbatim, so unlike a replay there is no order matching to do here. A
/// refusal is an answer like any other: it settles the request as `RpcOutcome::Err`, with or
/// without a code, because a request the core never hears back about keeps its lane in flight for
/// ever. The only call that yields no event is one with no usable id, and the caller counts it.
pub(super) fn resolved(arguments: &[Value]) -> Option<Event> {
    let request_id = arguments.first().and_then(request_id)?;
    let result = arguments.get(1).cloned().unwrap_or(Value::Null);
    let error = arguments.get(2).filter(|value| !value.is_null());
    let outcome = match error {
        Some(error) => RpcOutcome::Err {
            code: error
                .get("code")
                .and_then(Value::as_str)
                .map(str::to_string),
            message: error
                .get("message")
                .and_then(Value::as_str)
                .unwrap_or("Request failed.")
                .to_string(),
            endpoint: error
                .get("endpoint")
                .and_then(Value::as_str)
                .map(str::to_string),
        },
        None => RpcOutcome::Ok { result },
    };
    Some(Event::RpcSettled {
        request_id,
        outcome: Box::new(outcome),
    })
}

/// A request id as the view echoes it: the number the core allocated. A whole number that crossed
/// as a float or a string is still that id.
fn request_id(value: &Value) -> Option<u64> {
    value
        .as_u64()
        .or_else(|| {
            value
                .as_f64()
                .filter(|id| id.fract() == 0.0 && *id >= 0.0 && *id < 2f64.powi(53))
                .map(|id| id as u64)
        })
        .or_else(|| value.as_str().and_then(|id| id.parse::<u64>().ok()))
}

/// What a broken chunked transfer does to the chat: the same retry a `reset` asks for, which is
/// what `ChatTransfers`' failure callback runs (`controller.current().retry()`).
pub(super) fn transfer_failed() -> Event {
    Event::Connection(ConnectionUpdate::Resubscribed)
}

/// The seven `brokerMessage` kinds the QuickJS brain takes, minus the two the host answers
/// elsewhere.
///
/// `chunk` is reassembled by `transfers.rs` before it reaches this function, and a `response`
/// answers a broker request id the Rust host never issues (its reads are `rpc`s, answered by
/// `resolve`), so the one the relay can still send ("The shared chat service is starting.") is
/// counted rather than routed.
fn broker_events(message: Option<&Value>) -> Vec<Event> {
    let Some(message) = message else {
        return Vec::new();
    };
    match message.get("kind").and_then(Value::as_str) {
        Some("event") => chat_frame(message.get("event").or_else(|| message.get("payload"))),
        Some("chatSettings") => message
            .get("settings")
            .or_else(|| message.get("payload"))
            .and_then(|value| serde_json::from_value::<ChatSettings>(value.clone()).ok())
            .map(|settings| vec![Event::SettingsChanged(Box::new(settings))])
            .unwrap_or_default(),
        Some("contextPreferences") => vec![Event::ContextPreferencesChanged {
            provider: message
                .get("provider")
                .and_then(Value::as_str)
                .unwrap_or_default()
                .to_string(),
            preferences: message.get("preferences").cloned().unwrap_or(Value::Null),
        }],
        Some("catalog") => vec![Event::ModelCatalogChanged {
            catalog: message.get("catalog").cloned().unwrap_or(Value::Null),
        }],
        // `reset` is the transport saying it rebuilt itself, which is what re-reads everything.
        Some("reset") => vec![Event::Connection(ConnectionUpdate::Resubscribed)],
        _ => Vec::new(),
    }
}

/// One of the four admitted frame types, already parsed.
///
/// The eight field checks `apps/desktop/sidebar/session-chat-runtime/socket.ts` runs are the
/// deserializer's here: a frame missing `projectId`, `sessionId`, `epoch`, `seq` or `serverId`
/// fails to parse and is dropped, which is the same answer.
fn chat_frame(value: Option<&Value>) -> Vec<Event> {
    let Some(value) = value else {
        return Vec::new();
    };
    let frame = match value.get("type").and_then(Value::as_str) {
        Some("sessionChatSnapshot") => serde_json::from_value::<ChatSnapshotFrame>(value.clone())
            .ok()
            .map(|frame| ChatFrame::Snapshot(Box::new(frame))),
        Some("sessionChatReplaced") => serde_json::from_value::<ChatSnapshotFrame>(value.clone())
            .ok()
            .map(|frame| ChatFrame::Replaced(Box::new(frame))),
        Some("sessionChatAppended") => serde_json::from_value::<ChatAppendedFrame>(value.clone())
            .ok()
            .map(|frame| ChatFrame::Appended(Box::new(frame))),
        Some("sessionChatState") => serde_json::from_value::<ChatStateFrame>(value.clone())
            .ok()
            .map(|frame| ChatFrame::State(Box::new(frame))),
        _ => None,
    };
    frame
        .map(|frame| vec![Event::Frame(Box::new(frame))])
        .unwrap_or_default()
}
