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

/// CDXC:AppModal 2026-09-25 DECISION:
/// User: on Windows the modals shown without decoration (Add a project and the like) "blend with the bg of the app", so they need a border. macOS draws a rim and shadow around these borderless windows; a Windows PopUp gets neither, and the modal surface is tinted from the app chrome. Windows 11 DWM gives the modal window rounded corners, its shadow and a border in `border`, the same frame for the React and native modal hosts. Windows 10 ignores both attributes.
pub(crate) fn frame_app_modal_window(window: &mut Window, border: gpui::Rgba) {
    #[cfg(target_os = "windows")]
    {
        use raw_window_handle::{HasWindowHandle as _, RawWindowHandle};
        use windows_sys::Win32::Graphics::Dwm::{
            DWMWA_BORDER_COLOR, DWMWA_WINDOW_CORNER_PREFERENCE, DWMWCP_ROUND, DwmSetWindowAttribute,
        };
        let Ok(handle) = window.window_handle() else {
            return;
        };
        let RawWindowHandle::Win32(handle) = handle.as_raw() else {
            return;
        };
        let hwnd = handle.hwnd.get() as windows_sys::Win32::Foundation::HWND;
        let channel = |value: f32| (value.clamp(0.0, 1.0) * 255.0).round() as u32;
        // COLORREF is 0x00BBGGRR.
        let color: u32 = channel(border.r) | channel(border.g) << 8 | channel(border.b) << 16;
        let corner = DWMWCP_ROUND;
        unsafe {
            DwmSetWindowAttribute(
                hwnd,
                DWMWA_WINDOW_CORNER_PREFERENCE as u32,
                (&raw const corner).cast(),
                std::mem::size_of_val(&corner) as u32,
            );
            DwmSetWindowAttribute(
                hwnd,
                DWMWA_BORDER_COLOR as u32,
                (&raw const color).cast(),
                std::mem::size_of_val(&color) as u32,
            );
        }
    }
    #[cfg(not(target_os = "windows"))]
    let _ = (window, border);
}
