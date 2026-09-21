//! The transcript region's own state: which of the empty, loading, starting and ready pictures the
//! renderer draws, and the copy that goes with it.

use ghostex_gx_protocol::Tri;
use serde::{Deserialize, Serialize};

/// What the transcript region is doing, from
/// `packages/core-ui/chat/session-chat-view-state.ts`.
#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ViewState {
    /// `ready`, `empty`, `loading`, `starting`, `notFound`, `error`.
    pub kind: String,
    #[serde(default, skip_serializing_if = "Tri::is_absent")]
    pub is_working: Tri<bool>,
    /// The failure copy a `kind: "error"` view carries.
    #[serde(default, skip_serializing_if = "Tri::is_absent")]
    pub error: Tri<String>,
}

/// The headline and detail an empty transcript shows.
#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EmptyState {
    pub title: String,
    pub detail: String,
}

/// The greeting a brand new session shows instead of the empty copy.
#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NewSessionWelcome {
    pub agent_name: String,
    /// The agent mark, or `null` when the agent has none.
    pub icon: Option<String>,
    /// Dropped once a notice or question card takes the space below the mark.
    pub show_title: bool,
    pub title: String,
}
