//! Reading and writing the sidebar's own state in the client storage the sidebar has always kept
//! it in.
//!
//! CDXC:Sidebar 2026-09-20 WHY:
//! The values live in the `preferences` table of the client-storage database, under the keys the
//! TypeScript sidebar wrote them under, because an installation that upgrades keeps its collapsed
//! groups, its Space, its hidden items and its filters, and a build from before the port must
//! still read them. This is a second door into that database: the client-storage service in
//! QuickJS owns the first one, and there is a `CDXC:Settings` decision saying all storage goes
//! through one system so it cannot silently fill up. The second door is what the port is for, and
//! it carries that decision's obligations itself rather than dropping them: the catalog's entry
//! bound is enforced below, a refused or failed write is counted and reported
//! (`gxStore.sidebarUi.write.warning`), and the three keys have no functional subscriber, only the
//! Settings storage inspector, which reads the database rather than the event stream. What it does
//! not do is meter these writes into `recordStorageEvent`, so the inspector's writes-per-minute
//! figure does not count them. The collapse map is deliberately not pruned, here or on the other
//! side: an entry belongs to a project the user may have merely parked, and dropping it would
//! reopen that project expanded.
//!
//! The database is opened on a background thread with its own connections, kept between calls, and
//! every write is applied inside one immediate transaction, so a collapse envelope is never read
//! by one writer while the other replaces it.
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
/// this side stored would be one the other side cannot write: `admission` would throw, the
/// TypeScript sidebar swallows that, and it would stop persisting while this side kept writing.
const MAX_ENTRY_BYTES: usize = 64 * 1024;
/// `maxBytes` of the collapse store; the other two keep the 128 KiB default.
const MAX_STORE_BYTES_COLLAPSE: usize = 256 * 1024;
const MAX_STORE_BYTES_DEFAULT: usize = 128 * 1024;
/// `STORAGE_BUDGETS.local`, shared with every other preference key the app has.
const MAX_BACKEND_BYTES: usize = 2 * 1024 * 1024;

/// `storageBytes(key, raw)`: two per UTF-16 code unit of the key and the value together. Not the
/// length of the value in bytes, which is what the bound is most easily mistaken for and admits
/// about twice as much.
fn storage_bytes(key: &str, raw: &str) -> usize {
    2 * (utf16_len(key) + utf16_len(raw))
}

/// The length JavaScript measures, which is code units rather than characters or bytes.
fn utf16_len(value: &str) -> usize {
    value.chars().map(char::len_utf16).sum()
}

/// The sidebar state as storage holds it.
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub(super) struct StoredSidebarUi {
    pub(super) collapse: SidebarCollapseState,
    pub(super) hidden_items: SidebarHiddenItems,
    pub(super) selected_machine_id: String,
    /// The stored collections, as JSON; the view model reads them only while the daemon has none.
    pub(super) project_collections: Option<Value>,
}

/// A key a write could not store, and the bound that refused it. Reported rather than retried:
/// the payload does not get smaller by trying again, and the other door refuses it too.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(super) struct SidebarWriteRefusal {
    pub(super) key: &'static str,
    pub(super) bound: &'static str,
}

