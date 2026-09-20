// Cluster: the shared grab strip, hover line, and pane outline segments used by every resize rail.

use gpui::Animation;
use gpui::AnimationExt as _;
use gpui::AnyElement;
use gpui::Div;
use gpui::ElementId;
use gpui::Hsla;
use gpui::InteractiveElement as _;
use gpui::IntoElement;
use gpui::ParentElement;
use gpui::Stateful;
use gpui::Styled;
use gpui::deferred;
use gpui::div;
use gpui::px;

use crate::app::consts::*;
use crate::app::helpers::*;
use crate::app::model::*;
use crate::*;

/// Which side of its rail a grab strip covers, named in layout order: `Leading` is the left or top
/// neighbour, `Trailing` the right or bottom one.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum ResizeRailGrabSide {
    Straddle,
    Leading,
    Trailing,
}

/// The sides of a pane that touch a resize rail. The pane leaves its own border off those sides so the
/// rail is the only line there.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub(crate) struct RailFacingEdges {
    pub(crate) left: bool,
    pub(crate) right: bool,
    pub(crate) top: bool,
    pub(crate) bottom: bool,
}

impl RailFacingEdges {
    /// The edges the first and second child of a split inherit: each keeps its parent's outer edges and
    /// gains the one that touches the split's own rail.
    pub(crate) fn for_split_children(self, axis: WorkspaceSplitAxis) -> (Self, Self) {
        match axis {
            WorkspaceSplitAxis::Horizontal => (
                Self {
                    right: true,
                    ..self
                },
                Self { left: true, ..self },
            ),
            WorkspaceSplitAxis::Vertical => (
                Self {
                    bottom: true,
                    ..self
                },
                Self { top: true, ..self },
            ),
        }
    }
}

fn resize_rail_strip_leading_reach(side: ResizeRailGrabSide) -> f32 {
    match side {
        ResizeRailGrabSide::Straddle => RESIZE_RAIL_GRAB_REACH,
        ResizeRailGrabSide::Leading => RESIZE_RAIL_GRAB_ONE_SIDED_REACH,
        ResizeRailGrabSide::Trailing => 0.0,
    }
}

fn resize_rail_strip_trailing_reach(side: ResizeRailGrabSide) -> f32 {
    match side {
        ResizeRailGrabSide::Straddle => RESIZE_RAIL_GRAB_REACH,
        ResizeRailGrabSide::Leading => 0.0,
        ResizeRailGrabSide::Trailing => RESIZE_RAIL_GRAB_ONE_SIDED_REACH,
    }
}

/// CDXC:Workarea 2026-09-19 DECISION:
/// User: rails should be catchable without hovering exactly on the line, the way Waku's are, and the earlier rule that the visible divider must be the only grab target no longer applies to resize rails.
/// The strip is an invisible child of the 1px rail that reaches a few pixels into the neighbouring panes. It is drawn deferred so it sits above both panes (the terminal element blocks the mouse for anything under it) and escapes the split containers' clipping. A CEF page is a native view above the GPUI scene, so the strip never receives the mouse over one; callers whose rail touches a CEF page on one side pass `Leading` or `Trailing` to put the whole strip on the GPUI-painted side, which is what Waku does next to its webview.
///
/// CDXC:Workarea 2026-09-19 WHY:
/// The strip blocks the mouse for what is under it only while no resize drag is running. Every drag is driven by the root element's mouse-move listener, and GPUI delivers a move to an element only while its hitbox counts as hovered, which a blocking hitbox above it prevents. A strip that kept blocking during its own drag swallowed every move made while the pointer was still inside it, so dragging towards the strip's side did nothing.
pub(crate) fn resize_rail_grab_strip(
    id: impl Into<ElementId>,
    axis: WorkspaceSplitAxis,
    side: ResizeRailGrabSide,
    resize_drag_active: bool,
) -> Stateful<Div> {
    let leading = resize_rail_strip_leading_reach(side);
    let extent =
        leading + WORKSPACE_SPLIT_HANDLE_THICKNESS + resize_rail_strip_trailing_reach(side);
    let strip = div().id(id).absolute();
    let strip = if resize_drag_active {
        strip
    } else {
        strip.occlude()
    };
    match axis {
        WorkspaceSplitAxis::Horizontal => strip
            .top_0()
            .bottom_0()
            .left(px(-leading))
            .w(px(extent))
            .cursor_ew_resize(),
        WorkspaceSplitAxis::Vertical => strip
            .left_0()
            .right_0()
            .top(px(-leading))
            .h(px(extent))
            .cursor_ns_resize(),
    }
}

