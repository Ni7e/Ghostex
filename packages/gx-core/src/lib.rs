//! Platform-neutral core of the Ghostex client: the one store that owns product state.
//!
//! Inputs are [`Event`]s (wire frames, user [`Intent`]s, clock ticks). Outputs are state, read
//! through selectors, plus [`Effect`]s: requests the host performs. Nothing in this crate touches
//! gpui, threads, sockets, the file system, or a clock; the host passes `now_ms` in. That is what
//! lets the desktop app, the mobile app (through UniFFI), and the web build share it.
//!
//! Design rules:
//!
//! - One owner per piece of state. Focus lives in [`FocusState`] and nowhere else.
//! - A local intent applies at once and always wins over a server or echo update older than it.
//! - "Not loaded yet" and "empty" are different types ([`PresentationState`], [`Loadable`]).
//! - Daemon rows are replaced whole, never merged; local edits are overlays that never renumber
//!   the revision.

mod change;
mod core;
mod focus;
mod keys;
mod overlay;
mod presentation_store;
mod selectors;

pub use crate::change::{ChangeSummary, IgnoredReason, SideStateChanges};
pub use crate::core::{Core, Effect, Event, Intent, Output, ResubscribeReason};
pub use crate::focus::{
    default_group_for_project, next_visible_sessions_for_local_focus, ActiveGroup,
    ExternalFocusUpdate, FocusOutcome, FocusState,
};
pub use crate::keys::{
    decode_uri_component, encode_uri_component, encode_workspace_subgroup_id,
    parse_workspace_subgroup_id, MachineId, ProjectKey, SessionKey, CHATS_GROUP_ID,
};
pub use crate::overlay::SessionPatch;
pub use crate::presentation_store::{
    LoadedPresentation, MachinePresentation, PresentationState, PresentationStore, SideState,
    SideStateUpdate, SnapshotOrigin,
};
pub use crate::selectors::{
    is_chat_project_path, Loadable, TabSession, DEFAULT_TERMINAL_SESSION_TITLE,
    QUICK_AUTOMATIONS_PROJECT_ID, TAB_SESSION_TITLE_MAX_UTF16,
};

/// The wire types, re-exported so a host needs one dependency.
pub use ghostex_gx_protocol as protocol;
