//! CDXC:WebGpui 2026-09-22 WHY: the entries in this folder that are symlinks ARE the desktop app's source files, compiled here unchanged. Symlinks rather than `#[path]` attributes because rustc resolves the nested `mod` lines of a `#[path]`-loaded file as if it were a `mod.rs`, which breaks every desktop file that has a sibling directory (`consts.rs` + `consts/`). Real files in this folder are the web replacements for the desktop's native-only halves.
pub(crate) mod chat_host;
pub(crate) mod consts;
pub(crate) mod element;
pub(crate) mod floating_reveal;
pub(crate) mod gx_chat;
pub(crate) mod gx_store;
pub(crate) mod helpers;
pub(crate) mod hotkeys;
pub(crate) mod model;
pub(crate) mod native_chat;
pub(crate) mod native_sidebar;
#[allow(dead_code, unused_imports)]
pub(crate) mod project_views {
    include!(concat!(env!("OUT_DIR"), "/project_views.rs"));
}
pub(crate) mod render;
#[allow(dead_code)]
pub(crate) mod sidebar_direct_focus {
    include!(concat!(env!("OUT_DIR"), "/sidebar_direct_focus.rs"));
}
pub(crate) mod terminal_host;
pub(crate) mod titlebar;
pub(crate) mod web_app;
pub(crate) mod window;
