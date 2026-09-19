use crate::app::helpers::ThrottledAnimationExt as _;
use crate::app::helpers::*;
use crate::app::model::*;
use crate::*;
use gpui::{
    AnyElement, Div, ElementId, Hsla, IntoElement, ParentElement as _, Styled as _, div, px,
    relative,
};

/// The layout a view's skeleton sketches while the view is loading.
#[derive(Clone, Copy, PartialEq, Eq)]
pub(crate) enum ViewSkeletonKind {
    /// An editor: activity bar, file tree, tab strip, indented code lines.
    Code,
    /// Docs: a document list beside a titled page of paragraphs.
    Docs,
    /// A board of columns holding cards.
    Kanban,
    /// A list of automation rows with a toolbar.
    Automate,
    /// Storybook: a story tree beside a canvas with its toolbar.
    Storybook,
    /// Any other web page: a header, a hero block, a grid of cards.
    Web,
    /// A terminal: a prompt and lines of output.
    Terminal,
}

struct SkeletonPaint {
    fill: Hsla,
    background: Hsla,
}

impl GhostexGpuiApp {
    /// CDXC:Workarea 2026-09-19 DECISION:
    /// User: every titlebar view shows a skeleton that looks nice while it is loading, instead of a "Loading …" sentence; Storybook gets whatever fits it best.
    /// Each view sketches its own layout in the shared skeleton tint and pulse, on the same background its real page paints on, so the switch from skeleton to page reads as the page filling in rather than a flash.
    pub(crate) fn view_skeleton_kind_for_mode(&self, mode: TitlebarMode) -> ViewSkeletonKind {
        match mode {
            TitlebarMode::Source => ViewSkeletonKind::Code,
            TitlebarMode::Manage => ViewSkeletonKind::Docs,
            TitlebarMode::Kanban => ViewSkeletonKind::Kanban,
            TitlebarMode::Automate => ViewSkeletonKind::Automate,
            TitlebarMode::Extension(id) if id.as_str() == "storybook" => {
                ViewSkeletonKind::Storybook
            }
            TitlebarMode::Extension(_) | TitlebarMode::Agents | TitlebarMode::Browser => {
                ViewSkeletonKind::Web
            }
        }
    }

    /// The skeleton for a workarea view, on that view's own background.
    pub(crate) fn render_view_skeleton(&self, mode: TitlebarMode) -> AnyElement {
        let light = CHROME_LIGHT_APPEARANCE.load(std::sync::atomic::Ordering::Relaxed);
        let background: Hsla = if mode == TitlebarMode::Source {
            source_view_background_color()
        } else if light {
            gpui::rgb(0xffffff).into()
        } else {
            workspace_background_color()
        };
        render_view_skeleton(
            self.view_skeleton_kind_for_mode(mode),
            format!("view-skeleton-{}", mode.element_slug()),
            background,
        )
    }
}

/// A skeleton of the given kind filling its container.
pub(crate) fn render_view_skeleton(
    kind: ViewSkeletonKind,
    id: impl Into<ElementId>,
    background: Hsla,
) -> AnyElement {
    let paint = SkeletonPaint {
        fill: chrome_color(0xe5e8ec, 0x111111)
            .opacity(crate::app::session_chat_skeleton::skeleton_tint())
            .into(),
        background,
    };
    let body = match kind {
        ViewSkeletonKind::Code => code_skeleton(&paint),
        ViewSkeletonKind::Docs => docs_skeleton(&paint),
        ViewSkeletonKind::Kanban => kanban_skeleton(&paint),
        ViewSkeletonKind::Automate => automate_skeleton(&paint),
        ViewSkeletonKind::Storybook => storybook_skeleton(&paint),
        ViewSkeletonKind::Web => web_skeleton(&paint),
        ViewSkeletonKind::Terminal => terminal_skeleton(&paint),
    };
    let body = body
        .id(id)
        .role(gpui::Role::Status)
        .aria_label("Loading…")
        .size_full()
        .min_w_0()
        .min_h_0()
        .overflow_hidden()
        .bg(paint.background);
    if gpui_macos_reduce_motion_enabled() {
        return body.into_any_element();
    }
    let (period, min) = crate::app::session_chat_skeleton::skeleton_pulse();
    body.with_throttled_animation("view-skeleton-pulse", period, move |body, frame| {
        let dip = ease_in_out(if frame < 0.5 {
            frame * 2.0
        } else {
            (1.0 - frame) * 2.0
        });
        body.opacity(1.0 - (1.0 - min) * dip)
    })
    .into_any_element()
}

