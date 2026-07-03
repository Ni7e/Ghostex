#![allow(dead_code)]

/*
CDXC:GPUITerminalElement 2026-07-03:
P1c GPUI-composited terminal renderer over the P1b terminal model. One
`TerminalView` entity owns the model plus the render caches; `TerminalElement`
is a thin gpui::Element that reads them each frame. Replaces native Ghostty
child views for portability (P1e swaps it into the panes).

Frame flow: model wakeups arrive on background threads through the event sink,
get marshalled to the gpui foreground via an unbounded channel + entity task,
and each wakeup takes EXACTLY ONE snapshot immediately (row dirty flags are
relative to the previous snapshot, so skipping or coalescing snapshots would
lose that frame's diff). The latest snapshot is kept as the current frame;
prepaint never touches the model except on first layout and grid resize.

Caching: shaped rows are cached per viewport row and invalidated by the
snapshot's dirty info (`Clean` global → whole previous layout reused; row
dirty → that row reshaped). Background spans merge horizontally only, per
row, so a row's cache entry is self-contained and dirty tracking stays sound;
whole-frame vertical rect merging would couple rows and defeat the cache.

Column alignment: text runs are shaped with `force_width = cell_width`, which
snaps every base glyph to its cell. A Wide cell would receive only one forced
cell of advance inside a batch, so wide cells always flush the current batch
and paint as their own run positioned by grid column; spacer cells keep the
cells vector column-aligned and are skipped for text.

CDXC:GPUITerminalInput 2026-07-04 (P1d):
Input rides libghostty-vt's own encoders so encoding always matches the modes
the running program set. Key path: the platform delivers plain-alt text keys
and IME composition to the InputHandler (marked text renders, commits write
UTF-8 to the PTY); every other key hits the on_key_event listener and goes
through the vt key encoder (kitty/legacy/DECCKM synced from live terminal
state) — an encoded key is consumed, an un-encoded one (bare mods, unbound
cmd chords) propagates so app bindings still work. Mouse path: with a
tracking mode active (and shift not held, the xterm local-override), events
encode through the vt mouse encoder in DEVICE pixels matching the PTY cell
sizes; otherwise the view owns click-to-focus plus cell/word/line drag
selection in viewport coordinates. Wheel routes by terminal state: reported,
arrow keys (alt screen + mode 1007), or local scrollback viewport scrolling.
Copy trims per-row trailing whitespace and joins rows with newlines; paste
uses the vt paste encoder (bracketed mode + unsafe byte stripping).

Known P1e follow-ups: selection is viewport-relative (drifts under output,
no soft-wrap join on copy), option-as-alt/right-click/modifier-only kitty
events aren't wired, and scrollback has no scrollbar UI.
*/

use std::ops::Range;
use std::sync::Arc;

use futures::StreamExt as _;

use gpui::{
    App, BorderStyle, Bounds, ClipboardItem, ContentMask, Context, CursorStyle, DispatchPhase,
    Element, ElementId, ElementInputHandler, Entity, EntityInputHandler, FocusHandle, Focusable,
    Font, FontStyle, FontWeight, GlobalElementId, Hitbox, HitboxBehavior, Hsla, IntoElement,
    KeyDownEvent, KeyUpEvent, Keystroke, LayoutId, Modifiers, MouseButton, MouseDownEvent,
    MouseMoveEvent, MouseUpEvent, Pixels, Point, Render, Rgba, ScrollDelta, ScrollWheelEvent,
    ShapedLine, SharedString, Size, StrikethroughStyle, Style, TextAlign, TextRun, UTF16Selection,
    UnderlineStyle as GpuiUnderlineStyle, Window, fill, outline, point, px, size,
};

use crate::ghostty_vt::{
    VtCellWide, VtDirty, VtKey, VtKeyAction, VtKeyInput, VtMods, VtMouseAction, VtMouseButton,
    VtMouseInput, VtScrollViewport, ffi,
};
use crate::terminal_model::{
    Rgb, SnapshotCell, SnapshotRow, TerminalEvent, TerminalEventSink, TerminalExit, TerminalModel,
    TerminalSnapshot, TerminalSpawnConfig, UnderlineStyle as CellUnderline, WheelRoute,
};

/// Terminal font configuration used for cell metrics and run shaping.
/// TODO(P1e): sync from the app's terminal settings (shared_settings
/// font-family/size/weight) instead of this hardcoded app default.
#[derive(Clone, Debug, PartialEq)]
pub struct TerminalFontConfig {
    pub family: SharedString,
    pub size: Pixels,
    pub weight: FontWeight,
}

impl Default for TerminalFontConfig {
    fn default() -> Self {
        Self {
            family: "JetBrains Mono".into(),
            size: px(13.),
            weight: FontWeight::LIGHT,
        }
    }
}

/// Cursor shape to draw. Defaults to Block; P1e syncs the real shape from
/// terminal modes/settings.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum TerminalCursorShape {
    Block,
    Bar,
    Underline,
}

/// Linear selection over viewport cells: covers every cell from `start`
/// (inclusive) walking left-to-right/top-to-bottom to `end` (exclusive
/// column on the end row). Driven by mouse selection below; ranges are
/// normalized (start/end swapped as needed) wherever they are consumed.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct TerminalSelection {
    pub start_row: u16,
    pub start_col: u16,
    pub end_row: u16,
    pub end_col: u16,
}

/// Drag granularity from the click count (single/double/triple click).
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum SelectMode {
    Cell,
    Word,
    Line,
}

/// An in-progress local selection drag, anchored at the mouse-down cell.
#[derive(Clone, Copy, Debug)]
struct SelectionDrag {
    mode: SelectMode,
    anchor: (u16, u16),
}

/// Per-cell metrics derived from the configured font.
#[derive(Clone, Copy, Debug, PartialEq)]
struct CellMetrics {
    cell_width: Pixels,
    line_height: Pixels,
}

/// A horizontal run of same-colored cells within one row.
#[derive(Clone, Debug)]
struct CellSpan {
    col: u16,
    len: u16,
    color: Hsla,
}

/// A shaped text run anchored at a grid column.
struct PositionedRun {
    col: u16,
    shaped: ShapedLine,
}

/// Cached per-row layout: everything needed to paint one row except
/// selection/cursor/marked text, which change independently of row content.
struct RowLayout {
    bg_spans: Vec<CellSpan>,
    overline_spans: Vec<CellSpan>,
    runs: Vec<PositionedRun>,
}

struct CursorLayout {
    col: u16,
    row: u16,
    width_cells: u16,
    shape: TerminalCursorShape,
    color: Hsla,
    /// Unfocused terminals draw a hollow (outline) block instead of a
    /// filled cursor.
    hollow: bool,
    /// Block cursors repaint the covered glyph in the inverted color.
    overlay: Option<ShapedLine>,
}

struct MarkedTextLayout {
    col: u16,
    row: u16,
    shaped: ShapedLine,
    background: Hsla,
}

/// Prepaint output consumed by paint; positions are grid coordinates
/// converted to pixels against the element origin at paint time.
pub struct TerminalLayout {
    metrics: CellMetrics,
    background: Hsla,
    rows: Vec<Arc<RowLayout>>,
    selection_spans: Vec<(u16, CellSpan)>,
    cursor: Option<CursorLayout>,
    marked_text: Option<MarkedTextLayout>,
}

