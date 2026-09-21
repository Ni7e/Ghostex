//! One call that reached `globalThis.nativeChat`, parsed from the JSON the bridge carries.
//!
//! The QuickJS brain's entry points are six functions plus five pure helpers plus `take`
//! (`docs/2026-09-21/rust-chat/SEAM.md` section 0). Both readers of that traffic see it as a method
//! name and an argument array: the replay reads them out of a recording line, and a shadow host
//! reads them off the live bridge as it forwards each call to QuickJS. So the parse lives here,
//! once, rather than in either of them.

use serde_json::Value;

/// One call the bridge carries, with its arguments still in wire form.
///
/// The arguments stay [`Value`] rather than being deserialized here, because the translator is
/// what decides which [`crate::Event`] a call becomes and a call this build does not model must
/// still be countable rather than a parse error.
#[derive(Clone, Debug, PartialEq)]
#[non_exhaustive]
pub enum BridgeCall {
    /// `start(config)`: the host's boot configuration.
    Start(Box<Value>),
    /// `action(command)`: one user gesture from the renderer.
    Action(Box<Value>),
    /// `brokerMessage(message)`: a push from the app runtime, fanned out by its own `kind`.
    BrokerMessage(Box<Value>),
    /// `event(frame)`: one gxserver chat frame.
    Frame(Box<Value>),
    /// `resolve(id, value, error)`: an answer to something the brain asked for.
    Resolve {
        /// The request id the OTHER brain allocated. See [`super::BridgeTranslator`] for why it
        /// cannot be used to route the answer.
        id: Value,
        value: Value,
        error: Value,
    },
    /// `tick()`: drain whatever timer is due.
    Tick,
    /// One of the five pure helpers the renderer asks for a single gesture.
    Query {
        query: BridgeQuery,
        arguments: Vec<Value>,
    },
    /// `take(lastRevision)`: drain the document.
    Take {
        /// The revision the CALLER says it last saw. It belongs to the other brain's publish
        /// counter, so the translator drains against its own; this is kept for reporting.
        last_revision: Option<u64>,
    },
}

impl BridgeCall {
    /// Parses one call from the method name and the argument array the bridge carried.
    ///
    /// `None` means this build does not model the method, which the caller counts as a refusal
    /// rather than treating as a no-op.
    pub fn parse(method: &str, arguments: &[Value]) -> Option<Self> {
        let first = || arguments.first().cloned().unwrap_or(Value::Null);
        Some(match method {
            "start" => Self::Start(Box::new(first())),
            "action" => Self::Action(Box::new(first())),
            "brokerMessage" => Self::BrokerMessage(Box::new(first())),
            "event" => Self::Frame(Box::new(first())),
            "resolve" => Self::Resolve {
                id: first(),
                value: arguments.get(1).cloned().unwrap_or(Value::Null),
                error: arguments.get(2).cloned().unwrap_or(Value::Null),
            },
            "tick" => Self::Tick,
            "take" => Self::Take {
                last_revision: arguments.first().and_then(Value::as_u64),
            },
            other => Self::Query {
                query: BridgeQuery::from_wire(other)?,
                arguments: arguments.to_vec(),
            },
        })
    }

    /// The method name this call came in under.
    pub fn method(&self) -> &str {
        match self {
            Self::Start(_) => "start",
            Self::Action(_) => "action",
            Self::BrokerMessage(_) => "brokerMessage",
            Self::Frame(_) => "event",
            Self::Resolve { .. } => "resolve",
            Self::Tick => "tick",
            Self::Query { query, .. } => query.as_str(),
            Self::Take { .. } => "take",
        }
    }
}

/// The five pure helpers. They read state and return an answer; they change nothing.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash)]
pub enum BridgeQuery {
    /// The reference pills a draft's text carries.
    ComposerReferences,
    /// What a keystroke in the composer means.
    ComposerKeyIntent,
    /// The context menu for a reference pill.
    ReferenceMenu,
    /// The context menu for a transcript selection.
    TranscriptMenu,
    /// The toast text for a send the composer refused.
    SendBlockedToast,
}

impl BridgeQuery {
    /// The wire spelling, which is the method name on the bridge.
    pub fn as_str(self) -> &'static str {
        match self {
            Self::ComposerReferences => "composerReferences",
            Self::ComposerKeyIntent => "composerKeyIntent",
            Self::ReferenceMenu => "referenceMenu",
            Self::TranscriptMenu => "transcriptMenu",
            Self::SendBlockedToast => "sendBlockedToast",
        }
    }

    /// Maps a method name to a helper, or `None` when it is not one of the five.
    pub fn from_wire(value: &str) -> Option<Self> {
        Some(match value {
            "composerReferences" => Self::ComposerReferences,
            "composerKeyIntent" => Self::ComposerKeyIntent,
            "referenceMenu" => Self::ReferenceMenu,
            "transcriptMenu" => Self::TranscriptMenu,
            "sendBlockedToast" => Self::SendBlockedToast,
            _ => return None,
        })
    }
}