fn ease_in_out(t: f32) -> f32 {
    if t < 0.5 {
        2.0 * t * t
    } else {
        1.0 - (-2.0 * t + 2.0).powi(2) / 2.0
    }
}

/// A text line: a rounded bar of the given relative width.
fn line(paint: &SkeletonPaint, width: f32, height: f32) -> Div {
    div()
        .w(relative(width))
        .h(px(height))
        .flex_shrink_0()
        .rounded_full()
        .bg(paint.fill)
}

/// A fixed-width bar, for toolbars and tabs.
fn pill(paint: &SkeletonPaint, width: f32, height: f32) -> Div {
    div()
        .w(px(width))
        .h(px(height))
        .flex_shrink_0()
        .rounded_full()
        .bg(paint.fill)
}

/// A square glyph slot.
fn glyph(paint: &SkeletonPaint, size: f32) -> Div {
    div()
        .size(px(size))
        .flex_shrink_0()
        .rounded(px(size * 0.28))
        .bg(paint.fill)
}

/// A card or panel block.
fn block(paint: &SkeletonPaint, height: f32, radius: f32) -> Div {
    div()
        .w_full()
        .h(px(height))
        .flex_shrink_0()
        .rounded(px(radius))
        .bg(paint.fill)
}

/// A column of tree rows with nesting, like a file or story tree.
fn tree(paint: &SkeletonPaint, rows: &[(u8, f32)]) -> Div {
    div()
        .flex()
        .flex_col()
        .gap(px(14.0))
        .children(rows.iter().map(|(depth, width)| {
            div()
                .flex()
                .items_center()
                .gap(px(8.0))
                .pl(px(f32::from(*depth) * 16.0))
                .child(glyph(paint, 12.0))
                .child(line(paint, *width, 10.0))
        }))
}

const CODE_LINES: [(u8, f32); 18] = [
    (0, 0.34),
    (0, 0.52),
    (0, 0.18),
    (1, 0.61),
    (1, 0.44),
    (2, 0.72),
    (2, 0.38),
    (1, 0.26),
    (0, 0.12),
    (0, 0.48),
    (1, 0.66),
    (2, 0.55),
    (2, 0.31),
    (1, 0.42),
    (0, 0.16),
    (0, 0.58),
    (1, 0.37),
    (0, 0.22),
];

fn code_skeleton(paint: &SkeletonPaint) -> Div {
    let activity = div()
        .w(px(46.0))
        .h_full()
        .flex_shrink_0()
        .flex()
        .flex_col()
        .items_center()
        .pt(px(14.0))
        .gap(px(18.0))
        .children((0..5).map(|_| glyph(paint, 22.0)));
    let sidebar = div()
        .w(px(218.0))
        .h_full()
        .flex_shrink_0()
        .flex()
        .flex_col()
        .pt(px(14.0))
        .px(px(14.0))
        .gap(px(18.0))
        .child(line(paint, 0.5, 10.0))
        .child(tree(
            paint,
            &[
                (0, 0.55),
                (1, 0.42),
                (1, 0.62),
                (2, 0.5),
                (2, 0.36),
                (1, 0.48),
                (0, 0.6),
                (1, 0.4),
                (1, 0.53),
                (0, 0.44),
                (1, 0.58),
                (1, 0.34),
            ],
        ));
    let tabs = div()
        .h(px(36.0))
        .flex_shrink_0()
        .flex()
        .items_center()
        .gap(px(6.0))
        .px(px(10.0))
        .child(pill(paint, 118.0, 18.0))
        .child(pill(paint, 92.0, 18.0))
        .child(pill(paint, 138.0, 18.0));
    let lines = div()
        .flex_1()
        .min_h_0()
        .flex()
        .flex_col()
        .gap(px(13.0))
        .pt(px(18.0))
        .pl(px(56.0))
        .pr(px(40.0))
        .children(CODE_LINES.iter().map(|(indent, width)| {
            div()
                .flex()
                .pl(px(f32::from(*indent) * 24.0))
                .child(line(paint, *width, 10.0))
        }));
    div().flex().child(activity).child(sidebar).child(
        div()
            .flex_1()
            .min_w_0()
            .h_full()
            .flex()
            .flex_col()
            .child(tabs)
            .child(lines),
    )
}

