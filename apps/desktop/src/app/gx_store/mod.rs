//! The Rust store (`ghostex-gx-core`) running inside the desktop app. Per-concern files:
//! `host.rs` owns the core, the client and the pump; `effects.rs` performs what the core asks
//! for; `local_focus.rs` makes selections local and admits the old runtime's focus payloads;
//! `burst.rs` tells the old runtime once and releases deferred work when the selection settles;
//! `session_walk.rs` walks the rendered sidebar rows for the previous and next session hotkeys;
//! `remote_clients.rs` runs one client per connected remote machine and owns the machine tabs,
//! and `remote_last_seen.rs` reads back the last-seen rows of one that has not connected in this
//! run, from the `records` table rather than the `preferences` one every other door here uses;
//! `layout_persist.rs` writes the shell layout on a timer; `shadow_diff.rs` mirrors the old
//! runtime's focus into the core and compares its tab list; `sidebar_shadow.rs` builds the
//! sidebar list from the store beside the old projection's and compares them (`_inputs` mirrors
//! what it reads, `_compare` names the differences, `_storage` reads the hidden projects);
//! `sidebar_menus.rs` builds the menus, hover buttons and header buttons the drawn list carries;
//! `sidebar_actions.rs` performs what a menu row, hover button or header button does, and
//! `sidebar_lifecycle.rs` the ones with a daemon round trip in the middle (sleep, wake, close
//! and fork), `sidebar_flags.rs` the four that are one call with different fields,
//! `sidebar_modals.rs` the two that only open a dialog, `sidebar_open.rs` the family whose whole
//! answer is an app-modal-host message (the More menu's rows, a machine's Configure, the Space
//! editor, a project's Add Worktree and History), and `sidebar_snooze.rs` the two that read
//! the clock and the local calendar, `sidebar_reload.rs` Full Reload and Split Right,
//! `sidebar_bulk.rs` the plural payloads and the renderer's
//! batch envelope, `sidebar_remote.rs` every per-session action of a row on a remote machine,
//! `sidebar_drag.rs` the session moves and what their order messages write, and
//! `workspace_groups.rs` the client-owned groups document those writes land in, with its stored
//! key, its debounced push and the guard that refuses the daemon's echo while one is outstanding;
//! `project_docs.rs` the PROJECT moves (reorder, into and out of a collection, Space membership)
//! and the two documents they write, on the generic `client_document.rs` host that owns the stored
//! key, the debounced push and the echo funnel for any client-owned document;
//! `sidebar_ui_paths.rs` holds the three routes into the sidebar's own state that are NOT
//! sidebar commands (the per-Space session memory, the Space-editor delete, and the project slot
//! hotkey); `diagnostics.rs` writes the log lines.

mod burst;
mod client_document;
mod diagnostics;
mod diagnostics_open;
mod diagnostics_remote_last_seen;
mod effects;
mod host;
mod layout_persist;
mod local_focus;
mod project_docs;
mod remote_clients;
mod remote_last_seen;
mod session_walk;
mod shadow_diff;
mod sidebar_actions;
mod sidebar_bulk;
mod sidebar_drag;
mod sidebar_flags;
mod sidebar_lifecycle;
mod sidebar_list;
mod sidebar_list_inputs;
mod sidebar_menus;
mod sidebar_modals;
mod sidebar_open;
mod sidebar_reload;
mod sidebar_remote;
mod sidebar_scratch_compare;
mod sidebar_shadow;
mod sidebar_shadow_compare;
mod sidebar_snapshot;
mod sidebar_snooze;
mod sidebar_ui;
mod sidebar_ui_commands;
mod sidebar_ui_paths;
mod sidebar_ui_storage;
mod workspace_groups;

pub(crate) use host::GxStoreHost;
pub(crate) use workspace_groups::note_native_host_message_dropped;
