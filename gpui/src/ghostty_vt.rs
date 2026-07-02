#![allow(dead_code)]

/*
CDXC:GPUILibghosttyVt 2026-07-03:
Phase 1 GPUI-composited terminals are driven by libghostty-vt (vendored under
ghostty/, MIT), whose C API is functionally stable but explicitly NOT
API-stable. This module is the single choke point over that C API: every
libghostty-vt symbol, struct layout, and enum value used by Rust lives here so
a vendored API bump touches one file. Do not declare ghostty_vt symbols in
other modules, and do not expose raw handles outside this module.

CDXC:GPUILibghosttyVt 2026-07-03 (dirty-tracking contract):
render.h keeps two INDEPENDENT dirty layers: a global render-state dirty value
(false/partial/full) and a per-row dirty flag. ghostty_render_state_update()
only ever raises dirty state; it never clears either layer, and clearing one
layer does not clear the other. The renderer (caller) must clear BOTH after
consuming a frame: per-row via VtRow::clear_dirty() while iterating, global
via VtRenderState::clear_dirty() after the frame. Skipping either leaves the
next frame reporting stale dirtiness.

Threading: a terminal plus its render state have no thread affinity but no
internal synchronization either. ghostty_render_state_update() needs exclusive
access to the terminal only for the duration of the call ("short lock");
reading rows/cells afterwards touches only the render-state snapshot. Rust
expresses this as &mut borrows here; cross-thread callers (P1b's PTY reader
vs. render path) must wrap the VtTerminal in a lock held across feed/resize
and update, while row readback can happen outside that lock. Row and cell
data borrowed from the render state is invalidated by the next update, which
the lifetimes below enforce at compile time.
*/

use std::{ffi::c_void, fmt, marker::PhantomData};

pub mod ffi {
    #![allow(non_camel_case_types)]

    use std::ffi::{c_int, c_void};

    pub type GhosttyResult = c_int;
    pub const GHOSTTY_SUCCESS: GhosttyResult = 0;
    pub const GHOSTTY_OUT_OF_MEMORY: GhosttyResult = -1;
    pub const GHOSTTY_INVALID_VALUE: GhosttyResult = -2;
    pub const GHOSTTY_OUT_OF_SPACE: GhosttyResult = -3;
    pub const GHOSTTY_NO_VALUE: GhosttyResult = -4;

    pub type GhosttyTerminal = *mut c_void;
    pub type GhosttyRenderState = *mut c_void;
    pub type GhosttyRenderStateRowIterator = *mut c_void;
    pub type GhosttyRenderStateRowCells = *mut c_void;

    /// Opaque cell value (`GhosttyCell` in screen.h).
    pub type GhosttyCell = u64;

    #[repr(C)]
    #[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
    pub struct GhosttyColorRgb {
        pub r: u8,
        pub g: u8,
        pub b: u8,
    }

    #[repr(C)]
    #[derive(Clone, Copy, Debug)]
    pub struct GhosttyTerminalOptions {
        pub cols: u16,
        pub rows: u16,
        pub max_scrollback: usize,
    }

    pub type GhosttyRenderStateDirty = c_int;
    pub const GHOSTTY_RENDER_STATE_DIRTY_FALSE: GhosttyRenderStateDirty = 0;
    pub const GHOSTTY_RENDER_STATE_DIRTY_PARTIAL: GhosttyRenderStateDirty = 1;
    pub const GHOSTTY_RENDER_STATE_DIRTY_FULL: GhosttyRenderStateDirty = 2;

    pub type GhosttyRenderStateData = c_int;
    pub const GHOSTTY_RENDER_STATE_DATA_COLS: GhosttyRenderStateData = 1;
    pub const GHOSTTY_RENDER_STATE_DATA_ROWS: GhosttyRenderStateData = 2;
    pub const GHOSTTY_RENDER_STATE_DATA_DIRTY: GhosttyRenderStateData = 3;
    pub const GHOSTTY_RENDER_STATE_DATA_ROW_ITERATOR: GhosttyRenderStateData = 4;
    pub const GHOSTTY_RENDER_STATE_DATA_CURSOR_VISIBLE: GhosttyRenderStateData = 11;
    pub const GHOSTTY_RENDER_STATE_DATA_CURSOR_VIEWPORT_HAS_VALUE: GhosttyRenderStateData = 14;
    pub const GHOSTTY_RENDER_STATE_DATA_CURSOR_VIEWPORT_X: GhosttyRenderStateData = 15;
    pub const GHOSTTY_RENDER_STATE_DATA_CURSOR_VIEWPORT_Y: GhosttyRenderStateData = 16;

    pub type GhosttyRenderStateOption = c_int;
    pub const GHOSTTY_RENDER_STATE_OPTION_DIRTY: GhosttyRenderStateOption = 0;

    pub type GhosttyRenderStateRowData = c_int;
    pub const GHOSTTY_RENDER_STATE_ROW_DATA_DIRTY: GhosttyRenderStateRowData = 1;
    pub const GHOSTTY_RENDER_STATE_ROW_DATA_CELLS: GhosttyRenderStateRowData = 3;

