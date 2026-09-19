//! The one sidebar UI state the published snapshot cannot reveal: the projects and collections
//! the user hid. A hidden row is simply absent from the snapshot, so the value is read from the
//! client storage the sidebar persists it in (`ghostex.sidebar.hidden-items.v1`).
//!
//! The read is a single row of a second, read-only connection to the same SQLite file the service
//! thread owns, and it runs on a background thread.

use std::path::PathBuf;
use std::time::Duration;

use ghostex_gx_core::SidebarHiddenItems;
use rusqlite::{Connection, OpenFlags, OptionalExtension};
use serde_json::Value;

const HIDDEN_ITEMS_KEY: &str = "ghostex.sidebar.hidden-items.v1";

fn client_storage_path() -> PathBuf {
    crate::shared_settings::ghostex_storage_paths()
        .state_dir
        .join("client-storage.sqlite3")
}

/// Reads the hidden projects and collections. `Err` means the value could not be read at all (no
/// database yet, or it is busy), which is different from "nothing is hidden".
pub(super) fn read_hidden_items() -> Result<SidebarHiddenItems, String> {
    let path = client_storage_path();
    let connection = Connection::open_with_flags(
        &path,
        OpenFlags::SQLITE_OPEN_READ_ONLY | OpenFlags::SQLITE_OPEN_NO_MUTEX,
    )
    .map_err(|error| error.to_string())?;
    connection
        .busy_timeout(Duration::from_millis(250))
        .map_err(|error| error.to_string())?;
    let raw: Option<String> = connection
        .query_row(
            "SELECT value FROM preferences WHERE key=?1",
            [HIDDEN_ITEMS_KEY],
            |row| row.get(0),
        )
        .optional()
        .map_err(|error| error.to_string())?;
    Ok(parse_hidden_items(raw.as_deref()))
}

/// `readSidebarHiddenItems`: two lists of unique, non-empty strings; anything else reads as empty.
fn parse_hidden_items(raw: Option<&str>) -> SidebarHiddenItems {
    let Some(value) = raw.and_then(|raw| serde_json::from_str::<Value>(raw).ok()) else {
        return SidebarHiddenItems::default();
    };
    let list = |key: &str| -> Vec<String> {
        let mut unique: Vec<String> = Vec::new();
        for entry in value
            .get(key)
            .and_then(Value::as_array)
            .into_iter()
            .flatten()
        {
            let Some(entry) = entry.as_str().filter(|entry| !entry.is_empty()) else {
                continue;
            };
            if !unique.iter().any(|seen| seen == entry) {
                unique.push(entry.to_string());
            }
        }
        unique
    };
    SidebarHiddenItems {
        group_ids: list("groupIds"),
        collection_keys: list("collectionKeys"),
    }
}
