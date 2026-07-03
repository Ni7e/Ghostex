/*
CDXC:GPUICefPlatformSeam 2026-07-04:
Linux (X11) platform adapter for the shared windowed-CEF backend
(cef/shell.rs). This module owns only the truly per-OS pieces: turning CEF's
on_schedule_message_pump_work callbacks into main-thread
cef::do_message_loop_work() steps via gpui's foreground executor, child
X11-window frame/visibility/focus operations through x11rb, the helper-exe
subprocess path, and the `--ozone-platform=x11` Chromium switch. All
browser/bridge/runtime logic stays OS-agnostic in cef/shell.rs. Handles
cross this seam as opaque `*mut c_void`; only this file treats them as X11
window ids.

X11 is an app-wide constraint on Linux, not a per-pane choice: CEF child
windows can only be reparented into an X11 window, so the GPUI shell itself
must run gpui's X11 backend (forced in main.rs before Application creation)
and Chromium's Ozone layer must match. Under Wayland desktops everything
runs through XWayland, which trades away fractional-scaling sharpness and
some IME fidelity — accepted v1 trade-offs until browser OSR unlocks a
native-Wayland shell (plan Phase 4).

x11rb is the deliberate X library choice: gpui's own X11 backend already
pulls it into the Linux dependency tree (same 0.13 major), it speaks the X
protocol directly over its own connection (no libX11/libxcb link-time
dependency), and the four requests this adapter needs (ConfigureWindow,
MapWindow, UnmapWindow, SetInputFocus) are core protocol.

Written without Linux hardware (P3 best-effort bring-up): the pump-state
machine mirrors gpui/native/macos/GpuiCefAppKitHooks.m semantics 1:1 except
that a gpui foreground task with a cancellable deadline replaces the
uncancellable dispatch_after generation counter. Runtime behavior needs
device verification.
*/

use anyhow::Result;
use futures::{FutureExt as _, StreamExt as _, channel::mpsc};
use std::ffi::c_void;
use std::sync::OnceLock;
use std::sync::atomic::{AtomicBool, Ordering};
use std::time::{Duration, Instant};

use x11rb::connection::Connection as _;
use x11rb::protocol::xproto::{
    ConfigureWindowAux, ConnectionExt as _, InputFocus, Window as X11Window,
};
use x11rb::rust_connection::RustConnection;

/// Matches GhostexGpuiCEFMessagePumpPlaceholderDelayMs in the macOS shim.
const PUMP_PLACEHOLDER_DELAY_MS: i64 = i32::MAX as i64;
/// Matches GhostexGpuiCEFMessagePumpMaxTimerDelayMs in the macOS shim.
const PUMP_MAX_TIMER_DELAY_MS: i64 = 1000 / 30;

/// Requested pump delays, sent from any thread by CEF's
/// on_schedule_message_pump_work and consumed by the main-thread driver
/// task. The sender is the only cross-thread pump entry point.
static PUMP_SENDER: OnceLock<mpsc::UnboundedSender<i64>> = OnceLock::new();
static PUMP_INSTALLED: AtomicBool = AtomicBool::new(false);
static PUMP_WORK_PENDING: AtomicBool = AtomicBool::new(false);
static PUMP_WORK_ACTIVE: AtomicBool = AtomicBool::new(false);
static PUMP_REENTRANCY_DETECTED: AtomicBool = AtomicBool::new(false);

/// Linux links libcef.so at load time (cef-dll-sys emits
/// `rustc-link-lib=dylib=cef`), so there is no runtime framework loader to
/// hold; the packaging layout owns placing libcef.so and the CEF resources
/// beside the executable (found via the $ORIGIN rpath from gpui/build.rs).
pub(super) struct PlatformCefRuntime;

pub(super) fn load_cef_runtime() -> Result<PlatformCefRuntime> {
    Ok(PlatformCefRuntime)
}

pub(super) fn prepare_application() {
    // macOS disables AppKit crash-state restoration here. The Linux
    // process-level preparation — forcing gpui's X11 backend before the
    // Application exists — lives in main.rs next to the
    // gpui_platform::application() call it steers, so nothing remains to do
    // at the CEF layer.
}

pub(super) fn install_application_hooks() {
    // The macOS CefAppProtocol/sendEvent swizzle and Edit-menu install have
    // no Linux counterpart: Chromium integrates with X11 directly (it opens
    // its own display connection and installs its own X error handlers), and
    // edit-command dispatch reaches the focused Chromium child window
    // through normal X11 key routing.
}

