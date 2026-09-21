//! The retained snapshot record, as it is written to and read from client storage.
//!
//! Ported from `apps/desktop/sidebar/session-chat-runtime/persistence.ts`. The record must stay
//! byte compatible with what the TypeScript wrote, because an installed Ghostex reads its own old
//! records after the switch: every number is an integer here for the same reason
//! `packages/chat-runtime/src/storage_records.rs` had to be fixed, since JavaScript writes `1`
//! where an `f64` would write `1.0`.

use serde::{Deserialize, Serialize};

use crate::session::constants::{PERSISTED_MAX_AGE_MS, PERSISTED_MAX_RECORD_BYTES};
use crate::session::fold::FoldedSnapshot;

/// One stored conversation.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StoredSnapshot {
    /// `JSON.stringify([machineId, projectId, sessionId])`, the store's own key.
    pub key: String,
    /// Epoch milliseconds, an integer.
    pub saved_at: i64,
    /// The window the next read should ask for, so a restored tail is not re-read smaller.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub requested_window: Option<u32>,
    pub snapshot: FoldedSnapshot,
}

/// The store key for one session on one machine.
///
/// `JSON.stringify` of a three-string array, which is what the TypeScript writes and what an
/// installed Ghostex already has on disk.
pub fn storage_key(machine_id: &str, project_id: &str, session_id: &str) -> String {
    serde_json::to_string(&[machine_id, project_id, session_id]).unwrap_or_default()
}

/// Whether a stored record is still usable, which is the read-side half of the bound.
pub fn is_fresh(record: &StoredSnapshot, now_ms: f64) -> bool {
    now_ms - (record.saved_at as f64) < PERSISTED_MAX_AGE_MS
}

/// Whether a record may be written at all.
///
/// The TypeScript measures `JSON.stringify(snapshot).length * 2`, which is the UTF-16 byte size of
/// the serialized value; an oversized snapshot is dropped rather than sliced, because slicing
/// would leave an invalid pagination cursor behind.
pub fn fits_record_bound(snapshot: &FoldedSnapshot) -> bool {
    let Ok(text) = serde_json::to_string(snapshot) else {
        return false;
    };
    text.encode_utf16().count() * 2 <= PERSISTED_MAX_RECORD_BYTES
}
