//! The retained transcript cache: the record a reopened chat draws before its snapshot arrives.
//!
//! `apps/desktop/sidebar/session-chat-runtime/persistence.ts`, which is 30 lines of TypeScript
//! around one managed store. The RECORD is the core's: it encodes and decodes `StoredSnapshot`,
//! applies the freshness window and decides when a fold is worth writing. What is left here is what
//! only a host can do: build the key (it is the one that knows the machine id), perform the
//! read-modify-write, and keep the store inside the bound the catalog gives it.
//!
//! CDXC:SessionChat 2026-09-22 WHY:
//! The key is the RETENTION key, `JSON.stringify([machineId, projectId, sessionId])`, and not the
//! storage session key every other chat record is suffixed with. Those two disagree for a remote
//! session (`remote-<machineId>:<projectId>:<sessionId>` against the three-element array), so a
//! cache written under the wrong one is a record the TypeScript brain never reads and a remote chat
//! that draws empty every time it is reopened.

use serde_json::Value;

use ghostex_gx_chat_core::StorageKey;

use super::storage;

/// `managedStore('chatSnapshots')`.
const STORE: &str = "chatSnapshots";

/// The catalog's `maxEntries` for this store.
///
/// CDXC:SessionChat 2026-09-22 WHY:
/// The host prunes to it before writing a new key, because the catalog gives `chatSnapshots` a
/// `cache` policy where the client-storage SERVICE evicts the oldest row to make room, and the Rust
/// record door refuses instead, on purpose (`gx_store/records_storage.rs`). Without the prune the
/// cache would freeze on the first 24 sessions ever retained: every later session's write would be
/// refused and every one of those chats would draw an empty transcript on reopen until a seven-day
/// expiry let one of the 24 go. This is the same shape as the sent history's, and the same fix.
const MAX_ENTRIES: usize = 24;

/// `readPersistedSessionChat(key)`: the stored record, verbatim.
///
/// The freshness window is the core's (`session::persistence::decode` drops a record older than
/// seven days), so this hands over whatever is on disk and lets the core refuse it.
pub(super) fn read(key: &str, now_ms: i64) -> Result<Option<String>, &'static str> {
    storage::read(&record_key(key), now_ms).map(|raw| raw.filter(|raw| !raw.is_empty()))
}

/// `persistSessionChat`, which is `storage.update(key, previous => …)`.
///
/// Two rules, in the TypeScript's order. A record already on disk with a NEWER `savedAt` wins and
/// nothing is written, so two writers racing cannot roll the cached tail backwards. A `value` of
/// `None` is the callback returning `undefined`, which DELETES: the core sends it for a snapshot
/// over the record bound, and an oversized snapshot is disposable because slicing it would leave
/// the server's pagination cursor pointing at a row that is gone.
///
/// Nothing answers this. A refused cache write is not a failure the chat reports (the live stream
/// stays authoritative), so the caller counts it and moves on.
pub(super) fn write(key: &str, value: Option<&str>, now_ms: i64) -> Result<(), &'static str> {
    let record = record_key(key);
    let Some(value) = value else {
        return storage::write(&record, None, now_ms);
    };
    let stored = storage::read(&record, now_ms)?.filter(|raw| !raw.is_empty());
    if saved_at(stored.as_deref()) > saved_at(Some(value)) {
        return Ok(());
    }
    if stored.is_none() {
        prune(MAX_ENTRIES - 1, now_ms);
    }
    storage::write(&record, Some(value), now_ms)
}

/// The record's own `savedAt`, or 0 for anything that is not one.
///
/// `previous?.savedAt ?? 0`, with JavaScript's reading of the number: a stamp written `1.7e12` is
/// the same instant as `1700000000000`, and `Value::as_i64` answers `None` for the first of those.
fn saved_at(raw: Option<&str>) -> f64 {
    raw.and_then(|raw| serde_json::from_str::<Value>(raw).ok())
        .as_ref()
        .and_then(|value| value.get("savedAt"))
        .and_then(Value::as_f64)
        .unwrap_or(0.0)
}

/// Keeps the newest `keep` records and deletes the rest, oldest `savedAt` first.
///
/// A row whose payload no longer decodes has no stamp to sort by and reads as the oldest there is,
/// which is the right answer: it is a record nothing can draw from anyway.
fn prune(keep: usize, now_ms: i64) {
    let Ok(rows) = storage::scan(STORE, "", now_ms) else {
        return;
    };
    if rows.len() <= keep {
        return;
    }
    let mut records: Vec<(f64, String)> = rows
        .into_iter()
        .map(|(suffix, raw)| (saved_at(Some(&raw)), suffix))
        .collect();
    records.sort_by(|left, right| right.0.total_cmp(&left.0));
    for (_, suffix) in records.into_iter().skip(keep) {
        let _ = storage::write(
            &StorageKey {
                store: STORE.to_string(),
                suffix,
            },
            None,
            now_ms,
        );
    }
}

fn record_key(key: &str) -> StorageKey {
    StorageKey {
        store: STORE.to_string(),
        suffix: key.to_string(),
    }
}