fn docs_skeleton(paint: &SkeletonPaint) -> Div {
    let list = div()
        .w(px(240.0))
        .h_full()
        .flex_shrink_0()
        .flex()
        .flex_col()
        .pt(px(16.0))
        .px(px(16.0))
        .gap(px(16.0))
        .child(pill(paint, 150.0, 26.0))
        .child(tree(
            paint,
            &[
                (0, 0.7),
                (0, 0.5),
                (1, 0.6),
                (1, 0.45),
                (0, 0.66),
                (1, 0.52),
                (0, 0.4),
                (0, 0.58),
            ],
        ));
    let paragraphs: [&[f32]; 4] = [
        &[0.96, 0.9, 0.62],
        &[0.88, 0.97, 0.93, 0.4],
        &[0.94, 0.86],
        &[0.9, 0.98, 0.7, 0.55],
    ];
    let page = div()
        .flex_1()
        .min_w_0()
        .h_full()
        .flex()
        .flex_col()
        .pt(px(36.0))
        .px(px(64.0))
        .gap(px(28.0))
        .child(line(paint, 0.42, 22.0))
        .children(paragraphs.iter().map(|widths| {
            div()
                .w_full()
                .max_w(px(760.0))
                .flex()
                .flex_col()
                .gap(px(12.0))
                .children(widths.iter().map(|width| line(paint, *width, 10.0)))
        }));
    div().flex().child(list).child(page)
}

fn kanban_skeleton(paint: &SkeletonPaint) -> Div {
    let toolbar = div()
        .h(px(48.0))
        .flex_shrink_0()
        .flex()
        .items_center()
        .gap(px(10.0))
        .px(px(20.0))
        .child(pill(paint, 130.0, 18.0))
        .child(pill(paint, 72.0, 18.0))
        .child(pill(paint, 72.0, 18.0));
    let columns: [&[f32]; 4] = [
        &[64.0, 88.0, 56.0, 72.0],
        &[80.0, 56.0, 96.0],
        &[56.0, 72.0, 64.0, 88.0, 56.0],
        &[88.0, 64.0],
    ];
    let board = div()
        .flex_1()
        .min_h_0()
        .flex()
        .gap(px(16.0))
        .px(px(20.0))
        .pt(px(8.0))
        .children(columns.iter().map(|cards| {
            div()
                .flex_1()
                .min_w_0()
                .max_w(px(320.0))
                .flex()
                .flex_col()
                .gap(px(10.0))
                .child(div().pb(px(4.0)).child(line(paint, 0.55, 12.0)))
                .children(cards.iter().map(|height| block(paint, *height, 8.0)))
        }));
    div().flex().flex_col().child(toolbar).child(board)
}

fn automate_skeleton(paint: &SkeletonPaint) -> Div {
    let toolbar = div()
        .h(px(48.0))
        .flex_shrink_0()
        .flex()
        .items_center()
        .gap(px(10.0))
        .px(px(20.0))
        .child(pill(paint, 150.0, 18.0))
        .child(pill(paint, 84.0, 18.0));
    let rows = div()
        .flex_1()
        .min_h_0()
        .flex()
        .flex_col()
        .gap(px(10.0))
        .px(px(20.0))
        .pt(px(6.0))
        .children([0.42, 0.3, 0.5, 0.36, 0.46, 0.28].into_iter().map(|width| {
            div()
                .h(px(46.0))
                .flex_shrink_0()
                .flex()
                .items_center()
                .gap(px(14.0))
                .px(px(14.0))
                .rounded(px(8.0))
                .border_1()
                .border_color(paint.fill)
                .child(glyph(paint, 22.0))
                .child(line(paint, width, 10.0))
                .child(div().flex_1())
                .child(pill(paint, 64.0, 16.0))
        }));
    div().flex().flex_col().child(toolbar).child(rows)
}

