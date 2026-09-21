/// Strips the system frame and shadow from a right-click menu's window (`GpuiChatDialogWindow.m`).
pub(super) fn prepare_context_menu(window: &mut gpui::Window) {
    #[cfg(target_os = "macos")]
    {
        use raw_window_handle::{HasWindowHandle as _, RawWindowHandle};
        unsafe extern "C" {
            fn GhostexGpuiPrepareChatContextMenuWindow(view: *mut std::ffi::c_void);
        }
        if let Ok(handle) = window.window_handle()
            && let RawWindowHandle::AppKit(handle) = handle.as_raw()
        {
            unsafe { GhostexGpuiPrepareChatContextMenuWindow(handle.ns_view.as_ptr()) };
        }
    }
    #[cfg(not(target_os = "macos"))]
    let _ = window;
}
