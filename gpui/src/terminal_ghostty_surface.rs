#![allow(dead_code)]

use std::{
    collections::VecDeque,
    ffi::{CStr, CString, c_char, c_int, c_void},
    fmt,
    mem::{self, ManuallyDrop},
    ptr::{self, NonNull},
    sync::{
        Mutex, OnceLock,
        atomic::{AtomicBool, AtomicPtr, AtomicU8, Ordering},
    },
};

use gpui::{Bounds, Pixels};

use crate::{
    AgentsTerminalBodyMountSlotId, AgentsTerminalRuntimeSessionId, AgentsTerminalStartupBodySlotId,
    TerminalSurfaceMountSlotKey, ghostty_kit::ffi,
};

#[cfg(target_os = "macos")]
use crate::terminal_native_view::RealTerminalNativeViewHandle;

/*
CDXC:GPUIGhosttySurfaceRuntime 2026-06-22-22:45:
Phase 2 crosses the real GhosttyKit/libghostty boundary for visible running Agents mount slots. The runtime owners may initialize Ghostty, create a finalized default config, share one Ghostty app, create/drop/update real surfaces from App-owned host NSViews, and mirror shell-derived terminal focus idempotently; they must not add command/cwd/env/session lifecycle, persistent IDs, terminal content, stdout/stderr, logs, fake handles, fallback success paths, overlays, hidden hit regions, broad hit-test routing, or synthetic input routing.

CDXC:GPUITerminalRuntimeIdentity 2026-06-22-23:24:
Ghostty surface owners carry the private runtime session id separately from the pane/body mount slot. Mount slots remain layout attachments keyed by pane plus shell session, while runtime ids are process-local session identity and must not be persisted, logged, or shown as terminal titles.

CDXC:GPUITerminalLaunchPayload 2026-06-22-23:58:
Phase 3 startup may carry cwd, command, env vars, initial input, and wait-after-command only as runtime launch data on a prepared Ghostty surface request. Reject interior-NUL strings before FFI and keep CString/env-var storage scoped to ghostty_surface_new so private launch values never enter Debug output, logs, shell state, titles, or returned configs with dangling pointers.

CDXC:GPUITerminalStartupGhosttySurface 2026-06-23-03:33:
Mounting startup surfaces need a startup-owned Ghostty boundary keyed by `AgentsTerminalStartupBodySlotId` plus process-local runtime id. This owner may create, resize, and free a hidden Ghostty surface from an already-prepared config request, but it must not require a Running mount slot, show or focus AppKit hosts, set Ghostty app/surface focus, apply Ready/Failed, persist, log, or expose launch/private terminal payloads.

CDXC:GPUITerminalStartupGhosttySurface 2026-06-23-04:13:
Startup readiness may inspect Ghostty surface metadata only as redacted runtime facts: process-exited, foreground-process-id-present, and tty-name-present. Raw tty names and process ids must be freed or discarded at the FFI boundary and must not enter Debug output, shell state, logs, titles, launch payloads, or persistence.

CDXC:GPUITerminalStartupHandoff 2026-06-23-04:25:
Ready Mounting startup surfaces must be re-owned by the Running surface path instead of being dropped and recreated. The conversion consumes the startup owner without freeing the Ghostty surface, changes only the map key identity from startup body slot to Running body mount slot, and keeps raw process, tty, launch, and terminal content data out of logs, shell state, and Debug output.

CDXC:GPUITerminalGhosttyClose 2026-06-23-04:49:
Running Ghostty close parity must ask the embedded surface to close and wait for the runtime close callback before shell-tab removal. Each surface owner passes a process-memory close token as surface userdata, keeps the AppKit NSView available only through `platform.macos.nsview`, and records only confirmation-needed or confirmed-close state without logging, persistence, runtime ids, raw paths, command text, environment, stdout/stderr, tty names, process ids, or terminal content.

CDXC:GPUICommandTerminalSurface 2026-06-23-05:03:
Running Ghostty surface ownership is generic over a typed body mount slot so command-pane terminals can use the same App-owned NSView and GhosttyKit surface pipeline without entering Agents workspace/startup maps. Command owners use command group/session ids, empty launch requests for now, no title/status/path parsing, no logs, no persistence, and no input routing changes.

CDXC:GPUITerminalProcessExit 2026-06-23-05:30:
Mounted Running Agents and command terminals need a runtime-only process-exited query that returns only a redacted boolean. Callers that only need exit state must not use the richer metadata snapshot because that would unnecessarily cross the tty/pid FFI boundary and increase the chance of exposing raw terminal/process details.

CDXC:GPUITerminalCloseConfirm 2026-06-23-05:39:
Close-confirm parity needs the Ghostty callback token to hand confirmation-needed events to GPUI exactly once so App-owned runtime state can hold the pending prompt identity. The token remains process memory only and must not expose terminal content, command text, paths, runtime ids, durable ids, logs, shell-state fields, or launch payload data.

CDXC:GPUITerminalCloseConfirm 2026-06-23-05:47:
Canceling a pending close-confirm prompt must reset only the owner-local close-request latch after exact GPUI surface matching. That lets a later user close action ask Ghostty again without inventing a fallback close path or persisting prompt state.

CDXC:GPUITerminalInputABI 2026-06-23-05:53:
Real terminal input parity begins with narrow owner wrappers over the existing embedded Ghostty input exports. These wrappers accept already-sanitized primitive values or borrowed byte slices, do not translate GPUI keyboard/mouse events yet, and must not store, log, persist, or expose terminal input text through Debug or shell-state JSON.

CDXC:GPUITerminalInputABI 2026-06-23-05:58:
Zero-length text and preedit are distinct FFI edge cases. Text uses a stable non-null empty pointer because Ghostty slices the pointer unconditionally, while preedit clear follows Ghostty's AppKit path and passes a null pointer with length zero.

CDXC:GPUITerminalCloseConfirm 2026-06-23-20:04:
Slice 237 binds GhosttyKit's real `ghostty_surface_needs_confirm_quit` query so close-confirm prompts can be backed by source-side ABI evidence. Surface owners may expose only a boolean for the current mounted surface; they must not log, persist, or reveal process ids, tty names, commands, paths, runtime ids, or terminal content.
*/

#[derive(Clone, Copy)]
pub(crate) struct GhosttyKitFunctionTable {
    init: unsafe fn(usize, *mut *mut c_char) -> c_int,
    config_new: unsafe fn() -> ffi::ghostty_config_t,
    config_free: unsafe fn(ffi::ghostty_config_t),
    config_load_default_files: unsafe fn(ffi::ghostty_config_t),
    config_finalize: unsafe fn(ffi::ghostty_config_t),
    app_new: unsafe fn(
        *const ffi::ghostty_runtime_config_s,
        ffi::ghostty_config_t,
    ) -> ffi::ghostty_app_t,
    app_free: unsafe fn(ffi::ghostty_app_t),
    app_tick: unsafe fn(ffi::ghostty_app_t),
    app_set_focus: unsafe fn(ffi::ghostty_app_t, bool),
    string_free: unsafe fn(ffi::ghostty_string_s),
    surface_config_new: unsafe fn() -> ffi::ghostty_surface_config_s,
    surface_new: unsafe fn(
        ffi::ghostty_app_t,
        *const ffi::ghostty_surface_config_s,
    ) -> ffi::ghostty_surface_t,
    surface_free: unsafe fn(ffi::ghostty_surface_t),
    surface_set_content_scale: unsafe fn(ffi::ghostty_surface_t, f64, f64),
    surface_set_size: unsafe fn(ffi::ghostty_surface_t, u32, u32),
    surface_set_focus: unsafe fn(ffi::ghostty_surface_t, bool),
    surface_size: unsafe fn(ffi::ghostty_surface_t) -> ffi::ghostty_surface_size_s,
    surface_needs_confirm_quit: unsafe fn(ffi::ghostty_surface_t) -> bool,
    surface_process_exited: unsafe fn(ffi::ghostty_surface_t) -> bool,
    surface_foreground_pid: unsafe fn(ffi::ghostty_surface_t) -> u64,
    surface_tty_name: unsafe fn(ffi::ghostty_surface_t) -> ffi::ghostty_string_s,
    surface_key_translation_mods:
        unsafe fn(ffi::ghostty_surface_t, ffi::ghostty_input_mods_e) -> ffi::ghostty_input_mods_e,
    surface_key: unsafe fn(ffi::ghostty_surface_t, ffi::ghostty_input_key_s) -> bool,
    surface_key_is_binding: unsafe fn(
        ffi::ghostty_surface_t,
        ffi::ghostty_input_key_s,
        *mut ffi::ghostty_binding_flags_e,
    ) -> bool,
    surface_text: unsafe fn(ffi::ghostty_surface_t, *const c_char, usize),
    surface_preedit: unsafe fn(ffi::ghostty_surface_t, *const c_char, usize),
    surface_mouse_captured: unsafe fn(ffi::ghostty_surface_t) -> bool,
    surface_mouse_button: unsafe fn(
        ffi::ghostty_surface_t,
        ffi::ghostty_input_mouse_state_e,
        ffi::ghostty_input_mouse_button_e,
        ffi::ghostty_input_mods_e,
    ) -> bool,
    surface_mouse_pos: unsafe fn(ffi::ghostty_surface_t, f64, f64, ffi::ghostty_input_mods_e),
    surface_mouse_scroll:
        unsafe fn(ffi::ghostty_surface_t, f64, f64, ffi::ghostty_input_scroll_mods_t),
    surface_mouse_pressure: unsafe fn(ffi::ghostty_surface_t, u32, f64),
    surface_ime_point: unsafe fn(ffi::ghostty_surface_t, *mut f64, *mut f64, *mut f64, *mut f64),
    surface_request_close: unsafe fn(ffi::ghostty_surface_t),
    surface_complete_clipboard_request:
        unsafe fn(ffi::ghostty_surface_t, *const c_char, *mut c_void, bool),
}

impl GhosttyKitFunctionTable {
    const fn production() -> Self {
        Self {
            init: production_ghostty_init,
            config_new: production_ghostty_config_new,
            config_free: production_ghostty_config_free,
            config_load_default_files: production_ghostty_config_load_default_files,
            config_finalize: production_ghostty_config_finalize,
            app_new: production_ghostty_app_new,
            app_free: production_ghostty_app_free,
            app_tick: production_ghostty_app_tick,
            app_set_focus: production_ghostty_app_set_focus,
            string_free: production_ghostty_string_free,
            surface_config_new: production_ghostty_surface_config_new,
            surface_new: production_ghostty_surface_new,
            surface_free: production_ghostty_surface_free,
            surface_set_content_scale: production_ghostty_surface_set_content_scale,
            surface_set_size: production_ghostty_surface_set_size,
            surface_set_focus: production_ghostty_surface_set_focus,
            surface_size: production_ghostty_surface_size,
            surface_needs_confirm_quit: production_ghostty_surface_needs_confirm_quit,
            surface_process_exited: production_ghostty_surface_process_exited,
            surface_foreground_pid: production_ghostty_surface_foreground_pid,
            surface_tty_name: production_ghostty_surface_tty_name,
            surface_key_translation_mods: production_ghostty_surface_key_translation_mods,
            surface_key: production_ghostty_surface_key,
            surface_key_is_binding: production_ghostty_surface_key_is_binding,
            surface_text: production_ghostty_surface_text,
            surface_preedit: production_ghostty_surface_preedit,
            surface_mouse_captured: production_ghostty_surface_mouse_captured,
            surface_mouse_button: production_ghostty_surface_mouse_button,
            surface_mouse_pos: production_ghostty_surface_mouse_pos,
            surface_mouse_scroll: production_ghostty_surface_mouse_scroll,
            surface_mouse_pressure: production_ghostty_surface_mouse_pressure,
            surface_ime_point: production_ghostty_surface_ime_point,
            surface_request_close: production_ghostty_surface_request_close,
            surface_complete_clipboard_request:
                production_ghostty_surface_complete_clipboard_request,
        }
    }

    #[cfg(test)]
    #[allow(clippy::too_many_arguments)]
    pub(crate) const fn new_for_test(
        init: unsafe fn(usize, *mut *mut c_char) -> c_int,
        config_new: unsafe fn() -> ffi::ghostty_config_t,
        config_free: unsafe fn(ffi::ghostty_config_t),
        config_load_default_files: unsafe fn(ffi::ghostty_config_t),
        config_finalize: unsafe fn(ffi::ghostty_config_t),
        app_new: unsafe fn(
            *const ffi::ghostty_runtime_config_s,
            ffi::ghostty_config_t,
        ) -> ffi::ghostty_app_t,
        app_free: unsafe fn(ffi::ghostty_app_t),
        app_tick: unsafe fn(ffi::ghostty_app_t),
        app_set_focus: unsafe fn(ffi::ghostty_app_t, bool),
        string_free: unsafe fn(ffi::ghostty_string_s),
        surface_config_new: unsafe fn() -> ffi::ghostty_surface_config_s,
        surface_new: unsafe fn(
            ffi::ghostty_app_t,
            *const ffi::ghostty_surface_config_s,
        ) -> ffi::ghostty_surface_t,
        surface_free: unsafe fn(ffi::ghostty_surface_t),
        surface_set_content_scale: unsafe fn(ffi::ghostty_surface_t, f64, f64),
        surface_set_size: unsafe fn(ffi::ghostty_surface_t, u32, u32),
        surface_set_focus: unsafe fn(ffi::ghostty_surface_t, bool),
        surface_size: unsafe fn(ffi::ghostty_surface_t) -> ffi::ghostty_surface_size_s,
        surface_needs_confirm_quit: unsafe fn(ffi::ghostty_surface_t) -> bool,
        surface_process_exited: unsafe fn(ffi::ghostty_surface_t) -> bool,
        surface_foreground_pid: unsafe fn(ffi::ghostty_surface_t) -> u64,
        surface_tty_name: unsafe fn(ffi::ghostty_surface_t) -> ffi::ghostty_string_s,
        surface_key_translation_mods: unsafe fn(
            ffi::ghostty_surface_t,
            ffi::ghostty_input_mods_e,
        ) -> ffi::ghostty_input_mods_e,
        surface_key: unsafe fn(ffi::ghostty_surface_t, ffi::ghostty_input_key_s) -> bool,
        surface_key_is_binding: unsafe fn(
            ffi::ghostty_surface_t,
            ffi::ghostty_input_key_s,
            *mut ffi::ghostty_binding_flags_e,
        ) -> bool,
        surface_text: unsafe fn(ffi::ghostty_surface_t, *const c_char, usize),
        surface_preedit: unsafe fn(ffi::ghostty_surface_t, *const c_char, usize),
        surface_mouse_captured: unsafe fn(ffi::ghostty_surface_t) -> bool,
        surface_mouse_button: unsafe fn(
            ffi::ghostty_surface_t,
            ffi::ghostty_input_mouse_state_e,
            ffi::ghostty_input_mouse_button_e,
            ffi::ghostty_input_mods_e,
        ) -> bool,
        surface_mouse_pos: unsafe fn(ffi::ghostty_surface_t, f64, f64, ffi::ghostty_input_mods_e),
        surface_mouse_scroll: unsafe fn(
            ffi::ghostty_surface_t,
            f64,
            f64,
            ffi::ghostty_input_scroll_mods_t,
        ),
        surface_mouse_pressure: unsafe fn(ffi::ghostty_surface_t, u32, f64),
        surface_ime_point: unsafe fn(
            ffi::ghostty_surface_t,
            *mut f64,
            *mut f64,
            *mut f64,
            *mut f64,
        ),
        surface_request_close: unsafe fn(ffi::ghostty_surface_t),
        surface_complete_clipboard_request: unsafe fn(
            ffi::ghostty_surface_t,
            *const c_char,
            *mut c_void,
            bool,
        ),
    ) -> Self {
        Self {
            init,
            config_new,
            config_free,
            config_load_default_files,
            config_finalize,
            app_new,
            app_free,
            app_tick,
            app_set_focus,
            string_free,
            surface_config_new,
            surface_new,
            surface_free,
            surface_set_content_scale,
            surface_set_size,
            surface_set_focus,
            surface_size,
            surface_needs_confirm_quit,
            surface_process_exited,
            surface_foreground_pid,
            surface_tty_name,
            surface_key_translation_mods,
            surface_key,
            surface_key_is_binding,
            surface_text,
            surface_preedit,
            surface_mouse_captured,
            surface_mouse_button,
            surface_mouse_pos,
            surface_mouse_scroll,
            surface_mouse_pressure,
            surface_ime_point,
            surface_request_close,
            surface_complete_clipboard_request,
        }
    }
}