/// Entity that owns a live terminal: the P1b model, the latest snapshot, and
/// the shaped-row cache. Rendered by [`TerminalElement`]; its own `Render`
/// impl just emits that element so `cx.notify()` re-renders naturally.
pub struct TerminalView {
    model: TerminalModel,
    font: TerminalFontConfig,
    frame: Option<TerminalSnapshot>,
    row_cache: Vec<Option<Arc<RowLayout>>>,
    cached_metrics: Option<CellMetrics>,
    exit: Option<TerminalExit>,
    pub cursor_shape: TerminalCursorShape,
    /// Selection over viewport cells, driven by the mouse handlers below.
    pub selection: Option<TerminalSelection>,
    /// IME marked (pre-edit) text drawn at the cursor, driven by the
    /// EntityInputHandler impl below.
    pub marked_text: Option<String>,
    focus_handle: FocusHandle,
    /// Focus state as of the last prepaint; edges send focus reports
    /// (mode 1004) and switch the cursor to hollow.
    focused: bool,
    /// Local selection drag in progress (left button held, no reporting).
    drag: Option<SelectionDrag>,
    /// The left press was routed to PTY mouse reporting; drag sends motion
    /// and release goes to the PTY even if modes change mid-drag.
    reporting_drag: bool,
    left_button_down: bool,
    /// Fractional wheel rows not yet dispatched (trackpad smoothness).
    wheel_accum: f32,
}

impl TerminalView {
    /// Spawn the configured process and start pumping model events onto the
    /// gpui foreground. Every Wakeup takes one snapshot and notifies.
    pub fn spawn(
        config: TerminalSpawnConfig,
        font: TerminalFontConfig,
        cx: &mut Context<Self>,
    ) -> anyhow::Result<Self> {
        let (event_tx, mut event_rx) = futures::channel::mpsc::unbounded::<TerminalEvent>();
        let sink: TerminalEventSink = Arc::new(move |event| {
            let _ = event_tx.unbounded_send(event);
        });
        let model = TerminalModel::spawn(config, sink)?;

        cx.spawn(async move |this, cx| {
            while let Some(event) = event_rx.next().await {
                let Ok(()) = this.update(cx, |view, cx| view.handle_event(event, cx)) else {
                    break;
                };
            }
        })
        .detach();

        Ok(Self {
            model,
            font,
            frame: None,
            row_cache: Vec::new(),
            cached_metrics: None,
            exit: None,
            cursor_shape: TerminalCursorShape::Block,
            selection: None,
            marked_text: None,
            focus_handle: cx.focus_handle(),
            focused: false,
            drag: None,
            reporting_drag: false,
            left_button_down: false,
            wheel_accum: 0.,
        })
    }

    pub fn model(&self) -> &TerminalModel {
        &self.model
    }

    pub fn model_mut(&mut self) -> &mut TerminalModel {
        &mut self.model
    }

    pub fn exit_status(&self) -> Option<TerminalExit> {
        self.exit
    }

    fn handle_event(&mut self, event: TerminalEvent, cx: &mut Context<Self>) {
        match event {
            TerminalEvent::Wakeup => {
                self.refresh_snapshot();
                cx.notify();
            }
            TerminalEvent::Exited(exit) => {
                // Contents stay readable after exit; the final Wakeup may
                // land before or after this by design.
                self.exit = Some(exit);
                cx.notify();
            }
            // Bell and title consumers live with pane integration (P1e).
            TerminalEvent::Bell | TerminalEvent::TitleChanged => {}
        }
    }

    /// Take one snapshot and fold its dirty info into the row cache. Keeps
    /// the previous frame on snapshot errors so the next wakeup retries.
    fn refresh_snapshot(&mut self) {
        let Ok(frame) = self.model.snapshot() else {
            return;
        };
        if self.row_cache.len() != frame.rows.len() {
            self.row_cache = vec![None; frame.rows.len()];
        } else {
            match frame.dirty {
                VtDirty::Clean => {}
                VtDirty::Full => self.row_cache.fill(None),
                VtDirty::Partial => {
                    for (slot, row) in self.row_cache.iter_mut().zip(&frame.rows) {
                        if row.dirty {
                            *slot = None;
                        }
                    }
                }
            }
        }
        self.frame = Some(frame);
    }

    /// After writing user input to the PTY: drop the local selection, snap
    /// the viewport back to the live tail (ghostty behavior), and redraw.
    fn after_send_input(&mut self, cx: &mut Context<Self>) {
        self.selection = None;
        self.drag = None;
        self.model.scroll_viewport(VtScrollViewport::Bottom);
        self.refresh_snapshot();
        cx.notify();
    }

    fn handle_key_down(&mut self, event: &KeyDownEvent, cx: &mut Context<Self>) {
        let keystroke = &event.keystroke;
        let modifiers = &keystroke.modifiers;
        eprintln!("P1D-DEBUG key_down {keystroke:?}");
        if keystroke.key == "f6" {
            // P1D-DEBUG: exercise the wheel Viewport route without a wheel.
            self.model
                .scroll_viewport(VtScrollViewport::Delta(-10));
            self.refresh_snapshot();
            cx.notify();
            cx.stop_propagation();
            return;
        }

        // Clipboard shortcuts are app-owned; they never reach the PTY.
        if modifiers.platform && !modifiers.control && !modifiers.alt && !modifiers.function {
            match keystroke.key.as_str() {
                "c" if self.selection.is_some() => {
                    self.copy_selection(cx);
                    cx.stop_propagation();
                    return;
                }
                "v" => {
                    self.paste_clipboard(cx);
                    cx.stop_propagation();
                    return;
                }
                _ => {}
            }
        }

        // Plain option-modified text keys belong to the IME/insertText path
        // while option is not acting as alt: dead keys compose there
        // (option-e + e -> é) and option-symbols (ß, ∫) arrive as committed
        // text. Consuming them here would break composition, so let them
        // propagate to the platform text input path.
        if modifiers.alt
            && !modifiers.control
            && !modifiers.platform
            && !modifiers.function
            && keystroke.key_char.is_some()
            && !self.model.option_sends_alt()
        {
            return;
        }

        let (key, unshifted_codepoint) = keystroke_vt_key(keystroke);
        let utf8 = keystroke_text(keystroke);
        let mods = vt_mods(modifiers);
        let input = VtKeyInput {
            action: if event.is_held {
                VtKeyAction::Repeat
            } else {
                VtKeyAction::Press
            },
            key,
            mods,
            // The platform layout already folded shift/option into the
            // produced text; ctrl/super transformations stay unconsumed.
            consumed_mods: if utf8.is_some() {
                mods & (ffi::GHOSTTY_MODS_SHIFT | ffi::GHOSTTY_MODS_ALT)
            } else {
                0
            },
            utf8,
            unshifted_codepoint,
        };
        if self.model.send_key(&input) {
            self.after_send_input(cx);
            cx.stop_propagation();
        }
    }

    /// Key releases only produce output under kitty report-events mode;
    /// they never consume the event.
    fn handle_key_up(&mut self, event: &KeyUpEvent) {
        let keystroke = &event.keystroke;
        let (key, unshifted_codepoint) = keystroke_vt_key(keystroke);
        let _ = self.model.send_key(&VtKeyInput {
            action: VtKeyAction::Release,
            key,
            mods: vt_mods(&keystroke.modifiers),
            consumed_mods: 0,
            utf8: None,
            unshifted_codepoint,
        });
    }

    /// Commit IME text (or press-and-hold repeats) to the PTY as UTF-8. The
    /// borrowed platform string is written immediately and never retained
    /// (AppKit reuses IME insert buffers; gpui also copies before this).
    fn commit_ime_text(&mut self, text: &str, cx: &mut Context<Self>) {
        self.marked_text = None;
        if text.is_empty() {
            cx.notify();
            return;
        }
        let _ = self.model.write_input(text.as_bytes());
        self.after_send_input(cx);
    }

    fn copy_selection(&mut self, cx: &mut Context<Self>) {
        if let Some(text) = self.selection_text()
            && !text.is_empty()
        {
            cx.write_to_clipboard(ClipboardItem::new_string(text));
        }
    }

