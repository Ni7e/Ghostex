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

Inputs that P1d/P1e own but this element already draws: selection rects
(driven by the `selection` range stub), the IME marked-text slot, and the
cursor shape. Keyboard/mouse/IME wiring and pane integration live there, not
here.
*/

use std::sync::Arc;

use futures::StreamExt as _;

use gpui::{
    App, Bounds, ContentMask, Context, Element, ElementId, Entity, Font, FontStyle, FontWeight,
    GlobalElementId, Hsla, IntoElement, LayoutId, Pixels, Render, Rgba, ShapedLine, SharedString,
    Size, StrikethroughStyle, Style, TextAlign, TextRun, UnderlineStyle as GpuiUnderlineStyle,
    Window, fill, point, px, size,
};

use crate::ghostty_vt::{VtCellWide, VtDirty};
use crate::terminal_model::{
    Rgb, SnapshotCell, SnapshotRow, TerminalEvent, TerminalEventSink, TerminalExit, TerminalModel,
    TerminalSnapshot, TerminalSpawnConfig, UnderlineStyle as CellUnderline,
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
/// column on the end row). Rendering input only; P1d owns mouse selection
/// state and copy behavior.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct TerminalSelection {
    pub start_row: u16,
    pub start_col: u16,
    pub end_row: u16,
    pub end_col: u16,
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
    /// Selection range rendering input; P1d drives this from mouse state.
    pub selection: Option<TerminalSelection>,
    /// IME marked (pre-edit) text drawn at the cursor; P1d wires real IME.
    pub marked_text: Option<String>,
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

    /// Build the frame layout for the element bounds: sync metrics/grid,
    /// reshape dirty rows, and lay out cursor/selection/marked text.
    fn prepaint_layout(&mut self, bounds: Bounds<Pixels>, window: &mut Window) -> TerminalLayout {
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
            cursor: layout_cursor(self.cursor_shape, frame, &self.font, metrics, window),
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

/// gpui element that fills its bounds with the terminal grid.
pub struct TerminalElement {
    terminal: Entity<TerminalView>,
}

impl TerminalElement {
    pub fn new(terminal: Entity<TerminalView>) -> Self {
        Self { terminal }
    }
}

impl IntoElement for TerminalElement {
    type Element = TerminalElement;

    fn into_element(self) -> Self::Element {
        self
    }
}

impl Element for TerminalElement {
    type RequestLayoutState = ();
    type PrepaintState = TerminalLayout;

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
        self.terminal
            .update(cx, |view, _cx| view.prepaint_layout(bounds, window))
    }

    fn paint(
        &mut self,
        _: Option<&GlobalElementId>,
        _: Option<&gpui::InspectorElementId>,
        bounds: Bounds<Pixels>,
        _: &mut Self::RequestLayoutState,
        layout: &mut Self::PrepaintState,
        window: &mut Window,
        cx: &mut App,
    ) {
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
                window.paint_quad(fill(cursor_bounds, cursor.color));
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