unsafe fn production_ghostty_init(argc: usize, argv: *mut *mut c_char) -> c_int {
    unsafe { ffi::ghostty_init(argc, argv) }
}

unsafe fn production_ghostty_config_new() -> ffi::ghostty_config_t {
    unsafe { ffi::ghostty_config_new() }
}

unsafe fn production_ghostty_config_free(config: ffi::ghostty_config_t) {
    unsafe { ffi::ghostty_config_free(config) }
}

unsafe fn production_ghostty_config_load_default_files(config: ffi::ghostty_config_t) {
    unsafe { ffi::ghostty_config_load_default_files(config) }
}

unsafe fn production_ghostty_config_finalize(config: ffi::ghostty_config_t) {
    unsafe { ffi::ghostty_config_finalize(config) }
}

unsafe fn production_ghostty_app_new(
    runtime_config: *const ffi::ghostty_runtime_config_s,
    config: ffi::ghostty_config_t,
) -> ffi::ghostty_app_t {
    unsafe { ffi::ghostty_app_new(runtime_config, config) }
}

unsafe fn production_ghostty_app_free(app: ffi::ghostty_app_t) {
    unsafe { ffi::ghostty_app_free(app) }
}

unsafe fn production_ghostty_app_tick(app: ffi::ghostty_app_t) {
    unsafe { ffi::ghostty_app_tick(app) }
}

unsafe fn production_ghostty_app_set_focus(app: ffi::ghostty_app_t, focused: bool) {
    unsafe { ffi::ghostty_app_set_focus(app, focused) }
}

unsafe fn production_ghostty_string_free(value: ffi::ghostty_string_s) {
    unsafe { ffi::ghostty_string_free(value) }
}

unsafe fn production_ghostty_surface_config_new() -> ffi::ghostty_surface_config_s {
    unsafe { ffi::ghostty_surface_config_new() }
}

unsafe fn production_ghostty_surface_new(
    app: ffi::ghostty_app_t,
    config: *const ffi::ghostty_surface_config_s,
) -> ffi::ghostty_surface_t {
    unsafe { ffi::ghostty_surface_new(app, config) }
}

unsafe fn production_ghostty_surface_free(surface: ffi::ghostty_surface_t) {
    unsafe { ffi::ghostty_surface_free(surface) }
}

unsafe fn production_ghostty_surface_set_content_scale(
    surface: ffi::ghostty_surface_t,
    x: f64,
    y: f64,
) {
    unsafe { ffi::ghostty_surface_set_content_scale(surface, x, y) }
}

unsafe fn production_ghostty_surface_set_size(
    surface: ffi::ghostty_surface_t,
    width: u32,
    height: u32,
) {
    unsafe { ffi::ghostty_surface_set_size(surface, width, height) }
}

unsafe fn production_ghostty_surface_set_focus(surface: ffi::ghostty_surface_t, focused: bool) {
    unsafe { ffi::ghostty_surface_set_focus(surface, focused) }
}

unsafe fn production_ghostty_surface_size(
    surface: ffi::ghostty_surface_t,
) -> ffi::ghostty_surface_size_s {
    unsafe { ffi::ghostty_surface_size(surface) }
}

unsafe fn production_ghostty_surface_process_exited(surface: ffi::ghostty_surface_t) -> bool {
    unsafe { ffi::ghostty_surface_process_exited(surface) }
}

unsafe fn production_ghostty_surface_needs_confirm_quit(
    surface: ffi::ghostty_surface_t,
) -> bool {
    unsafe { ffi::ghostty_surface_needs_confirm_quit(surface) }
}

unsafe fn production_ghostty_surface_foreground_pid(surface: ffi::ghostty_surface_t) -> u64 {
    unsafe { ffi::ghostty_surface_foreground_pid(surface) }
}

unsafe fn production_ghostty_surface_tty_name(
    surface: ffi::ghostty_surface_t,
) -> ffi::ghostty_string_s {
    unsafe { ffi::ghostty_surface_tty_name(surface) }
}

unsafe fn production_ghostty_surface_key_translation_mods(
    surface: ffi::ghostty_surface_t,
    mods: ffi::ghostty_input_mods_e,
) -> ffi::ghostty_input_mods_e {
    unsafe { ffi::ghostty_surface_key_translation_mods(surface, mods) }
}

unsafe fn production_ghostty_surface_key(
    surface: ffi::ghostty_surface_t,
    event: ffi::ghostty_input_key_s,
) -> bool {
    unsafe { ffi::ghostty_surface_key(surface, event) }
}

unsafe fn production_ghostty_surface_key_is_binding(
    surface: ffi::ghostty_surface_t,
    event: ffi::ghostty_input_key_s,
    flags: *mut ffi::ghostty_binding_flags_e,
) -> bool {
    unsafe { ffi::ghostty_surface_key_is_binding(surface, event, flags) }
}

unsafe fn production_ghostty_surface_text(
    surface: ffi::ghostty_surface_t,
    ptr: *const c_char,
    len: usize,
) {
    unsafe { ffi::ghostty_surface_text(surface, ptr, len) }
}

unsafe fn production_ghostty_surface_preedit(
    surface: ffi::ghostty_surface_t,
    ptr: *const c_char,
    len: usize,
) {
    unsafe { ffi::ghostty_surface_preedit(surface, ptr, len) }
}

unsafe fn production_ghostty_surface_mouse_captured(surface: ffi::ghostty_surface_t) -> bool {
    unsafe { ffi::ghostty_surface_mouse_captured(surface) }
}

unsafe fn production_ghostty_surface_mouse_button(
    surface: ffi::ghostty_surface_t,
    action: ffi::ghostty_input_mouse_state_e,
    button: ffi::ghostty_input_mouse_button_e,
    mods: ffi::ghostty_input_mods_e,
) -> bool {
    unsafe { ffi::ghostty_surface_mouse_button(surface, action, button, mods) }
}

unsafe fn production_ghostty_surface_mouse_pos(
    surface: ffi::ghostty_surface_t,
    x: f64,
    y: f64,
    mods: ffi::ghostty_input_mods_e,
) {
    unsafe { ffi::ghostty_surface_mouse_pos(surface, x, y, mods) }
}

unsafe fn production_ghostty_surface_mouse_scroll(
    surface: ffi::ghostty_surface_t,
    x: f64,
    y: f64,
    scroll_mods: ffi::ghostty_input_scroll_mods_t,
) {
    unsafe { ffi::ghostty_surface_mouse_scroll(surface, x, y, scroll_mods) }
}

unsafe fn production_ghostty_surface_mouse_pressure(
    surface: ffi::ghostty_surface_t,
    stage: u32,
    pressure: f64,
) {
    unsafe { ffi::ghostty_surface_mouse_pressure(surface, stage, pressure) }
}

unsafe fn production_ghostty_surface_ime_point(
    surface: ffi::ghostty_surface_t,
    x: *mut f64,
    y: *mut f64,
    width: *mut f64,
    height: *mut f64,
) {
    unsafe { ffi::ghostty_surface_ime_point(surface, x, y, width, height) }
}

unsafe fn production_ghostty_surface_request_close(surface: ffi::ghostty_surface_t) {
    unsafe { ffi::ghostty_surface_request_close(surface) }
}

unsafe fn production_ghostty_surface_complete_clipboard_request(
    surface: ffi::ghostty_surface_t,
    data: *const c_char,
    state: *mut c_void,
    confirmed: bool,
) {
    unsafe { ffi::ghostty_surface_complete_clipboard_request(surface, data, state, confirmed) }
}

#[derive(Clone, Copy, Debug, PartialEq)]
pub(crate) enum GhosttySurfaceRuntimeError {
    InitFailed(c_int),
    ConfigCreateReturnedNull,
    AppCreateReturnedNull,
    SurfaceCreateReturnedNull,
    InvalidScaleFactor(f64),
    InvalidBounds {
        field: GhosttySurfaceBoundsField,
        value: f64,
    },
    LaunchPayloadContainsInteriorNul {
        field: GhosttySurfaceLaunchPayloadField,
    },
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum GhosttySurfaceBoundsField {
    Width,
    Height,
}

impl From<GhosttySurfaceConfigRequestError> for GhosttySurfaceRuntimeError {
    fn from(error: GhosttySurfaceConfigRequestError) -> Self {
        match error {
            GhosttySurfaceConfigRequestError::InvalidScaleFactor(value) => {
                Self::InvalidScaleFactor(value)
            }
            GhosttySurfaceConfigRequestError::LaunchPayloadContainsInteriorNul { field } => {
                Self::LaunchPayloadContainsInteriorNul { field }
            }
        }
    }
}

static PRODUCTION_GHOSTTY_INIT_RESULT: OnceLock<Result<(), GhosttySurfaceRuntimeError>> =
    OnceLock::new();

fn initialize_production_ghostty_once(
    functions: GhosttyKitFunctionTable,
) -> Result<(), GhosttySurfaceRuntimeError> {
    *PRODUCTION_GHOSTTY_INIT_RESULT.get_or_init(|| initialize_ghostty_runtime(functions))
}

fn initialize_ghostty_runtime(
    functions: GhosttyKitFunctionTable,
) -> Result<(), GhosttySurfaceRuntimeError> {
    let mut argv = [ptr::null_mut::<c_char>()];
    let result = unsafe { (functions.init)(0, argv.as_mut_ptr()) };
    if result == ffi::GHOSTTY_SUCCESS {
        Ok(())
    } else {
        Err(GhosttySurfaceRuntimeError::InitFailed(result))
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) struct GhosttySurfaceNsViewHandle {
    nsview: NonNull<c_void>,
}

impl GhosttySurfaceNsViewHandle {
    /// # Safety
    ///
    /// `nsview` must be an existing real AppKit `NSView` that remains valid until the eventual
    /// Ghostty surface config consumer finishes using the produced FFI struct.
    pub(crate) unsafe fn from_existing_nsview(nsview: NonNull<c_void>) -> Self {
        Self { nsview }
    }

    #[cfg(target_os = "macos")]
    pub(crate) fn from_terminal_native_view(native_view: RealTerminalNativeViewHandle) -> Self {
        Self {
            nsview: native_view.as_non_null(),
        }
    }

    fn as_ptr(self) -> *mut c_void {
        self.nsview.as_ptr()
    }
}

#[derive(Clone, Copy, Debug, PartialEq)]
pub(crate) struct GhosttySurfaceScaleFactor(f64);

impl GhosttySurfaceScaleFactor {
    pub(crate) fn new(scale_factor: f64) -> Result<Self, GhosttySurfaceConfigRequestError> {
        if scale_factor.is_finite() && scale_factor > 0.0 {
            Ok(Self(scale_factor))
        } else {
            Err(GhosttySurfaceConfigRequestError::InvalidScaleFactor(
                scale_factor,
            ))
        }
    }

    fn get(self) -> f64 {
        self.0
    }
}

#[derive(Clone, Copy, Debug, PartialEq)]
pub(crate) enum GhosttySurfaceConfigRequestError {
    InvalidScaleFactor(f64),
    LaunchPayloadContainsInteriorNul {
        field: GhosttySurfaceLaunchPayloadField,
    },
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum GhosttySurfaceLaunchPayloadField {
    WorkingDirectory,
    Command,
    EnvVarKey,
    EnvVarValue,
    InitialInput,
}

#[derive(Clone, PartialEq, Eq)]
pub(crate) struct GhosttySurfaceLaunchEnvVar {
    key: String,
    value: String,
}

#[derive(Clone, PartialEq, Eq)]
pub(crate) struct GhosttySurfaceLaunchPayload {
    working_directory: Option<String>,
    command: Option<String>,
    env_vars: Vec<GhosttySurfaceLaunchEnvVar>,
    initial_input: Option<String>,
    wait_after_command: bool,
}

impl GhosttySurfaceLaunchPayload {
    pub(crate) fn try_new(
        working_directory: Option<String>,
        command: Option<String>,
        env_vars: Vec<(String, String)>,
        initial_input: Option<String>,
        wait_after_command: bool,
    ) -> Result<Self, GhosttySurfaceConfigRequestError> {
        validate_optional_launch_string(
            GhosttySurfaceLaunchPayloadField::WorkingDirectory,
            working_directory.as_deref(),
        )?;
        validate_optional_launch_string(
            GhosttySurfaceLaunchPayloadField::Command,
            command.as_deref(),
        )?;
        validate_optional_launch_string(
            GhosttySurfaceLaunchPayloadField::InitialInput,
            initial_input.as_deref(),
        )?;

        let env_vars = env_vars
            .into_iter()
            .map(|(key, value)| {
                validate_launch_string(GhosttySurfaceLaunchPayloadField::EnvVarKey, &key)?;
                validate_launch_string(GhosttySurfaceLaunchPayloadField::EnvVarValue, &value)?;
                Ok(GhosttySurfaceLaunchEnvVar { key, value })
            })
            .collect::<Result<Vec<_>, GhosttySurfaceConfigRequestError>>()?;

        Ok(Self {
            working_directory,
            command,
            env_vars,
            initial_input,
            wait_after_command,
        })
    }

    fn env_var_count(&self) -> usize {
        self.env_vars.len()
    }
}

impl fmt::Debug for GhosttySurfaceLaunchPayload {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.debug_struct("GhosttySurfaceLaunchPayload")
            .field("has_working_directory", &self.working_directory.is_some())
            .field("has_command", &self.command.is_some())
            .field("env_var_count", &self.env_var_count())
            .field("has_initial_input", &self.initial_input.is_some())
            .field("wait_after_command", &self.wait_after_command)
            .finish()
    }
}

fn validate_optional_launch_string(
    field: GhosttySurfaceLaunchPayloadField,
    value: Option<&str>,
) -> Result<(), GhosttySurfaceConfigRequestError> {
    if let Some(value) = value {
        validate_launch_string(field, value)?;
    }
    Ok(())
}

fn validate_launch_string(
    field: GhosttySurfaceLaunchPayloadField,
    value: &str,
) -> Result<(), GhosttySurfaceConfigRequestError> {
    if value.as_bytes().contains(&0) {
        Err(GhosttySurfaceConfigRequestError::LaunchPayloadContainsInteriorNul { field })
    } else {
        Ok(())
    }
}

#[derive(Clone, PartialEq)]
pub(crate) struct GhosttySurfaceConfigRequest {
    nsview: GhosttySurfaceNsViewHandle,
    scale_factor: GhosttySurfaceScaleFactor,
    launch_payload: Option<GhosttySurfaceLaunchPayload>,
}

impl GhosttySurfaceConfigRequest {
    pub(crate) fn new(
        nsview: GhosttySurfaceNsViewHandle,
        scale_factor: GhosttySurfaceScaleFactor,
    ) -> Self {
        Self {
            nsview,
            scale_factor,
            launch_payload: None,
        }
    }

    pub(crate) fn try_new(
        nsview: GhosttySurfaceNsViewHandle,
        scale_factor: f64,
    ) -> Result<Self, GhosttySurfaceConfigRequestError> {
        Ok(Self::new(
            nsview,
            GhosttySurfaceScaleFactor::new(scale_factor)?,
        ))
    }

    pub(crate) fn with_launch_payload(
        mut self,
        launch_payload: GhosttySurfaceLaunchPayload,
    ) -> Self {
        self.launch_payload = Some(launch_payload);
        self
    }

    #[cfg(target_os = "macos")]
    pub(crate) fn try_from_terminal_native_view(
        native_view: RealTerminalNativeViewHandle,
        scale_factor: f64,
    ) -> Result<Self, GhosttySurfaceConfigRequestError> {
        Self::try_new(
            GhosttySurfaceNsViewHandle::from_terminal_native_view(native_view),
            scale_factor,
        )
    }

    pub(crate) fn to_ffi_config(&self) -> ffi::ghostty_surface_config_s {
        assert!(
            self.launch_payload.is_none(),
            "launch-bearing Ghostty configs require scoped preparation"
        );
        let mut config = empty_ffi_surface_config();
        self.apply_base_to_ffi_config(&mut config);
        config
    }

    pub(crate) fn scale_factor(&self) -> f64 {
        self.scale_factor.get()
    }

    fn prepare_ffi_config(
        &self,
        mut config: ffi::ghostty_surface_config_s,
    ) -> GhosttySurfacePreparedConfig {
        self.apply_base_to_ffi_config(&mut config);
        GhosttySurfacePreparedConfig::new(config, self.launch_payload.as_ref())
    }

    fn apply_base_to_ffi_config(&self, config: &mut ffi::ghostty_surface_config_s) {
        let nsview = self.nsview.as_ptr();

        config.platform_tag = ffi::GHOSTTY_PLATFORM_MACOS;
        config.platform = ffi::ghostty_platform_u {
            macos: ffi::ghostty_platform_macos_s { nsview },
        };
        config.userdata = nsview;
        config.write_pty_cb = None;
        config.scale_factor = self.scale_factor.get();
        config.font_size = 0.0;
        config.working_directory = ptr::null();
        config.command = ptr::null();
        config.env_vars = ptr::null_mut();
        config.env_var_count = 0;
        config.initial_input = ptr::null();
        config.wait_after_command = false;
        config.context = ffi::GHOSTTY_SURFACE_CONTEXT_WINDOW;
    }
}

impl fmt::Debug for GhosttySurfaceConfigRequest {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.debug_struct("GhosttySurfaceConfigRequest")
            .field("scale_factor", &self.scale_factor.get())
            .field("has_launch_payload", &self.launch_payload.is_some())
            .field(
                "launch_env_var_count",
                &self
                    .launch_payload
                    .as_ref()
                    .map_or(0, GhosttySurfaceLaunchPayload::env_var_count),
            )
            .finish()
    }
}

struct GhosttySurfacePreparedConfig {
    config: ffi::ghostty_surface_config_s,
    _working_directory: Option<CString>,
    _command: Option<CString>,
    _env_keys: Vec<CString>,
    _env_values: Vec<CString>,
    _env_vars: Vec<ffi::ghostty_env_var_s>,
    _initial_input: Option<CString>,
}

impl GhosttySurfacePreparedConfig {
    fn new(
        mut config: ffi::ghostty_surface_config_s,
        launch_payload: Option<&GhosttySurfaceLaunchPayload>,
    ) -> Self {
        let Some(launch_payload) = launch_payload else {
            return Self {
                config,
                _working_directory: None,
                _command: None,
                _env_keys: Vec::new(),
                _env_values: Vec::new(),
                _env_vars: Vec::new(),
                _initial_input: None,
            };
        };

        let working_directory = launch_payload
            .working_directory
            .as_deref()
            .map(cstring_from_validated_launch_string);
        let command = launch_payload
            .command
            .as_deref()
            .map(cstring_from_validated_launch_string);
        let initial_input = launch_payload
            .initial_input
            .as_deref()
            .map(cstring_from_validated_launch_string);
        let env_keys = launch_payload
            .env_vars
            .iter()
            .map(|env_var| cstring_from_validated_launch_string(&env_var.key))
            .collect::<Vec<_>>();
        let env_values = launch_payload
            .env_vars
            .iter()
            .map(|env_var| cstring_from_validated_launch_string(&env_var.value))
            .collect::<Vec<_>>();
        let mut env_vars = env_keys
            .iter()
            .zip(env_values.iter())
            .map(|(key, value)| ffi::ghostty_env_var_s {
                key: key.as_ptr(),
                value: value.as_ptr(),
            })
            .collect::<Vec<_>>();

        config.working_directory = working_directory
            .as_ref()
            .map_or(ptr::null(), |value| value.as_ptr());
        config.command = command.as_ref().map_or(ptr::null(), |value| value.as_ptr());
        config.initial_input = initial_input
            .as_ref()
            .map_or(ptr::null(), |value| value.as_ptr());
        config.wait_after_command = launch_payload.wait_after_command;
        config.env_var_count = env_vars.len();
        config.env_vars = if env_vars.is_empty() {
            ptr::null_mut()
        } else {
            env_vars.as_mut_ptr()
        };

        Self {
            config,
            _working_directory: working_directory,
            _command: command,
            _env_keys: env_keys,
            _env_values: env_values,
            _env_vars: env_vars,
            _initial_input: initial_input,
        }
    }