    fn paste_clipboard(&mut self, cx: &mut Context<Self>) {
        let Some(text) = cx.read_from_clipboard().and_then(|item| item.text()) else {
            return;
        };
        if text.is_empty() {
            return;
        }
        let _ = self.model.send_paste(&text);
        self.after_send_input(cx);
    }

    /// Selected text: spacers skipped, per-row trailing whitespace trimmed,
    /// rows joined with newlines. (Soft-wrapped rows still join with a
    /// newline — the snapshot has no wrap metadata yet; P1e.)
    fn selection_text(&self) -> Option<String> {
        let selection = self.selection?;
        let frame = self.frame.as_ref()?;
        let rows = frame.rows.len() as u16;
        if rows == 0 || frame.cols == 0 {
            return None;
        }
        let (start, end) = {
            let start = (selection.start_row, selection.start_col);
            let end = (selection.end_row, selection.end_col);
            if start <= end { (start, end) } else { (end, start) }
        };
        let mut lines: Vec<String> = Vec::new();
        for row in start.0..=end.0.min(rows - 1) {
            let cells = &frame.rows[usize::from(row)].cells;
            let col_start = usize::from(if row == start.0 { start.1 } else { 0 });
            let col_end = usize::from(if row == end.0 { end.1 } else { frame.cols }).min(cells.len());
            let mut line = String::new();
            for cell in cells.iter().take(col_end).skip(col_start) {
                match cell.width {
                    VtCellWide::SpacerTail | VtCellWide::SpacerHead => continue,
                    VtCellWide::Narrow | VtCellWide::Wide => {}
                }
                line.push(cell.base);
                if let Some(combining) = &cell.combining {
                    line.push_str(combining);
                }
            }
            line.truncate(line.trim_end().len());
            lines.push(line);
        }
        Some(lines.join("\n"))
    }

    fn handle_mouse_down(
        &mut self,
        event: &MouseDownEvent,
        origin: Point<Pixels>,
        scale: f32,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) {
        self.focus_handle.focus(window, cx);
        if event.button == MouseButton::Left {
            self.left_button_down = true;
        }

        // Shift bypasses mouse reporting for local selection (xterm/ghostty
        // convention).
        if !event.modifiers.shift
            && self.model.mouse_tracking()
            && let Some(button) = vt_mouse_button(event.button)
        {
            let (x, y) = self.device_position(event.position, origin, scale);
            let sent = self.model.send_mouse(
                &VtMouseInput {
                    action: VtMouseAction::Press,
                    button: Some(button),
                    mods: vt_mods(&event.modifiers),
                    x,
                    y,
                },
                true,
            );
            if sent && event.button == MouseButton::Left {
                self.reporting_drag = true;
            }
            if self.selection.take().is_some() {
                cx.notify();
            }
            self.drag = None;
            return;
        }

        if event.button != MouseButton::Left {
            return;
        }
        let cell = self.grid_cell(event.position, origin);
        match event.click_count {
            1 => {
                self.selection = None;
                self.drag = Some(SelectionDrag {
                    mode: SelectMode::Cell,
                    anchor: cell,
                });
            }
            2 => {
                self.drag = Some(SelectionDrag {
                    mode: SelectMode::Word,
                    anchor: cell,
                });
                self.selection = self
                    .frame
                    .as_ref()
                    .map(|frame| word_selection(frame, cell, cell));
            }
            _ => {
                self.drag = Some(SelectionDrag {
                    mode: SelectMode::Line,
                    anchor: cell,
                });
                self.selection = self
                    .frame
                    .as_ref()
                    .map(|frame| line_selection(frame, cell.0, cell.0));
            }
        }
        cx.notify();
    }

    fn handle_mouse_move(
        &mut self,
        event: &MouseMoveEvent,
        origin: Point<Pixels>,
        scale: f32,
        hovered: bool,
        cx: &mut Context<Self>,
    ) {
        if self.reporting_drag && event.pressed_button == Some(MouseButton::Left) {
            let (x, y) = self.device_position(event.position, origin, scale);
            self.model.send_mouse(
                &VtMouseInput {
                    action: VtMouseAction::Motion,
                    button: Some(VtMouseButton::Left),
                    mods: vt_mods(&event.modifiers),
                    x,
                    y,
                },
                true,
            );
            return;
        }

        if self.drag.is_some() && event.pressed_button == Some(MouseButton::Left) {
            let cell = self.grid_cell(event.position, origin);
            self.extend_selection(cell);
            cx.notify();
            return;
        }

        // Buttonless hover motion only reports in any-event tracking; the
        // encoder filters it out for other modes.
        if hovered
            && event.pressed_button.is_none()
            && !event.modifiers.shift
            && self.model.mouse_tracking()
        {
            let (x, y) = self.device_position(event.position, origin, scale);
            self.model.send_mouse(
                &VtMouseInput {
                    action: VtMouseAction::Motion,
                    button: None,
                    mods: vt_mods(&event.modifiers),
                    x,
                    y,
                },
                false,
            );
        }
    }

    fn handle_mouse_up(
        &mut self,
        event: &MouseUpEvent,
        origin: Point<Pixels>,
        scale: f32,
        _cx: &mut Context<Self>,
    ) {
        if event.button == MouseButton::Left {
            self.left_button_down = false;
        }
        // A press that went to the PTY gets its matching release even if
        // modes changed mid-drag; other buttons release per current mode.
        let route_release = if event.button == MouseButton::Left {
            self.reporting_drag
        } else {
            !event.modifiers.shift && self.model.mouse_tracking()
        };
        if route_release && let Some(button) = vt_mouse_button(event.button) {
            let (x, y) = self.device_position(event.position, origin, scale);
            self.model.send_mouse(
                &VtMouseInput {
                    action: VtMouseAction::Release,
                    button: Some(button),
                    mods: vt_mods(&event.modifiers),
                    x,
                    y,
                },
                false,
            );
        }
        if event.button == MouseButton::Left {
            self.reporting_drag = false;
            self.drag = None;
        }
    }

    fn handle_wheel(
        &mut self,
        event: &ScrollWheelEvent,
        origin: Point<Pixels>,
        scale: f32,
        cx: &mut Context<Self>,
    ) {
        let line_height = self
            .cached_metrics
            .map(|metrics| metrics.line_height)
            .unwrap_or(px(16.));
        let lines = match event.delta {
            ScrollDelta::Pixels(delta) => delta.y.as_f32() / line_height.as_f32(),
            ScrollDelta::Lines(delta) => delta.y,
        };
        eprintln!("P1D-DEBUG wheel delta={:?} lines={lines}", event.delta);
        self.wheel_accum += lines;
        let steps = self.wheel_accum.trunc() as i32;
        if steps == 0 {
            return;
        }
        self.wheel_accum -= steps as f32;

        // Shift-wheel always scrolls locally (mirrors the selection
        // override for reporting modes).
        let route = if event.modifiers.shift {
            WheelRoute::Viewport
        } else {
            self.model.wheel_route()
        };
        match route {
            WheelRoute::Report => {
                let (x, y) = self.device_position(event.position, origin, scale);
                let button = if steps > 0 {
                    VtMouseButton::WheelUp
                } else {
                    VtMouseButton::WheelDown
                };
                // Wheel reports are press-only events (xterm buttons 64/65).
                for _ in 0..steps.abs() {
                    self.model.send_mouse(
                        &VtMouseInput {
                            action: VtMouseAction::Press,
                            button: Some(button),
                            mods: vt_mods(&event.modifiers),
                            x,
                            y,
                        },
                        self.left_button_down,
                    );
                }
            }
            WheelRoute::ArrowKeys => {
                let key = if steps > 0 {
                    VtKey::ArrowUp
                } else {
                    VtKey::ArrowDown
                };
                let input = VtKeyInput {
                    action: VtKeyAction::Press,
                    key,
                    mods: 0,
                    consumed_mods: 0,
                    utf8: None,
                    unshifted_codepoint: 0,
                };
                for _ in 0..steps.abs() {
                    self.model.send_key(&input);
                }
            }
            WheelRoute::Viewport => {
                // Viewport delta: up (positive wheel) is negative rows.
                self.model
                    .scroll_viewport(VtScrollViewport::Delta(-(steps as isize)));
                self.refresh_snapshot();
                cx.notify();
            }
            WheelRoute::None => {}
        }
    }

