//! The desktop can run the Rust chat core in shadow beside the QuickJS brain and count what
//! differs (`apps/desktop/src/app/native_chat/shadow/`). The browser runs its chat bundle in an
//! iframe, has no support logs to write counters to, and has its own runtime worker, so there is
//! no shadow here: this module exists because `native_chat/mod.rs` is shared with the desktop.
