//! The Rust store (`ghostex-gx-core`) running inside the desktop app. Per-concern files:
//! `host.rs` owns the core, the client and the pump; `effects.rs` performs what the core asks
//! for; `shadow_diff.rs` compares the store with the old runtime's tab list; `diagnostics.rs`
//! writes the log lines.

mod diagnostics;
mod effects;
mod host;
mod shadow_diff;

pub(crate) use host::GxStoreHost;
