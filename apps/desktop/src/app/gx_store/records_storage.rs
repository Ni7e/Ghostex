//! The second table of the client-storage database: `records`, where an indexeddb-catalogued store
//! keeps its rows. This file is the CONNECTION half; the row shape, the bounds and the bookkeeping
//! are `packages/chat-runtime/src/storage_records.rs`, so a harness can drive them.
//!
//! CDXC:Settings 2026-09-21 WHY:
//! Every Rust storage door before this one writes the `preferences` table, which is `(key, value)`
//! with `value` the raw string, because every key it owns is catalogued on the `local` backend. A
//! store catalogued on **indexeddb** is a different shape in the same file: `records` is
//! `(key, store, value)` where `value` is the WHOLE ROW as JSON,
//! `{ key, store, raw, bytes, updatedAt, revision, schemaVersion }` (`applyDatabaseMutations` in
//! `packages/client-storage/adapters/database-transaction.ts`, `recordWrite` in
//! `packages/chat-runtime/src/storage.rs`), with `bytes` the UTF-16 accounting of the key and the
//! raw together and `schemaVersion` the catalog row's `version`. Beside it are the `metadata` rows
//! the table's writers all owe, which `apply_record_metadata` rebuilds rather than adjusts.
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
//! packages/chat-runtime/src/storage_records.rs (everything this file hands a connection to).

use rusqlite::Connection;

pub(crate) use ghostex_chat_runtime::{RecordRead, RecordStore, RecordWrite};

use super::sidebar_ui_storage::{with_read_connection, with_write_connection};

/// The `raw` payload of one record, if the catalog still admits it at `now_ms`.
pub(crate) fn read_record_raw(
    store: RecordStore,
    key: &str,
    now_ms: i64,
) -> Result<RecordRead, &'static str> {
    with_read_connection(|connection| {
        ghostex_chat_runtime::read_record(connection, store, key, now_ms)
    })
}

/// Stores one record in one immediate transaction.
pub(crate) fn write_record(
    store: RecordStore,
    key: &str,
    raw: &str,
    now_ms: i64,
) -> Result<RecordWrite, &'static str> {
    with_write_connection(|connection| {
        connection
            .execute_batch("BEGIN IMMEDIATE")
            .map_err(|_| "begin")?;
        let result = ghostex_chat_runtime::write_record(connection, store, key, raw, now_ms);
        match &result {
            Ok(RecordWrite::Stored) => {
                connection.execute_batch("COMMIT").map_err(|_| "commit")?;
            }
            // Nothing was written, so there is nothing to commit and a rollback is the shortest way
            // out of the immediate transaction the other writer is waiting on.
            _ => finish_without_writing(connection)?,
        }
        result
    })
}

/// Ends a transaction that wrote nothing.
///
/// CDXC:Settings 2026-09-21 WHY:
/// A failed ROLLBACK is reported rather than swallowed, and the reason is the pool rather than the
/// statement: `with_write_connection` keeps the connection unless the call returns an error, so a
/// swallowed failure would hand the next writer a connection that may still be inside `BEGIN
/// IMMEDIATE`, holding the database's write lock against the client-storage service until the app
/// quits. Turning it into an error drops the connection and the next call opens a fresh one, which
/// costs one retried write in a case that needs the statement itself to fail.
fn finish_without_writing(connection: &Connection) -> Result<(), &'static str> {
    connection
        .execute_batch("ROLLBACK")
        .map(|_| ())
        .map_err(|_| "rollback")
}
