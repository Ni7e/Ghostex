use gpui::Window;

/// Strips the system frame and shadow from a popup's own window (`GpuiChatDialogWindow.m`).
/// Only for windows with a transparent background whose content draws its own panel.
pub(crate) fn strip_gpui_popup_window_frame(window: &mut Window) {
    #[cfg(target_os = "macos")]
    {
        use raw_window_handle::{HasWindowHandle as _, RawWindowHandle};
        unsafe extern "C" {
            fn GhostexGpuiStripPopupWindowFrame(view: *mut std::ffi::c_void);
        }
        if let Ok(handle) = window.window_handle()
            && let RawWindowHandle::AppKit(handle) = handle.as_raw()
        {
            unsafe { GhostexGpuiStripPopupWindowFrame(handle.ns_view.as_ptr()) };
        }
    }
    #[cfg(not(target_os = "macos"))]
    let _ = window;
}
