//! The Rust store (`ghostex-gx-core`) running inside the desktop app. Per-concern files:
//! `host.rs` owns the core, the client and the pump; `effects.rs` performs what the core asks
//! for; `local_focus.rs` makes selections local and admits the old runtime's focus payloads;
//! `burst.rs` tells the old runtime once and releases deferred work when the selection settles;
//! `session_walk.rs` walks the rendered sidebar rows for the previous and next session hotkeys;
//! `layout_persist.rs` writes the shell layout on a timer; `shadow_diff.rs` mirrors the old
//! runtime's focus into the core and compares its tab list; `diagnostics.rs` writes the log lines.

mod burst;
mod diagnostics;
mod effects;
mod host;
mod layout_persist;
mod local_focus;
mod session_walk;
mod shadow_diff;

pub(crate) use host::GxStoreHost;