    fn as_ptr(&self) -> *const ffi::ghostty_surface_config_s {
        &self.config
    }

    fn set_surface_userdata(&mut self, userdata: *mut c_void) {
        self.config.userdata = userdata;
    }

    #[cfg(test)]
    fn config(&self) -> &ffi::ghostty_surface_config_s {
        &self.config
    }
}

fn cstring_from_validated_launch_string(value: &str) -> CString {
    CString::new(value).expect("launch payload strings are validated before FFI preparation")
}

fn empty_ffi_surface_config() -> ffi::ghostty_surface_config_s {
    ffi::ghostty_surface_config_s {
        platform_tag: ffi::GHOSTTY_PLATFORM_INVALID,
        platform: ffi::ghostty_platform_u {
            macos: ffi::ghostty_platform_macos_s {
                nsview: ptr::null_mut(),
            },
        },
        userdata: ptr::null_mut(),
        write_pty_cb: None,
        scale_factor: 1.0,
        font_size: 0.0,
        working_directory: ptr::null(),
        command: ptr::null(),
        env_vars: ptr::null_mut(),
        env_var_count: 0,
        initial_input: ptr::null(),
        wait_after_command: false,
        context: ffi::GHOSTTY_SURFACE_CONTEXT_WINDOW,
    }
}

pub(crate) struct GhosttyConfigOwner {
    config: NonNull<c_void>,
    functions: GhosttyKitFunctionTable,
}

impl GhosttyConfigOwner {
    fn load_default_finalized_with_functions(
        functions: GhosttyKitFunctionTable,
    ) -> Result<Self, GhosttySurfaceRuntimeError> {
        let config = unsafe { (functions.config_new)() };
        let config =
            NonNull::new(config).ok_or(GhosttySurfaceRuntimeError::ConfigCreateReturnedNull)?;
        let owner = Self { config, functions };

        unsafe {
            (functions.config_load_default_files)(owner.as_raw());
            (functions.config_finalize)(owner.as_raw());
        }

        Ok(owner)
    }

    fn as_raw(&self) -> ffi::ghostty_config_t {
        self.config.as_ptr()
    }
}

impl Drop for GhosttyConfigOwner {
    fn drop(&mut self) {
        unsafe {
            (self.functions.config_free)(self.as_raw());
        }
    }
}

struct GhosttyRuntimeCallbackState {
    app: AtomicPtr<c_void>,
    wakeup_requested: AtomicBool,
}

impl GhosttyRuntimeCallbackState {
    fn new() -> Self {
        Self {
            app: AtomicPtr::new(ptr::null_mut()),
            wakeup_requested: AtomicBool::new(false),
        }
    }

    fn mark_app_ready(&self, app: ffi::ghostty_app_t) {
        self.app.store(app, Ordering::SeqCst);
    }
}

pub(crate) struct GhosttyAppOwner {
    app: NonNull<c_void>,
    config: GhosttyConfigOwner,
    runtime_state: Box<GhosttyRuntimeCallbackState>,
    runtime_config: ffi::ghostty_runtime_config_s,
    functions: GhosttyKitFunctionTable,
    latest_focus_state: Option<bool>,
}

impl GhosttyAppOwner {
    pub(crate) fn new() -> Result<Self, GhosttySurfaceRuntimeError> {
        let functions = GhosttyKitFunctionTable::production();
        initialize_production_ghostty_once(functions)?;
        Self::new_after_runtime_init(functions)
    }

    #[cfg(test)]
    pub(crate) fn new_with_functions(
        functions: GhosttyKitFunctionTable,
    ) -> Result<Self, GhosttySurfaceRuntimeError> {
        initialize_ghostty_runtime(functions)?;
        Self::new_after_runtime_init(functions)
    }

    fn new_after_runtime_init(
        functions: GhosttyKitFunctionTable,
    ) -> Result<Self, GhosttySurfaceRuntimeError> {
        let config = GhosttyConfigOwner::load_default_finalized_with_functions(functions)?;
        let runtime_state = Box::new(GhosttyRuntimeCallbackState::new());
        let runtime_config = runtime_config_for_state(&runtime_state);
        let app = unsafe { (functions.app_new)(&runtime_config, config.as_raw()) };
        let app = NonNull::new(app).ok_or(GhosttySurfaceRuntimeError::AppCreateReturnedNull)?;
        runtime_state.mark_app_ready(app.as_ptr());

        Ok(Self {
            app,
            config,
            runtime_state,
            runtime_config,
            functions,
            latest_focus_state: None,
        })
    }

    fn as_raw(&self) -> ffi::ghostty_app_t {
        self.app.as_ptr()
    }

    pub(crate) fn tick(&self) {
        unsafe {
            (self.functions.app_tick)(self.as_raw());
        }
    }

    pub(crate) fn tick_if_woken(&self) {
        if self
            .runtime_state
            .wakeup_requested
            .swap(false, Ordering::SeqCst)
        {
            self.tick();
        }
    }

    pub(crate) fn set_focus(&mut self, focused: bool) {
        if self.latest_focus_state == Some(focused) {
            return;
        }
        unsafe {
            (self.functions.app_set_focus)(self.as_raw(), focused);
        }
        self.latest_focus_state = Some(focused);
    }

    #[cfg(test)]
    fn wakeup_requested(&self) -> bool {
        self.runtime_state.wakeup_requested.load(Ordering::SeqCst)
    }
}

impl Drop for GhosttyAppOwner {
    fn drop(&mut self) {
        self.runtime_state
            .app
            .store(ptr::null_mut(), Ordering::SeqCst);
        unsafe {
            (self.functions.app_free)(self.as_raw());
        }
    }
}

/*
CDXC:GPUITerminalClipboard 2026-06-23-12:11:
Ghostty runtime clipboard callbacks must never touch GPUI App clipboard APIs directly. The Ghostty runtime config passes app-level callback userdata plus opaque request state but no surface identity, while completion requires a concrete `ghostty_surface_t`; binding requests to whichever GPUI surface is focused during a later drain could complete a non-focused terminal's clipboard request through the wrong surface. Keep these callbacks installed but disabled until Ghostty or GPUI exposes a surface-scoped app-thread clipboard handoff; selection clipboard also stays unsupported because GPUI exposes no cross-platform selection path here.

CDXC:GPUITerminalClipboard 2026-06-23-14:23:
Runtime clipboard stays blocked until a surface-scoped app-thread handoff proves the exact mounted surface that originated the Ghostty request. App-level userdata, non-null request state, or "some terminal is focused" are not requester identity and must not authorize GPUI clipboard reads or writes.
*/
const GHOSTTY_RUNTIME_SUPPORTS_SELECTION_CLIPBOARD: bool = false;
const GHOSTTY_RUNTIME_CLIPBOARD_TEXT_PLAIN_MIME: &[u8] = b"text/plain";
const GHOSTTY_RUNTIME_EMPTY_CLIPBOARD_C_STRING: &[u8] = b"\0";

fn runtime_config_for_state(state: &GhosttyRuntimeCallbackState) -> ffi::ghostty_runtime_config_s {
    ffi::ghostty_runtime_config_s {
        userdata: state as *const GhosttyRuntimeCallbackState as *mut c_void,
        supports_selection_clipboard: GHOSTTY_RUNTIME_SUPPORTS_SELECTION_CLIPBOARD,
        wakeup_cb: Some(ghostty_runtime_wakeup_cb),
        action_cb: Some(ghostty_runtime_action_cb),
        read_clipboard_cb: Some(ghostty_runtime_read_clipboard_cb),
        confirm_read_clipboard_cb: Some(ghostty_runtime_confirm_read_clipboard_cb),
        write_clipboard_cb: Some(ghostty_runtime_write_clipboard_cb),
        close_surface_cb: Some(ghostty_runtime_close_surface_cb),
    }
}

unsafe extern "C" fn ghostty_runtime_wakeup_cb(userdata: *mut c_void) {
    let Some(state) = NonNull::new(userdata as *mut GhosttyRuntimeCallbackState) else {
        return;
    };
    unsafe {
        state
            .as_ref()
            .wakeup_requested
            .store(true, Ordering::SeqCst);
    }
}

unsafe extern "C" fn ghostty_runtime_action_cb(
    _app: ffi::ghostty_app_t,
    _target: ffi::ghostty_target_s,
    _action: ffi::ghostty_action_s,
) -> bool {
    false
}

/*
CDXC:GPUITerminalClipboard 2026-06-23-12:11:
Runtime callbacks intentionally return false or ignore pointer payloads. Do not cast app-level runtime userdata to a surface close token, synthesize a focused-surface fallback, store raw clipboard bytes in runtime state, or log/persist clipboard data from this FFI path.

CDXC:GPUITerminalClipboard 2026-06-23-14:23:
These callbacks must stay no-op/false gates even when userdata resembles a ready app state or a surface token. Regression coverage asserts that callback invocations do not enqueue owner-local operations, read or write GPUI clipboard closures, complete requests, or retain raw clipboard payloads.
*/
unsafe extern "C" fn ghostty_runtime_read_clipboard_cb(
    _userdata: *mut c_void,
    _clipboard: ffi::ghostty_clipboard_e,
    _state: *mut c_void,
) -> bool {
    false
}

unsafe extern "C" fn ghostty_runtime_confirm_read_clipboard_cb(
    _userdata: *mut c_void,
    _content: *const c_char,
    _state: *mut c_void,
    _request: ffi::ghostty_clipboard_request_e,
) {
}

unsafe extern "C" fn ghostty_runtime_write_clipboard_cb(
    _userdata: *mut c_void,
    _clipboard: ffi::ghostty_clipboard_e,
    _content: *const ffi::ghostty_clipboard_content_s,
    _len: usize,
    _confirm: bool,
) {
}

const GHOSTTY_SURFACE_CLOSE_STATE_NONE: u8 = 0;
const GHOSTTY_SURFACE_CLOSE_STATE_CONFIRMATION_NEEDED: u8 = 1;
const GHOSTTY_SURFACE_CLOSE_STATE_CONFIRMED: u8 = 2;

/*
CDXC:GPUITerminalClipboard 2026-06-23-14:23:
Owner-local clipboard operations are denial/drain scaffolding only. A denied drain must complete pending reads with empty data and drop writes without invoking clipboard closures; an allowed drain must not be wired to focused-surface fallback routing unless a future surface-scoped requester identity is explicit.
*/
enum GhosttyRuntimeClipboardOperation {
    ReadStandard { state: *mut c_void },
    WriteStandardText { text: String },
}

struct GhosttySurfaceCloseToken {
    close_state: AtomicU8,
    surface: AtomicPtr<c_void>,
    surface_complete_clipboard_request:
        unsafe fn(ffi::ghostty_surface_t, *const c_char, *mut c_void, bool),
    runtime_clipboard_operations: Mutex<VecDeque<GhosttyRuntimeClipboardOperation>>,
}

impl GhosttySurfaceCloseToken {
    fn new(functions: GhosttyKitFunctionTable) -> Self {
        Self {
            close_state: AtomicU8::new(GHOSTTY_SURFACE_CLOSE_STATE_NONE),
            surface: AtomicPtr::new(ptr::null_mut()),
            surface_complete_clipboard_request: functions.surface_complete_clipboard_request,
            runtime_clipboard_operations: Mutex::new(VecDeque::new()),
        }
    }

    fn as_userdata(&self) -> *mut c_void {
        self as *const GhosttySurfaceCloseToken as *mut c_void
    }

    fn set_surface(&self, surface: ffi::ghostty_surface_t) {
        self.surface.store(surface, Ordering::SeqCst);
    }

    fn clear_surface(&self) {
        self.surface.store(ptr::null_mut(), Ordering::SeqCst);
    }

    fn runtime_surface(&self) -> Option<ffi::ghostty_surface_t> {
        NonNull::new(self.surface.load(Ordering::SeqCst)).map(NonNull::as_ptr)
    }

    fn record_close_callback(&self, confirmation_needed: bool) {
        let state = if confirmation_needed {
            GHOSTTY_SURFACE_CLOSE_STATE_CONFIRMATION_NEEDED
        } else {
            GHOSTTY_SURFACE_CLOSE_STATE_CONFIRMED
        };
        self.close_state.store(state, Ordering::SeqCst);
    }

    fn enqueue_runtime_clipboard_read(&self, state: *mut c_void) -> bool {
        if self.runtime_surface().is_none() {
            return false;
        }
        let Ok(mut operations) = self.runtime_clipboard_operations.lock() else {
            return false;
        };
        operations.push_back(GhosttyRuntimeClipboardOperation::ReadStandard { state });
        true
    }

    fn enqueue_runtime_clipboard_write(&self, text: String) {
        if self.runtime_surface().is_none() || text.is_empty() {
            return;
        }
        if let Ok(mut operations) = self.runtime_clipboard_operations.lock() {
            operations.push_back(GhosttyRuntimeClipboardOperation::WriteStandardText { text });
        }
    }

