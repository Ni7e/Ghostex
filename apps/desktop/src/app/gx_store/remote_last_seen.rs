//! The last-seen presentation of a remote machine: the rows the sidebar draws, faded, for a
//! machine that has not connected in this run.
//!
//! CDXC:RemoteMachines 2026-09-21 DECISION:
//! Asked "today, when a remote machine is offline, the old sidebar still shows its sessions from
//! the last time it connected, greyed out; the Rust sidebar cannot do that yet, so an offline
//! machine shows nothing until it connects. Do you want that last-seen view kept?", the user
//! answered "yes pls". This file is the store's half of keeping it.
//!
//! **A different table from every other Rust storage door, and that is the whole reason this file
//! exists.** The three sidebar keys and the three client-owned documents are `local` catalog rows
//! and live in the `preferences` table as `(key, value)` with `value` the raw string. This key is
//! catalogued on the **indexeddb** backend (`remotePresentations` in
//! `packages/client-storage/catalog.ts` takes `cache`, which takes `disk`, which sets
//! `backend: 'indexeddb'`), so it lives in the **`records`** table as `(key, store, value)` where
//! `value` is the WHOLE ROW serialized as JSON, not the payload:
//! `{ key, store, raw, bytes, updatedAt, revision, schemaVersion }`
//! (`applyDatabaseMutations` in `packages/client-storage/adapters/database-transaction.ts`, and
//! `recordWrite` in `packages/chat-runtime/src/storage.rs`). Pointing `read_preference_value` at
//! this key would find nothing, for ever, and look like a machine that had simply never connected.
//!
//! The key is one per machine, `ghostex-gpui-remote-last-seen-presentations:machine:<encoded id>`,
//! and the value is a `GxserverPresentationSnapshot`: the same shape the live stream and
//! `/api/readPresentationSnapshot` deliver, which is why gx-core needs no codec of its own for it
//! and why a build from before this port still reads what this one wrote.
//!
//! SEE-ALSO: apps/desktop/sidebar/gxserver-runtime/helpers/remote-last-seen.ts (the writer that
//! still runs until M4d part 2 deletes it), packages/gx-core/src/presentation_store/apply.rs
//! (`seed_last_seen`, and the revision rules that make these rows "held, not live").

use ghostex_gx_core::encode_uri_component;
use rusqlite::{Connection, OptionalExtension};
use serde_json::Value;

use super::sidebar_ui_storage::with_read_connection;

/// The catalog row's `key` prefix, with the per-machine infix `RemoteLastSeenStore` appends.
/// `GPUI_REMOTE_LAST_SEEN_PRESENTATIONS_STORAGE_KEY` in
/// `apps/desktop/sidebar/gxserver-runtime/constants.ts`, then `:machine:`.
const MACHINE_KEY_PREFIX: &str = "ghostex-gpui-remote-last-seen-presentations:machine:";

/// The stored key of one machine's last-seen snapshot.
pub(super) fn machine_key(machine_id: &str) -> String {
    format!("{MACHINE_KEY_PREFIX}{}", encode_uri_component(machine_id))
}

/// The raw payload of one machine's last-seen snapshot, or `None` when there is none.
///
/// Reads the `records` row and hands back its `raw` field. A row whose JSON does not parse, or
/// that carries no `raw` string, reads as absent rather than as an error: one machine's malformed
/// entry must not stop the others being seeded, which is the rule `RemoteLastSeenStore::read` also
/// applies on its side.
pub(super) fn read_last_seen_raw(machine_id: &str) -> Result<Option<String>, &'static str> {
    let key = machine_key(machine_id);
    with_read_connection(|connection| read_record_raw(connection, &key))
}

fn read_record_raw(connection: &Connection, key: &str) -> Result<Option<String>, &'static str> {
    let row: Option<String> = connection
        .query_row("SELECT value FROM records WHERE key=?1", [key], |row| {
            row.get(0)
        })
        .optional()
        .map_err(|_| "read")?;
    Ok(row
        .and_then(|text| serde_json::from_str::<Value>(&text).ok())
        .and_then(|row| row.get("raw")?.as_str().map(str::to_string)))
}