    pub type GhosttyRenderStateRowOption = c_int;
    pub const GHOSTTY_RENDER_STATE_ROW_OPTION_DIRTY: GhosttyRenderStateRowOption = 0;

    pub type GhosttyRenderStateRowCellsData = c_int;
    pub const GHOSTTY_RENDER_STATE_ROW_CELLS_DATA_RAW: GhosttyRenderStateRowCellsData = 1;
    pub const GHOSTTY_RENDER_STATE_ROW_CELLS_DATA_STYLE: GhosttyRenderStateRowCellsData = 2;
    pub const GHOSTTY_RENDER_STATE_ROW_CELLS_DATA_GRAPHEMES_LEN: GhosttyRenderStateRowCellsData = 3;
    pub const GHOSTTY_RENDER_STATE_ROW_CELLS_DATA_GRAPHEMES_BUF: GhosttyRenderStateRowCellsData = 4;
    pub const GHOSTTY_RENDER_STATE_ROW_CELLS_DATA_BG_COLOR: GhosttyRenderStateRowCellsData = 5;
    pub const GHOSTTY_RENDER_STATE_ROW_CELLS_DATA_FG_COLOR: GhosttyRenderStateRowCellsData = 6;

    pub type GhosttyCellData = c_int;
    pub const GHOSTTY_CELL_DATA_WIDE: GhosttyCellData = 3;

    pub type GhosttyCellWide = c_int;
    pub const GHOSTTY_CELL_WIDE_NARROW: GhosttyCellWide = 0;
    pub const GHOSTTY_CELL_WIDE_WIDE: GhosttyCellWide = 1;
    pub const GHOSTTY_CELL_WIDE_SPACER_TAIL: GhosttyCellWide = 2;
    pub const GHOSTTY_CELL_WIDE_SPACER_HEAD: GhosttyCellWide = 3;

    /// sgr.h `GhosttySgrUnderline`: value of [`GhosttyStyle::underline`].
    pub type GhosttySgrUnderline = c_int;
    pub const GHOSTTY_SGR_UNDERLINE_NONE: GhosttySgrUnderline = 0;
    pub const GHOSTTY_SGR_UNDERLINE_SINGLE: GhosttySgrUnderline = 1;
    pub const GHOSTTY_SGR_UNDERLINE_DOUBLE: GhosttySgrUnderline = 2;
    pub const GHOSTTY_SGR_UNDERLINE_CURLY: GhosttySgrUnderline = 3;
    pub const GHOSTTY_SGR_UNDERLINE_DOTTED: GhosttySgrUnderline = 4;
    pub const GHOSTTY_SGR_UNDERLINE_DASHED: GhosttySgrUnderline = 5;

    pub type GhosttyTerminalOption = c_int;
    pub const GHOSTTY_TERMINAL_OPT_USERDATA: GhosttyTerminalOption = 0;
    pub const GHOSTTY_TERMINAL_OPT_WRITE_PTY: GhosttyTerminalOption = 1;
    pub const GHOSTTY_TERMINAL_OPT_BELL: GhosttyTerminalOption = 2;
    pub const GHOSTTY_TERMINAL_OPT_TITLE_CHANGED: GhosttyTerminalOption = 5;

    /// terminal.h `GhosttyTerminalWritePtyFn`: query auto-replies (DA1, DSR,
    /// DECRQM, ...) that must be written back to the PTY. `data` is only
    /// valid for the duration of the call.
    pub type GhosttyTerminalWritePtyFn = unsafe extern "C" fn(
        terminal: GhosttyTerminal,
        userdata: *mut c_void,
        data: *const u8,
        len: usize,
    );
    /// terminal.h `GhosttyTerminalBellFn`.
    pub type GhosttyTerminalBellFn =
        unsafe extern "C" fn(terminal: GhosttyTerminal, userdata: *mut c_void);
    /// terminal.h `GhosttyTerminalTitleChangedFn`. The new title is queried
    /// from the terminal after the callback returns.
    pub type GhosttyTerminalTitleChangedFn =
        unsafe extern "C" fn(terminal: GhosttyTerminal, userdata: *mut c_void);

    pub type GhosttyStyleColorTag = c_int;
    pub const GHOSTTY_STYLE_COLOR_NONE: GhosttyStyleColorTag = 0;
    pub const GHOSTTY_STYLE_COLOR_PALETTE: GhosttyStyleColorTag = 1;
    pub const GHOSTTY_STYLE_COLOR_RGB: GhosttyStyleColorTag = 2;

    #[repr(C)]
    #[derive(Clone, Copy)]
    pub union GhosttyStyleColorValue {
        pub palette: u8,
        pub rgb: GhosttyColorRgb,
        pub _padding: u64,
    }

    #[repr(C)]
    #[derive(Clone, Copy)]
    pub struct GhosttyStyleColor {
        pub tag: GhosttyStyleColorTag,
        pub value: GhosttyStyleColorValue,
    }