    fn extend_selection(&mut self, cell: (u16, u16)) {
        let Some(drag) = self.drag else {
            return;
        };
        let Some(frame) = self.frame.as_ref() else {
            return;
        };
        self.selection = Some(match drag.mode {
            SelectMode::Cell => cell_selection(drag.anchor, cell),
            SelectMode::Word => word_selection(frame, drag.anchor, cell),
            SelectMode::Line => line_selection(frame, drag.anchor.0, cell.0),
        });
    }

    /// Viewport cell under a window position, clamped to the grid.
    fn grid_cell(&self, position: Point<Pixels>, origin: Point<Pixels>) -> (u16, u16) {
        let Some(metrics) = self.cached_metrics else {
            return (0, 0);
        };
        let (cols, rows) = self.model.size();
        let col = ((position.x - origin.x).as_f32() / metrics.cell_width.as_f32())
            .floor()
            .clamp(0., f32::from(cols.saturating_sub(1)));
        let row = ((position.y - origin.y).as_f32() / metrics.line_height.as_f32())
            .floor()
            .clamp(0., f32::from(rows.saturating_sub(1)));
        (row as u16, col as u16)
    }

    /// Window position -> DEVICE pixels relative to the grid origin,
    /// clamped inside the grid; matches the cell pixel sizes the model
    /// reported to the PTY so SGR-pixels reports and cell math line up.
    fn device_position(
        &self,
        position: Point<Pixels>,
        origin: Point<Pixels>,
        scale: f32,
    ) -> (f32, f32) {
        let Some(metrics) = self.cached_metrics else {
            return (0., 0.);
        };
        let (cols, rows) = self.model.size();
        let cell_width_px = ((metrics.cell_width.as_f32() * scale).round()).max(1.);
        let cell_height_px = ((metrics.line_height.as_f32() * scale).round()).max(1.);
        let x = ((position.x - origin.x).as_f32() * scale)
            .clamp(0., f32::from(cols) * cell_width_px - 1.);
        let y = ((position.y - origin.y).as_f32() * scale)
            .clamp(0., f32::from(rows) * cell_height_px - 1.);
        (x, y)
    }

    /// Build the frame layout for the element bounds: sync focus state and
    /// metrics/grid, reshape dirty rows, and lay out cursor/selection/marked
    /// text.
    fn prepaint_layout(&mut self, bounds: Bounds<Pixels>, window: &mut Window) -> TerminalLayout {
        // Focus edges send focus reports (mode 1004) and toggle the hollow
        // cursor; gpui refreshes the window on focus changes, so prepaint
        // always observes them.
        let focused = self.focus_handle.is_focused(window);
        if focused != self.focused {
            self.focused = focused;
            self.model.send_focus(focused);
        }

        let metrics = compute_cell_metrics(&self.font, window);
        if self.cached_metrics != Some(metrics) {
            self.cached_metrics = Some(metrics);
            self.row_cache.fill(None);
        }

        let cols = ((bounds.size.width / metrics.cell_width) as u16).max(1);
        let rows = ((bounds.size.height / metrics.line_height) as u16).max(1);
        let scale = window.scale_factor();
        let cell_width_px = ((metrics.cell_width.as_f32() * scale).round() as u32).max(1);
        let cell_height_px = ((metrics.line_height.as_f32() * scale).round() as u32).max(1);

        if self.frame.is_none() || (cols, rows) != self.model.size() {
            // Resize reflows the vt grid synchronously, so take the fresh
            // frame now instead of waiting for the SIGWINCH redraw wakeup.
            // Best-effort: the PTY side can only fail once the child is
            // gone, and the vt grid (which rendering reads) resizes first.
            let _ = self.model.resize(cols, rows, cell_width_px, cell_height_px);
            self.row_cache.clear();
            self.refresh_snapshot();
        }

        let Some(frame) = &self.frame else {
            return TerminalLayout {
                metrics,
                background: gpui::black().into(),
                rows: Vec::new(),
                selection_spans: Vec::new(),
                cursor: None,
                marked_text: None,
            };
        };

        // A failed snapshot after a grid change can leave the cache length
        // stale; re-align before filling so indexing below stays in bounds.
        if self.row_cache.len() != frame.rows.len() {
            self.row_cache = vec![None; frame.rows.len()];
        }
        for (index, row) in frame.rows.iter().enumerate() {
            if self.row_cache[index].is_none() {
                self.row_cache[index] = Some(Arc::new(build_row_layout(
                    row, frame, &self.font, metrics, window,
                )));
            }
        }

        TerminalLayout {
            metrics,
            background: rgb_to_hsla(frame.background),
            rows: self
                .row_cache
                .iter()
                .map(|row| row.clone().expect("row layout built above"))
                .collect(),
            selection_spans: layout_selection(self.selection, frame),
            cursor: layout_cursor(
                self.cursor_shape,
                self.focused,
                frame,
                &self.font,
                metrics,
                window,
            ),
            marked_text: layout_marked_text(
                self.marked_text.as_deref(),
                frame,
                &self.font,
                window,
            ),
        }
    }
}

impl Render for TerminalView {
    fn render(&mut self, _window: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
        TerminalElement::new(cx.entity())
    }
}

impl Focusable for TerminalView {
    fn focus_handle(&self, _cx: &App) -> FocusHandle {
        self.focus_handle.clone()
    }
}

/// IME integration: composition text renders as the `marked_text` overlay at
/// the cursor cell, commits write UTF-8 straight to the PTY, and the
/// candidate window anchors to the cursor cell via `bounds_for_range`. The
/// terminal has no addressable document, so ranges are token values.
impl EntityInputHandler for TerminalView {
    fn text_for_range(
        &mut self,
        _range: Range<usize>,
        _adjusted_range: &mut Option<Range<usize>>,
        _window: &mut Window,
        _cx: &mut Context<Self>,
    ) -> Option<String> {
        None
    }

    fn selected_text_range(
        &mut self,
        _ignore_disabled_input: bool,
        _window: &mut Window,
        _cx: &mut Context<Self>,
    ) -> Option<UTF16Selection> {
        // A zero caret keeps the IME anchored at "insertion point" state.
        Some(UTF16Selection {
            range: 0..0,
            reversed: false,
        })
    }

    fn marked_text_range(
        &self,
        _window: &mut Window,
        _cx: &mut Context<Self>,
    ) -> Option<Range<usize>> {
        self.marked_text
            .as_ref()
            .map(|text| 0..text.encode_utf16().count())
    }

    fn unmark_text(&mut self, _window: &mut Window, cx: &mut Context<Self>) {
        if self.marked_text.take().is_some() {
            cx.notify();
        }
    }

    fn replace_text_in_range(
        &mut self,
        _range: Option<Range<usize>>,
        text: &str,
        _window: &mut Window,
        cx: &mut Context<Self>,
    ) {
        self.commit_ime_text(text, cx);
    }

