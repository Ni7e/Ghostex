use anyhow::Result;
use rusqlite::{Connection, params};
use serde_json::json;

/// CDXC:Settings 2026-09-21 WHY:
/// The `records` table carries three `metadata` rows beside it, and every writer of the table owes
/// them: `<storeId>` is that store's `{bytes, entries}` usage, `total` is the bytes of every
/// indexeddb row, and `revision` is the counter the client-storage service compares an event
/// against before it believes it. `applyDatabaseMutations`
/// (`packages/client-storage/adapters/database-transaction.ts`) keeps all three INCREMENTALLY, which
/// is correct for one writer in one process and not for two: a decrement missed by either side
/// drifts for the life of the installation, and the TypeScript side then refuses or over-admits
/// every later write of that store with nothing to say why. So a Rust writer recomputes them from
/// the table instead, which is self-correcting whatever the other side did. This function is that
/// recompute, in ONE place: the browser import wrote it first and the last-seen remote presentation
/// writer needs the same thing, and two copies of a bookkeeping rule is how one of them drifts.
///
/// Call it INSIDE the transaction that wrote the rows.
///
/// The scan is an aggregation rather than a Rust loop over every parsed row because it also runs
/// on the app's own write path, inside `BEGIN IMMEDIATE`, where the QuickJS service's writes are
/// waiting on the lock: at this user's scale the table is about 5,500 rows and 5.8 MB of JSON, a
/// few milliseconds in SQLite against tens in `serde_json`. A row whose value is not JSON fails the
/// statement, which is what the parsing loop did too.
///
/// SEE-ALSO: packages/client-storage/adapters/database-transaction.ts (the other writer),
/// apps/desktop/src/app/gx_store/records_storage.rs (the caller that made this shared).
pub fn recompute_record_metadata(connection: &Connection) -> Result<()> {
    let mut query = connection.prepare(
        "SELECT COALESCE(json_extract(value,'$.store'),'') AS store,
                COALESCE(SUM(CAST(COALESCE(json_extract(value,'$.bytes'),0) AS INTEGER)),0),
                COUNT(*),
                COALESCE(MAX(CAST(COALESCE(json_extract(value,'$.revision'),0) AS INTEGER)),0)
         FROM records GROUP BY store",
    )?;
    let usage = query
        .query_map([], |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, i64>(1)?,
                row.get::<_, i64>(2)?,
                row.get::<_, i64>(3)?,
            ))
        })?
        .collect::<Result<Vec<_>, _>>()?;
    let mut total: i64 = 0;
    let mut revision: i64 = 0;
    for (store, bytes, entries, highest) in &usage {
        total += bytes;
        revision = revision.max(*highest);
        connection.execute(
            "INSERT INTO metadata VALUES (?1,?2) ON CONFLICT(key) DO UPDATE SET value=excluded.value",
            params![store, json!({"bytes": bytes, "entries": entries}).to_string()],
        )?;
    }
    for (key, value) in [("revision", json!(revision)), ("total", json!(total))] {
        connection.execute(
            "INSERT INTO metadata VALUES (?1,?2) ON CONFLICT(key) DO UPDATE SET value=excluded.value",
            params![key, value.to_string()],
        )?;
    }
    Ok(())
}
