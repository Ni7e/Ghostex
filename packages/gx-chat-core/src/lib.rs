//! Platform-neutral core of the Ghostex chat: the brain behind every chat renderer.
//!
//! Inputs are [`Event`]s (gxserver chat frames, user [`UserAction`]s, clock ticks, storage
//! answers). Outputs are the [`Document`] the renderer draws plus [`Effect`]s the host performs.
//! Nothing here touches gpui, threads, sockets, the file system, or a clock; the host passes
//! `now_ms` in. That is what lets the desktop app, the mobile app (through UniFFI), and the web
//! build share one chat brain.
//!
//! Design rules:
//!
//! - The document is the contract. Its JSON must stay identical to what
//!   `packages/shared/session-chat-controller/native-host.ts` publishes today, because 24,000
//!   lines of drawing code in `apps/desktop/src/app/native_chat/` read it by key and must not
//!   change.
//! - Absent, `null` and a value are three different things on the wire. Use `Tri` where the
//!   producer can leave a key out.
//! - Integers stay integers. A JSON `1` written back as `1.0` is a contract break.
//! - No callbacks into the core, no generics and no lifetimes at the public boundary, so the same
//!   API works over UniFFI.
//!
//! The port families each own one directory below, listed in
//! `docs/2026-09-21/rust-chat/FAMILIES.md`. Nobody edits outside their own directory except to add
//! one line to a barrel here.

mod action;
pub mod bridge;
pub mod composer;
mod core;
mod dispatch;
mod document;
mod effect;
mod event;
pub mod extras;
pub mod menus;
pub mod questions;
pub mod session;
pub mod state;
pub mod transcript;
mod wire;

pub use crate::action::{ActionKind, UserAction};
pub use crate::core::ChatCore;
pub use crate::dispatch::{owner, Family};
pub use crate::document::{
    assemble, frame_parts, AccountStatus, AsyncQuestions, ComposerActions, ComposerChrome,
    ComposerOverflow, DeferredWorkRow, Document, Draft, EmptyState, Frame, FrameParts, HostAction,
    IncomingDraft, Interaction, ItemsSplice, MinimapMarker, NewSessionWelcome, Note,
    PreviewSettings, ProjectedMessage, Queue, QueueCapabilities, QueuedPrompt, QuestionCard,
    QuestionControls, QuestionDraft, RowDetails, TerminalTail, TerminalTailNotice, TranscriptItem,
    ViewState, WorkingStrip,
};
pub use crate::state::{
    ChatContext, ChatState, CommandMarker, ComposerState, CoreState, ExtrasState, FormattedTime,
    FormattedTimeStyle, FramePosition,
    LoadEarlierRequest, MenusState, MessagesState, PendingSend, PendingState, QuestionsState,
    ResyncState, SessionIdentity, SessionState, TerminalStream, TranscriptViewState,
};
pub use crate::effect::{Effect, HostRequest, OpenTarget, RequestKind};
pub use crate::event::{
    ChatSettings, ComposerBootRead, ConnectionUpdate, Event, Measurement, OpenRowDetail,
    StartConfig, StorageKey,
};
pub use crate::wire::{
    ChatAppendedFrame, ChatBlock, ChatFrame, ChatFrameBase, ChatMessage, ChatRole, ChatRpcMethod,
    ChatSideState, ChatSnapshotFrame, ChatStateFrame, ChatStatus, ClientMessage,
    ReadSessionChatResult, RpcErrorCode, RpcOutcome, ServerEvent, StreamPosition, TurnLifecycle,
    CHAT_FRAME_TYPES, GXSERVER_EVENTS_STREAM_SESSION_CHAT, GXSERVER_PROTOCOL_VERSION,
};

/// Absent versus `null` versus a value, reused from the wire crate so both sides spell it once.
pub use ghostex_gx_protocol::Tri;

/// The wire types, re-exported so a host needs one dependency.
pub use ghostex_gx_protocol as protocol;