    fn replace_and_mark_text_in_range(
        &mut self,
        _range: Option<Range<usize>>,
        new_text: &str,
        _new_selected_range: Option<Range<usize>>,
        _window: &mut Window,
        cx: &mut Context<Self>,
    ) {
        self.marked_text = if new_text.is_empty() {
            None
        } else {
            Some(new_text.to_string())
        };
        cx.notify();
    }

    fn bounds_for_range(
        &mut self,
        range_utf16: Range<usize>,
        element_bounds: Bounds<Pixels>,
        _window: &mut Window,
        _cx: &mut Context<Self>,
    ) -> Option<Bounds<Pixels>> {
        let metrics = self.cached_metrics?;
        let (col, row) = self.frame.as_ref()?.cursor?;
        let origin = element_bounds.origin
            + point(
                metrics.cell_width * (f32::from(col) + range_utf16.start as f32),
                metrics.line_height * f32::from(row),
            );
        Some(Bounds::new(
            origin,
            size(metrics.cell_width, metrics.line_height),
        ))
    }

    fn character_index_for_point(
        &mut self,
        _point: Point<Pixels>,
        _window: &mut Window,
        _cx: &mut Context<Self>,
    ) -> Option<usize> {
        None
    }
}

/// gpui element that fills its bounds with the terminal grid.
pub struct TerminalElement {
    terminal: Entity<TerminalView>,
}

impl TerminalElement {
    pub fn new(terminal: Entity<TerminalView>) -> Self {
        Self { terminal }
    }

    /// Register this frame's input surfaces: the IME input handler on the
    /// focus handle, key listeners on this dispatch node (focused path
    /// only), and window mouse listeners scoped by the hitbox.
    fn register_input(
        &self,
        bounds: Bounds<Pixels>,
        hitbox: &Hitbox,
        window: &mut Window,
        cx: &mut App,
    ) {
        let entity = self.terminal.clone();
        let focus_handle = entity.read(cx).focus_handle.clone();
        window.set_cursor_style(CursorStyle::IBeam, hitbox);
        window.handle_input(
            &focus_handle,
            ElementInputHandler::new(bounds, entity.clone()),
            cx,
        );

        window.on_key_event({
            let entity = entity.clone();
            move |event: &KeyDownEvent, phase, _window, cx| {
                if phase != DispatchPhase::Bubble {
                    return;
                }
                entity.update(cx, |view, cx| view.handle_key_down(event, cx));
            }
        });
        window.on_key_event({
            let entity = entity.clone();
            move |event: &KeyUpEvent, phase, _window, cx| {
                if phase != DispatchPhase::Bubble {
                    return;
                }
                entity.update(cx, |view, _cx| view.handle_key_up(event));
            }
        });

        let origin = bounds.origin;
        let scale = window.scale_factor();
        window.on_mouse_event({
            let entity = entity.clone();
            let hitbox = hitbox.clone();
            move |event: &MouseDownEvent, phase, window, cx| {
                if phase != DispatchPhase::Bubble || !hitbox.is_hovered(window) {
                    return;
                }
                entity.update(cx, |view, cx| {
                    view.handle_mouse_down(event, origin, scale, window, cx)
                });
            }
        });
        // Drags leave the hitbox, so move/up listen window-wide and the view
        // gates on its own drag state.
        window.on_mouse_event({
            let entity = entity.clone();
            let hitbox = hitbox.clone();
            move |event: &MouseMoveEvent, phase, window, cx| {
                if phase != DispatchPhase::Bubble {
                    return;
                }
                let hovered = hitbox.is_hovered(window);
                entity.update(cx, |view, cx| {
                    view.handle_mouse_move(event, origin, scale, hovered, cx)
                });
            }
        });
        window.on_mouse_event({
            let entity = entity.clone();
            move |event: &MouseUpEvent, phase, _window, cx| {
                if phase != DispatchPhase::Bubble {
                    return;
                }
                entity.update(cx, |view, cx| view.handle_mouse_up(event, origin, scale, cx));
            }
        });
        window.on_mouse_event({
            let entity = entity.clone();
            let hitbox = hitbox.clone();
            move |event: &ScrollWheelEvent, phase, window, cx| {
                if phase != DispatchPhase::Bubble {
                    return;
                }
                eprintln!(
                    "P1D-DEBUG wheel listener hovered={}",
                    hitbox.is_hovered(window)
                );
                if !hitbox.is_hovered(window) {
                    return;
                }
                entity.update(cx, |view, cx| view.handle_wheel(event, origin, scale, cx));
            }
        });
    }
}

impl IntoElement for TerminalElement {
    type Element = TerminalElement;

    fn into_element(self) -> Self::Element {
        self
    }
}

/// Prepaint output: the frame layout plus the hitbox that scopes mouse
/// listeners and the cursor style to this element's bounds.
pub struct TerminalPrepaint {
    layout: TerminalLayout,
    hitbox: Hitbox,
}

impl Element for TerminalElement {
    type RequestLayoutState = ();
    type PrepaintState = TerminalPrepaint;

    fn id(&self) -> Option<ElementId> {
        None
    }

    fn source_location(&self) -> Option<&'static std::panic::Location<'static>> {
        None
    }

    fn request_layout(
        &mut self,
        _: Option<&GlobalElementId>,
        _: Option<&gpui::InspectorElementId>,
        window: &mut Window,
        cx: &mut App,
    ) -> (LayoutId, Self::RequestLayoutState) {
        let style = Style {
            size: Size::full(),
            flex_shrink: 1.,
            ..Default::default()
        };
        (window.request_layout(style, [], cx), ())
    }

    fn prepaint(
        &mut self,
        _: Option<&GlobalElementId>,
        _: Option<&gpui::InspectorElementId>,
        bounds: Bounds<Pixels>,
        _: &mut Self::RequestLayoutState,
        window: &mut Window,
        cx: &mut App,
    ) -> Self::PrepaintState {
        let layout = self
            .terminal
            .update(cx, |view, _cx| view.prepaint_layout(bounds, window));
        // The focus handle attaches to this element's dispatch node so key
        // events only dispatch here while this terminal is focused; an
        // unfocused terminal never sees (or swallows) keys.
        let focus_handle = self.terminal.read(cx).focus_handle.clone();
        window.set_focus_handle(&focus_handle, cx);
        let hitbox = window.insert_hitbox(bounds, HitboxBehavior::Normal);
        TerminalPrepaint { layout, hitbox }
    }

