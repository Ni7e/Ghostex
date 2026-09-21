//! The chat's state: one struct, six owners.
//!
//! Each family owns exactly one file here (`docs/2026-09-21/rust-chat/FAMILIES.md`). Adding a
//! family's own module below is the only edit anyone makes outside their own directory.

mod chat;
mod composer;
mod context;
mod extras;
mod menus;
mod messages;
mod pending;
mod questions;
mod session;
mod transcript_view;

pub use crate::state::chat::{ChatState, CoreState};
pub use crate::state::composer::ComposerState;
pub use crate::state::context::ChatContext;
pub use crate::state::extras::ExtrasState;
pub use crate::state::menus::MenusState;
pub use crate::state::messages::{FramePosition, LoadEarlierRequest, MessagesState, ResyncState};
pub use crate::state::pending::{
    CommandMarker, PendingSend, PendingState, StartupDelivery, TerminalStream,
};
pub use crate::state::questions::QuestionsState;
pub use crate::state::session::{SessionIdentity, SessionState};
pub use crate::state::transcript_view::TranscriptViewState;