fn storybook_skeleton(paint: &SkeletonPaint) -> Div {
    let sidebar = div()
        .w(px(240.0))
        .h_full()
        .flex_shrink_0()
        .flex()
        .flex_col()
        .pt(px(14.0))
        .px(px(14.0))
        .gap(px(18.0))
        .child(
            div()
                .flex()
                .items_center()
                .gap(px(8.0))
                .child(glyph(paint, 22.0))
                .child(line(paint, 0.5, 12.0)),
        )
        .child(div().w_full().h(px(28.0)).rounded(px(6.0)).bg(paint.fill))
        .child(tree(
            paint,
            &[
                (0, 0.5),
                (1, 0.62),
                (2, 0.4),
                (2, 0.5),
                (2, 0.34),
                (1, 0.55),
                (2, 0.45),
                (0, 0.44),
                (1, 0.6),
                (2, 0.36),
                (2, 0.52),
                (1, 0.42),
            ],
        ));
    let toolbar = div()
        .h(px(40.0))
        .flex_shrink_0()
        .flex()
        .items_center()
        .gap(px(12.0))
        .px(px(14.0))
        .children((0..6).map(|_| glyph(paint, 16.0)))
        .child(div().flex_1())
        .child(glyph(paint, 16.0))
        .child(glyph(paint, 16.0));
    let canvas = div()
        .flex_1()
        .min_h_0()
        .flex()
        .flex_col()
        .items_center()
        .justify_center()
        .gap(px(18.0))
        .p(px(32.0))
        .child(
            div()
                .w(relative(0.68))
                .h(relative(0.56))
                .rounded(px(12.0))
                .bg(paint.fill),
        )
        .child(pill(paint, 160.0, 10.0));
    div().flex().child(sidebar).child(
        div()
            .flex_1()
            .min_w_0()
            .h_full()
            .flex()
            .flex_col()
            .child(toolbar)
            .child(canvas),
    )
}

fn web_skeleton(paint: &SkeletonPaint) -> Div {
    let header = div()
        .h(px(52.0))
        .flex_shrink_0()
        .flex()
        .items_center()
        .gap(px(18.0))
        .px(px(28.0))
        .child(glyph(paint, 24.0))
        .child(pill(paint, 70.0, 12.0))
        .child(pill(paint, 54.0, 12.0))
        .child(pill(paint, 62.0, 12.0))
        .child(div().flex_1())
        .child(pill(paint, 84.0, 26.0));
    let body =
        div()
            .flex_1()
            .min_h_0()
            .flex()
            .flex_col()
            .gap(px(20.0))
            .px(px(28.0))
            .pt(px(12.0))
            .child(block(paint, 128.0, 12.0))
            .child(
                div().flex().gap(px(16.0)).children(
                    (0..3).map(|_| div().flex_1().min_w_0().child(block(paint, 96.0, 10.0))),
                ),
            )
            .child(div().flex().gap(px(16.0)).children(
                (0..3).map(|_| div().flex_1().min_w_0().child(block(paint, 96.0, 10.0))),
            ));
    div().flex().flex_col().child(header).child(body)
}

fn terminal_skeleton(paint: &SkeletonPaint) -> Div {
    let rows: [(bool, f32); 8] = [
        (true, 0.32),
        (false, 0.58),
        (false, 0.41),
        (false, 0.66),
        (true, 0.24),
        (false, 0.5),
        (false, 0.37),
        (true, 0.06),
    ];
    div()
        .flex()
        .flex_col()
        .gap(px(12.0))
        .pt(px(14.0))
        .px(px(16.0))
        .children(rows.iter().map(|(prompt, width)| {
            div()
                .flex()
                .items_center()
                .gap(px(10.0))
                .when(*prompt, |row| row.child(glyph(paint, 12.0)))
                .child(line(paint, *width, 10.0))
        }))
}

use gpui::prelude::FluentBuilder as _;