    fn paint(
        &mut self,
        _: Option<&GlobalElementId>,
        _: Option<&gpui::InspectorElementId>,
        bounds: Bounds<Pixels>,
        _: &mut Self::RequestLayoutState,
        prepaint: &mut Self::PrepaintState,
        window: &mut Window,
        cx: &mut App,
    ) {
        self.register_input(bounds, &prepaint.hitbox, window, cx);
        let layout = &prepaint.layout;
        let origin = bounds.origin;
        let cell_width = layout.metrics.cell_width;
        let line_height = layout.metrics.line_height;
        let span_bounds = |row: u16, span_col: u16, span_len: u16| {
            let x = origin.x + cell_width * f32::from(span_col);
            let y = origin.y + line_height * f32::from(row);
            Bounds::new(
                point(x.floor(), y),
                size((cell_width * f32::from(span_len)).ceil(), line_height),
            )
        };

        window.paint_quad(fill(bounds, layout.background));
        window.with_content_mask(Some(ContentMask { bounds }), |window| {
            for (row, layout_row) in layout.rows.iter().enumerate() {
                for span in &layout_row.bg_spans {
                    window.paint_quad(fill(span_bounds(row as u16, span.col, span.len), span.color));
                }
            }

            for (row, span) in &layout.selection_spans {
                window.paint_quad(fill(span_bounds(*row, span.col, span.len), span.color));
            }

            for (row, layout_row) in layout.rows.iter().enumerate() {
                let y = origin.y + line_height * (row as f32);
                for run in &layout_row.runs {
                    let run_origin = point(origin.x + cell_width * f32::from(run.col), y);
                    let _ = run.shaped.paint(
                        run_origin,
                        line_height,
                        TextAlign::Left,
                        None,
                        window,
                        cx,
                    );
                }
                for span in &layout_row.overline_spans {
                    let mut overline = span_bounds(row as u16, span.col, span.len);
                    overline.size.height = px(1.);
                    window.paint_quad(fill(overline, span.color));
                }
            }

            if let Some(marked) = &layout.marked_text {
                let marked_origin = point(
                    origin.x + cell_width * f32::from(marked.col),
                    origin.y + line_height * f32::from(marked.row),
                );
                window.paint_quad(fill(
                    Bounds::new(marked_origin, size(marked.shaped.width(), line_height)),
                    marked.background,
                ));
                let _ = marked.shaped.paint(
                    marked_origin,
                    line_height,
                    TextAlign::Left,
                    None,
                    window,
                    cx,
                );
            }

            if let Some(cursor) = &layout.cursor {
                let cell_origin = point(
                    origin.x + cell_width * f32::from(cursor.col),
                    origin.y + line_height * f32::from(cursor.row),
                );
                let cursor_bounds = match cursor.shape {
                    TerminalCursorShape::Block => Bounds::new(
                        cell_origin,
                        size(cell_width * f32::from(cursor.width_cells), line_height),
                    ),
                    TerminalCursorShape::Bar => {
                        Bounds::new(cell_origin, size(px(2.), line_height))
                    }
                    TerminalCursorShape::Underline => Bounds::new(
                        point(cell_origin.x, cell_origin.y + line_height - px(2.)),
                        size(cell_width * f32::from(cursor.width_cells), px(2.)),
                    ),
                };
                if cursor.hollow {
                    window.paint_quad(outline(cursor_bounds, cursor.color, BorderStyle::Solid));
                } else {
                    window.paint_quad(fill(cursor_bounds, cursor.color));
                }
                if let Some(overlay) = &cursor.overlay {
                    let _ =
                        overlay.paint(cell_origin, line_height, TextAlign::Left, None, window, cx);
                }
            }
        });
    }
}

fn base_font(config: &TerminalFontConfig, bold: bool, italic: bool) -> Font {
    let mut font = gpui::font(config.family.clone());
    font.weight = if bold { FontWeight::BOLD } else { config.weight };
    font.style = if italic {
        FontStyle::Italic
    } else {
        FontStyle::Normal
    };
    font
}

fn compute_cell_metrics(config: &TerminalFontConfig, window: &Window) -> CellMetrics {
    let text_system = window.text_system();
    let font_id = text_system.resolve_font(&base_font(config, false, false));
    let cell_width = text_system
        .advance(font_id, config.size, 'm')
        .expect("terminal font advance for 'm'")
        .width;
    // Terminal cell height: natural font extent, matching how monospace
    // grids are conventionally sized. gpui font metrics follow the font-kit
    // sign convention where descent is negative (below baseline), so the
    // extent is ascent plus |descent|. JetBrains Mono has no line gap;
    // revisit with real font config sync in P1e.
    let ascent = text_system.ascent(font_id, config.size).as_f32();
    let descent = text_system.descent(font_id, config.size).as_f32();
    let line_height = px(ascent + descent.abs()).ceil();
    CellMetrics {
        cell_width,
        line_height,
    }
}

fn rgb_to_hsla(rgb: Rgb) -> Hsla {
    Rgba {
        r: f32::from(rgb.r) / 255.,
        g: f32::from(rgb.g) / 255.,
        b: f32::from(rgb.b) / 255.,
        a: 1.,
    }
    .into()
}

fn blend_rgb(a: Rgb, b: Rgb, factor: f32) -> Rgb {
    let mix = |x: u8, y: u8| -> u8 {
        (f32::from(x) + (f32::from(y) - f32::from(x)) * factor).round() as u8
    };
    Rgb {
        r: mix(a.r, b.r),
        g: mix(a.g, b.g),
        b: mix(a.b, b.b),
    }
}

/// Effective cell colors after defaults and attribute resolution: `inverse`
/// arrives un-applied from the snapshot and is swapped here; `faint` dims the
/// foreground toward the effective background. Returns `(fg, Option<bg>)`
/// where `None` bg means the element's default background quad shows through.
fn resolve_cell_colors(cell: &SnapshotCell, frame: &TerminalSnapshot) -> (Rgb, Option<Rgb>) {
    let mut fg = cell.fg.unwrap_or(frame.foreground);
    let mut bg = cell.bg;
    if cell.inverse {
        let inverted_bg = fg;
        fg = bg.unwrap_or(frame.background);
        bg = Some(inverted_bg);
    }
    if cell.faint {
        fg = blend_rgb(fg, bg.unwrap_or(frame.background), 0.5);
    }
    (fg, bg)
}

fn cell_text_run(
    cell: &SnapshotCell,
    fg: Rgb,
    len: usize,
    config: &TerminalFontConfig,
) -> TextRun {
    let underline = match cell.underline {
        CellUnderline::None => None,
        // gpui underlines are plain or wavy; Double/Dotted/Dashed render as
        // Single for now (P1e parity polish).
        CellUnderline::Curly => Some(GpuiUnderlineStyle {
            thickness: px(1.),
            color: Some(rgb_to_hsla(cell.underline_color.unwrap_or(fg))),
            wavy: true,
        }),
        CellUnderline::Single
        | CellUnderline::Double
        | CellUnderline::Dotted
        | CellUnderline::Dashed => Some(GpuiUnderlineStyle {
            thickness: px(1.),
            color: Some(rgb_to_hsla(cell.underline_color.unwrap_or(fg))),
            wavy: false,
        }),
    };
    let strikethrough = cell.strikethrough.then(|| StrikethroughStyle {
        thickness: px(1.),
        color: Some(rgb_to_hsla(fg)),
    });
    TextRun {
        len,
        font: base_font(config, cell.bold, cell.italic),
        color: rgb_to_hsla(fg),
        // Backgrounds paint as merged quads, not text decorations.
        background_color: None,
        underline,
        strikethrough,
    }
}

/// Whether a cell contributes no glyphs or text decorations. Its background
/// still paints via bg spans.
fn cell_is_blank(cell: &SnapshotCell) -> bool {
    cell.invisible
        || (cell.base == ' '
            && cell.combining.is_none()
            && cell.underline == CellUnderline::None
            && !cell.strikethrough)
}

fn push_span(spans: &mut Vec<CellSpan>, col: u16, color: Hsla) {
    if let Some(last) = spans.last_mut()
        && last.color == color
        && last.col + last.len == col
    {
        last.len += 1;
        return;
    }
    spans.push(CellSpan { col, len: 1, color });
}

