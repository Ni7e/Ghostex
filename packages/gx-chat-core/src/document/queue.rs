//! Ghostex's own prompt queue: the rows the agent has not seen yet.

use ghostex_gx_protocol::Tri;
use serde::{Deserialize, Serialize};
use serde_json::Value;

/// The queue as the renderer draws it.
#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Queue {
    pub capabilities: QueueCapabilities,
    /// Authoritative order, head first. Empty while supported but nothing waits.
    pub prompts: Vec<QueuedPrompt>,
}

/// What this daemon supports.
///
/// `supported` is false until a read or a frame CARRIES a queue field; that presence, even as an
/// empty list, is the capability probe. Every control hides rather than calling an endpoint that
/// would answer 404.
#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct QueueCapabilities {
    pub supported: bool,
    pub can_queue: bool,
    pub can_edit: bool,
    pub can_remove: bool,
    pub can_reorder: bool,
    pub can_retry: bool,
    pub can_send_now: bool,
    pub can_sync_draft: bool,
}

/// One queued prompt row.
#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct QueuedPrompt {
    pub id: String,
    pub text: String,
    /// `queued`, `sending`, `failed`, `delivered`.
    pub state: String,
    pub created_at: String,
    pub updated_at: String,
    /// The single line the row shows, projected so both renderers clip identically.
    pub preview: String,
    /// The row is mid-flight, so its controls are held.
    pub busy: bool,
    #[serde(default, skip_serializing_if = "Tri::is_absent")]
    pub error: Tri<String>,
    #[serde(flatten)]
    pub extra: serde_json::Map<String, Value>,
}
