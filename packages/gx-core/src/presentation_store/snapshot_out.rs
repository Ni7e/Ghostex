//! The reverse of a snapshot: the rows a machine holds, written back out as one
//! `PresentationSnapshot`.
//!
//! CDXC:RemoteMachines 2026-09-21 WHY:
//! The last-seen copy of an offline remote machine is stored as a whole
//! `GxserverPresentationSnapshot`, the same shape the stream delivers, so the store has to be able
//! to hand one back. That is a decoding question rather than a serializing one: the value the old
//! sidebar writes is what the old sidebar reads, and both are still live, so a copy that dropped a
//! field or reordered an array would be a different payload for the same key and the two writers
//! would flip the row between them on every publish.
//!
//! **What makes the two bytewise equal is the ARRAY ORDER, and it is the daemon's own.** Projects
//! and groups keep the `(sortKey, id)` order [`super::loaded`] already sorts them into; sessions
//! are written in `(projectId, groupId, sortKey, sessionId)` order, which is the key sequence
//! `orderPresentationSessions` (`packages/shared/gxserver-presentation-cache.ts`) re-sorts the
//! TypeScript cache into after every delta. Byte order rather than `localeCompare`, for the reason
//! on `sort_projects`: the daemon orders by byte order and the store follows the daemon.
//!
//! **What is NOT written, on purpose.** The local overlays (a pending sleep, a local hide, a
//! manual reorder's predicted row) are this client's guesses about a machine, not the machine, and
//! a copy read back next run must start from what the daemon said. Rows a snapshot could not parse
//! (`Rows::skipped`) are not written back either: the store does not hold them.
//!
//! SEE-ALSO: apps/desktop/src/app/gx_store/remote_last_seen.rs (the only caller today),
//! packages/gx-core/src/presentation_store/apply.rs (`seed_last_seen`, which reads one back in).

use ghostex_gx_protocol::{PresentationSession, PresentationSnapshot};
use serde_json::{Map, Value};

use super::store::MachinePresentation;

/// A snapshot as the stored copy holds it: JSON with every object's keys in byte order.
///
/// CDXC:RemoteMachines 2026-09-21 WHY:
/// The order is not cosmetic and it is not `serde_json`'s to decide. gxserver builds its frames
/// with `json!` into a `BTreeMap`, so every object reaches the wire in byte order, and
/// `JSON.stringify` of the parsed object keeps it, which is the order the old sidebar's copy of
/// this key is written in. A Rust struct serializes in DECLARATION order, and the desktop binary
/// turns `serde_json`'s map into an `IndexMap` (gpui pulls in the `preserve_order` feature), so
/// nothing about the default output is the daemon's order. Sorting here makes the two writers
/// produce the same bytes for the same rows, which is what lets the write be skipped instead of
/// flipping the row and its `updatedAt` on every publish.
pub fn snapshot_storage_json(snapshot: &PresentationSnapshot) -> String {
    let value = serde_json::to_value(snapshot).unwrap_or(Value::Null);
    sorted_json(&value).to_string()
}

/// The same value with every object's keys in byte order, recursively.
pub fn sorted_json(value: &Value) -> Value {
    match value {
        Value::Object(map) => {
            let mut keys: Vec<&String> = map.keys().collect();
            keys.sort_by(|left, right| left.as_bytes().cmp(right.as_bytes()));
            let mut sorted = Map::new();
            for key in keys {
                sorted.insert(key.clone(), sorted_json(&map[key]));
            }
            Value::Object(sorted)
        }
        Value::Array(items) => Value::Array(items.iter().map(sorted_json).collect()),
        other => other.clone(),
    }
}

impl MachinePresentation {
    /// The machine's daemon rows and side state as one snapshot, or `None` while it is not loaded.
    ///
    /// Round-trips: a snapshot fed in through `apply_snapshot` or `seed_last_seen` and asked back
    /// for here serializes to the same bytes, which the `last-seen transition` pass of
    /// `sidebar_replay` asserts against the recording's own snapshot.
    pub fn to_snapshot(&self) -> Option<PresentationSnapshot> {
        let loaded = self.loaded()?;
        let mut sessions: Vec<PresentationSession> = loaded.server_sessions().cloned().collect();
        sessions.sort_by(|left, right| session_order(left).cmp(&session_order(right)));
        Some(PresentationSnapshot {
            revision: loaded.revision,
            generated_at: loaded.generated_at.clone(),
            projects: loaded.projects().to_vec().into(),
            groups: loaded.groups().to_vec().into(),
            sessions: sessions.into(),
            capabilities: loaded.capabilities.clone(),
            auto_settle_after_days: loaded.auto_settle_after_days.clone(),
            portless: loaded.portless.clone(),
            workspace_groups: self.side_state().workspace_groups.clone(),
            sidebar_project_collections: self.side_state().project_collections.clone(),
            sidebar_spaces: self.side_state().spaces.clone(),
            custom_session_tags: self.side_state().custom_session_tags.clone(),
        })
    }
}

/// `orderPresentationSessions`' key sequence.
fn session_order(session: &PresentationSession) -> (&str, &str, &str, &str) {
    (
        session.project_id.as_str(),
        session.group_id.as_str(),
        session.sort_key.as_str(),
        session.session_id.as_str(),
    )
}
