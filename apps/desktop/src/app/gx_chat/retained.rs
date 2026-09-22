//! The retained transcript cache: the record a reopened chat draws before its snapshot arrives.
//!
//! The read half of `apps/desktop/sidebar/session-chat-runtime/persistence.ts`. The RECORD is the
//! core's to decode and to judge fresh; the WRITES are the app runtime's retained store's, which
//! still owns the subscription (`worker.rs`, the `WriteRetainedSnapshot` arm). What is left here is
//! building the key, which only the host can do because it knows the machine id.
//!
//! CDXC:SessionChat 2026-09-22 WHY:
//! The key is the RETENTION key, `JSON.stringify([machineId, projectId, sessionId])`, and not the
//! storage session key every other chat record is suffixed with. Those two disagree for a remote
//! session (`remote-<machineId>:<projectId>:<sessionId>` against the three-element array), so a
//! cache written under the wrong one is a record the TypeScript brain never reads and a remote chat
//! that draws empty every time it is reopened.

use ghostex_gx_chat_core::StorageKey;

use super::storage;

/// `managedStore('chatSnapshots')`.
const STORE: &str = "chatSnapshots";

/// `readPersistedSessionChat(key)`: the stored record, verbatim.
///
/// The freshness window is the core's (`session::persistence::decode` drops a record older than
/// seven days), so this hands over whatever is on disk and lets the core refuse it.
pub(super) fn read(key: &str, now_ms: i64) -> Result<Option<String>, &'static str> {
    storage::read(&record_key(key), now_ms).map(|raw| raw.filter(|raw| !raw.is_empty()))
}

fn record_key(key: &str) -> StorageKey {
    StorageKey {
        store: STORE.to_string(),
        suffix: key.to_string(),
    }
}