/// Shape one row into cached layout: merged background/overline spans plus
/// batched same-style text runs with forced cell advance.
fn build_row_layout(
    row: &SnapshotRow,
    frame: &TerminalSnapshot,
    config: &TerminalFontConfig,
    metrics: CellMetrics,
    window: &mut Window,
) -> RowLayout {
    let mut bg_spans: Vec<CellSpan> = Vec::new();
    let mut overline_spans: Vec<CellSpan> = Vec::new();
    let mut runs: Vec<PositionedRun> = Vec::new();

    let mut batch_col: u16 = 0;
    let mut batch_cells: u16 = 0;
    let mut batch_text = String::new();
    let mut batch_run: Option<TextRun> = None;

    let flush = |batch_run: &mut Option<TextRun>,
                     batch_text: &mut String,
                     batch_col: u16,
                     force_width: Option<Pixels>,
                     runs: &mut Vec<PositionedRun>,
                     window: &mut Window| {
        let Some(mut run) = batch_run.take() else {
            return;
        };
        run.len = batch_text.len();
        let shaped = window.text_system().shape_line(
            SharedString::from(std::mem::take(batch_text)),
            config.size,
            std::slice::from_ref(&run),
            force_width,
        );
        runs.push(PositionedRun {
            col: batch_col,
            shaped,
        });
    };

    for (col, cell) in row.cells.iter().enumerate() {
        let col = col as u16;
        let (fg, bg) = resolve_cell_colors(cell, frame);

        // Spacer cells carry the wide char's style: include their background
        // so wide-cell backgrounds cover both columns, but never their text.
        if let Some(bg) = bg {
            push_span(&mut bg_spans, col, rgb_to_hsla(bg));
        }
        if cell.overline {
            push_span(&mut overline_spans, col, rgb_to_hsla(fg));
        }
        match cell.width {
            VtCellWide::SpacerTail | VtCellWide::SpacerHead => continue,
            VtCellWide::Narrow | VtCellWide::Wide => {}
        }
        if cell_is_blank(cell) {
            continue;
        }

        let mut cell_text = String::new();
        cell_text.push(cell.base);
        if let Some(combining) = &cell.combining {
            cell_text.push_str(combining);
        }
        let run = cell_text_run(cell, fg, cell_text.len(), config);

        if cell.width == VtCellWide::Wide {
            // Wide glyphs take two columns; forced single-cell advance would
            // misplace anything batched after them, so they run alone.
            flush(
                &mut batch_run,
                &mut batch_text,
                batch_col,
                Some(metrics.cell_width),
                &mut runs,
                window,
            );
            let shaped =
                window
                    .text_system()
                    .shape_line(SharedString::from(cell_text), config.size, &[run], None);
            runs.push(PositionedRun { col, shaped });
            continue;
        }

        let appendable = batch_run
            .as_ref()
            .is_some_and(|batch| {
                batch.font == run.font
                    && batch.color == run.color
                    && batch.underline == run.underline
                    && batch.strikethrough == run.strikethrough
            })
            && batch_col + batch_cells == col;
        if !appendable {
            flush(
                &mut batch_run,
                &mut batch_text,
                batch_col,
                Some(metrics.cell_width),
                &mut runs,
                window,
            );
            batch_col = col;
            batch_cells = 0;
            batch_run = Some(run);
        }
        batch_text.push_str(&cell_text);
        batch_cells += 1;
    }
    flush(
        &mut batch_run,
        &mut batch_text,
        batch_col,
        Some(metrics.cell_width),
        &mut runs,
        window,
    );

    RowLayout {
        bg_spans,
        overline_spans,
        runs,
    }
}

/// gpui modifiers -> vt modifier bitmask (sides unavailable from gpui).
fn vt_mods(modifiers: &Modifiers) -> VtMods {
    let mut mods: VtMods = 0;
    if modifiers.shift {
        mods |= ffi::GHOSTTY_MODS_SHIFT;
    }
    if modifiers.control {
        mods |= ffi::GHOSTTY_MODS_CTRL;
    }
    if modifiers.alt {
        mods |= ffi::GHOSTTY_MODS_ALT;
    }
    if modifiers.platform {
        mods |= ffi::GHOSTTY_MODS_SUPER;
    }
    mods
}

fn vt_mouse_button(button: MouseButton) -> Option<VtMouseButton> {
    match button {
        MouseButton::Left => Some(VtMouseButton::Left),
        MouseButton::Right => Some(VtMouseButton::Right),
        MouseButton::Middle => Some(VtMouseButton::Middle),
        _ => None,
    }
}

/// gpui keystroke -> vt physical key + unshifted codepoint. gpui reports
/// layout-resolved key names (letters already unshifted; shifted symbols
/// arrive shifted, a known encoding approximation), so single characters
/// map by identity and named keys by table. Unknown keys stay Unidentified
/// and encode through their codepoint/text.
fn keystroke_vt_key(keystroke: &Keystroke) -> (VtKey, u32) {
    let key = keystroke.key.as_str();
    let mut chars = key.chars();
    if let (Some(c), None) = (chars.next(), chars.next()) {
        let vt = match c.to_ascii_lowercase() {
            'a' => VtKey::A,
            'b' => VtKey::B,
            'c' => VtKey::C,
            'd' => VtKey::D,
            'e' => VtKey::E,
            'f' => VtKey::F,
            'g' => VtKey::G,
            'h' => VtKey::H,
            'i' => VtKey::I,
            'j' => VtKey::J,
            'k' => VtKey::K,
            'l' => VtKey::L,
            'm' => VtKey::M,
            'n' => VtKey::N,
            'o' => VtKey::O,
            'p' => VtKey::P,
            'q' => VtKey::Q,
            'r' => VtKey::R,
            's' => VtKey::S,
            't' => VtKey::T,
            'u' => VtKey::U,
            'v' => VtKey::V,
            'w' => VtKey::W,
            'x' => VtKey::X,
            'y' => VtKey::Y,
            'z' => VtKey::Z,
            '0' => VtKey::Digit0,
            '1' => VtKey::Digit1,
            '2' => VtKey::Digit2,
            '3' => VtKey::Digit3,
            '4' => VtKey::Digit4,
            '5' => VtKey::Digit5,
            '6' => VtKey::Digit6,
            '7' => VtKey::Digit7,
            '8' => VtKey::Digit8,
            '9' => VtKey::Digit9,
            '`' => VtKey::Backquote,
            '\\' => VtKey::Backslash,
            '[' => VtKey::BracketLeft,
            ']' => VtKey::BracketRight,
            ',' => VtKey::Comma,
            '=' => VtKey::Equal,
            '-' => VtKey::Minus,
            '.' => VtKey::Period,
            '\'' => VtKey::Quote,
            ';' => VtKey::Semicolon,
            '/' => VtKey::Slash,
            _ => VtKey::Unidentified,
        };
        return (vt, c as u32);
    }
    let vt = match key {
        "space" => VtKey::Space,
        "tab" => VtKey::Tab,
        "enter" => VtKey::Enter,
        "backspace" => VtKey::Backspace,
        "escape" => VtKey::Escape,
        "up" => VtKey::ArrowUp,
        "down" => VtKey::ArrowDown,
        "left" => VtKey::ArrowLeft,
        "right" => VtKey::ArrowRight,
        "pageup" => VtKey::PageUp,
        "pagedown" => VtKey::PageDown,
        "home" => VtKey::Home,
        "end" => VtKey::End,
        "delete" => VtKey::Delete,
        "insert" => VtKey::Insert,
        "f1" => VtKey::F1,
        "f2" => VtKey::F2,
        "f3" => VtKey::F3,
        "f4" => VtKey::F4,
        "f5" => VtKey::F5,
        "f6" => VtKey::F6,
        "f7" => VtKey::F7,
        "f8" => VtKey::F8,
        "f9" => VtKey::F9,
        "f10" => VtKey::F10,
        "f11" => VtKey::F11,
        "f12" => VtKey::F12,
        "f13" => VtKey::F13,
        "f14" => VtKey::F14,
        "f15" => VtKey::F15,
        "f16" => VtKey::F16,
        "f17" => VtKey::F17,
        "f18" => VtKey::F18,
        "f19" => VtKey::F19,
        "f20" => VtKey::F20,
        "f21" => VtKey::F21,
        "f22" => VtKey::F22,
        "f23" => VtKey::F23,
        "f24" => VtKey::F24,
        "f25" => VtKey::F25,
        _ => VtKey::Unidentified,
    };
    let codepoint = if vt == VtKey::Space { u32::from(' ') } else { 0 };
    (vt, codepoint)
}

