pub(crate) mod native_modal_kit;
pub(crate) mod frosted_host;
pub(crate) mod popup_frame;

/// AppKit child-window attachment on the desktop. The web platform's windows are canvases of one page, which the platform itself stacks.
pub(crate) fn attach_gpui_app_modal_window_to_main_window(
    _window: &mut gpui::Window,
    _main_window_native_view: *mut std::ffi::c_void,
) {
}
#[allow(dead_code, unused_imports)]
pub(crate) mod space_editor_modal {
    use crate::*;
    include!(concat!(env!("OUT_DIR"), "/space_editor_modal.rs"));
}