    /// Sized struct (style.h). Construct via [`GhosttyStyle::init_sized`] so
    /// the library can detect which struct version the caller compiled with.
    #[repr(C)]
    #[derive(Clone, Copy)]
    pub struct GhosttyStyle {
        pub size: usize,
        pub fg_color: GhosttyStyleColor,
        pub bg_color: GhosttyStyleColor,
        pub underline_color: GhosttyStyleColor,
        pub bold: bool,
        pub italic: bool,
        pub faint: bool,
        pub blink: bool,
        pub inverse: bool,
        pub invisible: bool,
        pub strikethrough: bool,
        pub overline: bool,
        pub underline: c_int,
    }

    impl GhosttyStyle {
        pub fn init_sized() -> Self {
            // GHOSTTY_INIT_SIZED equivalent: zeroed with the size field set.
            let mut style: Self = unsafe { std::mem::zeroed() };
            style.size = std::mem::size_of::<Self>();
            style
        }
    }

    /// Sized struct (render.h). Construct via
    /// [`GhosttyRenderStateColors::init_sized`].
    #[repr(C)]
    #[derive(Clone, Copy)]
    pub struct GhosttyRenderStateColors {
        pub size: usize,
        pub background: GhosttyColorRgb,
        pub foreground: GhosttyColorRgb,
        pub cursor: GhosttyColorRgb,
        pub cursor_has_value: bool,
        pub palette: [GhosttyColorRgb; 256],
    }

    impl GhosttyRenderStateColors {
        pub fn init_sized() -> Self {
            let mut colors: Self = unsafe { std::mem::zeroed() };
            colors.size = std::mem::size_of::<Self>();
            colors
        }
    }

    unsafe extern "C" {
        pub fn ghostty_terminal_new(
            allocator: *const c_void,
            terminal: *mut GhosttyTerminal,
            options: GhosttyTerminalOptions,
        ) -> GhosttyResult;
        pub fn ghostty_terminal_free(terminal: GhosttyTerminal);
        pub fn ghostty_terminal_reset(terminal: GhosttyTerminal);
        pub fn ghostty_terminal_resize(
            terminal: GhosttyTerminal,
            cols: u16,
            rows: u16,
            cell_width_px: u32,
            cell_height_px: u32,
        ) -> GhosttyResult;
        pub fn ghostty_terminal_vt_write(terminal: GhosttyTerminal, data: *const u8, len: usize);
        /// For pointer-typed options (userdata, callbacks) `value` IS the
        /// pointer/function pointer itself, not a pointer to it. NULL clears.
        pub fn ghostty_terminal_set(
            terminal: GhosttyTerminal,
            option: GhosttyTerminalOption,
            value: *const c_void,
        ) -> GhosttyResult;

        pub fn ghostty_render_state_new(
            allocator: *const c_void,
            state: *mut GhosttyRenderState,
        ) -> GhosttyResult;
        pub fn ghostty_render_state_free(state: GhosttyRenderState);
        pub fn ghostty_render_state_update(
            state: GhosttyRenderState,
            terminal: GhosttyTerminal,
        ) -> GhosttyResult;
        pub fn ghostty_render_state_get(
            state: GhosttyRenderState,
            data: GhosttyRenderStateData,
            out: *mut c_void,
        ) -> GhosttyResult;
        pub fn ghostty_render_state_set(
            state: GhosttyRenderState,
            option: GhosttyRenderStateOption,
            value: *const c_void,
        ) -> GhosttyResult;
        pub fn ghostty_render_state_colors_get(
            state: GhosttyRenderState,
            out_colors: *mut GhosttyRenderStateColors,
        ) -> GhosttyResult;

        pub fn ghostty_render_state_row_iterator_new(
            allocator: *const c_void,
            out_iterator: *mut GhosttyRenderStateRowIterator,
        ) -> GhosttyResult;
        pub fn ghostty_render_state_row_iterator_free(iterator: GhosttyRenderStateRowIterator);
        pub fn ghostty_render_state_row_iterator_next(
            iterator: GhosttyRenderStateRowIterator,
        ) -> bool;
        pub fn ghostty_render_state_row_get(
            iterator: GhosttyRenderStateRowIterator,
            data: GhosttyRenderStateRowData,
            out: *mut c_void,
        ) -> GhosttyResult;
        pub fn ghostty_render_state_row_set(
            iterator: GhosttyRenderStateRowIterator,
            option: GhosttyRenderStateRowOption,
            value: *const c_void,
        ) -> GhosttyResult;

        pub fn ghostty_render_state_row_cells_new(
            allocator: *const c_void,
            out_cells: *mut GhosttyRenderStateRowCells,
        ) -> GhosttyResult;
        pub fn ghostty_render_state_row_cells_free(cells: GhosttyRenderStateRowCells);
        pub fn ghostty_render_state_row_cells_next(cells: GhosttyRenderStateRowCells) -> bool;
        pub fn ghostty_render_state_row_cells_select(
            cells: GhosttyRenderStateRowCells,
            x: u16,
        ) -> GhosttyResult;
        pub fn ghostty_render_state_row_cells_get(
            cells: GhosttyRenderStateRowCells,
            data: GhosttyRenderStateRowCellsData,
            out: *mut c_void,
        ) -> GhosttyResult;

        pub fn ghostty_cell_get(
            cell: GhosttyCell,
            data: GhosttyCellData,
            out: *mut c_void,
        ) -> GhosttyResult;
    }
}