    fn drain_runtime_clipboard_operations(
        &self,
        allow_standard_clipboard: bool,
        mut read_standard_text: impl FnMut() -> Option<String>,
        mut write_standard_text: impl FnMut(String),
    ) {
        let operations = self.take_runtime_clipboard_operations();
        for operation in operations {
            match operation {
                GhosttyRuntimeClipboardOperation::ReadStandard { state } => {
                    let text = if allow_standard_clipboard {
                        read_standard_text()
                    } else {
                        None
                    };
                    self.complete_runtime_clipboard_read(state, text);
                }
                GhosttyRuntimeClipboardOperation::WriteStandardText { text } => {
                    if allow_standard_clipboard {
                        write_standard_text(text);
                    }
                }
            }
        }
    }

    fn deny_pending_runtime_clipboard_operations(&self) {
        let operations = self.take_runtime_clipboard_operations();
        for operation in operations {
            if let GhosttyRuntimeClipboardOperation::ReadStandard { state } = operation {
                self.complete_runtime_clipboard_request(
                    empty_runtime_clipboard_c_string(),
                    state,
                    true,
                );
            }
        }
    }

    fn take_runtime_clipboard_operations(&self) -> VecDeque<GhosttyRuntimeClipboardOperation> {
        self.runtime_clipboard_operations
            .lock()
            .map(|mut operations| mem::take(&mut *operations))
            .unwrap_or_default()
    }

    fn complete_runtime_clipboard_read(&self, state: *mut c_void, text: Option<String>) {
        let text = text.and_then(|text| CString::new(text).ok());
        let data = text
            .as_ref()
            .map_or_else(empty_runtime_clipboard_c_string, |text| text.as_ptr());
        self.complete_runtime_clipboard_request(data, state, true);
    }

    fn complete_runtime_clipboard_request(
        &self,
        data: *const c_char,
        state: *mut c_void,
        confirmed: bool,
    ) {
        let Some(surface) = self.runtime_surface() else {
            return;
        };
        unsafe {
            (self.surface_complete_clipboard_request)(surface, data, state, confirmed);
        }
    }

    fn consume_confirmed_close_requested(&self) -> bool {
        self.close_state
            .compare_exchange(
                GHOSTTY_SURFACE_CLOSE_STATE_CONFIRMED,
                GHOSTTY_SURFACE_CLOSE_STATE_NONE,
                Ordering::SeqCst,
                Ordering::SeqCst,
            )
            .is_ok()
    }

    fn consume_confirmation_needed_close_requested(&self) -> bool {
        self.close_state
            .compare_exchange(
                GHOSTTY_SURFACE_CLOSE_STATE_CONFIRMATION_NEEDED,
                GHOSTTY_SURFACE_CLOSE_STATE_NONE,
                Ordering::SeqCst,
                Ordering::SeqCst,
            )
            .is_ok()
    }

    fn confirmed_close_pending(&self) -> bool {
        self.close_state.load(Ordering::SeqCst) == GHOSTTY_SURFACE_CLOSE_STATE_CONFIRMED
    }

    fn clear_confirmation_needed_close_requested(&self) {
        let _ = self.close_state.compare_exchange(
            GHOSTTY_SURFACE_CLOSE_STATE_CONFIRMATION_NEEDED,
            GHOSTTY_SURFACE_CLOSE_STATE_NONE,
            Ordering::SeqCst,
            Ordering::SeqCst,
        );
    }

