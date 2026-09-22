//! The desktop's `model/` is mostly native workspace state; only the plain types the shared drawing code names are lifted out (see `extracted-items.txt`).
#[allow(dead_code, unused_imports)]
pub(crate) mod titlebar_panels {
    include!(concat!(env!("OUT_DIR"), "/titlebar_panels.rs"));
}
pub(crate) use titlebar_panels::*;
pub(crate) mod titlebar_mode;
pub(crate) use titlebar_mode::*;
#[allow(dead_code)]
pub(crate) mod agents_terminal_startup {
    include!(concat!(env!("OUT_DIR"), "/agents_terminal_startup.rs"));
}
pub(crate) use agents_terminal_startup::*;

/// The desktop reaches a remote machine's daemon through an SSH tunnel it owns. The browser build has no tunnels yet, so no value of this type is ever made; it exists for the shared chat files that carry one.
#[derive(Clone)]
pub(crate) struct GpuiRemoteGxserverRequestTarget {
    pub(crate) local_port: u16,
    pub(crate) token: String,
}

/// Only the identity counter of the desktop's chat page state, which the chat view uses for draft ids.
pub(crate) struct SessionChatPageState;

impl SessionChatPageState {
    pub(crate) fn next_identity() -> u64 {
        static NEXT: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(1);
        NEXT.fetch_add(1, std::sync::atomic::Ordering::Relaxed)
    }
}
#[allow(dead_code, unused_imports)]
pub(crate) mod hotkeys_and_palette {
    use crate::*;
    include!(concat!(env!("OUT_DIR"), "/hotkeys_and_palette.rs"));
}
pub(crate) use hotkeys_and_palette::*;