/// Error from a libghostty-vt call, carrying the raw `GhosttyResult` code.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct VtError {
    pub code: i32,
}

impl fmt::Display for VtError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        let name = match self.code {
            ffi::GHOSTTY_OUT_OF_MEMORY => "out of memory",
            ffi::GHOSTTY_INVALID_VALUE => "invalid value",
            ffi::GHOSTTY_OUT_OF_SPACE => "out of space",
            ffi::GHOSTTY_NO_VALUE => "no value",
            _ => "unknown libghostty-vt error",
        };
        write!(f, "libghostty-vt: {name} (code {})", self.code)
    }
}

impl std::error::Error for VtError {}

fn check(result: ffi::GhosttyResult) -> Result<(), VtError> {
    if result == ffi::GHOSTTY_SUCCESS {
        Ok(())
    } else {
        Err(VtError { code: result })
    }
}

/// Global render-state dirtiness after an update.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum VtDirty {
    /// Nothing changed; rendering can be skipped entirely.
    Clean,
    /// Some rows changed; consult per-row dirty flags.
    Partial,
    /// Global state changed; redraw everything.
    Full,
}

/// Width behavior of a cell.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum VtCellWide {
    Narrow,
    Wide,
    /// Spacer after a wide character. Do not render.
    SpacerTail,
    /// Spacer at the end of a soft-wrapped line before a wide character.
    SpacerHead,
}

/// A libghostty-vt terminal instance: VT parser plus full terminal state
/// (screen, scrollback, alt screen, modes, styles).
///
/// Not `Sync`: exclusive access is required for every call, expressed as
/// `&mut self`. Cross-thread sharing (PTY reader thread vs. render path)
/// must go through a lock owned by the caller.
pub struct VtTerminal {
    raw: ffi::GhosttyTerminal,
    /// Heap cell registered as the terminal's userdata; trampolines below
    /// dispatch through it. Null until [`set_host_callbacks`] installs hooks.
    ///
    /// [`set_host_callbacks`]: Self::set_host_callbacks
    host_callbacks: *mut VtHostCallbacks,
}

// SAFETY: libghostty-vt terminal state has no thread affinity (no TLS, no
// run-loop coupling); it only requires exclusive access, which &mut methods
// and the !Sync auto impl (raw pointer field) already enforce.
unsafe impl Send for VtTerminal {}

impl VtTerminal {
    pub fn new(cols: u16, rows: u16, max_scrollback: usize) -> Result<Self, VtError> {
        let mut raw: ffi::GhosttyTerminal = std::ptr::null_mut();
        check(unsafe {
            ffi::ghostty_terminal_new(
                std::ptr::null(),
                &mut raw,
                ffi::GhosttyTerminalOptions {
                    cols,
                    rows,
                    max_scrollback,
                },
            )
        })?;
        Ok(Self {
            raw,
            host_callbacks: std::ptr::null_mut(),
        })
    }

    /// Install terminal → host hooks. Hooks fire synchronously inside
    /// [`feed`](Self::feed) on whichever thread is feeding, so they must be
    /// `Send`, must never call back into this terminal (no reentrancy per
    /// terminal.h), and must not block. `None` hooks are cleared in the
    /// library so the corresponding sequences are ignored. Replaces any
    /// previously installed set.
    pub fn set_host_callbacks(&mut self, callbacks: VtHostCallbacks) -> Result<(), VtError> {
        let write_pty_fn: *const c_void = if callbacks.write_pty.is_some() {
            let f: ffi::GhosttyTerminalWritePtyFn = write_pty_trampoline;
            f as *const c_void
        } else {
            std::ptr::null()
        };
        let bell_fn: *const c_void = if callbacks.bell.is_some() {
            let f: ffi::GhosttyTerminalBellFn = bell_trampoline;
            f as *const c_void
        } else {
            std::ptr::null()
        };
        let title_fn: *const c_void = if callbacks.title_changed.is_some() {
            let f: ffi::GhosttyTerminalTitleChangedFn = title_changed_trampoline;
            f as *const c_void
        } else {
            std::ptr::null()
        };

        let boxed = Box::into_raw(Box::new(callbacks));
        let result = unsafe {
            check(ffi::ghostty_terminal_set(
                self.raw,
                ffi::GHOSTTY_TERMINAL_OPT_USERDATA,
                boxed.cast::<c_void>(),
            ))
            .and_then(|()| {
                check(ffi::ghostty_terminal_set(
                    self.raw,
                    ffi::GHOSTTY_TERMINAL_OPT_WRITE_PTY,
                    write_pty_fn,
                ))
            })
            .and_then(|()| {
                check(ffi::ghostty_terminal_set(
                    self.raw,
                    ffi::GHOSTTY_TERMINAL_OPT_BELL,
                    bell_fn,
                ))
            })
            .and_then(|()| {
                check(ffi::ghostty_terminal_set(
                    self.raw,
                    ffi::GHOSTTY_TERMINAL_OPT_TITLE_CHANGED,
                    title_fn,
                ))
            })
        };
        if let Err(error) = result {
            // Leave the terminal with no hooks rather than half a set wired
            // to a userdata pointer we are about to free.
            unsafe {
                ffi::ghostty_terminal_set(
                    self.raw,
                    ffi::GHOSTTY_TERMINAL_OPT_WRITE_PTY,
                    std::ptr::null(),
                );
                ffi::ghostty_terminal_set(self.raw, ffi::GHOSTTY_TERMINAL_OPT_BELL, std::ptr::null());
                ffi::ghostty_terminal_set(
                    self.raw,
                    ffi::GHOSTTY_TERMINAL_OPT_TITLE_CHANGED,
                    std::ptr::null(),
                );
                ffi::ghostty_terminal_set(
                    self.raw,
                    ffi::GHOSTTY_TERMINAL_OPT_USERDATA,
                    std::ptr::null(),
                );
                drop(Box::from_raw(boxed));
            }
            return Err(error);
        }
        let previous = std::mem::replace(&mut self.host_callbacks, boxed);
        if !previous.is_null() {
            // Safe to free only now: the library already points at `boxed`.
            drop(unsafe { Box::from_raw(previous) });
        }
        Ok(())
    }

