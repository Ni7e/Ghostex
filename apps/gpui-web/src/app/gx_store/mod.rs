//! The Rust store (`ghostex-gx-core`) running in the browser. `sidebar_snapshot.rs` is the desktop's file (the list in the shape the renderer draws); `host.rs` is this build's host: it owns the core, pumps the daemon's frames into it and installs the list. The desktop files that exist to hand work to its old QuickJS runtime are left out on purpose.
mod host;
mod sidebar_snapshot;
mod web_commands;
pub(crate) mod web_transport;

pub(crate) use host::GxStoreHost;