    #[cfg(test)]
    fn confirmation_needed_pending(&self) -> bool {
        self.close_state.load(Ordering::SeqCst) == GHOSTTY_SURFACE_CLOSE_STATE_CONFIRMATION_NEEDED
    }
}

fn empty_runtime_clipboard_c_string() -> *const c_char {
    GHOSTTY_RUNTIME_EMPTY_CLIPBOARD_C_STRING.as_ptr().cast()
}

unsafe fn runtime_clipboard_text_plain_content(
    content: *const ffi::ghostty_clipboard_content_s,
    len: usize,
) -> Option<String> {
    if content.is_null() || len == 0 {
        return None;
    }
    for entry in unsafe { std::slice::from_raw_parts(content, len) } {
        if entry.mime.is_null() || entry.data.is_null() {
            continue;
        }
        let mime = unsafe { CStr::from_ptr(entry.mime) };
        if mime.to_bytes() != GHOSTTY_RUNTIME_CLIPBOARD_TEXT_PLAIN_MIME {
            continue;
        }
        let data = unsafe { CStr::from_ptr(entry.data) };
        let Ok(text) = data.to_str() else {
            continue;
        };
        if text.is_empty() {
            continue;
        }
        return Some(text.to_string());
    }
    None
}

unsafe extern "C" fn ghostty_runtime_close_surface_cb(
    userdata: *mut c_void,
    confirmation_needed: bool,
) {
    let Some(token) = NonNull::new(userdata as *mut GhosttySurfaceCloseToken) else {
        return;
    };
    unsafe {
        token.as_ref().record_close_callback(confirmation_needed);
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) struct GhosttySurfacePixelSize {
    pub(crate) width: u32,
    pub(crate) height: u32,
}

impl GhosttySurfacePixelSize {
    pub(crate) fn from_gpui_bounds(
        bounds: Bounds<Pixels>,
        scale_factor: f64,
    ) -> Result<Self, GhosttySurfaceRuntimeError> {
        let scale_factor = GhosttySurfaceScaleFactor::new(scale_factor)?;
        Ok(Self {
            width: scaled_pixel_dimension(
                GhosttySurfaceBoundsField::Width,
                f64::from(bounds.size.width.as_f32()),
                scale_factor,
            )?,
            height: scaled_pixel_dimension(
                GhosttySurfaceBoundsField::Height,
                f64::from(bounds.size.height.as_f32()),
                scale_factor,
            )?,
        })
    }
}

fn scaled_pixel_dimension(
    field: GhosttySurfaceBoundsField,
    value: f64,
    scale_factor: GhosttySurfaceScaleFactor,
) -> Result<u32, GhosttySurfaceRuntimeError> {
    if !value.is_finite() || value < 0.0 {
        return Err(GhosttySurfaceRuntimeError::InvalidBounds { field, value });
    }

    let scaled = (value * scale_factor.get()).floor().max(1.0);
    if !scaled.is_finite() || scaled > f64::from(u32::MAX) {
        return Err(GhosttySurfaceRuntimeError::InvalidBounds { field, value });
    }

    Ok(scaled as u32)
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) struct GhosttySurfaceKeyBindingStatus {
    binding: bool,
    flags: ffi::ghostty_binding_flags_e,
}

impl GhosttySurfaceKeyBindingStatus {
    fn from_ffi_result(binding: bool, flags: ffi::ghostty_binding_flags_e) -> Self {
        Self {
            binding,
            flags: if binding { flags } else { 0 },
        }
    }

    pub(crate) fn binding(self) -> bool {
        self.binding
    }

    pub(crate) fn flags(self) -> ffi::ghostty_binding_flags_e {
        self.flags
    }
}

static GHOSTTY_SURFACE_EMPTY_TEXT_SENTINEL: [u8; 1] = [0];

fn ghostty_surface_text_ptr(bytes: &[u8]) -> *const c_char {
    if bytes.is_empty() {
        GHOSTTY_SURFACE_EMPTY_TEXT_SENTINEL.as_ptr() as *const c_char
    } else {
        bytes.as_ptr() as *const c_char
    }
}

fn ghostty_surface_preedit_ptr(bytes: &[u8]) -> *const c_char {
    if bytes.is_empty() {
        ptr::null()
    } else {
        bytes.as_ptr() as *const c_char
    }
}

#[derive(Clone, Copy, Debug, PartialEq)]
pub(crate) struct GhosttySurfaceImePoint {
    pub(crate) x: f64,
    pub(crate) y: f64,
    pub(crate) width: f64,
    pub(crate) height: f64,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) struct GhosttySurfaceMetadataSnapshot {
    process_exited: bool,
    foreground_process_id_present: bool,
    tty_name_present: bool,
}

impl GhosttySurfaceMetadataSnapshot {
    pub(crate) fn from_redacted_presence(
        process_exited: bool,
        foreground_process_id_present: bool,
        tty_name_present: bool,
    ) -> Self {
        Self {
            process_exited,
            foreground_process_id_present,
            tty_name_present,
        }
    }

    pub(crate) fn process_exited(self) -> bool {
        self.process_exited
    }

    pub(crate) fn foreground_process_id_present(self) -> bool {
        self.foreground_process_id_present
    }

    pub(crate) fn tty_name_present(self) -> bool {
        self.tty_name_present
    }

    pub(crate) fn indicates_ready_metadata(self) -> bool {
        !self.process_exited && self.foreground_process_id_present && self.tty_name_present
    }
}

fn ghostty_surface_metadata_snapshot(
    functions: GhosttyKitFunctionTable,
    surface: ffi::ghostty_surface_t,
) -> GhosttySurfaceMetadataSnapshot {
    let process_exited = unsafe { (functions.surface_process_exited)(surface) };
    let foreground_process_id_present = unsafe { (functions.surface_foreground_pid)(surface) } != 0;
    let tty_name = unsafe { (functions.surface_tty_name)(surface) };
    let tty_name_present = !tty_name.ptr.is_null() && tty_name.len > 0;
    unsafe {
        (functions.string_free)(tty_name);
    }

    GhosttySurfaceMetadataSnapshot::from_redacted_presence(
        process_exited,
        foreground_process_id_present,
        tty_name_present,
    )
}

pub(crate) struct GhosttySurfaceOwner<SlotId = AgentsTerminalBodyMountSlotId> {
    surface: NonNull<c_void>,
    mount_slot_id: SlotId,
    runtime_session_id: AgentsTerminalRuntimeSessionId,
    functions: GhosttyKitFunctionTable,
    close_token: Box<GhosttySurfaceCloseToken>,
    close_requested: bool,
    latest_scale_factor: Option<GhosttySurfaceScaleFactor>,
    latest_pixel_size: Option<GhosttySurfacePixelSize>,
    latest_focus_state: Option<bool>,
}

impl<SlotId> GhosttySurfaceOwner<SlotId>
where
    SlotId: TerminalSurfaceMountSlotKey,
{
    pub(crate) fn new(
        app: &GhosttyAppOwner,
        mount_slot_id: SlotId,
        runtime_session_id: AgentsTerminalRuntimeSessionId,
        request: &GhosttySurfaceConfigRequest,
    ) -> Result<Self, GhosttySurfaceRuntimeError> {
        let close_token = Box::new(GhosttySurfaceCloseToken::new(app.functions));
        let (surface, functions) =
            create_ghostty_surface_from_request(app, request, close_token.as_userdata())?;
        close_token.set_surface(surface.as_ptr());
        Ok(Self {
            surface,
            mount_slot_id,
            runtime_session_id,
            functions,
            close_token,
            close_requested: false,
            latest_scale_factor: None,
            latest_pixel_size: None,
            latest_focus_state: None,
        })
    }

    pub(crate) fn mount_slot_id(&self) -> SlotId {
        self.mount_slot_id
    }

    pub(crate) fn runtime_session_id(&self) -> AgentsTerminalRuntimeSessionId {
        self.runtime_session_id
    }

    pub(crate) fn can_rekey_to_mount_slot(
        &self,
        mount_slot_id: SlotId,
        runtime_session_id: AgentsTerminalRuntimeSessionId,
    ) -> bool {
        self.mount_slot_id == mount_slot_id && self.runtime_session_id == runtime_session_id
    }

    pub(crate) fn into_rekeyed_surface_owner(
        self,
        mount_slot_id: SlotId,
        runtime_session_id: AgentsTerminalRuntimeSessionId,
    ) -> Self {
        /*
        CDXC:GPUTerminalParkedOwnerReattach 2026-06-23-19:41:
        Parked Running owners must reattach by moving the same Ghostty surface back under the current body slot. `ManuallyDrop` prevents `ghostty_surface_free` during the rekey and keeps the close/clipboard token with the surface userdata so reattach cannot recreate the process or lose owner-scoped runtime callbacks.
        */
        let owner = ManuallyDrop::new(self);
        let close_token = unsafe { ptr::read(&owner.close_token) };
        Self {
            surface: owner.surface,
            mount_slot_id,
            runtime_session_id,
            functions: owner.functions,
            close_token,
            close_requested: owner.close_requested,
            latest_scale_factor: owner.latest_scale_factor,
            latest_pixel_size: owner.latest_pixel_size,
            latest_focus_state: None,
        }
    }

    pub(crate) fn update_content_scale_and_size(
        &mut self,
        bounds: Bounds<Pixels>,
        scale_factor: f64,
    ) -> Result<(), GhosttySurfaceRuntimeError> {
        let scale_factor = GhosttySurfaceScaleFactor::new(scale_factor)?;
        let pixel_size = GhosttySurfacePixelSize::from_gpui_bounds(bounds, scale_factor.get())?;
        self.set_content_scale(scale_factor);
        self.set_size_pixels(pixel_size);
        Ok(())
    }

    pub(crate) fn set_focus(&mut self, focused: bool) {
        if self.latest_focus_state == Some(focused) {
            return;
        }
        unsafe {
            (self.functions.surface_set_focus)(self.as_raw(), focused);
        }
        self.latest_focus_state = Some(focused);
    }

    pub(crate) fn surface_size(&self) -> ffi::ghostty_surface_size_s {
        unsafe { (self.functions.surface_size)(self.as_raw()) }
    }

    pub(crate) fn metadata_snapshot(&self) -> GhosttySurfaceMetadataSnapshot {
        ghostty_surface_metadata_snapshot(self.functions, self.as_raw())
    }

    pub(crate) fn process_exited(&self) -> bool {
        unsafe { (self.functions.surface_process_exited)(self.as_raw()) }
    }

    pub(crate) fn needs_confirm_quit(&self) -> bool {
        unsafe { (self.functions.surface_needs_confirm_quit)(self.as_raw()) }
    }

    pub(crate) fn key_translation_mods(
        &self,
        mods: ffi::ghostty_input_mods_e,
    ) -> ffi::ghostty_input_mods_e {
        unsafe { (self.functions.surface_key_translation_mods)(self.as_raw(), mods) }
    }

    pub(crate) fn send_key(&self, event: ffi::ghostty_input_key_s) -> bool {
        unsafe { (self.functions.surface_key)(self.as_raw(), event) }
    }

    pub(crate) fn key_is_binding(
        &self,
        event: ffi::ghostty_input_key_s,
    ) -> GhosttySurfaceKeyBindingStatus {
        let mut flags = 0;
        let binding =
            unsafe { (self.functions.surface_key_is_binding)(self.as_raw(), event, &mut flags) };
        GhosttySurfaceKeyBindingStatus::from_ffi_result(binding, flags)
    }

    pub(crate) fn send_text_bytes(&self, bytes: &[u8]) {
        unsafe {
            (self.functions.surface_text)(
                self.as_raw(),
                ghostty_surface_text_ptr(bytes),
                bytes.len(),
            );
        }
    }

    pub(crate) fn set_preedit_bytes(&self, bytes: &[u8]) {
        unsafe {
            (self.functions.surface_preedit)(
                self.as_raw(),
                ghostty_surface_preedit_ptr(bytes),
                bytes.len(),
            );
        }
    }

    pub(crate) fn mouse_captured(&self) -> bool {
        unsafe { (self.functions.surface_mouse_captured)(self.as_raw()) }
    }

    pub(crate) fn mouse_button(
        &self,
        action: ffi::ghostty_input_mouse_state_e,
        button: ffi::ghostty_input_mouse_button_e,
        mods: ffi::ghostty_input_mods_e,
    ) -> bool {
        unsafe { (self.functions.surface_mouse_button)(self.as_raw(), action, button, mods) }
    }

    pub(crate) fn mouse_pos(&self, x: f64, y: f64, mods: ffi::ghostty_input_mods_e) {
        unsafe {
            (self.functions.surface_mouse_pos)(self.as_raw(), x, y, mods);
        }
    }

    pub(crate) fn mouse_scroll(
        &self,
        x: f64,
        y: f64,
        scroll_mods: ffi::ghostty_input_scroll_mods_t,
    ) {
        unsafe {
            (self.functions.surface_mouse_scroll)(self.as_raw(), x, y, scroll_mods);
        }
    }

    pub(crate) fn mouse_pressure(&self, stage: u32, pressure: f64) {
        unsafe {
            (self.functions.surface_mouse_pressure)(self.as_raw(), stage, pressure);
        }
    }

    pub(crate) fn ime_point(&self) -> GhosttySurfaceImePoint {
        let mut x = 0.0;
        let mut y = 0.0;
        let mut width = 0.0;
        let mut height = 0.0;
        unsafe {
            (self.functions.surface_ime_point)(
                self.as_raw(),
                &mut x,
                &mut y,
                &mut width,
                &mut height,
            );
        }
        GhosttySurfaceImePoint {
            x,
            y,
            width,
            height,
        }
    }

    pub(crate) fn request_close(&mut self) -> bool {
        if self.close_requested {
            return false;
        }
        self.close_requested = true;
        unsafe {
            (self.functions.surface_request_close)(self.as_raw());
        }
        true
    }

    pub(crate) fn consume_confirmed_close_requested(&self) -> bool {
        self.close_token.consume_confirmed_close_requested()
    }

    pub(crate) fn consume_confirmation_needed_close_requested(&self) -> bool {
        self.close_token
            .consume_confirmation_needed_close_requested()
    }

    pub(crate) fn cancel_pending_close_request(&mut self) -> bool {
        if !self.close_requested || self.close_token.confirmed_close_pending() {
            return false;
        }
        self.close_token.clear_confirmation_needed_close_requested();
        self.close_requested = false;
        true
    }

    #[cfg(test)]
    pub(crate) fn simulate_runtime_close_callback_for_test(&self, confirmation_needed: bool) {
        unsafe {
            ghostty_runtime_close_surface_cb(self.close_token.as_userdata(), confirmation_needed);
        }
    }

    #[cfg(test)]
    pub(crate) fn confirmation_needed_close_pending_for_test(&self) -> bool {
        self.close_token.confirmation_needed_pending()
    }

    pub(crate) fn drain_runtime_clipboard_requests(
        &self,
        allow_standard_clipboard: bool,
        read_standard_text: impl FnMut() -> Option<String>,
        write_standard_text: impl FnMut(String),
    ) {
        self.close_token.drain_runtime_clipboard_operations(
            allow_standard_clipboard,
            read_standard_text,
            write_standard_text,
        );
    }

    fn as_raw(&self) -> ffi::ghostty_surface_t {
        self.surface.as_ptr()
    }

    fn set_content_scale(&mut self, scale_factor: GhosttySurfaceScaleFactor) {
        if self.latest_scale_factor == Some(scale_factor) {
            return;
        }
        unsafe {
            (self.functions.surface_set_content_scale)(
                self.as_raw(),
                scale_factor.get(),
                scale_factor.get(),
            );
        }
        self.latest_scale_factor = Some(scale_factor);
    }

    fn set_size_pixels(&mut self, pixel_size: GhosttySurfacePixelSize) {
        if self.latest_pixel_size == Some(pixel_size) {
            return;
        }
        unsafe {
            (self.functions.surface_set_size)(self.as_raw(), pixel_size.width, pixel_size.height);
        }
        self.latest_pixel_size = Some(pixel_size);
    }
}

impl<SlotId> Drop for GhosttySurfaceOwner<SlotId> {
    fn drop(&mut self) {
        self.close_token.deny_pending_runtime_clipboard_operations();
        unsafe {
            (self.functions.surface_free)(self.surface.as_ptr());
        }
        self.close_token.clear_surface();
    }
}

pub(crate) struct StartupGhosttySurfaceOwner {
    surface: NonNull<c_void>,
    startup_body_slot_id: AgentsTerminalStartupBodySlotId,
    runtime_session_id: AgentsTerminalRuntimeSessionId,
    functions: GhosttyKitFunctionTable,
    close_token: Box<GhosttySurfaceCloseToken>,
    latest_scale_factor: Option<GhosttySurfaceScaleFactor>,
    latest_pixel_size: Option<GhosttySurfacePixelSize>,
}

impl StartupGhosttySurfaceOwner {
    pub(crate) fn new(
        app: &GhosttyAppOwner,
        startup_body_slot_id: AgentsTerminalStartupBodySlotId,
        runtime_session_id: AgentsTerminalRuntimeSessionId,
        request: &GhosttySurfaceConfigRequest,
    ) -> Result<Self, GhosttySurfaceRuntimeError> {
        let close_token = Box::new(GhosttySurfaceCloseToken::new(app.functions));
        let (surface, functions) =
            create_ghostty_surface_from_request(app, request, close_token.as_userdata())?;
        close_token.set_surface(surface.as_ptr());
        Ok(Self {
            surface,
            startup_body_slot_id,
            runtime_session_id,
            functions,
            close_token,
            latest_scale_factor: None,
            latest_pixel_size: None,
        })
    }

    pub(crate) fn startup_body_slot_id(&self) -> AgentsTerminalStartupBodySlotId {
        self.startup_body_slot_id
    }

    pub(crate) fn runtime_session_id(&self) -> AgentsTerminalRuntimeSessionId {
        self.runtime_session_id
    }

    pub(crate) fn update_content_scale_and_size(
        &mut self,
        bounds: Bounds<Pixels>,
        scale_factor: f64,
    ) -> Result<(), GhosttySurfaceRuntimeError> {
        let scale_factor = GhosttySurfaceScaleFactor::new(scale_factor)?;
        let pixel_size = GhosttySurfacePixelSize::from_gpui_bounds(bounds, scale_factor.get())?;
        self.set_content_scale(scale_factor);
        self.set_size_pixels(pixel_size);
        Ok(())
    }

    pub(crate) fn metadata_snapshot(&self) -> GhosttySurfaceMetadataSnapshot {
        ghostty_surface_metadata_snapshot(self.functions, self.as_raw())
    }

    pub(crate) fn into_running_surface_owner(
        self,
        mount_slot_id: AgentsTerminalBodyMountSlotId,
    ) -> GhosttySurfaceOwner {
        /*
        CDXC:GPUITerminalStartupHandoff 2026-06-23-04:25:
        Promotion must transfer the exact startup Ghostty surface into the Running owner without calling `ghostty_surface_free`. `ManuallyDrop` keeps the surface alive while the new owner takes the same raw handle and runtime id; focus starts unset because startup owners never focus hidden hosts.

        CDXC:GPUITerminalGhosttyClose 2026-06-23-04:49:
        The surface userdata is the owner-held close token, so Ready handoff must move that token with the raw Ghostty surface. Replacing it would leave the embedded close callback pointing at stale process memory.

        CDXC:GPUITerminalClipboard 2026-06-23-12:11:
        The surface userdata may carry future surface-scoped runtime clipboard scaffold in addition to close state, so Ready handoff must still move the token with the Ghostty surface. Current runtime clipboard callbacks remain disabled because app-level callback userdata does not prove which surface requested clipboard access.
        */
        let startup_owner = ManuallyDrop::new(self);
        let close_token = unsafe { ptr::read(&startup_owner.close_token) };
        GhosttySurfaceOwner {
            surface: startup_owner.surface,
            mount_slot_id,
            runtime_session_id: startup_owner.runtime_session_id,
            functions: startup_owner.functions,
            close_token,
            close_requested: false,
            latest_scale_factor: startup_owner.latest_scale_factor,
            latest_pixel_size: startup_owner.latest_pixel_size,
            latest_focus_state: None,
        }
    }

    fn as_raw(&self) -> ffi::ghostty_surface_t {
        self.surface.as_ptr()
    }

    fn set_content_scale(&mut self, scale_factor: GhosttySurfaceScaleFactor) {
        if self.latest_scale_factor == Some(scale_factor) {
            return;
        }
        unsafe {
            (self.functions.surface_set_content_scale)(
                self.as_raw(),
                scale_factor.get(),
                scale_factor.get(),
            );
        }
        self.latest_scale_factor = Some(scale_factor);
    }

    fn set_size_pixels(&mut self, pixel_size: GhosttySurfacePixelSize) {
        if self.latest_pixel_size == Some(pixel_size) {
            return;
        }
        unsafe {
            (self.functions.surface_set_size)(self.as_raw(), pixel_size.width, pixel_size.height);
        }
        self.latest_pixel_size = Some(pixel_size);
    }
}

impl Drop for StartupGhosttySurfaceOwner {
    fn drop(&mut self) {
        self.close_token.deny_pending_runtime_clipboard_operations();
        unsafe {
            (self.functions.surface_free)(self.as_raw());
        }
        self.close_token.clear_surface();
    }
}

fn create_ghostty_surface_from_request(
    app: &GhosttyAppOwner,
    request: &GhosttySurfaceConfigRequest,
    surface_userdata: *mut c_void,
) -> Result<(NonNull<c_void>, GhosttyKitFunctionTable), GhosttySurfaceRuntimeError> {
    let functions = app.functions;
    let config = unsafe { (functions.surface_config_new)() };
    let mut prepared_config = request.prepare_ffi_config(config);
    prepared_config.set_surface_userdata(surface_userdata);
    let surface = unsafe { (functions.surface_new)(app.as_raw(), prepared_config.as_ptr()) };
    let surface =
        NonNull::new(surface).ok_or(GhosttySurfaceRuntimeError::SurfaceCreateReturnedNull)?;
    Ok((surface, functions))
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::{
        ffi::{CStr, CString},
        slice,
        sync::Mutex,
    };

    const FAKE_CONFIG: usize = 0x1000;
    const FAKE_APP: usize = 0x2000;
    const FAKE_SURFACE: usize = 0x3000;
    const FAKE_NSVIEW: usize = 0x4000;
    const TEST_LAUNCH_WORKING_DIRECTORY: &str = "runtime-working-directory";
    const TEST_LAUNCH_COMMAND: &str = "runtime-command";
    const TEST_LAUNCH_INITIAL_INPUT: &str = "runtime-initial-input";
    const TEST_LAUNCH_ENV_KEY_A: &str = "RUNTIME_ENV_A";
    const TEST_LAUNCH_ENV_VALUE_A: &str = "runtime-value-a";
    const TEST_LAUNCH_ENV_KEY_B: &str = "RUNTIME_ENV_B";
    const TEST_LAUNCH_ENV_VALUE_B: &str = "runtime-value-b";
    const TEST_TTY_NAME: &str = "/dev/ttys127-private";
    const TEST_FOREGROUND_PROCESS_ID: u64 = 424_242;

    #[derive(Default, Debug, PartialEq)]
    struct FakeGhosttyState {
        calls: Vec<&'static str>,
        next_init_result: c_int,
        config_new_returns_null: bool,
        app_new_returns_null: bool,
        surface_new_returns_null: bool,
        last_runtime_userdata: usize,
        last_surface_config: Option<CapturedSurfaceConfig>,
        last_launch_inspection: Option<CapturedLaunchInspection>,
        last_content_scale: Option<(f64, f64)>,
        last_size: Option<(u32, u32)>,
        last_app_focus: Option<bool>,
        last_surface_focus: Option<bool>,
        app_focus_calls: Vec<bool>,
        surface_focus_calls: Vec<bool>,
        needs_confirm_quit: bool,
        process_exited: bool,
        foreground_pid: u64,
        tty_name: Option<&'static str>,
        tty_string_free_count: usize,
        surface_request_close_count: usize,
        surface_complete_clipboard_request_count: usize,
        last_completed_clipboard_data_present: Option<bool>,
        last_completed_clipboard_data_empty: Option<bool>,
        last_completed_clipboard_state_present: Option<bool>,
        last_completed_clipboard_confirmed: Option<bool>,
        key_translation_mods_return: ffi::ghostty_input_mods_e,
        key_event_return: bool,
        key_binding_return: bool,
        key_binding_flags_return: ffi::ghostty_binding_flags_e,
        last_key_translation_mods: Option<ffi::ghostty_input_mods_e>,
        last_key_action: Option<ffi::ghostty_input_action_e>,
        last_key_mods: Option<ffi::ghostty_input_mods_e>,
        last_key_text_present: Option<bool>,
        last_key_composing: Option<bool>,
        surface_key_count: usize,
        surface_key_is_binding_count: usize,
        last_text_len: Option<usize>,
        last_text_ptr_present: Option<bool>,
        surface_text_count: usize,
        last_preedit_len: Option<usize>,
        last_preedit_ptr_present: Option<bool>,
        surface_preedit_count: usize,
        mouse_captured_return: bool,
        mouse_button_return: bool,
        last_mouse_button: Option<(
            ffi::ghostty_input_mouse_state_e,
            ffi::ghostty_input_mouse_button_e,
            ffi::ghostty_input_mods_e,
        )>,
        last_mouse_pos: Option<(f64, f64, ffi::ghostty_input_mods_e)>,
        last_mouse_scroll: Option<(f64, f64, ffi::ghostty_input_scroll_mods_t)>,
        last_mouse_pressure: Option<(u32, f64)>,
        ime_point_return: (f64, f64, f64, f64),
    }

    #[derive(Clone, Copy, Debug, PartialEq)]
    struct CapturedSurfaceConfig {
        platform_tag: ffi::ghostty_platform_e,
        nsview: usize,
        userdata: usize,
        scale_factor: f64,
        font_size: f32,
        working_directory: usize,
        command: usize,
        env_vars: usize,
        env_var_count: usize,
        initial_input: usize,
        wait_after_command: bool,
        context: ffi::ghostty_surface_context_e,
    }

    #[derive(Clone, Copy, Debug, PartialEq)]
    struct CapturedLaunchInspection {
        working_directory_present: bool,
        working_directory_matches_expected: bool,
        command_present: bool,
        command_matches_expected: bool,
        env_vars_present: bool,
        env_var_count: usize,
        env_vars_match_expected: bool,
        initial_input_present: bool,
        initial_input_matches_expected: bool,
        wait_after_command: bool,
    }

    static FAKE_GHOSTTY_STATE: OnceLock<Mutex<FakeGhosttyState>> = OnceLock::new();
    static FAKE_GHOSTTY_TEST_LOCK: OnceLock<Mutex<()>> = OnceLock::new();

    fn fake_state() -> &'static Mutex<FakeGhosttyState> {
        FAKE_GHOSTTY_STATE.get_or_init(|| Mutex::new(FakeGhosttyState::default()))
    }

    fn fake_test_lock() -> std::sync::MutexGuard<'static, ()> {
        FAKE_GHOSTTY_TEST_LOCK
            .get_or_init(|| Mutex::new(()))
            .lock()
            .unwrap()
    }

    fn reset_fake_state() {
        *fake_state().lock().unwrap() = FakeGhosttyState::default();
    }

    fn fake_functions() -> GhosttyKitFunctionTable {
        GhosttyKitFunctionTable {
            init: fake_ghostty_init,
            config_new: fake_ghostty_config_new,
            config_free: fake_ghostty_config_free,
            config_load_default_files: fake_ghostty_config_load_default_files,
            config_finalize: fake_ghostty_config_finalize,
            app_new: fake_ghostty_app_new,
            app_free: fake_ghostty_app_free,
            app_tick: fake_ghostty_app_tick,
            app_set_focus: fake_ghostty_app_set_focus,
            string_free: fake_ghostty_string_free,
            surface_config_new: fake_ghostty_surface_config_new,
            surface_new: fake_ghostty_surface_new,
            surface_free: fake_ghostty_surface_free,
            surface_set_content_scale: fake_ghostty_surface_set_content_scale,
            surface_set_size: fake_ghostty_surface_set_size,
            surface_set_focus: fake_ghostty_surface_set_focus,
            surface_size: fake_ghostty_surface_size,
            surface_needs_confirm_quit: fake_ghostty_surface_needs_confirm_quit,
            surface_process_exited: fake_ghostty_surface_process_exited,
            surface_foreground_pid: fake_ghostty_surface_foreground_pid,
            surface_tty_name: fake_ghostty_surface_tty_name,
            surface_key_translation_mods: fake_ghostty_surface_key_translation_mods,
            surface_key: fake_ghostty_surface_key,
            surface_key_is_binding: fake_ghostty_surface_key_is_binding,
            surface_text: fake_ghostty_surface_text,
            surface_preedit: fake_ghostty_surface_preedit,
            surface_mouse_captured: fake_ghostty_surface_mouse_captured,
            surface_mouse_button: fake_ghostty_surface_mouse_button,
            surface_mouse_pos: fake_ghostty_surface_mouse_pos,
            surface_mouse_scroll: fake_ghostty_surface_mouse_scroll,
            surface_mouse_pressure: fake_ghostty_surface_mouse_pressure,
            surface_ime_point: fake_ghostty_surface_ime_point,
            surface_request_close: fake_ghostty_surface_request_close,
            surface_complete_clipboard_request: fake_ghostty_surface_complete_clipboard_request,
        }
    }

    unsafe fn fake_ghostty_init(_argc: usize, _argv: *mut *mut c_char) -> c_int {
        let mut state = fake_state().lock().unwrap();
        state.calls.push("ghostty_init");
        state.next_init_result
    }

    unsafe fn fake_ghostty_config_new() -> ffi::ghostty_config_t {
        let mut state = fake_state().lock().unwrap();
        state.calls.push("ghostty_config_new");
        if state.config_new_returns_null {
            ptr::null_mut()
        } else {
            FAKE_CONFIG as *mut c_void
        }
    }

    unsafe fn fake_ghostty_config_free(_config: ffi::ghostty_config_t) {
        fake_state()
            .lock()
            .unwrap()
            .calls
            .push("ghostty_config_free");
    }

