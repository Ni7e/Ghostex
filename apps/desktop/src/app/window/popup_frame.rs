use gpui::Window;

/// CDXC:PlatformSupport 2026-09-23 WHY:
/// Windows menus and borderless child dialogs must be tool popups. Normal app windows are eligible for FancyZones' last-zone placement, which moved both the chat model menu and Add Worktree dialog to the main window's top-left despite correct requested bounds.
/// CDXC:PlatformSupport 2026-09-24 WHY:
/// Linux tiling managers need transient ownership before mapping; borderless Normal windows still tile. Floating preserves outside-click dismissal and session switching, which Dialog would block. Each Linux caller supplies x11_parent explicitly.
pub(crate) fn child_window_kind() -> gpui::WindowKind {
    if cfg!(target_os = "windows") {
        gpui::WindowKind::PopUp
    } else if cfg!(target_os = "linux") {
        gpui::WindowKind::Floating
    } else {
        gpui::WindowKind::Normal
    }
}

/// The display a popup at `point` belongs to, for `WindowOptions::display_id`.
///
/// CDXC:PlatformSupport 2026-09-23 WHY:
/// On Windows a window opened without a display is placed against the primary monitor, and bounds that lie on another monitor fail its on-display check and are replaced by the primary monitor's default spot. With the app on a second monitor, the chat's model, mode and context window menus therefore opened somewhere else, where they looked like they were behind the main window. Every popup names the display its bounds are on.
pub(crate) fn display_at(
    point: gpui::Point<gpui::Pixels>,
    cx: &gpui::App,
) -> Option<gpui::DisplayId> {
    cx.displays()
        .into_iter()
        .find(|display| display.bounds().contains(&point))
        .map(|display| display.id())
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