/// Text the key would insert, filtered per the encoder contract: no empty
/// strings (dead keys mid-composition), no C0 controls (enter/tab arrive as
/// "\n"/"\t"), and no macOS PUA function-key codes.
fn keystroke_text(keystroke: &Keystroke) -> Option<&str> {
    let text = keystroke.key_char.as_deref()?;
    if text.is_empty()
        || text
            .chars()
            .any(|c| c.is_control() || ('\u{F700}'..='\u{F8FF}').contains(&c))
    {
        return None;
    }
    Some(text)
}

/// Cell-granularity drag: the anchor cell always stays selected; the end
/// column is exclusive.
fn cell_selection(anchor: (u16, u16), cell: (u16, u16)) -> TerminalSelection {
    if cell >= anchor {
        TerminalSelection {
            start_row: anchor.0,
            start_col: anchor.1,
            end_row: cell.0,
            end_col: cell.1 + 1,
        }
    } else {
        TerminalSelection {
            start_row: cell.0,
            start_col: cell.1,
            end_row: anchor.0,
            end_col: anchor.1 + 1,
        }
    }
}

/// Word-granularity drag: the union of the words under the anchor and the
/// current cell.
fn word_selection(frame: &TerminalSnapshot, anchor: (u16, u16), cell: (u16, u16)) -> TerminalSelection {
    let (anchor_start, anchor_end) = word_bounds(frame, anchor.0, anchor.1);
    let (cell_start, cell_end) = word_bounds(frame, cell.0, cell.1);
    if (cell.0, cell_start) >= (anchor.0, anchor_start) {
        TerminalSelection {
            start_row: anchor.0,
            start_col: anchor_start,
            end_row: cell.0,
            end_col: cell_end,
        }
    } else {
        TerminalSelection {
            start_row: cell.0,
            start_col: cell_start,
            end_row: anchor.0,
            end_col: anchor_end,
        }
    }
}

/// Line-granularity drag: whole rows between the anchor and current row.
fn line_selection(frame: &TerminalSnapshot, row_a: u16, row_b: u16) -> TerminalSelection {
    TerminalSelection {
        start_row: row_a.min(row_b),
        start_col: 0,
        end_row: row_a.max(row_b),
        end_col: frame.cols,
    }
}

/// Character classes for double-click word selection: whitespace, word
/// characters, and separator symbols each form their own runs. Path-ish
/// punctuation (./-_~) stays inside words so file paths select whole.
fn word_char_class(c: char) -> u8 {
    if c.is_whitespace() {
        return 0;
    }
    const SEPARATORS: &str = "'\"`|:;,()[]{}<>&#$*!?=";
    if SEPARATORS.contains(c) { 2 } else { 1 }
}

/// Half-open column range of the same-class run around `col`. Wide-cell
/// spacers inherit the class of their head cell.
fn word_bounds(frame: &TerminalSnapshot, row: u16, col: u16) -> (u16, u16) {
    let Some(cells) = frame.rows.get(usize::from(row)).map(|row| &row.cells) else {
        return (col, col.saturating_add(1));
    };
    if cells.is_empty() {
        return (col, col.saturating_add(1));
    }
    let col = usize::from(col).min(cells.len() - 1);
    let class_at = |index: usize| -> u8 {
        let mut index = index;
        while index > 0
            && matches!(
                cells[index].width,
                VtCellWide::SpacerTail | VtCellWide::SpacerHead
            )
        {
            index -= 1;
        }
        word_char_class(cells[index].base)
    };
    let class = class_at(col);
    let mut start = col;
    while start > 0 && class_at(start - 1) == class {
        start -= 1;
    }
    let mut end = col + 1;
    while end < cells.len() && class_at(end) == class {
        end += 1;
    }
    (start as u16, end as u16)
}

fn layout_selection(
    selection: Option<TerminalSelection>,
    frame: &TerminalSnapshot,
) -> Vec<(u16, CellSpan)> {
    let Some(selection) = selection else {
        return Vec::new();
    };
    let rows = frame.rows.len() as u16;
    if rows == 0 || frame.cols == 0 {
        return Vec::new();
    }
    let (start, end) = {
        let start = (selection.start_row, selection.start_col);
        let end = (selection.end_row, selection.end_col);
        if start <= end { (start, end) } else { (end, start) }
    };
    // Selection tint: default foreground at low alpha adapts to any theme.
    let mut color = rgb_to_hsla(frame.foreground);
    color.a = 0.25;

    let mut spans = Vec::new();
    for row in start.0..=end.0.min(rows - 1) {
        let col_start = if row == start.0 { start.1 } else { 0 };
        let col_end = if row == end.0 { end.1 } else { frame.cols };
        let col_end = col_end.min(frame.cols);
        if col_start >= col_end {
            continue;
        }
        spans.push((
            row,
            CellSpan {
                col: col_start,
                len: col_end - col_start,
                color,
            },
        ));
    }
    spans
}

fn layout_cursor(
    shape: TerminalCursorShape,
    focused: bool,
    frame: &TerminalSnapshot,
    config: &TerminalFontConfig,
    metrics: CellMetrics,
    window: &mut Window,
) -> Option<CursorLayout> {
    if !frame.cursor_visible {
        return None;
    }
    let (col, row) = frame.cursor?;
    let cell = frame
        .rows
        .get(usize::from(row))
        .and_then(|r| r.cells.get(usize::from(col)));
    let width_cells = match cell.map(|cell| cell.width) {
        Some(VtCellWide::Wide) => 2,
        _ => 1,
    };
    let color = rgb_to_hsla(frame.cursor_color.unwrap_or(frame.foreground));

    // Unfocused terminals draw a hollow block regardless of the configured
    // shape (ghostty/Zed convention) and keep the covered glyph as-is.
    if !focused {
        return Some(CursorLayout {
            col,
            row,
            width_cells,
            shape: TerminalCursorShape::Block,
            color,
            hollow: true,
            overlay: None,
        });
    }

    // Block cursors invert the glyph they cover so it stays readable.
    let overlay = match (shape, cell) {
        (TerminalCursorShape::Block, Some(cell)) if !cell_is_blank(cell) => {
            let mut text = String::new();
            text.push(cell.base);
            if let Some(combining) = &cell.combining {
                text.push_str(combining);
            }
            let run = TextRun {
                len: text.len(),
                font: base_font(config, cell.bold, cell.italic),
                color: rgb_to_hsla(frame.background),
                background_color: None,
                underline: None,
                strikethrough: None,
            };
            Some(window.text_system().shape_line(
                SharedString::from(text),
                config.size,
                &[run],
                Some(metrics.cell_width),
            ))
        }
        _ => None,
    };

    Some(CursorLayout {
        col,
        row,
        width_cells,
        shape,
        color,
        hollow: false,
        overlay,
    })
}

fn layout_marked_text(
    marked_text: Option<&str>,
    frame: &TerminalSnapshot,
    config: &TerminalFontConfig,
    window: &mut Window,
) -> Option<MarkedTextLayout> {
    let text = marked_text?.trim_end_matches('\n');
    if text.is_empty() {
        return None;
    }
    let (col, row) = frame.cursor?;
    let fg = rgb_to_hsla(frame.foreground);
    let run = TextRun {
        len: text.len(),
        font: base_font(config, false, false),
        color: fg,
        background_color: None,
        underline: Some(GpuiUnderlineStyle {
            thickness: px(1.),
            color: Some(fg),
            wavy: false,
        }),
        strikethrough: None,
    };
    let shaped = window.text_system().shape_line(
        SharedString::from(text.to_string()),
        config.size,
        &[run],
        None,
    );
    Some(MarkedTextLayout {
        col,
        row,
        shaped,
        background: rgb_to_hsla(frame.background),
    })
}
