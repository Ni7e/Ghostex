//! The Rust store (`ghostex-gx-core`) running inside the desktop app. Per-concern files:
//! `host.rs` owns the core, the client and the pump; `effects.rs` performs what the core asks
//! for; `local_focus.rs` makes selections local and admits the old runtime's focus payloads;
//! `burst.rs` tells the old runtime once and releases deferred work when the selection settles;
//! `session_walk.rs` walks the rendered sidebar rows for the previous and next session hotkeys;
//! `layout_persist.rs` writes the shell layout on a timer; `shadow_diff.rs` mirrors the old
//! runtime's focus into the core and compares its tab list; `sidebar_shadow.rs` builds the
//! sidebar list from the store beside the old projection's and compares them (`_inputs` mirrors
//! what it reads, `_compare` names the differences, `_storage` reads the hidden projects);
//! `diagnostics.rs` writes the log lines.

mod burst;
mod diagnostics;
mod effects;
mod host;
mod layout_persist;
mod local_focus;
mod session_walk;
mod shadow_diff;
mod sidebar_list;
mod sidebar_list_inputs;
mod sidebar_scratch_compare;
mod sidebar_shadow;
mod sidebar_shadow_compare;
mod sidebar_snapshot;
mod sidebar_ui;
mod sidebar_ui_commands;
mod sidebar_ui_storage;

pub(crate) use host::GxStoreHost;
pub(crate) use sidebar_list::SidebarListSource;
