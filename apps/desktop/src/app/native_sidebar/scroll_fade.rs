//! The two ramps that fade the session list out at its top and bottom edges, in place of the
//! hairlines the Search and Commands rows used to draw around it.

use gpui::prelude::FluentBuilder as _;
use gpui::{IntoElement, Styled as _, div, px};

use super::appearance::SidebarAppearance;
use crate::GhostexGpuiApp;
use crate::app::consts::*;
use crate::app::helpers::*;

impl GhostexGpuiApp {
    /*
    CDXC:Sidebar 2026-09-20 DECISION:
    User, reviewing the 2026-09-19 screens: the session list fades out at both ends the way the chat
    transcript does, and there is no rule under the Search row, above the usage strip or above the
    Commands row. The ramps are painted over the list by the wrapper that owns it, never by the rows
    around it, so a fade always ends exactly where the list does even as the strip above it changes
    height. This supersedes the 2026-09-19 rule that framed the list with a hairline at each end;
    the decision that both rows are one pixel taller is unchanged and lives in navigation.rs.

    CDXC:Sidebar 2026-09-20 WHY:
    Each ramp is a bare `div()` with a background: no id, no listener, no hover style, no cursor and
    no group, which is what keeps GPUI from giving it a hitbox at all, so the rows underneath keep
    every click, drag, hover and scroll they had. That is the same rule the work area header's fade
    follows (render/workarea_header/overlap.rs).

    CDXC:Sidebar 2026-09-20 WHY:
    The sidebar's fill is a vertical gradient, so each ramp starts from the stop nearest its own
    edge: the top ramp from the gradient's top colour, the bottom ramp from its bottom colour. One
    flat colour would have left a visible band at one end whenever custom chrome is on, and in light
    mode the two stops are the same value anyway.
    */
    pub(crate) fn render_native_sidebar_list_fade(
        &self,
        appearance: &SidebarAppearance,
        top: bool,
    ) -> impl IntoElement {
        let scale = appearance.scale;
        let (color, height) = if top {
            (
                sidebar_chrome_gradient_top_color(),
                SIDEBAR_LIST_TOP_FADE_HEIGHT,
            )
        } else {
            (
                sidebar_chrome_gradient_bottom_color(),
                SIDEBAR_LIST_BOTTOM_FADE_HEIGHT,
            )
        };
        let (first, last) = if top {
            (color, color.opacity(0.0))
        } else {
            (color.opacity(0.0), color)
        };
        div()
            .absolute()
            .left_0()
            .right_0()
            .when(top, |ramp| ramp.top_0())
            .when(!top, |ramp| ramp.bottom_0())
            .h(px(height * scale))
            .bg(gpui::linear_gradient(
                180.0,
                gpui::linear_color_stop(first, 0.0),
                gpui::linear_color_stop(last, 1.0),
            ))
    }
}
