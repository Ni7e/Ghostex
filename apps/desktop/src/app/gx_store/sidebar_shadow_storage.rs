//! The two pieces of sidebar state the published snapshot cannot carry: the projects and
//! collections the user hid (a hidden row is simply absent), and the sidebar's own copy of the
//! project collections, which it shows until the daemon's document arrives.
//!
//! Both are read from the client storage the sidebar persists them in, on a background thread,
//! through a second read-only connection to the same SQLite file the service thread owns.

use std::path::PathBuf;
use std::time::Duration;

use ghostex_gx_core::SidebarHiddenItems;
use rusqlite::{Connection, OpenFlags, OptionalExtension};
use serde_json::Value;

const HIDDEN_ITEMS_KEY: &str = "ghostex.sidebar.hidden-items.v1";
const PROJECT_COLLECTIONS_KEY: &str = "ghostex.sidebar.projectCollections.v1";

/// What one read brought back.
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub(super) struct StoredSidebarState {
    pub(super) hidden_items: SidebarHiddenItems,
    /// The stored collections, as JSON; the view model reads them only while the daemon has none.
    pub(super) project_collections: Option<Value>,
}

fn client_storage_path() -> PathBuf {
    crate::shared_settings::ghostex_storage_paths()
        .state_dir
        .join("client-storage.sqlite3")
}

/// Reads both values. `Err` is a fixed word saying which step failed, never the database's own
/// message, which can carry the file's path.
pub(super) fn read_sidebar_state() -> Result<StoredSidebarState, &'static str> {
    let connection = Connection::open_with_flags(
        &client_storage_path(),
        OpenFlags::SQLITE_OPEN_READ_ONLY | OpenFlags::SQLITE_OPEN_NO_MUTEX,
    )
    .map_err(|_| "open")?;
    connection
        .busy_timeout(Duration::from_millis(250))
        .map_err(|_| "busyTimeout")?;
    let read = |key: &str| -> Result<Option<String>, &'static str> {
        connection
            .query_row("SELECT value FROM preferences WHERE key=?1", [key], |row| {
                row.get::<_, String>(0)
            })
            .optional()
            .map_err(|_| "query")
    };
    let hidden_items = parse_hidden_items(read(HIDDEN_ITEMS_KEY)?.as_deref());
    let project_collections = read(PROJECT_COLLECTIONS_KEY)?
        .and_then(|raw| serde_json::from_str::<Value>(&raw).ok())
        .filter(Value::is_object);
    Ok(StoredSidebarState {
        hidden_items,
        project_collections,
    })
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
