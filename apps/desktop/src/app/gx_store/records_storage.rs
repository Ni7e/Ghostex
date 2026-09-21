//! The second table of the client-storage database: `records`, where an indexeddb-catalogued store
//! keeps its rows.
//!
//! CDXC:Settings 2026-09-21 WHY:
//! Every Rust storage door before this one writes the `preferences` table, which is `(key, value)`
//! with `value` the raw string, because every key it owns is catalogued on the `local` backend. A
//! store catalogued on **indexeddb** is a different shape in the same file: `records` is
//! `(key, store, value)` where `value` is the WHOLE ROW as JSON,
//! `{ key, store, raw, bytes, updatedAt, revision, schemaVersion }` (`applyDatabaseMutations` in
//! `packages/client-storage/adapters/database-transaction.ts`, `recordWrite` in
//! `packages/chat-runtime/src/storage.rs`), with `bytes` the UTF-16 accounting of the key and the
//! raw together and `schemaVersion` the catalog row's `version`. Beside it are three `metadata`
//! rows the table's writers all owe, which [`recompute_record_metadata`] rebuilds rather than
//! adjusts.
//!
//! **This door refuses where `admission` evicts, on purpose.** For a `cache` store `admission`
//! makes room by deleting rows, its own store's oldest first and then other cache stores' when the
//! shared 128 MiB backend total is the bound that broke. A sidebar door that quietly deleted
//! another feature's cached data would be a loss nobody could trace back to it, so all four bounds
//! are checked and a value that breaks one is REFUSED and counted. What that costs is written down
//! where it is paid: the one store this door writes holds one row per remote machine against a
//! 32-entry, 24 MiB budget, so its own bound needs more than thirty machines to reach, and the
//! shared one is the client-storage service's to manage as it always has been.
//!
//! SEE-ALSO: apps/desktop/src/app/gx_store/sidebar_ui_storage.rs (the `preferences` door, whose
//! connection pool, busy timeout and error vocabulary this one borrows),
//! packages/chat-runtime/src/storage_metadata.rs (the bookkeeping both writers of this table run).

use ghostex_chat_runtime::recompute_record_metadata;
use rusqlite::{Connection, OptionalExtension, params};
use serde_json::{Value, json};

use super::sidebar_ui_storage::{storage_bytes, with_read_connection, with_write_connection};

/// `STORAGE_BUDGETS.indexeddb` (`packages/client-storage/budgets.ts`), shared by every store on
/// that backend.
const MAX_BACKEND_BYTES: i64 = 128 * 1024 * 1024;

/// One store's row in the catalog, as far as a write needs it.
#[derive(Clone, Copy, Debug)]
pub(super) struct RecordStore {
    /// The catalog `id`, which is also the `store` column and the key of the store's `metadata`
    /// row.
    pub(super) id: &'static str,
    /// The catalog `version`, stored on the row as `schemaVersion`.
    pub(super) version: i64,
    pub(super) max_entry_bytes: i64,
    pub(super) max_bytes: i64,
    pub(super) max_entries: i64,
}

/// What one write did. `Refused` names the bound, the way the `preferences` door does.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(super) enum RecordWrite {
    Stored,
    /// The row already held exactly this payload at this schema version, so nothing was written.
    /// `applyDatabaseMutations` skips the same case, which is what keeps two writers of one key
    /// from flipping its `updatedAt` between them.
    Unchanged,
    Refused(&'static str),
}

/// The `raw` payload of one record, or `None` when there is none.
///
/// A row whose JSON does not parse, or that carries no `raw` string, reads as absent rather than
/// as an error: the callers of this table are caches, and one damaged entry must not stop the
/// others being read.
pub(super) fn read_record_raw(key: &str) -> Result<Option<String>, &'static str> {
    with_read_connection(|connection| {
        let row: Option<String> = connection
            .query_row("SELECT value FROM records WHERE key=?1", [key], |row| {
                row.get(0)
            })
            .optional()
            .map_err(|_| "read")?;
        Ok(row
            .and_then(|text| serde_json::from_str::<Value>(&text).ok())
            .and_then(|row| row.get("raw")?.as_str().map(str::to_string)))
    })
}

/// Stores one record, with the catalog's four bounds and the table's bookkeeping, in one immediate
/// transaction.
pub(super) fn write_record(
    store: RecordStore,
    key: &str,
    raw: &str,
    now_ms: i64,
) -> Result<RecordWrite, &'static str> {
    with_write_connection(|connection| {
        connection
            .execute_batch("BEGIN IMMEDIATE")
            .map_err(|_| "begin")?;
        let result = write_in_transaction(connection, store, key, raw, now_ms);
        match &result {
            Ok(RecordWrite::Stored) => {
                connection.execute_batch("COMMIT").map_err(|_| "commit")?;
            }
            // Nothing was written, so there is nothing to commit and a rollback is the shortest way
            // out of the immediate transaction the other writer is waiting on.
            _ => {
                let _ = connection.execute_batch("ROLLBACK");
            }
        }
        result
    })
}

