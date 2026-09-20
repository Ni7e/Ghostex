//! The left-edge strip that arms the reveal.

use gpui::InteractiveElement as _;
use gpui::IntoElement;
use gpui::MouseMoveEvent;
use gpui::StatefulInteractiveElement as _;
use gpui::Styled as _;
use gpui::div;
use gpui::px;

use super::model::FLOATING_REVEAL_EDGE_WIDTH;
use crate::app::helpers::*;
use crate::*;

impl GhostexGpuiApp {
    /// CDXC:Sidebar 2026-09-20 DECISION:
    /// User (screen 10): "The hot zone is a real, exact edge strip, not an invisible overlay across
    /// the content." So it is a sibling of the workspace column in the body row, the width the user
    /// picked for this gesture, taken from the workarea while the sidebar is collapsed, rather than
    /// a layer over the view or a window-level pointer hook. It paints the workspace background and
    /// carries nothing but its own hover, and it is the single trigger on all three platforms:
    /// AppKit used to read the pointer's screen position against a rectangle of its own, which
    /// Wayland cannot answer at all and which would have made the gesture mean two different things
    /// on two platforms.
    pub(crate) fn render_floating_reveal_edge_strip(
        &self,
        cx: &mut gpui::Context<Self>,
    ) -> impl IntoElement {
        div()
            .id("ghostex-gpui-floating-reveal-edge")
            .flex_shrink_0()
            .w(px(FLOATING_REVEAL_EDGE_WIDTH))
            .h_full()
            .bg(workspace_background_color())
            // Hover alone is not enough: while the panel covers the strip the main window stops
            // seeing the pointer, so the strip can be left believing it is still hovered. Movement
            // is what arms the reveal, and the panel clears the flag when it closes, so coming back
            // to the edge is a fresh gesture rather than an instant re-open.
            .on_mouse_move(cx.listener(|this, _event: &MouseMoveEvent, _window, _cx| {
                this.floating_reveal.edge_hovered = true;
            }))
            .on_hover(cx.listener(|this, hovered: &bool, _window, _cx| {
                if !*hovered {
                    this.floating_reveal.edge_hovered = false;
                }
            }))
    }
}
