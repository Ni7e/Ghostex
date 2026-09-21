//! The left-edge strip that arms the reveal.

use gpui::InteractiveElement as _;
use gpui::IntoElement;
use gpui::MouseMoveEvent;
use gpui::ParentElement as _;
use gpui::StatefulInteractiveElement as _;
use gpui::Styled as _;
use gpui::div;
use gpui::prelude::FluentBuilder as _;
use gpui::px;

use super::model::FLOATING_REVEAL_EDGE_WIDTH;
use super::model::FloatingRevealContent;
use crate::app::consts::*;
use crate::app::helpers::*;
use crate::*;

impl GhostexGpuiApp {
    /// CDXC:Sidebar 2026-09-20 DECISION:
    /// User (screen 10): "The hot zone is a real, exact edge strip, not an invisible overlay across
    /// the content." So it is a sibling of the workspace column in the body row, the width the user
    /// picked for this gesture, taken from the workarea while something is folded away (at the window's
    /// edge with the sidebar collapsed, just past its divider with it docked), rather than
    /// a layer over the view or a window-level pointer hook. It paints the workspace background and
    /// carries nothing but its own hover, and it is the single trigger on all three platforms:
    /// AppKit used to read the pointer's screen position against a rectangle of its own, which
    /// Wayland cannot answer at all and which would have made the gesture mean two different things
    /// on two platforms.
    ///
    /// CDXC:Sidebar 2026-09-21 DECISION:
    /// User: the strip says what hovering it does. While only the sidebar is folded it is one zone
    /// with a right chevron in its middle. While the sessions column is folded too it is two equal
    /// zones: the top half shows a sidebar icon and floats the sidebar, the bottom half shows a
    /// chat icon and floats the sessions column. This supersedes the same-day request to drop the
    /// strip and watch the pointer over the view instead.
    pub(crate) fn render_floating_reveal_edge_strip(
        &self,
        cx: &mut gpui::Context<Self>,
    ) -> impl IntoElement {
        let sidebar_only = FloatingRevealContent {
            sidebar: true,
            agents_column: false,
        };
        let sessions_only = FloatingRevealContent {
            sidebar: false,
            agents_column: true,
        };
        let split = self.floating_reveal_available().agents_column;
        div()
            .id("ghostex-gpui-floating-reveal-edge")
            .flex()
            .flex_col()
            .flex_shrink_0()
            .w(px(FLOATING_REVEAL_EDGE_WIDTH))
            .h_full()
            .bg(workspace_background_color())
            .on_hover(cx.listener(|this, hovered: &bool, _window, _cx| {
                if !*hovered {
                    this.disarm_floating_reveal_edge();
                }
            }))
            .child(Self::render_floating_reveal_edge_zone(
                "ghostex-gpui-floating-reveal-edge-sidebar",
                if split {
                    TITLEBAR_ICON_LAYOUT_SIDEBAR
                } else {
                    "titlebar/chevron-right.svg"
                },
                sidebar_only,
                cx,
            ))
            .when(split, |this| {
                this.child(Self::render_floating_reveal_edge_zone(
                    "ghostex-gpui-floating-reveal-edge-sessions",
                    "titlebar/message.svg",
                    sessions_only,
                    cx,
                ))
            })
    }

    /// One zone of the strip. Hover alone is not enough: while the panel covers the strip the main
    /// window stops seeing the pointer, so the strip can be left believing it is still hovered.
    /// Movement is what arms the reveal, and the panel clears the flag when it closes, so coming
    /// back to the edge is a fresh gesture rather than an instant re-open.
    fn render_floating_reveal_edge_zone(
        id: &'static str,
        icon: &'static str,
        want: FloatingRevealContent,
        cx: &mut gpui::Context<Self>,
    ) -> impl IntoElement {
        div()
            .id(id)
            .flex()
            .flex_1()
            .min_h_0()
            .w_full()
            .items_center()
            .justify_center()
            .on_mouse_move(
                cx.listener(move |this, _event: &MouseMoveEvent, _window, _cx| {
                    this.arm_floating_reveal_from_strip(want);
                }),
            )
            .child(titlebar_svg_icon(
                icon,
                FLOATING_REVEAL_EDGE_WIDTH,
                titlebar_disabled_text_color(),
            ))
    }
}