    /// Feed raw VT-encoded bytes (typically PTY output) through the parser.
    /// Never fails; malformed input is absorbed by the library.
    pub fn feed(&mut self, bytes: &[u8]) {
        unsafe { ffi::ghostty_terminal_vt_write(self.raw, bytes.as_ptr(), bytes.len()) }
    }

    /// Resize the grid. The primary screen reflows; the alternate screen does
    /// not. Cell pixel sizes feed image protocols and size reports.
    pub fn resize(
        &mut self,
        cols: u16,
        rows: u16,
        cell_width_px: u32,
        cell_height_px: u32,
    ) -> Result<(), VtError> {
        check(unsafe {
            ffi::ghostty_terminal_resize(self.raw, cols, rows, cell_width_px, cell_height_px)
        })
    }

    /// Full terminal reset (RIS). Dimensions are preserved.
    pub fn reset(&mut self) {
        unsafe { ffi::ghostty_terminal_reset(self.raw) }
    }
}

impl Drop for VtTerminal {
    fn drop(&mut self) {
        // Free the terminal before the callback cell: callbacks only fire
        // from feed(), but this order keeps the userdata pointer valid for
        // the terminal's entire lifetime.
        unsafe { ffi::ghostty_terminal_free(self.raw) }
        if !self.host_callbacks.is_null() {
            drop(unsafe { Box::from_raw(self.host_callbacks) });
        }
    }
}

/// Terminal → host hooks dispatched from [`VtTerminal::feed`]. `write_pty`
/// receives query auto-replies (DA1, DSR, DECRQM, ...) that must reach the
/// PTY for applications to keep working; `bell` and `title_changed` are
/// notification hooks (the new title is queried from the terminal later).
#[derive(Default)]
pub struct VtHostCallbacks {
    pub write_pty: Option<Box<dyn FnMut(&[u8]) + Send>>,
    pub bell: Option<Box<dyn FnMut() + Send>>,
    pub title_changed: Option<Box<dyn FnMut() + Send>>,
}

unsafe extern "C" fn write_pty_trampoline(
    _terminal: ffi::GhosttyTerminal,
    userdata: *mut c_void,
    data: *const u8,
    len: usize,
) {
    let callbacks = unsafe { &mut *userdata.cast::<VtHostCallbacks>() };
    if let Some(write_pty) = callbacks.write_pty.as_mut() {
        let bytes: &[u8] = if len == 0 {
            &[]
        } else {
            unsafe { std::slice::from_raw_parts(data, len) }
        };
        write_pty(bytes);
    }
}

unsafe extern "C" fn bell_trampoline(_terminal: ffi::GhosttyTerminal, userdata: *mut c_void) {
    let callbacks = unsafe { &mut *userdata.cast::<VtHostCallbacks>() };
    if let Some(bell) = callbacks.bell.as_mut() {
        bell();
    }
}

unsafe extern "C" fn title_changed_trampoline(
    _terminal: ffi::GhosttyTerminal,
    userdata: *mut c_void,
) {
    let callbacks = unsafe { &mut *userdata.cast::<VtHostCallbacks>() };
    if let Some(title_changed) = callbacks.title_changed.as_mut() {
        title_changed();
    }
}

/// Resolve an SGR style color (e.g. `GhosttyStyle::underline_color`) against
/// the active palette. `None` means the style has no explicit color; use the
/// relevant default. Lives here so the union field reads stay in the FFI
/// choke point.
pub fn style_color_rgb(
    color: &ffi::GhosttyStyleColor,
    palette: &[ffi::GhosttyColorRgb; 256],
) -> Option<ffi::GhosttyColorRgb> {
    match color.tag {
        ffi::GHOSTTY_STYLE_COLOR_PALETTE => {
            Some(palette[unsafe { color.value.palette } as usize])
        }
        ffi::GHOSTTY_STYLE_COLOR_RGB => Some(unsafe { color.value.rgb }),
        _ => None,
    }
}