    unsafe fn fake_ghostty_config_load_default_files(_config: ffi::ghostty_config_t) {
        fake_state()
            .lock()
            .unwrap()
            .calls
            .push("ghostty_config_load_default_files");
    }

    unsafe fn fake_ghostty_config_finalize(_config: ffi::ghostty_config_t) {
        fake_state()
            .lock()
            .unwrap()
            .calls
            .push("ghostty_config_finalize");
    }

    unsafe fn fake_ghostty_app_new(
        runtime_config: *const ffi::ghostty_runtime_config_s,
        _config: ffi::ghostty_config_t,
    ) -> ffi::ghostty_app_t {
        let mut state = fake_state().lock().unwrap();
        state.calls.push("ghostty_app_new");
        let runtime_config = unsafe { runtime_config.as_ref().unwrap() };
        state.last_runtime_userdata = runtime_config.userdata as usize;
        if state.app_new_returns_null {
            ptr::null_mut()
        } else {
            FAKE_APP as *mut c_void
        }
    }

    unsafe fn fake_ghostty_app_free(_app: ffi::ghostty_app_t) {
        fake_state().lock().unwrap().calls.push("ghostty_app_free");
    }

    unsafe fn fake_ghostty_app_tick(_app: ffi::ghostty_app_t) {
        fake_state().lock().unwrap().calls.push("ghostty_app_tick");
    }

    unsafe fn fake_ghostty_app_set_focus(_app: ffi::ghostty_app_t, focused: bool) {
        let mut state = fake_state().lock().unwrap();
        state.calls.push("ghostty_app_set_focus");
        state.last_app_focus = Some(focused);
        state.app_focus_calls.push(focused);
    }

    unsafe fn fake_ghostty_string_free(_value: ffi::ghostty_string_s) {
        let mut state = fake_state().lock().unwrap();
        state.calls.push("ghostty_string_free");
        state.tty_string_free_count += 1;
    }

    unsafe fn fake_ghostty_surface_config_new() -> ffi::ghostty_surface_config_s {
        fake_state()
            .lock()
            .unwrap()
            .calls
            .push("ghostty_surface_config_new");
        empty_ffi_surface_config()
    }

    unsafe fn fake_ghostty_surface_new(
        _app: ffi::ghostty_app_t,
        config: *const ffi::ghostty_surface_config_s,
    ) -> ffi::ghostty_surface_t {
        let mut state = fake_state().lock().unwrap();
        state.calls.push("ghostty_surface_new");
        let config = unsafe { *config };
        state.last_launch_inspection = Some(unsafe { inspect_launch_config_for_test(&config) });
        state.last_surface_config = Some(CapturedSurfaceConfig {
            platform_tag: config.platform_tag,
            nsview: unsafe { config.platform.macos }.nsview as usize,
            userdata: config.userdata as usize,
            scale_factor: config.scale_factor,
            font_size: config.font_size,
            working_directory: config.working_directory as usize,
            command: config.command as usize,
            env_vars: config.env_vars as usize,
            env_var_count: config.env_var_count,
            initial_input: config.initial_input as usize,
            wait_after_command: config.wait_after_command,
            context: config.context,
        });
        if state.surface_new_returns_null {
            ptr::null_mut()
        } else {
            FAKE_SURFACE as *mut c_void
        }
    }

    unsafe fn inspect_launch_config_for_test(
        config: &ffi::ghostty_surface_config_s,
    ) -> CapturedLaunchInspection {
        let env_vars_match_expected = if config.env_vars.is_null() {
            config.env_var_count == 0
        } else {
            let env_vars = unsafe { slice::from_raw_parts(config.env_vars, config.env_var_count) };
            env_vars.len() == 2
                && unsafe { c_string_matches(env_vars[0].key, TEST_LAUNCH_ENV_KEY_A) }
                && unsafe { c_string_matches(env_vars[0].value, TEST_LAUNCH_ENV_VALUE_A) }
                && unsafe { c_string_matches(env_vars[1].key, TEST_LAUNCH_ENV_KEY_B) }
                && unsafe { c_string_matches(env_vars[1].value, TEST_LAUNCH_ENV_VALUE_B) }
        };

        CapturedLaunchInspection {
            working_directory_present: !config.working_directory.is_null(),
            working_directory_matches_expected: unsafe {
                c_string_matches(config.working_directory, TEST_LAUNCH_WORKING_DIRECTORY)
            },
            command_present: !config.command.is_null(),
            command_matches_expected: unsafe {
                c_string_matches(config.command, TEST_LAUNCH_COMMAND)
            },
            env_vars_present: !config.env_vars.is_null(),
            env_var_count: config.env_var_count,
            env_vars_match_expected,
            initial_input_present: !config.initial_input.is_null(),
            initial_input_matches_expected: unsafe {
                c_string_matches(config.initial_input, TEST_LAUNCH_INITIAL_INPUT)
            },
            wait_after_command: config.wait_after_command,
        }
    }

    unsafe fn c_string_matches(pointer: *const c_char, expected: &str) -> bool {
        !pointer.is_null() && unsafe { CStr::from_ptr(pointer) }.to_bytes() == expected.as_bytes()
    }

    unsafe fn fake_ghostty_surface_free(_surface: ffi::ghostty_surface_t) {
        fake_state()
            .lock()
            .unwrap()
            .calls
            .push("ghostty_surface_free");
    }

    unsafe fn fake_ghostty_surface_set_content_scale(
        _surface: ffi::ghostty_surface_t,
        x: f64,
        y: f64,
    ) {
        let mut state = fake_state().lock().unwrap();
        state.calls.push("ghostty_surface_set_content_scale");
        state.last_content_scale = Some((x, y));
    }

    unsafe fn fake_ghostty_surface_set_size(
        _surface: ffi::ghostty_surface_t,
        width: u32,
        height: u32,
    ) {
        let mut state = fake_state().lock().unwrap();
        state.calls.push("ghostty_surface_set_size");
        state.last_size = Some((width, height));
    }

    unsafe fn fake_ghostty_surface_set_focus(_surface: ffi::ghostty_surface_t, focused: bool) {
        let mut state = fake_state().lock().unwrap();
        state.calls.push("ghostty_surface_set_focus");
        state.last_surface_focus = Some(focused);
        state.surface_focus_calls.push(focused);
    }

    unsafe fn fake_ghostty_surface_size(
        _surface: ffi::ghostty_surface_t,
    ) -> ffi::ghostty_surface_size_s {
        fake_state()
            .lock()
            .unwrap()
            .calls
            .push("ghostty_surface_size");
        ffi::ghostty_surface_size_s {
            columns: 80,
            rows: 24,
            width_px: 640,
            height_px: 384,
            cell_width_px: 8,
            cell_height_px: 16,
        }
    }

    unsafe fn fake_ghostty_surface_process_exited(_surface: ffi::ghostty_surface_t) -> bool {
        let mut state = fake_state().lock().unwrap();
        state.calls.push("ghostty_surface_process_exited");
        state.process_exited
    }

    unsafe fn fake_ghostty_surface_needs_confirm_quit(_surface: ffi::ghostty_surface_t) -> bool {
        let mut state = fake_state().lock().unwrap();
        state.calls.push("ghostty_surface_needs_confirm_quit");
        state.needs_confirm_quit
    }

    unsafe fn fake_ghostty_surface_foreground_pid(_surface: ffi::ghostty_surface_t) -> u64 {
        let mut state = fake_state().lock().unwrap();
        state.calls.push("ghostty_surface_foreground_pid");
        state.foreground_pid
    }

    unsafe fn fake_ghostty_surface_tty_name(
        _surface: ffi::ghostty_surface_t,
    ) -> ffi::ghostty_string_s {
        let mut state = fake_state().lock().unwrap();
        state.calls.push("ghostty_surface_tty_name");
        state
            .tty_name
            .map(|tty_name| ffi::ghostty_string_s {
                ptr: tty_name.as_ptr() as *const c_char,
                len: tty_name.len(),
                sentinel: true,
            })
            .unwrap_or(ffi::ghostty_string_s {
                ptr: ptr::null(),
                len: 0,
                sentinel: false,
            })
    }

    unsafe fn fake_ghostty_surface_key_translation_mods(
        _surface: ffi::ghostty_surface_t,
        mods: ffi::ghostty_input_mods_e,
    ) -> ffi::ghostty_input_mods_e {
        let mut state = fake_state().lock().unwrap();
        state.calls.push("ghostty_surface_key_translation_mods");
        state.last_key_translation_mods = Some(mods);
        state.key_translation_mods_return
    }

    unsafe fn fake_ghostty_surface_key(
        _surface: ffi::ghostty_surface_t,
        event: ffi::ghostty_input_key_s,
    ) -> bool {
        let mut state = fake_state().lock().unwrap();
        state.calls.push("ghostty_surface_key");
        state.surface_key_count += 1;
        state.last_key_action = Some(event.action);
        state.last_key_mods = Some(event.mods);
        state.last_key_text_present = Some(!event.text.is_null());
        state.last_key_composing = Some(event.composing);
        state.key_event_return
    }

    unsafe fn fake_ghostty_surface_key_is_binding(
        _surface: ffi::ghostty_surface_t,
        event: ffi::ghostty_input_key_s,
        flags: *mut ffi::ghostty_binding_flags_e,
    ) -> bool {
        let mut state = fake_state().lock().unwrap();
        state.calls.push("ghostty_surface_key_is_binding");
        state.surface_key_is_binding_count += 1;
        state.last_key_action = Some(event.action);
        state.last_key_mods = Some(event.mods);
        state.last_key_text_present = Some(!event.text.is_null());
        state.last_key_composing = Some(event.composing);
        if !flags.is_null() {
            unsafe {
                *flags = state.key_binding_flags_return;
            }
        }
        state.key_binding_return
    }

    unsafe fn fake_ghostty_surface_text(
        _surface: ffi::ghostty_surface_t,
        ptr: *const c_char,
        len: usize,
    ) {
        let mut state = fake_state().lock().unwrap();
        state.calls.push("ghostty_surface_text");
        state.surface_text_count += 1;
        state.last_text_len = Some(len);
        state.last_text_ptr_present = Some(!ptr.is_null());
    }

    unsafe fn fake_ghostty_surface_preedit(
        _surface: ffi::ghostty_surface_t,
        ptr: *const c_char,
        len: usize,
    ) {
        let mut state = fake_state().lock().unwrap();
        state.calls.push("ghostty_surface_preedit");
        state.surface_preedit_count += 1;
        state.last_preedit_len = Some(len);
        state.last_preedit_ptr_present = Some(!ptr.is_null());
    }

    unsafe fn fake_ghostty_surface_mouse_captured(_surface: ffi::ghostty_surface_t) -> bool {
        let mut state = fake_state().lock().unwrap();
        state.calls.push("ghostty_surface_mouse_captured");
        state.mouse_captured_return
    }

    unsafe fn fake_ghostty_surface_mouse_button(
        _surface: ffi::ghostty_surface_t,
        action: ffi::ghostty_input_mouse_state_e,
        button: ffi::ghostty_input_mouse_button_e,
        mods: ffi::ghostty_input_mods_e,
    ) -> bool {
        let mut state = fake_state().lock().unwrap();
        state.calls.push("ghostty_surface_mouse_button");
        state.last_mouse_button = Some((action, button, mods));
        state.mouse_button_return
    }

    unsafe fn fake_ghostty_surface_mouse_pos(
        _surface: ffi::ghostty_surface_t,
        x: f64,
        y: f64,
        mods: ffi::ghostty_input_mods_e,
    ) {
        let mut state = fake_state().lock().unwrap();
        state.calls.push("ghostty_surface_mouse_pos");
        state.last_mouse_pos = Some((x, y, mods));
    }

    unsafe fn fake_ghostty_surface_mouse_scroll(
        _surface: ffi::ghostty_surface_t,
        x: f64,
        y: f64,
        scroll_mods: ffi::ghostty_input_scroll_mods_t,
    ) {
        let mut state = fake_state().lock().unwrap();
        state.calls.push("ghostty_surface_mouse_scroll");
        state.last_mouse_scroll = Some((x, y, scroll_mods));
    }

    unsafe fn fake_ghostty_surface_mouse_pressure(
        _surface: ffi::ghostty_surface_t,
        stage: u32,
        pressure: f64,
    ) {
        let mut state = fake_state().lock().unwrap();
        state.calls.push("ghostty_surface_mouse_pressure");
        state.last_mouse_pressure = Some((stage, pressure));
    }

    unsafe fn fake_ghostty_surface_ime_point(
        _surface: ffi::ghostty_surface_t,
        x: *mut f64,
        y: *mut f64,
        width: *mut f64,
        height: *mut f64,
    ) {
        let mut state = fake_state().lock().unwrap();
        state.calls.push("ghostty_surface_ime_point");
        let (next_x, next_y, next_width, next_height) = state.ime_point_return;
        unsafe {
            *x = next_x;
            *y = next_y;
            *width = next_width;
            *height = next_height;
        }
    }

    unsafe fn fake_ghostty_surface_request_close(_surface: ffi::ghostty_surface_t) {
        let mut state = fake_state().lock().unwrap();
        state.calls.push("ghostty_surface_request_close");
        state.surface_request_close_count += 1;
    }

    unsafe fn fake_ghostty_surface_complete_clipboard_request(
        _surface: ffi::ghostty_surface_t,
        data: *const c_char,
        request_state: *mut c_void,
        confirmed: bool,
    ) {
        let mut state = fake_state().lock().unwrap();
        state.calls.push("ghostty_surface_complete_clipboard_request");
        state.surface_complete_clipboard_request_count += 1;
        state.last_completed_clipboard_data_present = Some(!data.is_null());
        state.last_completed_clipboard_data_empty = if data.is_null() {
            None
        } else {
            Some(unsafe { CStr::from_ptr(data) }.to_bytes().is_empty())
        };
        state.last_completed_clipboard_state_present = Some(!request_state.is_null());
        state.last_completed_clipboard_confirmed = Some(confirmed);
    }

    fn test_nsview_pointer() -> NonNull<c_void> {
        NonNull::new(FAKE_NSVIEW as *mut c_void).expect("test pointer must be non-null")
    }

    fn test_nsview_handle() -> GhosttySurfaceNsViewHandle {
        unsafe { GhosttySurfaceNsViewHandle::from_existing_nsview(test_nsview_pointer()) }
    }

    fn test_bounds(width: f32, height: f32) -> Bounds<Pixels> {
        Bounds::from_corners(
            gpui::point(gpui::px(0.0), gpui::px(0.0)),
            gpui::point(gpui::px(width), gpui::px(height)),
        )
    }

    fn test_slot() -> AgentsTerminalBodyMountSlotId {
        AgentsTerminalBodyMountSlotId {
            pane_id: crate::WorkspacePaneId(10),
            session_id: crate::TerminalSessionId(101),
        }
    }

    fn test_startup_slot() -> AgentsTerminalStartupBodySlotId {
        AgentsTerminalStartupBodySlotId {
            pane_id: crate::WorkspacePaneId(20),
            session_id: crate::TerminalSessionId(201),
        }
    }

    fn test_runtime_session_id() -> AgentsTerminalRuntimeSessionId {
        AgentsTerminalRuntimeSessionId(9001)
    }

    fn test_launch_payload(wait_after_command: bool) -> GhosttySurfaceLaunchPayload {
        GhosttySurfaceLaunchPayload::try_new(
            Some(TEST_LAUNCH_WORKING_DIRECTORY.to_string()),
            Some(TEST_LAUNCH_COMMAND.to_string()),
            vec![
                (
                    TEST_LAUNCH_ENV_KEY_A.to_string(),
                    TEST_LAUNCH_ENV_VALUE_A.to_string(),
                ),
                (
                    TEST_LAUNCH_ENV_KEY_B.to_string(),
                    TEST_LAUNCH_ENV_VALUE_B.to_string(),
                ),
            ],
            Some(TEST_LAUNCH_INITIAL_INPUT.to_string()),
            wait_after_command,
        )
        .unwrap()
    }

    #[test]
    fn valid_request_builds_expected_window_config_fields() {
        let request = GhosttySurfaceConfigRequest::try_new(test_nsview_handle(), 2.0).unwrap();

        let config = request.to_ffi_config();

        assert_eq!(config.platform_tag, ffi::GHOSTTY_PLATFORM_MACOS);
        assert_eq!(
            unsafe { config.platform.macos }.nsview,
            test_nsview_pointer().as_ptr()
        );
        assert_eq!(config.userdata, test_nsview_pointer().as_ptr());
        assert_eq!(config.scale_factor, 2.0);
        assert_eq!(config.font_size, 0.0);
        assert_eq!(config.context, ffi::GHOSTTY_SURFACE_CONTEXT_WINDOW);
    }

