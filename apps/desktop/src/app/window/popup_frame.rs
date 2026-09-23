use gpui::Window;

/// CDXC:PlatformSupport 2026-09-23 WHY:
/// Windows menus and borderless child dialogs must be tool popups. Normal app windows are eligible for FancyZones' last-zone placement, which moved both the chat model menu and Add Worktree dialog to the main window's top-left despite correct requested bounds.
pub(crate) fn child_window_kind() -> gpui::WindowKind {
    if cfg!(target_os = "windows") {
        gpui::WindowKind::PopUp
    } else {
        gpui::WindowKind::Normal
    }
}

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