/// Snapshot of a terminal viewport for rendering, with two-level dirty
/// tracking (global + per-row).
///
/// Usage per frame: [`update`](Self::update) under exclusive terminal access,
/// read rows/cells via [`rows`](Self::rows), then clear BOTH dirty layers —
/// per-row with [`VtRow::clear_dirty`], global with
/// [`clear_dirty`](Self::clear_dirty). Updates never clear dirty state, and
/// clearing one layer never clears the other (see module CDXC).
pub struct VtRenderState {
    raw: ffi::GhosttyRenderState,
    row_iter: ffi::GhosttyRenderStateRowIterator,
    cells: ffi::GhosttyRenderStateRowCells,
}

// SAFETY: the render state is a self-contained snapshot after update; like
// VtTerminal it has no thread affinity and &mut methods enforce exclusivity.
unsafe impl Send for VtRenderState {}

impl VtRenderState {
    pub fn new() -> Result<Self, VtError> {
        let mut raw: ffi::GhosttyRenderState = std::ptr::null_mut();
        check(unsafe { ffi::ghostty_render_state_new(std::ptr::null(), &mut raw) })?;

        let mut row_iter: ffi::GhosttyRenderStateRowIterator = std::ptr::null_mut();
        if let Err(error) =
            check(unsafe { ffi::ghostty_render_state_row_iterator_new(std::ptr::null(), &mut row_iter) })
        {
            unsafe { ffi::ghostty_render_state_free(raw) };
            return Err(error);
        }

        let mut cells: ffi::GhosttyRenderStateRowCells = std::ptr::null_mut();
        if let Err(error) =
            check(unsafe { ffi::ghostty_render_state_row_cells_new(std::ptr::null(), &mut cells) })
        {
            unsafe {
                ffi::ghostty_render_state_row_iterator_free(row_iter);
                ffi::ghostty_render_state_free(raw);
            }
            return Err(error);
        }

        Ok(Self {
            raw,
            row_iter,
            cells,
        })
    }

    /// Sync this snapshot from the terminal. Requires exclusive terminal
    /// access only for the duration of this call (the "short lock").
    /// Invalidates all row/cell data read from previous updates, which the
    /// `&mut self` borrow enforces against the borrowing readers below.
    pub fn update(&mut self, terminal: &mut VtTerminal) -> Result<(), VtError> {
        check(unsafe { ffi::ghostty_render_state_update(self.raw, terminal.raw) })
    }

    fn get(&self, data: ffi::GhosttyRenderStateData, out: *mut c_void) -> Result<(), VtError> {
        check(unsafe { ffi::ghostty_render_state_get(self.raw, data, out) })
    }

    /// Viewport size in cells as `(cols, rows)`.
    pub fn size(&self) -> Result<(u16, u16), VtError> {
        let mut cols: u16 = 0;
        let mut rows: u16 = 0;
        self.get(
            ffi::GHOSTTY_RENDER_STATE_DATA_COLS,
            (&raw mut cols).cast::<c_void>(),
        )?;
        self.get(
            ffi::GHOSTTY_RENDER_STATE_DATA_ROWS,
            (&raw mut rows).cast::<c_void>(),
        )?;
        Ok((cols, rows))
    }

    /// Global dirty state. Raised by [`update`](Self::update); only ever
    /// cleared by the caller via [`clear_dirty`](Self::clear_dirty).
    pub fn dirty(&self) -> Result<VtDirty, VtError> {
        let mut dirty: ffi::GhosttyRenderStateDirty = 0;
        self.get(
            ffi::GHOSTTY_RENDER_STATE_DATA_DIRTY,
            (&raw mut dirty).cast::<c_void>(),
        )?;
        Ok(match dirty {
            ffi::GHOSTTY_RENDER_STATE_DIRTY_PARTIAL => VtDirty::Partial,
            ffi::GHOSTTY_RENDER_STATE_DIRTY_FULL => VtDirty::Full,
            _ => VtDirty::Clean,
        })
    }

    /// Clear the GLOBAL dirty layer after consuming a frame. Per-row dirty
    /// flags are independent and must be cleared per row while iterating
    /// ([`VtRow::clear_dirty`]).
    pub fn clear_dirty(&mut self) -> Result<(), VtError> {
        let clean = ffi::GHOSTTY_RENDER_STATE_DIRTY_FALSE;
        check(unsafe {
            ffi::ghostty_render_state_set(
                self.raw,
                ffi::GHOSTTY_RENDER_STATE_OPTION_DIRTY,
                (&raw const clean).cast::<c_void>(),
            )
        })
    }

    /// Default background/foreground, explicit cursor color, and the active
    /// 256-color palette.
    pub fn colors(&self) -> Result<ffi::GhosttyRenderStateColors, VtError> {
        let mut colors = ffi::GhosttyRenderStateColors::init_sized();
        check(unsafe { ffi::ghostty_render_state_colors_get(self.raw, &mut colors) })?;
        Ok(colors)
    }