    #[test]
    fn invalid_scale_factor_is_rejected_before_config_building() {
        for scale_factor in [f64::NEG_INFINITY, -1.0, -0.0, 0.0, f64::NAN, f64::INFINITY] {
            let error = GhosttySurfaceConfigRequest::try_new(test_nsview_handle(), scale_factor)
                .expect_err("invalid scale factor should not build a request");

            assert!(matches!(
                error,
                GhosttySurfaceConfigRequestError::InvalidScaleFactor(actual)
                    if actual == scale_factor || actual.is_nan()
            ));
        }
    }

    #[test]
    fn default_request_keeps_launch_and_privacy_fields_empty() {
        let request = GhosttySurfaceConfigRequest::try_new(test_nsview_handle(), 1.5).unwrap();
        let config = request.to_ffi_config();

        assert!(config.write_pty_cb.is_none());
        assert!(config.working_directory.is_null());
        assert!(config.command.is_null());
        assert!(config.env_vars.is_null());
        assert_eq!(config.env_var_count, 0);
        assert!(config.initial_input.is_null());
        assert!(!config.wait_after_command);
        assert_eq!(config.font_size, 0.0);
        assert_eq!(config.context, ffi::GHOSTTY_SURFACE_CONTEXT_WINDOW);

        let prepared_config = request.prepare_ffi_config(empty_ffi_surface_config());
        let config = prepared_config.config();
        assert!(config.working_directory.is_null());
        assert!(config.command.is_null());
        assert!(config.env_vars.is_null());
        assert_eq!(config.env_var_count, 0);
        assert!(config.initial_input.is_null());
        assert!(!config.wait_after_command);
    }

    #[test]
    fn launch_payload_populates_scoped_config_fields_env_vars_and_wait_flag() {
        let request = GhosttySurfaceConfigRequest::try_new(test_nsview_handle(), 1.75)
            .unwrap()
            .with_launch_payload(test_launch_payload(true));

        let prepared_config = request.prepare_ffi_config(empty_ffi_surface_config());
        let config = prepared_config.config();

        assert_eq!(config.scale_factor, 1.75);
        assert!(!config.working_directory.is_null());
        assert!(!config.command.is_null());
        assert!(!config.initial_input.is_null());
        assert!(!config.env_vars.is_null());
        assert_eq!(config.env_var_count, 2);
        assert!(config.wait_after_command);

        let launch = unsafe { inspect_launch_config_for_test(config) };
        assert!(launch.working_directory_present);
        assert!(launch.working_directory_matches_expected);
        assert!(launch.command_present);
        assert!(launch.command_matches_expected);
        assert!(launch.env_vars_present);
        assert_eq!(launch.env_var_count, 2);
        assert!(launch.env_vars_match_expected);
        assert!(launch.initial_input_present);
        assert!(launch.initial_input_matches_expected);
        assert!(launch.wait_after_command);
    }

    #[test]
    fn launch_payload_rejects_interior_nul_for_each_field_category() {
        for (result, expected_field) in [
            (
                GhosttySurfaceLaunchPayload::try_new(
                    Some("bad\0cwd".to_string()),
                    None,
                    Vec::new(),
                    None,
                    false,
                ),
                GhosttySurfaceLaunchPayloadField::WorkingDirectory,
            ),
            (
                GhosttySurfaceLaunchPayload::try_new(
                    None,
                    Some("bad\0command".to_string()),
                    Vec::new(),
                    None,
                    false,
                ),
                GhosttySurfaceLaunchPayloadField::Command,
            ),
            (
                GhosttySurfaceLaunchPayload::try_new(
                    None,
                    None,
                    vec![("bad\0key".to_string(), "value".to_string())],
                    None,
                    false,
                ),
                GhosttySurfaceLaunchPayloadField::EnvVarKey,
            ),
            (
                GhosttySurfaceLaunchPayload::try_new(
                    None,
                    None,
                    vec![("key".to_string(), "bad\0value".to_string())],
                    None,
                    false,
                ),
                GhosttySurfaceLaunchPayloadField::EnvVarValue,
            ),
            (
                GhosttySurfaceLaunchPayload::try_new(
                    None,
                    None,
                    Vec::new(),
                    Some("bad\0input".to_string()),
                    false,
                ),
                GhosttySurfaceLaunchPayloadField::InitialInput,
            ),
        ] {
            let error = result.expect_err("interior NUL should reject launch payload");
            assert!(matches!(
                error,
                GhosttySurfaceConfigRequestError::LaunchPayloadContainsInteriorNul { field }
                    if field == expected_field
            ));
        }
    }

    #[test]
    fn launch_payload_debug_redacts_raw_runtime_values() {
        let payload = GhosttySurfaceLaunchPayload::try_new(
            Some("raw-cwd-secret".to_string()),
            Some("raw-command-secret".to_string()),
            vec![(
                "RAW_SECRET_ENV_KEY".to_string(),
                "raw-secret-env-value".to_string(),
            )],
            Some("raw-initial-input-secret".to_string()),
            true,
        )
        .unwrap();
        let payload_debug = format!("{payload:?}");

        for raw_value in [
            "raw-cwd-secret",
            "raw-command-secret",
            "RAW_SECRET_ENV_KEY",
            "raw-secret-env-value",
            "raw-initial-input-secret",
        ] {
            assert!(!payload_debug.contains(raw_value));
        }

        let request = GhosttySurfaceConfigRequest::try_new(test_nsview_handle(), 2.0)
            .unwrap()
            .with_launch_payload(payload);
        let request_debug = format!("{request:?}");

        for raw_value in [
            "raw-cwd-secret",
            "raw-command-secret",
            "RAW_SECRET_ENV_KEY",
            "raw-secret-env-value",
            "raw-initial-input-secret",
        ] {
            assert!(!request_debug.contains(raw_value));
        }
    }

    #[cfg(target_os = "macos")]
    #[test]
    fn real_terminal_native_view_handle_can_seed_request_without_appkit_or_ffi_calls() {
        let native_view = unsafe {
            RealTerminalNativeViewHandle::from_existing_native_view(test_nsview_pointer())
        };

        let config = GhosttySurfaceConfigRequest::try_from_terminal_native_view(native_view, 2.5)
            .unwrap()
            .to_ffi_config();

        assert_eq!(
            unsafe { config.platform.macos }.nsview,
            test_nsview_pointer().as_ptr()
        );
        assert_eq!(config.userdata, test_nsview_pointer().as_ptr());
        assert_eq!(config.scale_factor, 2.5);
    }

    #[test]
    fn config_owner_loads_finalizes_and_frees_real_handle() {
        let _guard = fake_test_lock();
        reset_fake_state();

        {
            let owner = GhosttyConfigOwner::load_default_finalized_with_functions(fake_functions())
                .unwrap();
            assert_eq!(owner.as_raw(), FAKE_CONFIG as *mut c_void);
            assert_eq!(
                fake_state().lock().unwrap().calls,
                vec![
                    "ghostty_config_new",
                    "ghostty_config_load_default_files",
                    "ghostty_config_finalize"
                ]
            );
        }

        assert_eq!(
            fake_state().lock().unwrap().calls,
            vec![
                "ghostty_config_new",
                "ghostty_config_load_default_files",
                "ghostty_config_finalize",
                "ghostty_config_free"
            ]
        );
    }

    #[test]
    fn runtime_config_disables_selection_clipboard_and_installs_clipboard_callbacks() {
        let state = GhosttyRuntimeCallbackState::new();
        let config = runtime_config_for_state(&state);

        assert_eq!(
            config.userdata,
            &state as *const GhosttyRuntimeCallbackState as *mut c_void
        );
        assert_eq!(
            config.supports_selection_clipboard,
            GHOSTTY_RUNTIME_SUPPORTS_SELECTION_CLIPBOARD
        );
        assert!(!config.supports_selection_clipboard);
        assert!(config.read_clipboard_cb.is_some());
        assert!(config.confirm_read_clipboard_cb.is_some());
        assert!(config.write_clipboard_cb.is_some());
    }

    #[test]
    fn clipboard_runtime_callbacks_stay_disabled_for_app_and_surface_userdata() {
        let _guard = fake_test_lock();
        reset_fake_state();

        let runtime_state = GhosttyRuntimeCallbackState::new();
        runtime_state.mark_app_ready(FAKE_APP as *mut c_void);
        let runtime_userdata = &runtime_state as *const GhosttyRuntimeCallbackState as *mut c_void;
        let surface_token = GhosttySurfaceCloseToken::new(fake_functions());
        surface_token.set_surface(FAKE_SURFACE as *mut c_void);
        let request_state = 0xABCDusize as *mut c_void;
        let private_confirm =
            CString::new("private clipboard confirm content must stay local").unwrap();
        let mime = CString::new("text/plain").unwrap();
        let private_write = CString::new("private clipboard write content must stay local").unwrap();
        let content = [ffi::ghostty_clipboard_content_s {
            mime: mime.as_ptr(),
            data: private_write.as_ptr(),
        }];

        unsafe {
            assert!(!ghostty_runtime_read_clipboard_cb(
                runtime_userdata,
                ffi::GHOSTTY_CLIPBOARD_STANDARD,
                request_state
            ));
            assert!(!ghostty_runtime_read_clipboard_cb(
                surface_token.as_userdata(),
                ffi::GHOSTTY_CLIPBOARD_STANDARD,
                request_state
            ));
            assert!(!ghostty_runtime_read_clipboard_cb(
                runtime_userdata,
                ffi::GHOSTTY_CLIPBOARD_SELECTION,
                request_state
            ));
            ghostty_runtime_confirm_read_clipboard_cb(
                runtime_userdata,
                private_confirm.as_ptr(),
                request_state,
                ffi::GHOSTTY_CLIPBOARD_REQUEST_PASTE,
            );
            ghostty_runtime_write_clipboard_cb(
                runtime_userdata,
                ffi::GHOSTTY_CLIPBOARD_STANDARD,
                content.as_ptr(),
                content.len(),
                false,
            );
        }

        surface_token.drain_runtime_clipboard_operations(
            true,
            || panic!("disabled runtime callback must not enqueue clipboard reads"),
            |_| panic!("disabled runtime callback must not enqueue clipboard writes"),
        );

        let state = fake_state().lock().unwrap();
        assert_eq!(*state, FakeGhosttyState::default());
    }

    /*
    CDXC:GPUITerminalClipboard 2026-06-23-14:23:
    Clipboard drain coverage is source-only and owner-local. It proves denied runtime reads complete as empty and writes disappear without clipboard closures, while avoiding GPUI App clipboard APIs, focused-surface routing, logs, persistence, app launch, or raw clipboard storage.
    */
    #[test]
    fn clipboard_owner_local_drain_denies_reads_and_drops_writes_without_clipboard_closures() {
        let _guard = fake_test_lock();
        reset_fake_state();

        let app = GhosttyAppOwner::new_with_functions(fake_functions()).unwrap();
        {
            let request = GhosttySurfaceConfigRequest::try_new(test_nsview_handle(), 2.0).unwrap();
            let surface =
                GhosttySurfaceOwner::new(&app, test_slot(), test_runtime_session_id(), &request)
                    .unwrap();
            fake_state().lock().unwrap().calls.clear();

            let request_state = 0xBCDEusize as *mut c_void;
            assert!(surface
                .close_token
                .enqueue_runtime_clipboard_read(request_state));
            surface
                .close_token
                .enqueue_runtime_clipboard_write("blocked synthetic clipboard write".to_string());

            surface.drain_runtime_clipboard_requests(
                false,
                || panic!("denied runtime clipboard read must not touch GPUI clipboard"),
                |_| panic!("denied runtime clipboard write must not touch GPUI clipboard"),
            );

            let state = fake_state().lock().unwrap();
            assert_eq!(state.surface_complete_clipboard_request_count, 1);
            assert_eq!(state.last_completed_clipboard_data_present, Some(true));
            assert_eq!(state.last_completed_clipboard_data_empty, Some(true));
            assert_eq!(state.last_completed_clipboard_state_present, Some(true));
            assert_eq!(state.last_completed_clipboard_confirmed, Some(true));
            assert_eq!(state.calls, vec!["ghostty_surface_complete_clipboard_request"]);
            drop(state);
        }
        drop(app);
    }

    #[test]
    fn clipboard_abi_constants_match_expected_upstream_values() {
        assert_eq!(ffi::GHOSTTY_CLIPBOARD_STANDARD, 0);
        assert_eq!(ffi::GHOSTTY_CLIPBOARD_SELECTION, 1);
        assert_eq!(ffi::GHOSTTY_CLIPBOARD_REQUEST_PASTE, 0);
        assert_eq!(ffi::GHOSTTY_CLIPBOARD_REQUEST_OSC_52_READ, 1);
        assert_eq!(ffi::GHOSTTY_CLIPBOARD_REQUEST_OSC_52_WRITE, 2);
    }

    #[test]
    fn app_owner_initializes_config_creates_ticks_focuses_and_frees() {
        let _guard = fake_test_lock();
        reset_fake_state();

        {
            let mut app = GhosttyAppOwner::new_with_functions(fake_functions()).unwrap();
            assert_eq!(app.as_raw(), FAKE_APP as *mut c_void);
            assert!(!app.wakeup_requested());
            unsafe {
                (app.runtime_config.wakeup_cb.unwrap())(app.runtime_config.userdata);
            }
            assert!(app.wakeup_requested());
            app.tick_if_woken();
            app.tick();
            app.set_focus(true);
        }

        let state = fake_state().lock().unwrap();
        assert_eq!(
            state.calls,
            vec![
                "ghostty_init",
                "ghostty_config_new",
                "ghostty_config_load_default_files",
                "ghostty_config_finalize",
                "ghostty_app_new",
                "ghostty_app_tick",
                "ghostty_app_tick",
                "ghostty_app_set_focus",
                "ghostty_app_free",
                "ghostty_config_free"
            ]
        );
        assert_eq!(state.last_app_focus, Some(true));
        assert_eq!(state.app_focus_calls, vec![true]);
        assert_ne!(state.last_runtime_userdata, 0);
    }

    #[test]
    fn app_owner_focus_calls_only_on_state_changes() {
        let _guard = fake_test_lock();
        reset_fake_state();

        {
            let mut app = GhosttyAppOwner::new_with_functions(fake_functions()).unwrap();
            app.set_focus(false);
            app.set_focus(false);
            app.set_focus(true);
            app.set_focus(true);
            app.set_focus(false);
        }

        let state = fake_state().lock().unwrap();
        assert_eq!(state.app_focus_calls, vec![false, true, false]);
        assert_eq!(
            state
                .calls
                .iter()
                .filter(|call| **call == "ghostty_app_set_focus")
                .count(),
            3
        );
    }

    #[test]
    fn app_owner_errors_do_not_leave_owned_handles_to_free() {
        let _guard = fake_test_lock();
        reset_fake_state();
        fake_state().lock().unwrap().config_new_returns_null = true;

        let error = match GhosttyAppOwner::new_with_functions(fake_functions()) {
            Ok(_) => panic!("null config should prevent app owner creation"),
            Err(error) => error,
        };

        assert_eq!(error, GhosttySurfaceRuntimeError::ConfigCreateReturnedNull);
        assert_eq!(
            fake_state().lock().unwrap().calls,
            vec!["ghostty_init", "ghostty_config_new"]
        );
    }

