//! Everything that can reach the chat core.
//!
//! One enum, one direction. The host performs I/O and turns each result into an event; the core
//! never calls back out, which is what keeps it usable from UniFFI and from wasm.

use serde::{Deserialize, Serialize};
use serde_json::Value;

use crate::action::UserAction;
use crate::wire::{ChatFrame, RpcOutcome};

/// Something that happened outside the core.
#[derive(Clone, Debug, PartialEq)]
#[non_exhaustive]
pub enum Event {
    /// The host is opening this chat. Carries the identity and whatever the host had cached, so
    /// the first document can be drawn before any read answers.
    Start(Box<StartConfig>),
    /// An accepted gxserver frame for this session.
    Frame(Box<ChatFrame>),
    /// The socket's own state changed: connected, lost, or rebuilt.
    Connection(ConnectionUpdate),
    /// A request the core asked for has settled.
    RpcSettled {
        request_id: u64,
        outcome: Box<RpcOutcome>,
    },
    /// The user did something in the renderer.
    Action(Box<UserAction>),
    /// A timer the core set is due, or the host is simply driving the clock.
    Tick,
    /// A stored record the core asked for, or `None` when nothing was stored.
    StorageLoaded {
        key: StorageKey,
        value: Option<String>,
    },
    /// A storage write the core asked for has settled.
    StorageWritten {
        key: StorageKey,
        error: Option<String>,
    },
    /// The chat settings the host pushes changed.
    SettingsChanged(Box<ChatSettings>),
    /// The context-details preferences changed.
    ContextPreferencesChanged {
        provider: String,
        preferences: Value,
    },
    /// The agent model catalog changed.
    ModelCatalogChanged { catalog: Value },
    /// The renderer measured something the document's layout depends on.
    Measured(Measurement),
    /// The host's draft text changed outside the core (it owns the text field).
    DraftChanged { text: String },
}

/// What the host knows when it opens a chat.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StartConfig {
    pub client_id: String,
    pub project_id: String,
    pub session_id: String,
    /// The transcript the host had cached, so the first paint is not blank.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub initial_snapshot: Option<Value>,
    /// The presentation cache the sidebar and the chat share.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub initial_presentation: Option<Value>,
    /// The Chat Lab's scenario, when this chat is a preview rather than a session.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub preview: Option<Value>,
}

/// The socket's state, which decides whether the core waits or re-reads.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum ConnectionUpdate {
    /// The subscription is live and its first authoritative frame may now arrive.
    Subscribed,
    /// The socket went away; the core holds what it has.
    Lost,
    /// A fresh socket replaced the old one, so the stream position restarts.
    Resubscribed,
}

/// A record in client storage the chat owns.
///
/// Spelled as the store plus the per-session suffix rather than the full key, so the host owns the
/// prefix and the core never builds a storage key string.
#[derive(Clone, Debug, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StorageKey {
    /// The catalog store id, for example `questionDrafts` or `notices`.
    pub store: String,
    /// The part of the key after the store's prefix; empty for a singleton record.
    pub suffix: String,
}

/// The two settings the host pushes into the chat.
#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ChatSettings {
    /// Masks account text everywhere the chat shows it.
    pub hide_account_emails: bool,
    /// The session's display title, or `null` when it has none.
    pub title: Option<String>,
}

/// A size or position only the renderer can know, folded back into the document.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum Measurement {
    /// Which composer toolbar controls did not fit.
    ComposerOverflow {
        overflowed: Vec<String>,
        options_overflowed: bool,
    },
    /// Where the status line wraps.
    ContextStatusRows { rows: Vec<u32> },
    /// The rows the renderer currently draws open, so only those ship their detail.
    OpenRowDetails { rows: Vec<OpenRowDetail> },
}

/// One open row, identified the way the renderer keys it.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OpenRowDetail {
    pub key: String,
    /// `file` for a change card, anything else for a tool row.
    pub kind: String,
    pub message_id: String,
    pub index: usize,
}
