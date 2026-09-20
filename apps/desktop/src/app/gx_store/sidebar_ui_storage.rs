//! Reading and writing the sidebar's own state in the client storage the sidebar has always kept
//! it in.
//!
//! CDXC:Sidebar 2026-09-20 WHY:
//! The values live in the `preferences` table of the client-storage database, under the keys the
//! TypeScript sidebar wrote them under, because an installation that upgrades keeps its collapsed
//! groups, its Space, its hidden items and its filters, and a build from before the port must
//! still read them. This is a second door into that database: the client-storage service in
//! QuickJS owns the first one. The door is deliberate, because the whole point of the port is that
//! the sidebar stops needing QuickJS to be alive, but it means the service's admission checks do
//! not run here, so the entry bound of the catalog is enforced below instead. The database is
//! opened on a background thread with its own connections, kept between calls, and every write is
//! applied inside one immediate transaction, so a collapse envelope is never read by one writer
//! while the other replaces it.
//!
//! SEE-ALSO: packages/client-storage/catalog.ts (the entry and store bounds this mirrors),
//! packages/chat-runtime/src/storage.rs (the service's own door to the same file).

use std::path::PathBuf;
use std::sync::{Mutex, OnceLock};
use std::time::Duration;

use ghostex_gx_core::{
    COLLAPSE_STORAGE_KEY, HIDDEN_ITEMS_STORAGE_KEY, MACHINE_TAB_STORAGE_KEY,
    PROJECT_COLLECTIONS_STORAGE_KEY, SIDEBAR_WINDOW_SCOPE_ID, SidebarCollapseDiff,
    SidebarCollapseState, SidebarHiddenItems, collapse_state_from_storage,
    hidden_items_from_storage, machine_tab_from_storage, sidebar_window_storage_key,
};
use rusqlite::{Connection, OpenFlags, OptionalExtension};
use serde_json::Value;

/// How long a read or a write waits for the service thread's own transaction.
const BUSY_TIMEOUT: Duration = Duration::from_millis(500);
/// `maxEntryBytes` of the stores these keys belong to (`packages/client-storage/catalog.ts`). The
/// service in QuickJS refuses a larger entry, and this door has to refuse it too, or a payload
/// this side stored would be one the other side cannot write and the two would disagree about
/// what the user has.
const MAX_ENTRY_BYTES: usize = 64 * 1024;

/// The sidebar state as storage holds it.
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub(super) struct StoredSidebarUi {
    pub(super) collapse: SidebarCollapseState,
    pub(super) hidden_items: SidebarHiddenItems,
    pub(super) selected_machine_id: String,
    /// The stored collections, as JSON; the view model reads them only while the daemon has none.
    pub(super) project_collections: Option<Value>,
}

/// What one write has to store. A field left empty is not written at all.
#[derive(Clone, Debug, Default)]
pub(super) struct SidebarUiWrite {
    /// What the state changed about the collapse envelope since it was last written.
    pub(super) collapse: Option<(SidebarCollapseDiff, SidebarCollapseState)>,
    pub(super) hidden_items: Option<String>,
    pub(super) selected_machine_id: Option<String>,
}

impl SidebarUiWrite {
    pub(super) fn is_empty(&self) -> bool {
        self.collapse.is_none() && self.hidden_items.is_none() && self.selected_machine_id.is_none()
    }
}

/// The two connections, opened once and kept. A connection that errors is dropped, so the next
/// call opens a fresh one rather than reusing a handle whose file was replaced.
#[derive(Default)]
struct Connections {
    read: Option<Connection>,
    write: Option<Connection>,
}

fn connections() -> &'static Mutex<Connections> {
    static CONNECTIONS: OnceLock<Mutex<Connections>> = OnceLock::new();
    CONNECTIONS.get_or_init(|| Mutex::new(Connections::default()))
}

pub(super) fn client_storage_path() -> PathBuf {
    crate::shared_settings::ghostex_storage_paths()
        .state_dir
        .join("client-storage.sqlite3")
}

fn collapse_key() -> String {
    sidebar_window_storage_key(COLLAPSE_STORAGE_KEY, SIDEBAR_WINDOW_SCOPE_ID)
}

fn machine_tab_key() -> String {
    sidebar_window_storage_key(MACHINE_TAB_STORAGE_KEY, SIDEBAR_WINDOW_SCOPE_ID)
}

