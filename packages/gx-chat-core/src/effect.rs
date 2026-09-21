//! Everything the core asks the host to do.
//!
//! The core performs no I/O: it returns effects and waits for the matching [`crate::Event`]. Each
//! effect is plain data so the same list works over UniFFI and over wasm.
//!
//! [`HostRequest`] is the wire form the desktop host already consumes (the `requests` array of a
//! [`crate::Frame`], dispatched in `apps/desktop/src/app/native_chat/state.rs`). [`Effect`] is the
//! typed form the Rust host will use once the QuickJS bridge is gone; both exist during the
//! parity window so a frame stays comparable with the TypeScript producer's.

use serde::{Deserialize, Serialize};
use serde_json::{Map, Value};

use crate::event::StorageKey;
use crate::wire::ChatRpcMethod;

/// One thing the host must do.
#[derive(Clone, Debug, PartialEq)]
#[non_exhaustive]
pub enum Effect {
    /// Call gxserver. The answer comes back as [`crate::Event::RpcSettled`] with this id.
    SendRpc {
        request_id: u64,
        method: ChatRpcMethod,
        params: Box<Value>,
    },
    /// Subscribe this session's chat stream, asking for at least `limit` messages.
    Subscribe { limit: u32, catalog: bool },
    /// Drop the subscription.
    Unsubscribe,
    /// Tear the socket down and build a fresh one, the only recovery for a subscription that came
    /// up but never delivered its snapshot.
    Reconnect,
    /// Read a stored record; answered by [`crate::Event::StorageLoaded`].
    ReadStorage { key: StorageKey },
    /// Read everything the chat needs at boot in one go; answered by
    /// [`crate::Event::ComposerBootRead`].
    ///
    /// The host already owns this as one operation (`composer('read')`), and `start` in
    /// `native-host.ts` publishes nothing until it answers, so the core waits on it the same way
    /// rather than issuing a dozen separate reads whose answers would each ship a frame.
    ReadComposerBoot { request_id: u64 },
    /// Write a stored record. `value` of `None` deletes it.
    WriteStorage {
        key: StorageKey,
        value: Option<String>,
        /// Flush to disk before reporting, for records that must survive a crash.
        durable: bool,
    },
    /// Push a store's pending writes to disk and say when they are there; answered by
    /// [`crate::Event::StorageWritten`] with the same `store` and an empty suffix.
    ///
    /// This is `composer('flush')` on the bridge, which is `flushDraftSaves(sessionKey)`: the
    /// durable save outbox and its retry worker stay with the host
    /// (`docs/2026-09-21/rust-chat/HOST-TODO.md` section 3), and a submission must not deliver
    /// before the submitted revision is on disk. It is its own effect rather than a
    /// [`Effect::WriteStorage`] with no value, which would DELETE the record.
    FlushStorage { store: String },
    /// Wake the core with [`crate::Event::Tick`] in `delay_ms`, or cancel the pending wake when
    /// `delay_ms` is `None`.
    SetTimer { delay_ms: Option<u64> },
    /// Replace the composer text the host owns. `caret` is a UTF-16 offset, which is what a
    /// JavaScript string index is; the host converts it.
    SetComposerText {
        content: String,
        caret: Option<usize>,
        /// The text came from history recall, which the composer treats differently from an
        /// insert.
        from_history: bool,
    },
    /// Clear the composer only if it still holds exactly this text.
    ClearComposerIfUnchanged { text: String },
    /// Ask the host to open a path, a URL, or a file at a position.
    Open(OpenTarget),
    /// Put text on the clipboard.
    Copy { text: String },
    /// Show a toast.
    Toast { level: String, message: String },
    /// A Markdown document was written: put its path on the clipboard and say so.
    ///
    /// Its own variant rather than a [`Effect::HostAction`] string, because the host already has a
    /// dispatch arm for it (`markdownSaved` in `apps/desktop/src/app/native_chat/state.rs`) and the
    /// Effect-to-`HostRequest` mapping would otherwise have to special-case one action name.
    MarkdownSaved { path: String },
    /// Something only the app shell can do: switch to the terminal, pick attachments, report the
    /// composer ready. Free-form because the list belongs to the app, not to chat.
    HostAction { action: String, params: Box<Value> },
}

/// What [`Effect::Open`] should open.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum OpenTarget {
    Url {
        url: String,
    },
    File {
        path: String,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        line: Option<u32>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        column: Option<u32>,
    },
}

/// The wire form of an effect, as it rides in a [`crate::Frame`].
///
/// `kind` chooses the host's dispatch arm, `method` the operation inside it, and `params` carries
/// the rest. `id` is present only on the two kinds that expect an answer.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct HostRequest {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub id: Option<u64>,
    pub kind: RequestKind,
    pub method: String,
    pub params: Map<String, Value>,
}

macro_rules! request_kinds {
    ($($(#[$meta:meta])* $variant:ident => $wire:literal),+ $(,)?) => {
        /// The host dispatch arms. Open, because a host newer than the core may know more.
        #[derive(Clone, Debug, PartialEq, Eq, Hash)]
        pub enum RequestKind {
            $($(#[$meta])* $variant,)+
            /// A kind this build does not know; kept verbatim.
            Other(String),
        }

        impl RequestKind {
            /// The wire spelling.
            pub fn as_str(&self) -> &str {
                match self {
                    $(Self::$variant => $wire,)+
                    Self::Other(value) => value.as_str(),
                }
            }

            /// Maps a wire spelling to a kind; never fails.
            pub fn from_wire(value: &str) -> Self {
                match value {
                    $($wire => Self::$variant,)+
                    other => Self::Other(other.to_string()),
                }
            }
        }
    };
}

request_kinds! {
    /// A gxserver call; the host answers it by id.
    Rpc => "rpc",
    /// A call into the shared transcript broker; answered by id when it carries one.
    Broker => "broker",
    /// Replace the composer text.
    Composer => "composer",
    /// The boot result: client id, draft entry, stored options.
    ComposerInit => "composerInit",
    /// Clear the composer only if it still holds this text.
    ComposerClearExpected => "composerClearExpected",
    /// Insert reference pills for the paths the host just attached.
    AttachmentReferences => "attachmentReferences",
    /// An image read finished or failed.
    ChatImage => "chatImage",
    /// Put the prompt the agent handed back into the composer.
    ReturnedPrompt => "returnedPrompt",
    /// A Markdown document was written; copy its path and say so.
    MarkdownSaved => "markdownSaved",
    /// Something only the app shell can do.
    Host => "host",
    /// A send left the composer.
    DraftSubmitted => "draftSubmitted",
    /// A send failed; put the text back.
    SubmissionFailed => "submissionFailed",
    /// A draft arrived from another client.
    DraftReceived => "draftReceived",
    /// An action finished.
    ActionComplete => "actionComplete",
    /// An action failed.
    ActionError => "actionError",
}

impl Serialize for RequestKind {
    fn serialize<S: serde::Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        serializer.serialize_str(self.as_str())
    }
}

impl<'de> Deserialize<'de> for RequestKind {
    fn deserialize<D: serde::Deserializer<'de>>(deserializer: D) -> Result<Self, D::Error> {
        Ok(Self::from_wire(&String::deserialize(deserializer)?))
    }
}