pub(super) fn install_message_pump(cx: &gpui::App) {
    if PUMP_INSTALLED.load(Ordering::SeqCst) {
        return;
    }

    /*
    Unlike macOS (GCD main queue) and Windows (message-only HWND), Linux has
    no OS-level "run this on the main thread" primitive: the main thread sits
    inside gpui's calloop event loop. The only sanctioned way in is gpui's
    own foreground executor, so the pump is a detached foreground task that
    owns the whole pump-state machine on the main thread and receives
    requested delays over a channel. It is spawned once per process; a
    reinstall after invalidate just re-arms the flags.
    */
    if PUMP_SENDER.get().is_none() {
        let (sender, receiver) = mpsc::unbounded();
        let _ = PUMP_SENDER.set(sender);
        let background_executor = cx.background_executor().clone();
        cx.foreground_executor()
            .spawn(drive_message_pump(receiver, background_executor))
            .detach();
    }

    PUMP_WORK_PENDING.store(false, Ordering::SeqCst);
    PUMP_WORK_ACTIVE.store(false, Ordering::SeqCst);
    PUMP_REENTRANCY_DETECTED.store(false, Ordering::SeqCst);
    PUMP_INSTALLED.store(true, Ordering::SeqCst);
}

pub(super) fn invalidate_message_pump() {
    PUMP_INSTALLED.store(false, Ordering::SeqCst);
    PUMP_WORK_PENDING.store(false, Ordering::SeqCst);
}

pub(super) fn schedule_message_pump_work(delay_ms: i64) {
    // CEF may call on_schedule_message_pump_work from any thread; the
    // unbounded send marshals the delay to the main-thread driver task
    // exactly like the macOS shim's dispatch_async(main_queue). All pump
    // state below runs on that thread.
    if let Some(sender) = PUMP_SENDER.get() {
        let _ = sender.unbounded_send(delay_ms);
    }
}

enum PumpEvent {
    Scheduled(Option<i64>),
    DeadlineReached,
}

async fn drive_message_pump(
    mut scheduled_delays: mpsc::UnboundedReceiver<i64>,
    background_executor: gpui::BackgroundExecutor,
) {
    // `deadline` is this platform's SetTimer/KillTimer: a pending one-shot
    // that any newly scheduled delay replaces (making the macOS shim's
    // generation counter unnecessary, same as Windows).
    let mut deadline: Option<Instant> = None;
    loop {
        let event = match deadline {
            Some(at) => {
                let timer = background_executor
                    .timer(at.saturating_duration_since(Instant::now()))
                    .fuse();
                futures::pin_mut!(timer);
                futures::select_biased! {
                    delay_ms = scheduled_delays.next() => PumpEvent::Scheduled(delay_ms),
                    _ = timer => PumpEvent::DeadlineReached,
                }
            }
            None => PumpEvent::Scheduled(scheduled_delays.next().await),
        };

        match event {
            // The process-wide sender lives in a static and is never
            // dropped; a closed channel means process teardown.
            PumpEvent::Scheduled(None) => return,
            PumpEvent::Scheduled(Some(delay_ms)) => {
                on_schedule_message_pump_work(&mut deadline, delay_ms);
            }
            PumpEvent::DeadlineReached => {
                deadline = None;
                if PUMP_INSTALLED.load(Ordering::SeqCst)
                    && PUMP_WORK_PENDING.load(Ordering::SeqCst)
                {
                    PUMP_WORK_PENDING.store(false, Ordering::SeqCst);
                    run_scheduled_message_pump_work();
                }
            }
        }
    }
}

fn on_schedule_message_pump_work(deadline: &mut Option<Instant>, delay_ms: i64) {
    if !PUMP_INSTALLED.load(Ordering::SeqCst) {
        return;
    }

    if delay_ms == PUMP_PLACEHOLDER_DELAY_MS && PUMP_WORK_PENDING.load(Ordering::SeqCst) {
        return;
    }

    PUMP_WORK_PENDING.store(false, Ordering::SeqCst);
    *deadline = None;

    if delay_ms <= 0 {
        run_scheduled_message_pump_work();
        return;
    }

    let clamped_delay_ms = delay_ms.min(PUMP_MAX_TIMER_DELAY_MS);
    PUMP_WORK_PENDING.store(true, Ordering::SeqCst);
    *deadline = Some(Instant::now() + Duration::from_millis(clamped_delay_ms as u64));
}

fn run_scheduled_message_pump_work() {
    if !PUMP_INSTALLED.load(Ordering::SeqCst) {
        return;
    }

    let was_reentrant = perform_message_loop_work();
    if was_reentrant {
        schedule_message_pump_work(0);
    } else if !PUMP_WORK_PENDING.load(Ordering::SeqCst) {
        schedule_message_pump_work(PUMP_PLACEHOLDER_DELAY_MS);
    }
}

fn perform_message_loop_work() -> bool {
    if PUMP_WORK_ACTIVE.load(Ordering::SeqCst) {
        PUMP_REENTRANCY_DETECTED.store(true, Ordering::SeqCst);
        return false;
    }

    PUMP_REENTRANCY_DETECTED.store(false, Ordering::SeqCst);
    PUMP_WORK_ACTIVE.store(true, Ordering::SeqCst);
    cef::do_message_loop_work();
    PUMP_WORK_ACTIVE.store(false, Ordering::SeqCst);

    PUMP_REENTRANCY_DETECTED.load(Ordering::SeqCst)
}