/// The accent line a hovered or dragged rail shows, as a child of its grab strip. It covers the rail
/// plus one pixel beside it, on the strip's own side when the strip is one-sided so the extra pixel is
/// never hidden under a CEF page.
pub(crate) fn resize_rail_hover_line(
    animation_id: impl Into<ElementId>,
    axis: WorkspaceSplitAxis,
    side: ResizeRailGrabSide,
) -> impl IntoElement {
    let rail_offset = resize_rail_strip_leading_reach(side);
    let extra = SIDEBAR_DIVIDER_HOVER_LINE_WIDTH - WORKSPACE_SPLIT_HANDLE_THICKNESS;
    let offset = match side {
        ResizeRailGrabSide::Leading => rail_offset - extra,
        ResizeRailGrabSide::Straddle | ResizeRailGrabSide::Trailing => rail_offset,
    };
    let line = div().absolute().bg(sidebar_divider_hover_line_color());
    let line = match axis {
        WorkspaceSplitAxis::Horizontal => line
            .top_0()
            .bottom_0()
            .left(px(offset))
            .w(px(SIDEBAR_DIVIDER_HOVER_LINE_WIDTH)),
        WorkspaceSplitAxis::Vertical => line
            .left_0()
            .right_0()
            .top(px(offset))
            .h(px(SIDEBAR_DIVIDER_HOVER_LINE_WIDTH)),
    };
    line.with_animation(
        animation_id,
        Animation::new(SIDEBAR_DIVIDER_HOVER_FADE_DURATION).with_easing(gpui::ease_out_quint()),
        |line, delta| line.opacity(delta),
    )
}

/// Wraps a finished grab strip for its rail. Priority 0 keeps it under every menu and popup, which
/// all draw at priority 1 or higher.
pub(crate) fn resize_rail_deferred_strip(strip: impl IntoElement) -> AnyElement {
    deferred(strip.into_any_element()).into_any_element()
}

/// A pane with a focus or attention outline closes it over the rails it touches, because it has no
/// border of its own on those sides. Each segment is one rail thickness wide, sits just outside the
/// pane, and spans the pane's full outer length including the borders it does have.
pub(crate) fn resize_rail_outline_segments(edges: RailFacingEdges, color: Hsla) -> Vec<AnyElement> {
    let thickness = WORKSPACE_SPLIT_HANDLE_THICKNESS;
    let inset = |faces_rail: bool| if faces_rail { 0.0 } else { -1.0 };
    let mut segments = Vec::new();
    let mut vertical = |at_left: bool| {
        let segment = div()
            .absolute()
            .top(px(inset(edges.top)))
            .bottom(px(inset(edges.bottom)))
            .w(px(thickness))
            .bg(color);
        let segment = if at_left {
            segment.left(px(-thickness))
        } else {
            segment.right(px(-thickness))
        };
        segments.push(deferred(segment.into_any_element()).into_any_element());
    };
    if edges.left {
        vertical(true);
    }
    if edges.right {
        vertical(false);
    }
    let mut horizontal = |at_top: bool| {
        let segment = div()
            .absolute()
            .left(px(inset(edges.left)))
            .right(px(inset(edges.right)))
            .h(px(thickness))
            .bg(color);
        let segment = if at_top {
            segment.top(px(-thickness))
        } else {
            segment.bottom(px(-thickness))
        };
        segments.push(deferred(segment.into_any_element()).into_any_element());
    };
    if edges.top {
        horizontal(true);
    }
    if edges.bottom {
        horizontal(false);
    }
    segments
}

/// Gives a pane its one-pixel border on every side that does not touch a resize rail, and closes a
/// non-neutral outline over the rails on the sides that do. Border widths depend only on where the pane
/// sits, never on its state, so focus and attention changes cannot move the pane's content box.
pub(crate) fn rail_aware_pane_border<E: Styled + ParentElement>(
    pane: E,
    edges: RailFacingEdges,
    color: Hsla,
    neutral_color: Hsla,
) -> E {
    let mut pane = pane.border_color(color);
    if !edges.left {
        pane = pane.border_l_1();
    }
    if !edges.right {
        pane = pane.border_r_1();
    }
    if !edges.top {
        pane = pane.border_t_1();
    }
    if !edges.bottom {
        pane = pane.border_b_1();
    }
    if color != neutral_color {
        pane = pane.children(resize_rail_outline_segments(edges, color));
    }
    pane
}

impl GhostexGpuiApp {
    /// Whether any resize rail is being dragged right now.
    pub(crate) fn resize_rail_drag_active(&self) -> bool {
        self.sidebar_drag.is_some()
            || self.workspace_split_drag.is_some()
            || self.command_split_drag.is_some()
            || self.browser_split_drag.is_some()
            || self.workarea_split_drag.is_some()
            || self.command_pane.resize_drag.is_some()
    }
}
