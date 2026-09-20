//! Native window chrome for the titlebar dropdown popup windows.
//!
//! The dropdown is an owned popup window that must never take activation from
//! the main window: the menus are mouse driven, Escape is handled by the main
//! window, and the main window's deactivation observer closes whichever
//! dropdown is open. A panel that steals activation therefore destroys itself
//! on the very click it was opened for.

use gpui::Window;
#[cfg(any(target_os = "macos", target_os = "windows"))]
use raw_window_handle::{HasWindowHandle as _, RawWindowHandle};

#[cfg(target_os = "macos")]
pub(crate) fn prepare_gpui_titlebar_popup_window_chrome(window: &mut Window) {
    use crate::app::helpers::os_cli::native_event_queue::GhostexGpuiPrepareTitlebarPopupWindow;

    let Ok(handle) = window.window_handle() else {
        return;
    };
    if let RawWindowHandle::AppKit(handle) = handle.as_raw() {
        unsafe { GhostexGpuiPrepareTitlebarPopupWindow(handle.ns_view.as_ptr()) };
    }
}

/// CDXC:Titlebar 2026-09-20 WHY:
/// The Windows counterpart of the macOS `becomesKeyOnlyIfNeeded` panel. GPUI creates these popups with `focus: false`, which gives them WS_EX_NOACTIVATE and SW_SHOWNOACTIVATE, but its shared window procedure answers every WM_MOUSEACTIVATE with SetActiveWindow(handle) to keep `active_window` current. That activated the popup on the mouse-down before the click, deactivated the main window, and let the main window's observer close the popup before the click reached a row, so every titlebar dropdown row (Quick Actions "Configure" included) did nothing on Windows. Answering WM_MOUSEACTIVATE with MA_NOACTIVATE ahead of GPUI keeps the mouse message and leaves activation on the main window.
#[cfg(target_os = "windows")]
pub(crate) fn prepare_gpui_titlebar_popup_window_chrome(window: &mut Window) {
    let Ok(handle) = window.window_handle() else {
        return;
    };
    let RawWindowHandle::Win32(handle) = handle.as_raw() else {
        return;
    };
    windows_chrome::make_popup_window_non_activating(handle.hwnd.get() as windows_chrome::Hwnd);
}

#[cfg(not(any(target_os = "macos", target_os = "windows")))]
pub(crate) fn prepare_gpui_titlebar_popup_window_chrome(_window: &mut Window) {}

#[cfg(target_os = "windows")]
mod windows_chrome {
    use std::sync::Mutex;

    use windows_sys::Win32::Foundation::{HWND, LPARAM, LRESULT, WPARAM};
    use windows_sys::Win32::UI::WindowsAndMessaging::{
        CallWindowProcW, DefWindowProcW, GWLP_WNDPROC, GetWindowLongPtrW, MA_NOACTIVATE,
        SetWindowLongPtrW, WM_MOUSEACTIVATE, WM_NCDESTROY, WNDPROC,
    };

    pub(super) type Hwnd = HWND;

    /// GPUI's own window procedure for each popup window we subclassed, kept as
    /// a raw address because a `WNDPROC` is not `Send`. Entries are added on the
    /// main thread at window creation and dropped on WM_NCDESTROY; a popup is
    /// short-lived and only one is open at a time, so this stays tiny.
    static CHAINED_WINDOW_PROCS: Mutex<Vec<(isize, isize)>> = Mutex::new(Vec::new());

    pub(super) fn make_popup_window_non_activating(hwnd: Hwnd) {
        let ours: unsafe extern "system" fn(HWND, u32, WPARAM, LPARAM) -> LRESULT =
            ghostex_titlebar_popup_window_proc;
        let ours = ours as usize as isize;
        if unsafe { GetWindowLongPtrW(hwnd, GWLP_WNDPROC) } == ours {
            return;
        }
        let previous = unsafe { SetWindowLongPtrW(hwnd, GWLP_WNDPROC, ours) };
        if previous == 0 {
            return;
        }
        let mut chained = chained_window_procs();
        chained.retain(|(subclassed, _)| *subclassed != hwnd as isize);
        chained.push((hwnd as isize, previous));
    }

    unsafe extern "system" fn ghostex_titlebar_popup_window_proc(
        hwnd: HWND,
        msg: u32,
        wparam: WPARAM,
        lparam: LPARAM,
    ) -> LRESULT {
        if msg == WM_MOUSEACTIVATE {
            return MA_NOACTIVATE as LRESULT;
        }
        let previous = take_or_read_chained_window_proc(hwnd, msg == WM_NCDESTROY);
        match previous {
            Some(previous) => unsafe { CallWindowProcW(Some(previous), hwnd, msg, wparam, lparam) },
            None => unsafe { DefWindowProcW(hwnd, msg, wparam, lparam) },
        }
    }

    /// Resolves the chained procedure, releasing the lock before it is called so
    /// a re-entrant message from inside GPUI's procedure cannot deadlock.
    fn take_or_read_chained_window_proc(
        hwnd: HWND,
        forget: bool,
    ) -> Option<unsafe extern "system" fn(HWND, u32, WPARAM, LPARAM) -> LRESULT> {
        let raw = {
            let mut chained = chained_window_procs();
            let index = chained
                .iter()
                .position(|(subclassed, _)| *subclassed == hwnd as isize)?;
            if forget {
                chained.swap_remove(index).1
            } else {
                chained[index].1
            }
        };
        let proc: WNDPROC = unsafe { std::mem::transmute::<isize, WNDPROC>(raw) };
        proc
    }

    fn chained_window_procs() -> std::sync::MutexGuard<'static, Vec<(isize, isize)>> {
        CHAINED_WINDOW_PROCS
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
    }
}