fn write_in_transaction(
    connection: &Connection,
    store: RecordStore,
    key: &str,
    raw: &str,
    now_ms: i64,
) -> Result<RecordWrite, &'static str> {
    let held: Option<String> = connection
        .query_row("SELECT value FROM records WHERE key=?1", [key], |row| {
            row.get(0)
        })
        .optional()
        .map_err(|_| "read")?;
    let held: Option<Value> = held.and_then(|text| serde_json::from_str(&text).ok());
    let unchanged = held.as_ref().is_some_and(|row| {
        row.get("raw").and_then(Value::as_str) == Some(raw)
            && row.get("schemaVersion").and_then(Value::as_i64) == Some(store.version)
    });
    if unchanged {
        return Ok(RecordWrite::Unchanged);
    }
    let usage = Usage::read(connection, store.id, key)?;
    let next_bytes = storage_bytes(key, raw) as i64;
    if let Some(bound) = usage.refuses(store, next_bytes) {
        return Ok(RecordWrite::Refused(bound));
    }
    // The counter `applyDatabaseMutations` bumps per mutation. Taken above BOTH the metadata row
    // and every row's own revision so the recompute below, which reads the highest row revision,
    // cannot move the stored counter backwards past a service that is ahead of its rows.
    let revision = usage.revision_floor.max(metadata_revision(connection)?) + 1;
    let row = json!({
        "key": key,
        "store": store.id,
        "raw": raw,
        "bytes": next_bytes,
        "updatedAt": now_ms,
        "revision": revision,
        "schemaVersion": store.version,
    });
    connection
        .execute(
            "INSERT INTO records VALUES (?1,?2,?3) ON CONFLICT(key) DO UPDATE SET store=excluded.store,value=excluded.value",
            params![key, store.id, row.to_string()],
        )
        .map_err(|_| "write")?;
    recompute_record_metadata(connection).map_err(|_| "metadata")?;
    Ok(RecordWrite::Stored)
}

/// The sizes the four bounds are measured against, read inside the transaction.
///
/// Inside rather than before it, unlike the `preferences` door's cached `Totals`: this is one
/// aggregation SQLite answers in a few milliseconds over an indexed column, not a scan whose rows
/// are parsed in Rust, and a cache would have to be invalidated by the OTHER writer's mutations,
/// which this process does not see.
struct Usage {
    /// Bytes and entries of this store, NOT counting the key being written.
    store_bytes: i64,
    store_entries: i64,
    /// Bytes of every row on the backend, the key being written included.
    backend_bytes: i64,
    /// What the key being written holds today.
    previous_bytes: i64,
    /// The highest revision any row carries.
    revision_floor: i64,
}

impl Usage {
    fn read(connection: &Connection, store_id: &str, key: &str) -> Result<Self, &'static str> {
        // The `store` COLUMN, because that is what `records.byStore` asks and therefore what the
        // rows `admission` is given are selected by; the row's own `store` field is written from
        // the same value.
        connection
            .query_row(
                "SELECT COALESCE(SUM(CASE WHEN store=?1 AND key<>?2 THEN bytes ELSE 0 END),0),
                        COALESCE(SUM(CASE WHEN store=?1 AND key<>?2 THEN 1 ELSE 0 END),0),
                        COALESCE(SUM(bytes),0),
                        COALESCE(SUM(CASE WHEN key=?2 THEN bytes ELSE 0 END),0),
                        COALESCE(MAX(revision),0)
                 FROM (SELECT key, store,
                              CAST(COALESCE(json_extract(value,'$.bytes'),0) AS INTEGER) AS bytes,
                              CAST(COALESCE(json_extract(value,'$.revision'),0) AS INTEGER) AS revision
                       FROM records)",
                params![store_id, key],
                |row| {
                    Ok(Self {
                        store_bytes: row.get(0)?,
                        store_entries: row.get(1)?,
                        backend_bytes: row.get(2)?,
                        previous_bytes: row.get(3)?,
                        revision_floor: row.get(4)?,
                    })
                },
            )
            .map_err(|_| "usage")
    }

    /// The bound this value would break, or `None` when all four admit it. `admission`'s four, in
    /// its order and in its UTF-16 accounting.
    fn refuses(&self, store: RecordStore, next_bytes: i64) -> Option<&'static str> {
        if next_bytes > store.max_entry_bytes {
            return Some("entry");
        }
        if self.store_bytes + next_bytes > store.max_bytes {
            return Some("store");
        }
        if self.store_entries + 1 > store.max_entries {
            return Some("entries");
        }
        (self.backend_bytes - self.previous_bytes + next_bytes > MAX_BACKEND_BYTES)
            .then_some("backend")
    }
}

fn metadata_revision(connection: &Connection) -> Result<i64, &'static str> {
    let stored: Option<String> = connection
        .query_row(
            "SELECT value FROM metadata WHERE key='revision'",
            [],
            |row| row.get(0),
        )
        .optional()
        .map_err(|_| "metadata")?;
    Ok(stored
        .and_then(|text| serde_json::from_str::<Value>(&text).ok())
        .and_then(|value| value.as_i64())
        .unwrap_or(0))
}
