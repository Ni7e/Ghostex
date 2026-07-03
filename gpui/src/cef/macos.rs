/*
CDXC:GPUICefPlatformSeam 2026-07-04:
macOS platform adapter for the shared windowed-CEF backend (cef/shell.rs).
This module owns only the truly per-OS pieces: loading the CEF framework
from the app bundle, the AppKit CefAppProtocol/message-pump shim glue, and
NSView child-view frame/visibility/focus operations. All browser/bridge/
runtime logic stays OS-agnostic in cef/shell.rs. Handles cross this seam as
opaque `*mut c_void`; only this file treats them as NSView pointers.
*/

use anyhow::{Context as _, Result};
use std::ffi::{c_double, c_int, c_longlong, c_void};

unsafe extern "C" {
    fn GhostexGpuiCEFPrepareApplication();
    fn GhostexGpuiCEFInstallApplicationHooks();
    fn GhostexGpuiCEFInstallMessagePump();
    fn GhostexGpuiCEFInvalidateMessagePump();
    fn GhostexGpuiCEFScheduleMessagePumpWork(delay_ms: c_longlong);
    fn GhostexGpuiCEFSetNativeViewFrame(
        native_view: *mut c_void,
        x: c_double,
        y: c_double,
        width: c_double,
        height: c_double,
    );
    fn GhostexGpuiCEFSetNativeViewVisible(native_view: *mut c_void, visible: bool);
    fn GhostexGpuiCEFPrepareNativeViewForFocus(native_view: *mut c_void);
    fn GhostexGpuiCEFFocusNativeView(native_view: *mut c_void);
}

/// Keeps the CEF framework loaded for the lifetime of the CEF runtime.
pub(super) struct PlatformCefRuntime {
    _loader: cef::library_loader::LibraryLoader,
}

pub(super) fn load_cef_runtime() -> Result<PlatformCefRuntime> {
    let executable = std::env::current_exe().context("failed to resolve GPUI executable path")?;
    let loader = cef::library_loader::LibraryLoader::new(&executable, false);
    if !loader.load() {
        anyhow::bail!("CEF framework could not be loaded from the app bundle");
    }
    Ok(PlatformCefRuntime { _loader: loader })
}

pub(super) fn prepare_application() {
    unsafe {
        GhostexGpuiCEFPrepareApplication();
    }
}

pub(super) fn install_application_hooks() {
    unsafe { GhostexGpuiCEFInstallApplicationHooks() };
}

pub(super) fn install_message_pump() {
    unsafe { GhostexGpuiCEFInstallMessagePump() };
}

pub(super) fn invalidate_message_pump() {
    unsafe { GhostexGpuiCEFInvalidateMessagePump() };
}

pub(super) fn schedule_message_pump_work(delay_ms: i64) {
    unsafe {
        GhostexGpuiCEFScheduleMessagePumpWork(delay_ms as c_longlong);
    }
}

pub(super) fn apply_platform_settings(_settings: &mut cef::Settings) {
    // macOS discovers helper apps from the bundle layout; nothing to add.
}

pub(super) fn child_window_info(
    parent_native_view: *mut c_void,
    bounds: &cef::Rect,
) -> cef::WindowInfo {
    cef::WindowInfo::default().set_as_child(parent_native_view.cast(), bounds)
}

pub(super) fn native_view_ptr(handle: cef::sys::cef_window_handle_t) -> *mut c_void {
    handle.cast()
}

pub(super) fn prepare_native_view_for_focus(native_view: *mut c_void) {
    unsafe {
        GhostexGpuiCEFPrepareNativeViewForFocus(native_view);
    }
}

pub(super) fn set_native_view_frame(native_view: *mut c_void, x: f64, y: f64, width: f64, height: f64) {
    unsafe {
        GhostexGpuiCEFSetNativeViewFrame(
            native_view,
            x as c_double,
            y as c_double,
            width as c_double,
            height as c_double,
        );
    }
}

pub(super) fn set_native_view_visible(native_view: *mut c_void, visible: bool) {
    unsafe {
        GhostexGpuiCEFSetNativeViewVisible(native_view, visible);
    }
}

pub(super) fn focus_native_view(native_view: *mut c_void) {
    unsafe {
        GhostexGpuiCEFFocusNativeView(native_view);
    }
}

#[unsafe(no_mangle)]
pub extern "C" fn GhostexGpuiCEFDoMessageLoopWork() {
    cef::do_message_loop_work();
}

#[unsafe(no_mangle)]
pub extern "C" fn GhostexGpuiCEFHandleSelectAllForNativeView(native_view: *mut c_void) -> c_int {
    /*
    CDXC:GPUICefEditCommands 2026-06-14-17:25:
    Native AppKit command dispatch can reach CEF's NSView even when GPUI still remembers the address input as its focused element. Keep a main-thread native-view to cef-rs browser registry so the standard selectAll: command can call Chromium's Frame::select_all for the focused page field instead of selecting GPUI chrome.
    */
    super::shell::select_all_for_native_view(native_view)
}

#[unsafe(no_mangle)]
pub extern "C" fn GhostexGpuiCEFHandleSelectAllForActiveNativeView() -> c_int {
    super::shell::select_all_for_active_native_view()
}

#[unsafe(no_mangle)]
pub extern "C" fn GhostexGpuiCEFMarkNativeViewFocused(native_view: *mut c_void) -> c_int {
    super::shell::mark_native_view_focused(native_view)
}

#[unsafe(no_mangle)]
pub extern "C" fn GhostexGpuiCEFClearActiveNativeView() {
    super::shell::clear_active_native_view_registry()
}