pub(super) fn apply_platform_settings(settings: &mut cef::Settings) {
    /*
    On macOS the bundle layout discovers the helper apps; on Linux CEF
    re-launches the main executable for subprocesses unless
    browser_subprocess_path points at the dedicated helper, so the packaged
    layout must place ghostex-gpui-cef-helper beside the main executable.
    */
    let executable =
        std::env::current_exe().expect("failed to resolve GPUI executable path for CEF helper");
    let helper = executable
        .parent()
        .expect("GPUI executable path has no parent directory")
        .join("ghostex-gpui-cef-helper");
    settings.browser_subprocess_path = cef::CefString::from(helper.to_string_lossy().as_ref());
}

pub(super) fn append_platform_command_line_switches(command_line: &mut cef::CommandLine) {
    use cef::ImplCommandLine as _;
    // The whole app runs X11 (see the module header), so Chromium's Ozone
    // backend must be pinned to X11 as well; letting Ozone auto-pick Wayland
    // would make windowed child-browser creation impossible. Chromium
    // propagates the switch to its subprocesses itself.
    command_line.append_switch_with_value(
        Some(&cef::CefString::from("ozone-platform")),
        Some(&cef::CefString::from("x11")),
    );
}

pub(super) fn child_window_info(
    parent_native_view: *mut c_void,
    bounds: &cef::Rect,
) -> cef::WindowInfo {
    // cef_window_handle_t is the X11 window id (c_ulong) on Linux; the
    // opaque pointer from cef_parent_native_view carries that id.
    cef::WindowInfo::default().set_as_child(
        parent_native_view as usize as cef::sys::cef_window_handle_t,
        bounds,
    )
}

pub(super) fn native_view_ptr(handle: cef::sys::cef_window_handle_t) -> *mut c_void {
    handle as usize as *mut c_void
}

pub(super) fn prepare_native_view_for_focus(_native_view: *mut c_void) {
    // The macOS focus subclass exists to route AppKit first-responder and
    // command-key dispatch into the exact CEF NSView. On X11 keyboard focus
    // follows SetInputFocus/click on the Chromium child window, and
    // select-all runs inside Chromium's own accelerator handling, so no
    // per-view setup is needed here.
}

/// Adapter-owned X connection for child-window placement. CEF and gpui each
/// hold their own display connections; requests on separate connections are
/// serialized by the X server, so this needs no coordination with them.
fn x11_connection() -> &'static RustConnection {
    static X11_CONNECTION: OnceLock<RustConnection> = OnceLock::new();
    X11_CONNECTION.get_or_init(|| {
        let (connection, _screen) = x11rb::connect(None)
            .expect("failed to connect to the X11 display for CEF child-window placement");
        connection
    })
}

fn x11_window(native_view: *mut c_void) -> Option<X11Window> {
    let id = native_view as usize;
    if id == 0 {
        return None;
    }
    // X11 window ids are 32-bit resource ids even though the C handle type
    // is c_ulong.
    Some(id as X11Window)
}

pub(super) fn set_native_view_frame(
    native_view: *mut c_void,
    x: f64,
    y: f64,
    width: f64,
    height: f64,
    scale_factor: f32,
) {
    let Some(window) = x11_window(native_view) else {
        return;
    };
    /*
    The shared shell passes gpui logical pixels with a top-left origin. X11
    child-window placement is physical pixels relative to the parent's
    top-left, and X11 has no per-window scale query, so the conversion uses
    the scale factor GPUI computed for the parent window. Zero extents are
    clamped to 1: a zero-size X window is a BadValue protocol error, and the
    shared shell hides collapsed surfaces via set_native_view_visible rather
    than zero-sizing them.
    */
    let scale = if scale_factor > 0.0 {
        scale_factor as f64
    } else {
        1.0
    };
    let values = ConfigureWindowAux::new()
        .x((x * scale).round() as i32)
        .y((y * scale).round() as i32)
        .width((width * scale).round().max(1.0) as u32)
        .height((height * scale).round().max(1.0) as u32);
    let connection = x11_connection();
    let _ = connection.configure_window(window, &values);
    let _ = connection.flush();
}

pub(super) fn set_native_view_visible(native_view: *mut c_void, visible: bool) {
    let Some(window) = x11_window(native_view) else {
        return;
    };
    // Map/unmap mirrors NSView.hidden: the window keeps its geometry and
    // browser state, it just stops being composited. Neither request moves
    // keyboard focus; the shared shell's blur() handles focus release.
    let connection = x11_connection();
    if visible {
        let _ = connection.map_window(window);
    } else {
        let _ = connection.unmap_window(window);
    }
    let _ = connection.flush();
}

pub(super) fn focus_native_view(native_view: *mut c_void) {
    let Some(window) = x11_window(native_view) else {
        return;
    };
    // Mirrors makeFirstResponder on macOS: give the CEF child window X input
    // focus so key events route to Chromium; the shared shell follows up
    // with host.set_focus(1) so Chromium moves focus to its inner widget.
    // RevertTo=Parent returns focus to the GPUI window if the child unmaps.
    let connection = x11_connection();
    let _ = connection.set_input_focus(InputFocus::PARENT, window, x11rb::CURRENT_TIME);
    let _ = connection.flush();
}