/// What one write managed. An empty list of refusals is a write that stored everything it was
/// given.
#[derive(Clone, Debug, Default)]
pub(super) struct SidebarWriteReport {
    pub(super) refused: Vec<SidebarWriteRefusal>,
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
///
/// `Err` is a transient failure the caller owes again; a value too large for one of the three
/// bounds comes back as a refusal in the report instead, because owing it again would retry a
/// write that cannot succeed. A refused key does not take the others down with it.
pub(super) fn write_sidebar_ui_state(
    write: &SidebarUiWrite,
) -> Result<SidebarWriteReport, &'static str> {
    if write.is_empty() {
        return Ok(SidebarWriteReport::default());
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
) -> Result<SidebarWriteReport, &'static str> {
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
) -> Result<SidebarWriteReport, &'static str> {
    // The totals the three bounds are measured against, read once for the whole transaction.
    let mut totals = Totals::read(connection)?;
    let mut report = SidebarWriteReport::default();
    let store = |connection: &Connection,
                     report: &mut SidebarWriteReport,
                     totals: &mut Totals,
                     name: &'static str,
                     key: &str,
                     raw: &str,
                     max_store_bytes: usize,
                     store_prefix: &str|
     -> Result<(), &'static str> {
        match totals.admits(key, raw, max_store_bytes, store_prefix) {
            Some(bound) => {
                report
                    .refused
                    .push(SidebarWriteRefusal { key: name, bound });
                Ok(())
            }
            None => {
                write_preference(connection, key, raw)?;
                totals.accept(key, raw);
                Ok(())
            }
        }
    };
    if let Some((diff, fallback)) = &write.collapse {
        let key = collapse_key();
        let stored = read_preference(connection, &key)?;
        let raw = diff.apply(stored.as_deref(), fallback);
        store(
            connection,
            &mut report,
            &mut totals,
            "collapse",
            &key,
            &raw,
            MAX_STORE_BYTES_COLLAPSE,
            COLLAPSE_STORAGE_KEY,
        )?;
    }
    if let Some(hidden) = &write.hidden_items {
        store(
            connection,
            &mut report,
            &mut totals,
            "hiddenItems",
            HIDDEN_ITEMS_STORAGE_KEY,
            hidden,
            MAX_STORE_BYTES_DEFAULT,
            HIDDEN_ITEMS_STORAGE_KEY,
        )?;
    }
    if let Some(machine_id) = &write.selected_machine_id {
        let key = machine_tab_key();
        store(
            connection,
            &mut report,
            &mut totals,
            "machineTab",
            &key,
            machine_id,
            MAX_STORE_BYTES_DEFAULT,
            MACHINE_TAB_STORAGE_KEY,
        )?;
    }
    Ok(report)
}

/// Every preference row's size, so the three bounds `admission` checks can be checked here too.
///
/// CDXC:Sidebar 2026-09-20 WHY:
/// The entry bound alone is not what the client-storage decision is about: a second door that
/// respects only its own entry size can still push the shared 2 MiB local budget past the limit,
/// which is exactly the "storage silently fills up" the first door exists to prevent. All three of
/// `admission`'s bounds are checked here against the same numbers, in the same UTF-16 accounting,
/// inside the same transaction that writes. Cache eviction is the one part not ported, because
/// none of these keys is a cache store and `admission` only evicts for those.
struct Totals {
    rows: Vec<(String, usize)>,
}

impl Totals {
    fn read(connection: &Connection) -> Result<Self, &'static str> {
        let mut query = connection
            .prepare("SELECT key, value FROM preferences")
            .map_err(|_| "query")?;
        let rows = query
            .query_map([], |row| {
                Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
            })
            .map_err(|_| "query")?
            .map(|row| row.map(|(key, value)| (key.clone(), storage_bytes(&key, &value))))
            .collect::<Result<Vec<_>, _>>()
            .map_err(|_| "query")?;
        Ok(Self { rows })
    }

    /// The bound this value would break, or `None` when all three admit it.
    fn admits(
        &self,
        key: &str,
        raw: &str,
        max_store_bytes: usize,
        store_prefix: &str,
    ) -> Option<&'static str> {
        let next = storage_bytes(key, raw);
        if next > MAX_ENTRY_BYTES {
            return Some("entry");
        }
        let previous = self
            .rows
            .iter()
            .find(|(held, _)| held == key)
            .map_or(0, |(_, bytes)| *bytes);
        let store: usize = self
            .rows
            .iter()
            .filter(|(held, _)| held.starts_with(store_prefix) && held != key)
            .map(|(_, bytes)| *bytes)
            .sum();
        if store + next > max_store_bytes {
            return Some("store");
        }
        let backend: usize = self.rows.iter().map(|(_, bytes)| *bytes).sum();
        (backend - previous + next > MAX_BACKEND_BYTES).then_some("backend")
    }

    /// Records a value this transaction stored, so the next key in it measures against the total
    /// as it now stands.
    fn accept(&mut self, key: &str, raw: &str) {
        let next = storage_bytes(key, raw);
        match self.rows.iter_mut().find(|(held, _)| held == key) {
            Some((_, bytes)) => *bytes = next,
            None => self.rows.push((key.to_string(), next)),
        }
    }
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
    connection
        .execute(
            "INSERT INTO preferences VALUES (?1,?2) ON CONFLICT(key) DO UPDATE SET value=excluded.value",
            rusqlite::params![key, raw],
        )
        .map(|_| ())
        .map_err(|_| "write")
}