    /// Whether the cursor is visible per terminal modes (DECTCEM). Distinct
    /// from [`cursor_viewport`](Self::cursor_viewport), which reports whether
    /// the cursor position falls inside the viewport.
    pub fn cursor_visible(&self) -> Result<bool, VtError> {
        let mut visible = false;
        self.get(
            ffi::GHOSTTY_RENDER_STATE_DATA_CURSOR_VISIBLE,
            (&raw mut visible).cast::<c_void>(),
        )?;
        Ok(visible)
    }

    /// Cursor position in viewport cells, if the cursor is visible within
    /// the viewport.
    pub fn cursor_viewport(&self) -> Result<Option<(u16, u16)>, VtError> {
        let mut has_value = false;
        self.get(
            ffi::GHOSTTY_RENDER_STATE_DATA_CURSOR_VIEWPORT_HAS_VALUE,
            (&raw mut has_value).cast::<c_void>(),
        )?;
        if !has_value {
            return Ok(None);
        }
        let mut x: u16 = 0;
        let mut y: u16 = 0;
        self.get(
            ffi::GHOSTTY_RENDER_STATE_DATA_CURSOR_VIEWPORT_X,
            (&raw mut x).cast::<c_void>(),
        )?;
        self.get(
            ffi::GHOSTTY_RENDER_STATE_DATA_CURSOR_VIEWPORT_Y,
            (&raw mut y).cast::<c_void>(),
        )?;
        Ok(Some((x, y)))
    }

    /// Begin iterating viewport rows top to bottom. Row and cell data stay
    /// valid until the next [`update`](Self::update), enforced by borrows.
    pub fn rows(&mut self) -> Result<VtRows<'_>, VtError> {
        // Re-arms the pre-allocated iterator at the first viewport row.
        let mut row_iter = self.row_iter;
        self.get(
            ffi::GHOSTTY_RENDER_STATE_DATA_ROW_ITERATOR,
            (&raw mut row_iter).cast::<c_void>(),
        )?;
        Ok(VtRows { state: self })
    }
}

impl Drop for VtRenderState {
    fn drop(&mut self) {
        unsafe {
            ffi::ghostty_render_state_row_cells_free(self.cells);
            ffi::ghostty_render_state_row_iterator_free(self.row_iter);
            ffi::ghostty_render_state_free(self.raw);
        }
    }
}

/// Streaming row iterator (not `std::iter::Iterator`: each row borrows the
/// iterator so cell data cannot outlive its row).
pub struct VtRows<'a> {
    state: &'a mut VtRenderState,
}

impl VtRows<'_> {
    pub fn next_row(&mut self) -> Option<VtRow<'_>> {
        if unsafe { ffi::ghostty_render_state_row_iterator_next(self.state.row_iter) } {
            Some(VtRow { state: self.state })
        } else {
            None
        }
    }
}

/// One viewport row positioned under the row iterator.
pub struct VtRow<'a> {
    state: &'a mut VtRenderState,
}

impl VtRow<'_> {
    /// Per-row dirty flag. Independent from the global dirty layer.
    pub fn is_dirty(&self) -> Result<bool, VtError> {
        let mut dirty = false;
        check(unsafe {
            ffi::ghostty_render_state_row_get(
                self.state.row_iter,
                ffi::GHOSTTY_RENDER_STATE_ROW_DATA_DIRTY,
                (&raw mut dirty).cast::<c_void>(),
            )
        })?;
        Ok(dirty)
    }

    /// Clear this row's dirty flag after rendering it. Does not touch the
    /// global dirty layer.
    pub fn clear_dirty(&mut self) -> Result<(), VtError> {
        let clean = false;
        check(unsafe {
            ffi::ghostty_render_state_row_set(
                self.state.row_iter,
                ffi::GHOSTTY_RENDER_STATE_ROW_OPTION_DIRTY,
                (&raw const clean).cast::<c_void>(),
            )
        })
    }

    /// Begin iterating this row's cells left to right, reusing the render
    /// state's pre-allocated cells container.
    pub fn cells(&mut self) -> Result<VtCells<'_>, VtError> {
        let mut cells = self.state.cells;
        check(unsafe {
            ffi::ghostty_render_state_row_get(
                self.state.row_iter,
                ffi::GHOSTTY_RENDER_STATE_ROW_DATA_CELLS,
                (&raw mut cells).cast::<c_void>(),
            )
        })?;
        Ok(VtCells {
            raw: self.state.cells,
            _row: PhantomData,
        })
    }

    /// Convenience readback of the row's text: empty cells become spaces,
    /// wide-character spacers are skipped, trailing whitespace is trimmed.
    pub fn text(&mut self) -> Result<String, VtError> {
        let mut text = String::new();
        let mut codepoints: Vec<u32> = Vec::new();
        let mut cells = self.cells()?;
        while let Some(cell) = cells.next_cell() {
            match cell.wide()? {
                VtCellWide::SpacerTail | VtCellWide::SpacerHead => continue,
                VtCellWide::Narrow | VtCellWide::Wide => {}
            }
            codepoints.clear();
            cell.append_codepoints(&mut codepoints)?;
            if codepoints.is_empty() {
                text.push(' ');
                continue;
            }
            for codepoint in &codepoints {
                text.push(char::from_u32(*codepoint).unwrap_or(char::REPLACEMENT_CHARACTER));
            }
        }
        text.truncate(text.trim_end().len());
        Ok(text)
    }
}

