//! The browser's answers to helpers whose desktop versions call the operating system.
use std::path::PathBuf;

use crate::app::model::GpuiRemoteGxserverRequestTarget;
use serde_json::Value;

/// `prefers-reduced-motion`, which is where a browser exposes the system setting the desktop reads from AppKit.
pub(crate) fn gpui_macos_reduce_motion_enabled() -> bool {
    web_sys::window()
        .and_then(|window| window.match_media("(prefers-reduced-motion: reduce)").ok().flatten())
        .is_some_and(|query| query.matches())
}

/// The desktop plays a system sound on copy; a page may not play audio it was not asked for.
pub(crate) fn gpui_play_copy_sound() {}

pub(crate) fn gpui_random_uuid_string() -> Result<String, String> {
    web_sys::window()
        .and_then(|window| window.crypto().ok())
        .map(|crypto| crypto.random_uuid())
        .ok_or_else(|| "crypto.randomUUID is not available".to_string())
}

/// There is no state directory in a browser. The one caller keeps a small remembered flag there; its read fails softly and its write is dropped.
pub(crate) fn ghostex_state_root() -> PathBuf {
    PathBuf::from("/ghostex-web-state")
}

pub(crate) fn gpui_remote_install_unique_id() -> String {
    gpui_random_uuid_string().unwrap_or_default()
}

pub(crate) fn gpui_remote_gxserver_rpc_result(
    _target: &GpuiRemoteGxserverRequestTarget,
    _endpoint: &str,
    _params: &Value,
    _timeout: std::time::Duration,
) -> Result<Value, String> {
    Err("Remote machines are not available in the browser build yet.".to_string())
}

pub(crate) struct GpuiExtensionViewPresentation {
    pub(crate) title: String,
}

/// Extension and custom views are read from installed payloads on disk, which the browser build does not have, so none is ever offered.
pub(crate) fn gpui_extension_view_presentation(
    _id: crate::app::model::ExtensionId,
) -> Option<GpuiExtensionViewPresentation> {
    None
}

/// The desktop also plays its copy feedback here; the page only writes the clipboard.
pub(crate) fn gpui_copy_to_clipboard(item: gpui::ClipboardItem, cx: &mut gpui::App) {
    cx.write_to_clipboard(item);
}