    #[test]
    fn surface_owner_creates_from_request_updates_size_reads_size_focuses_and_frees() {
        let _guard = fake_test_lock();
        reset_fake_state();

        let app = GhosttyAppOwner::new_with_functions(fake_functions()).unwrap();
        {
            let request = GhosttySurfaceConfigRequest::try_new(test_nsview_handle(), 2.0).unwrap();
            let mut surface =
                GhosttySurfaceOwner::new(&app, test_slot(), test_runtime_session_id(), &request)
                    .unwrap();
            assert!(surface.mount_slot_id() == test_slot());
            assert!(surface.runtime_session_id() == test_runtime_session_id());
            surface
                .update_content_scale_and_size(test_bounds(10.5, 20.75), 2.0)
                .unwrap();
            surface
                .update_content_scale_and_size(test_bounds(10.5, 20.75), 2.0)
                .unwrap();
            surface.set_focus(true);
            let size = surface.surface_size();
            assert_eq!(size.columns, 80);
        }
        drop(app);

        let state = fake_state().lock().unwrap();
        let config = state.last_surface_config.unwrap();
        assert_eq!(config.platform_tag, ffi::GHOSTTY_PLATFORM_MACOS);
        assert_eq!(config.nsview, FAKE_NSVIEW);
        assert_ne!(config.userdata, 0);
        assert_ne!(config.userdata, FAKE_NSVIEW);
        assert_eq!(config.scale_factor, 2.0);
        assert_eq!(config.font_size, 0.0);
        assert_eq!(config.command, 0);
        assert_eq!(config.working_directory, 0);
        assert_eq!(config.env_vars, 0);
        assert_eq!(config.env_var_count, 0);
        assert_eq!(config.initial_input, 0);
        assert!(!config.wait_after_command);
        assert_eq!(config.context, ffi::GHOSTTY_SURFACE_CONTEXT_WINDOW);
        assert_eq!(state.last_content_scale, Some((2.0, 2.0)));
        assert_eq!(state.last_size, Some((21, 41)));
        assert_eq!(state.last_surface_focus, Some(true));
        assert_eq!(state.surface_focus_calls, vec![true]);
        assert_eq!(
            state.calls,
            vec![
                "ghostty_init",
                "ghostty_config_new",
                "ghostty_config_load_default_files",
                "ghostty_config_finalize",
                "ghostty_app_new",
                "ghostty_surface_config_new",
                "ghostty_surface_new",
                "ghostty_surface_set_content_scale",
                "ghostty_surface_set_size",
                "ghostty_surface_set_focus",
                "ghostty_surface_size",
                "ghostty_surface_free",
                "ghostty_app_free",
                "ghostty_config_free"
            ]
        );
    }

    #[test]
    fn surface_owner_request_close_calls_ffi_once_and_records_callbacks_in_memory() {
        let _guard = fake_test_lock();
        reset_fake_state();
        fake_state().lock().unwrap().needs_confirm_quit = true;

        let app = GhosttyAppOwner::new_with_functions(fake_functions()).unwrap();
        {
            let request = GhosttySurfaceConfigRequest::try_new(test_nsview_handle(), 2.0).unwrap();
            let mut surface =
                GhosttySurfaceOwner::new(&app, test_slot(), test_runtime_session_id(), &request)
                    .unwrap();

            assert!(surface.needs_confirm_quit());
            assert!(surface.request_close());
            assert!(!surface.request_close());
            surface.simulate_runtime_close_callback_for_test(true);
            assert!(surface.confirmation_needed_close_pending_for_test());
            assert!(surface.consume_confirmation_needed_close_requested());
            assert!(!surface.consume_confirmation_needed_close_requested());
            assert!(!surface.confirmation_needed_close_pending_for_test());
            assert!(!surface.consume_confirmed_close_requested());
            surface.simulate_runtime_close_callback_for_test(false);
            assert!(surface.consume_confirmed_close_requested());
            assert!(!surface.consume_confirmed_close_requested());
        }
        drop(app);

        let state = fake_state().lock().unwrap();
        assert_eq!(state.surface_request_close_count, 1);
        assert_eq!(
            state
                .calls
                .iter()
                .filter(|call| **call == "ghostty_surface_needs_confirm_quit")
                .count(),
            1
        );
        assert_eq!(
            state
                .calls
                .iter()
                .filter(|call| **call == "ghostty_surface_request_close")
                .count(),
            1
        );
    }

    #[test]
    fn surface_owner_text_and_preedit_wrappers_pass_lengths_without_storing_raw_text() {
        let _guard = fake_test_lock();
        reset_fake_state();

        let app = GhosttyAppOwner::new_with_functions(fake_functions()).unwrap();
        {
            let request = GhosttySurfaceConfigRequest::try_new(test_nsview_handle(), 2.0).unwrap();
            let surface =
                GhosttySurfaceOwner::new(&app, test_slot(), test_runtime_session_id(), &request)
                    .unwrap();
            fake_state().lock().unwrap().calls.clear();

            let private_text = b"private terminal input should not be stored";
            let private_preedit = b"private preedit text should not be stored";
            surface.send_text_bytes(private_text);
            surface.set_preedit_bytes(private_preedit);
            surface.send_text_bytes(b"");
            surface.set_preedit_bytes(b"");

            let state = fake_state().lock().unwrap();
            assert_eq!(state.surface_text_count, 2);
            assert_eq!(state.last_text_len, Some(0));
            assert_eq!(state.last_text_ptr_present, Some(true));
            assert_eq!(state.surface_preedit_count, 2);
            assert_eq!(state.last_preedit_len, Some(0));
            assert_eq!(state.last_preedit_ptr_present, Some(false));
            assert_eq!(
                state.calls,
                vec![
                    "ghostty_surface_text",
                    "ghostty_surface_preedit",
                    "ghostty_surface_text",
                    "ghostty_surface_preedit"
                ]
            );
        }
        drop(app);
    }

    #[test]
    fn surface_owner_key_wrappers_call_expected_input_abi_slots() {
        let _guard = fake_test_lock();
        reset_fake_state();
        {
            let mut state = fake_state().lock().unwrap();
            state.key_translation_mods_return = 0x24;
            state.key_event_return = true;
            state.key_binding_return = true;
            state.key_binding_flags_return = 0x09;
        }

        let app = GhosttyAppOwner::new_with_functions(fake_functions()).unwrap();
        {
            let request = GhosttySurfaceConfigRequest::try_new(test_nsview_handle(), 2.0).unwrap();
            let surface =
                GhosttySurfaceOwner::new(&app, test_slot(), test_runtime_session_id(), &request)
                    .unwrap();
            fake_state().lock().unwrap().calls.clear();

            let event = ffi::ghostty_input_key_s {
                action: 1,
                mods: 2,
                consumed_mods: 0,
                keycode: 42,
                text: ptr::null(),
                unshifted_codepoint: 65,
                composing: false,
            };

            assert_eq!(surface.key_translation_mods(0x12), 0x24);
            assert!(surface.send_key(event));
            let binding = surface.key_is_binding(event);
            assert!(binding.binding());
            assert_eq!(binding.flags(), 0x09);

            let state = fake_state().lock().unwrap();
            assert_eq!(state.last_key_translation_mods, Some(0x12));
            assert_eq!(state.surface_key_count, 1);
            assert_eq!(state.surface_key_is_binding_count, 1);
            assert_eq!(state.last_key_action, Some(1));
            assert_eq!(state.last_key_mods, Some(2));
            assert_eq!(state.last_key_text_present, Some(false));
            assert_eq!(state.last_key_composing, Some(false));
            assert_eq!(
                state.calls,
                vec![
                    "ghostty_surface_key_translation_mods",
                    "ghostty_surface_key",
                    "ghostty_surface_key_is_binding"
                ]
            );
        }
        drop(app);
    }

    #[test]
    fn surface_owner_mouse_and_ime_wrappers_call_expected_input_abi_slots() {
        let _guard = fake_test_lock();
        reset_fake_state();
        {
            let mut state = fake_state().lock().unwrap();
            state.mouse_captured_return = true;
            state.mouse_button_return = true;
            state.ime_point_return = (1.25, 2.5, 3.75, 4.0);
        }

        let app = GhosttyAppOwner::new_with_functions(fake_functions()).unwrap();
        {
            let request = GhosttySurfaceConfigRequest::try_new(test_nsview_handle(), 2.0).unwrap();
            let surface =
                GhosttySurfaceOwner::new(&app, test_slot(), test_runtime_session_id(), &request)
                    .unwrap();
            fake_state().lock().unwrap().calls.clear();

            assert!(surface.mouse_captured());
            assert!(surface.mouse_button(1, 2, 3));
            surface.mouse_pos(10.5, 20.25, 4);
            surface.mouse_scroll(-1.5, 2.25, 5);
            surface.mouse_pressure(6, 0.75);
            assert_eq!(
                surface.ime_point(),
                GhosttySurfaceImePoint {
                    x: 1.25,
                    y: 2.5,
                    width: 3.75,
                    height: 4.0,
                }
            );

            let state = fake_state().lock().unwrap();
            assert_eq!(state.last_mouse_button, Some((1, 2, 3)));
            assert_eq!(state.last_mouse_pos, Some((10.5, 20.25, 4)));
            assert_eq!(state.last_mouse_scroll, Some((-1.5, 2.25, 5)));
            assert_eq!(state.last_mouse_pressure, Some((6, 0.75)));
            assert_eq!(
                state.calls,
                vec![
                    "ghostty_surface_mouse_captured",
                    "ghostty_surface_mouse_button",
                    "ghostty_surface_mouse_pos",
                    "ghostty_surface_mouse_scroll",
                    "ghostty_surface_mouse_pressure",
                    "ghostty_surface_ime_point"
                ]
            );
        }
        drop(app);
    }

    #[test]
    fn surface_owner_creates_from_launch_request_with_scoped_pointer_lifetimes() {
        let _guard = fake_test_lock();
        reset_fake_state();

        let app = GhosttyAppOwner::new_with_functions(fake_functions()).unwrap();
        {
            let request = GhosttySurfaceConfigRequest::try_new(test_nsview_handle(), 2.0)
                .unwrap()
                .with_launch_payload(test_launch_payload(true));
            let surface =
                GhosttySurfaceOwner::new(&app, test_slot(), test_runtime_session_id(), &request)
                    .unwrap();
            assert!(surface.mount_slot_id() == test_slot());
            assert!(surface.runtime_session_id() == test_runtime_session_id());
        }
        drop(app);

        let state = fake_state().lock().unwrap();
        let config = state.last_surface_config.unwrap();
        assert_ne!(config.working_directory, 0);
        assert_ne!(config.command, 0);
        assert_ne!(config.initial_input, 0);
        assert_ne!(config.env_vars, 0);
        assert_eq!(config.env_var_count, 2);
        assert!(config.wait_after_command);

        let launch = state.last_launch_inspection.unwrap();
        assert!(launch.working_directory_present);
        assert!(launch.working_directory_matches_expected);
        assert!(launch.command_present);
        assert!(launch.command_matches_expected);
        assert!(launch.initial_input_present);
        assert!(launch.initial_input_matches_expected);
        assert!(launch.env_vars_present);
        assert_eq!(launch.env_var_count, 2);
        assert!(launch.env_vars_match_expected);
        assert!(launch.wait_after_command);
        assert_eq!(
            state.calls,
            vec![
                "ghostty_init",
                "ghostty_config_new",
                "ghostty_config_load_default_files",
                "ghostty_config_finalize",
                "ghostty_app_new",
                "ghostty_surface_config_new",
                "ghostty_surface_new",
                "ghostty_surface_free",
                "ghostty_app_free",
                "ghostty_config_free"
            ]
        );
    }

    #[test]
    fn startup_surface_owner_uses_startup_slot_updates_exact_size_and_never_focuses() {
        let _guard = fake_test_lock();
        reset_fake_state();

        let app = GhosttyAppOwner::new_with_functions(fake_functions()).unwrap();
        {
            let request = GhosttySurfaceConfigRequest::try_new(test_nsview_handle(), 2.25).unwrap();
            let mut surface = StartupGhosttySurfaceOwner::new(
                &app,
                test_startup_slot(),
                test_runtime_session_id(),
                &request,
            )
            .unwrap();
            assert!(surface.startup_body_slot_id() == test_startup_slot());
            assert!(surface.runtime_session_id() == test_runtime_session_id());
            surface
                .update_content_scale_and_size(test_bounds(10.5, 20.75), 2.25)
                .unwrap();
            surface
                .update_content_scale_and_size(test_bounds(10.5, 20.75), 2.25)
                .unwrap();
        }
        drop(app);

        let state = fake_state().lock().unwrap();
        let config = state.last_surface_config.unwrap();
        assert_eq!(config.platform_tag, ffi::GHOSTTY_PLATFORM_MACOS);
        assert_eq!(config.nsview, FAKE_NSVIEW);
        assert_ne!(config.userdata, 0);
        assert_ne!(config.userdata, FAKE_NSVIEW);
        assert_eq!(config.scale_factor, 2.25);
        assert_eq!(config.command, 0);
        assert_eq!(config.working_directory, 0);
        assert_eq!(config.env_vars, 0);
        assert_eq!(config.env_var_count, 0);
        assert_eq!(config.initial_input, 0);
        assert!(!config.wait_after_command);
        assert_eq!(state.last_content_scale, Some((2.25, 2.25)));
        assert_eq!(state.last_size, Some((23, 46)));
        assert!(state.app_focus_calls.is_empty());
        assert!(state.surface_focus_calls.is_empty());
        assert_eq!(
            state.calls,
            vec![
                "ghostty_init",
                "ghostty_config_new",
                "ghostty_config_load_default_files",
                "ghostty_config_finalize",
                "ghostty_app_new",
                "ghostty_surface_config_new",
                "ghostty_surface_new",
                "ghostty_surface_set_content_scale",
                "ghostty_surface_set_size",
                "ghostty_surface_free",
                "ghostty_app_free",
                "ghostty_config_free"
            ]
        );
    }

    #[test]
    fn startup_surface_metadata_snapshot_redacts_raw_tty_and_pid_presence() {
        let _guard = fake_test_lock();
        reset_fake_state();
        {
            let mut state = fake_state().lock().unwrap();
            state.process_exited = true;
            state.foreground_pid = TEST_FOREGROUND_PROCESS_ID;
            state.tty_name = Some(TEST_TTY_NAME);
        }

        let app = GhosttyAppOwner::new_with_functions(fake_functions()).unwrap();
        let snapshot = {
            let request = GhosttySurfaceConfigRequest::try_new(test_nsview_handle(), 2.0).unwrap();
            let surface = StartupGhosttySurfaceOwner::new(
                &app,
                test_startup_slot(),
                test_runtime_session_id(),
                &request,
            )
            .unwrap();
            surface.metadata_snapshot()
        };
        drop(app);

        assert!(snapshot.process_exited());
        assert!(snapshot.foreground_process_id_present());
        assert!(snapshot.tty_name_present());
        assert!(!snapshot.indicates_ready_metadata());

        let snapshot_debug = format!("{snapshot:?}");
        assert!(snapshot_debug.contains("process_exited: true"));
        assert!(snapshot_debug.contains("foreground_process_id_present: true"));
        assert!(snapshot_debug.contains("tty_name_present: true"));
        let raw_pid = TEST_FOREGROUND_PROCESS_ID.to_string();
        for raw_value in [TEST_TTY_NAME, raw_pid.as_str()] {
            assert!(
                !snapshot_debug.contains(raw_value),
                "metadata snapshot debug must not expose {raw_value}"
            );
        }

        let state = fake_state().lock().unwrap();
        assert_eq!(state.tty_string_free_count, 1);
        assert_eq!(
            state
                .calls
                .iter()
                .filter(|call| {
                    matches!(
                        **call,
                        "ghostty_surface_process_exited"
                            | "ghostty_surface_foreground_pid"
                            | "ghostty_surface_tty_name"
                            | "ghostty_string_free"
                    )
                })
                .copied()
                .collect::<Vec<_>>(),
            vec![
                "ghostty_surface_process_exited",
                "ghostty_surface_foreground_pid",
                "ghostty_surface_tty_name",
                "ghostty_string_free"
            ]
        );
    }

    #[test]
    fn surface_owner_focus_calls_only_on_state_changes() {
        let _guard = fake_test_lock();
        reset_fake_state();

        let app = GhosttyAppOwner::new_with_functions(fake_functions()).unwrap();
        {
            let request = GhosttySurfaceConfigRequest::try_new(test_nsview_handle(), 2.0).unwrap();
            let mut surface =
                GhosttySurfaceOwner::new(&app, test_slot(), test_runtime_session_id(), &request)
                    .unwrap();
            surface.set_focus(false);
            surface.set_focus(false);
            surface.set_focus(true);
            surface.set_focus(true);
            surface.set_focus(false);
        }
        drop(app);

        let state = fake_state().lock().unwrap();
        assert_eq!(state.surface_focus_calls, vec![false, true, false]);
        assert_eq!(
            state
                .calls
                .iter()
                .filter(|call| **call == "ghostty_surface_set_focus")
                .count(),
            3
        );
    }

    #[test]
    fn surface_pixel_size_rejects_invalid_runtime_bounds_without_ffi() {
        let error = GhosttySurfacePixelSize::from_gpui_bounds(test_bounds(f32::NAN, 20.0), 2.0)
            .expect_err("invalid bounds should not produce a pixel size");

        assert!(matches!(
            error,
            GhosttySurfaceRuntimeError::InvalidBounds {
                field: GhosttySurfaceBoundsField::Width,
                value
            } if value.is_nan()
        ));

        assert_eq!(
            GhosttySurfacePixelSize::from_gpui_bounds(test_bounds(0.0, 0.0), 2.0).unwrap(),
            GhosttySurfacePixelSize {
                width: 1,
                height: 1
            }
        );
    }
}