/// Streaming cell iterator for one row.
pub struct VtCells<'a> {
    raw: ffi::GhosttyRenderStateRowCells,
    _row: PhantomData<&'a mut VtRenderState>,
}

impl VtCells<'_> {
    pub fn next_cell(&mut self) -> Option<VtCellRef<'_>> {
        if unsafe { ffi::ghostty_render_state_row_cells_next(self.raw) } {
            Some(VtCellRef {
                raw: self.raw,
                _cells: PhantomData,
            })
        } else {
            None
        }
    }
}

/// One cell positioned under the cells iterator.
pub struct VtCellRef<'a> {
    raw: ffi::GhosttyRenderStateRowCells,
    _cells: PhantomData<&'a mut VtRenderState>,
}

impl VtCellRef<'_> {
    fn get(&self, data: ffi::GhosttyRenderStateRowCellsData, out: *mut c_void) -> Result<(), VtError> {
        check(unsafe { ffi::ghostty_render_state_row_cells_get(self.raw, data, out) })
    }

    /// Number of grapheme codepoints including the base codepoint; 0 means
    /// the cell has no text.
    pub fn grapheme_len(&self) -> Result<u32, VtError> {
        let mut len: u32 = 0;
        self.get(
            ffi::GHOSTTY_RENDER_STATE_ROW_CELLS_DATA_GRAPHEMES_LEN,
            (&raw mut len).cast::<c_void>(),
        )?;
        Ok(len)
    }

    /// Append the cell's grapheme codepoints (base first) to `out`.
    pub fn append_codepoints(&self, out: &mut Vec<u32>) -> Result<(), VtError> {
        let len = self.grapheme_len()? as usize;
        if len == 0 {
            return Ok(());
        }
        let start = out.len();
        out.resize(start + len, 0);
        self.get(
            ffi::GHOSTTY_RENDER_STATE_ROW_CELLS_DATA_GRAPHEMES_BUF,
            out[start..].as_mut_ptr().cast::<c_void>(),
        )?;
        Ok(())
    }

    /// Resolved foreground color, or `None` when the cell has no explicit
    /// foreground (use the render-state default).
    pub fn fg_color(&self) -> Result<Option<ffi::GhosttyColorRgb>, VtError> {
        self.optional_color(ffi::GHOSTTY_RENDER_STATE_ROW_CELLS_DATA_FG_COLOR)
    }

    /// Resolved background color, or `None` when the cell has no explicit
    /// background (use the render-state default).
    pub fn bg_color(&self) -> Result<Option<ffi::GhosttyColorRgb>, VtError> {
        self.optional_color(ffi::GHOSTTY_RENDER_STATE_ROW_CELLS_DATA_BG_COLOR)
    }

    fn optional_color(
        &self,
        data: ffi::GhosttyRenderStateRowCellsData,
    ) -> Result<Option<ffi::GhosttyColorRgb>, VtError> {
        let mut color = ffi::GhosttyColorRgb::default();
        match unsafe {
            ffi::ghostty_render_state_row_cells_get(
                self.raw,
                data,
                (&raw mut color).cast::<c_void>(),
            )
        } {
            ffi::GHOSTTY_SUCCESS => Ok(Some(color)),
            ffi::GHOSTTY_INVALID_VALUE => Ok(None),
            code => Err(VtError { code }),
        }
    }

    /// Full SGR style for the cell (default style when unstyled).
    pub fn style(&self) -> Result<ffi::GhosttyStyle, VtError> {
        let mut style = ffi::GhosttyStyle::init_sized();
        self.get(
            ffi::GHOSTTY_RENDER_STATE_ROW_CELLS_DATA_STYLE,
            (&raw mut style).cast::<c_void>(),
        )?;
        Ok(style)
    }

    /// Width behavior; spacer cells must not be rendered.
    pub fn wide(&self) -> Result<VtCellWide, VtError> {
        let mut raw_cell: ffi::GhosttyCell = 0;
        self.get(
            ffi::GHOSTTY_RENDER_STATE_ROW_CELLS_DATA_RAW,
            (&raw mut raw_cell).cast::<c_void>(),
        )?;
        let mut wide: ffi::GhosttyCellWide = 0;
        check(unsafe {
            ffi::ghostty_cell_get(
                raw_cell,
                ffi::GHOSTTY_CELL_DATA_WIDE,
                (&raw mut wide).cast::<c_void>(),
            )
        })?;
        Ok(match wide {
            ffi::GHOSTTY_CELL_WIDE_WIDE => VtCellWide::Wide,
            ffi::GHOSTTY_CELL_WIDE_SPACER_TAIL => VtCellWide::SpacerTail,
            ffi::GHOSTTY_CELL_WIDE_SPACER_HEAD => VtCellWide::SpacerHead,
            _ => VtCellWide::Narrow,
        })
    }
}