/// Reads everything the sidebar state is seeded from. `Err` is a fixed word saying which step
/// failed, never the database's own message, which can carry the file's path.
pub(super) fn read_sidebar_ui_state() -> Result<StoredSidebarUi, &'static str> {
    let mut held = connections()
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner());
    if held.read.is_none() {
        held.read = Some(open(OpenFlags::SQLITE_OPEN_READ_ONLY)?);
    }
    let connection = held.read.as_ref().expect("opened above");
    let result = read_all(connection);
    if result.is_err() {
        held.read = None;
    }
    result
}

fn read_all(connection: &Connection) -> Result<StoredSidebarUi, &'static str> {
    let scoped = read_preference(connection, &collapse_key())?;
    let legacy = read_preference(connection, COLLAPSE_STORAGE_KEY)?;
    let collections_raw = read_preference(connection, PROJECT_COLLECTIONS_STORAGE_KEY)?;
    let machine_tab = read_preference(connection, &machine_tab_key())?;
    let hidden = read_preference(connection, HIDDEN_ITEMS_STORAGE_KEY)?;
    Ok(StoredSidebarUi {
        collapse: collapse_state_from_storage(
            scoped.as_deref(),
            legacy.as_deref(),
            collections_raw.as_deref(),
        ),
        hidden_items: hidden_items_from_storage(hidden.as_deref()),
        selected_machine_id: machine_tab_from_storage(machine_tab.as_deref()),
        project_collections: collections_raw
            .and_then(|raw| serde_json::from_str::<Value>(&raw).ok())
            .filter(Value::is_object),
    })
}

/// Stores what changed. The collapse envelope is re-read inside the transaction and the state's
/// own difference applied to it, so a field another writer owns survives.
pub(super) fn write_sidebar_ui_state(write: &SidebarUiWrite) -> Result<(), &'static str> {
    if write.is_empty() {
        return Ok(());
    }
    let mut held = connections()
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner());
    if held.write.is_none() {
        held.write = Some(open(OpenFlags::SQLITE_OPEN_READ_WRITE)?);
    }
    let connection = held.write.as_ref().expect("opened above");
    let result = write_in_transaction(connection, write);
    if result.is_err() {
        held.write = None;
    }
    result
}

fn write_in_transaction(
    connection: &Connection,
    write: &SidebarUiWrite,
) -> Result<(), &'static str> {
    connection
        .execute_batch("BEGIN IMMEDIATE")
        .map_err(|_| "begin")?;
    let result = write_inside_transaction(connection, write);
    if result.is_ok() {
        connection.execute_batch("COMMIT").map_err(|_| "commit")?;
    } else {
        let _ = connection.execute_batch("ROLLBACK");
    }
    result
}

fn write_inside_transaction(
    connection: &Connection,
    write: &SidebarUiWrite,
) -> Result<(), &'static str> {
    if let Some((diff, fallback)) = &write.collapse {
        let key = collapse_key();
        let stored = read_preference(connection, &key)?;
        write_preference(connection, &key, &diff.apply(stored.as_deref(), fallback))?;
    }
    if let Some(hidden) = &write.hidden_items {
        write_preference(connection, HIDDEN_ITEMS_STORAGE_KEY, hidden)?;
    }
    if let Some(machine_id) = &write.selected_machine_id {
        write_preference(connection, &machine_tab_key(), machine_id)?;
    }
    Ok(())
}

fn open(flags: OpenFlags) -> Result<Connection, &'static str> {
    let connection = Connection::open_with_flags(
        &client_storage_path(),
        flags | OpenFlags::SQLITE_OPEN_NO_MUTEX,
    )
    .map_err(|_| "open")?;
    connection.busy_timeout(BUSY_TIMEOUT).map_err(|_| "busy")?;
    Ok(connection)
}

fn read_preference(connection: &Connection, key: &str) -> Result<Option<String>, &'static str> {
    connection
        .query_row("SELECT value FROM preferences WHERE key=?1", [key], |row| {
            row.get::<_, String>(0)
        })
        .optional()
        .map_err(|_| "query")
}

fn write_preference(connection: &Connection, key: &str, raw: &str) -> Result<(), &'static str> {
    if raw.len() > MAX_ENTRY_BYTES {
        return Err("tooLarge");
    }
    connection
        .execute(
            "INSERT INTO preferences VALUES (?1,?2) ON CONFLICT(key) DO UPDATE SET value=excluded.value",
            rusqlite::params![key, raw],
        )
        .map(|_| ())
        .map_err(|_| "write")
}
