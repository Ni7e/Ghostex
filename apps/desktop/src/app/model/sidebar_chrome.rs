// C1 wave-3 re-cluster: sidebar drag/side/collapse/divider chrome state and geometry, moved verbatim out of the
// types1.rs..types6.rs chunk split (docs/2026-08-22/repo-restructure/SPLITS.md
// C1) into this descriptively named module per its FOLLOW-UPS.md note (pure
// move, no logic changes).

use crate::*;

#[derive(Clone, Copy)]
pub(crate) struct SidebarDragState {
    pub(crate) start_x: f32,
    pub(crate) start_width: f32,
}

/*
CDXC:CommandPane 2026-08-16:
Command pane placement is placement-only shell state sourced from shared
Settings (`commandsPanelSide`). Bottom keeps the historical pinned/collapsed
layout; Right renders the pinned pane as a workspace column with a vertical
resize rail. The collapsed footer strip stays at the bottom on both sides so
the pane remains discoverable from the same place.
*/
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum GpuiCommandPaneSide {
    Bottom,
    Right,
}

pub(crate) fn gpui_next_sidebar_collapsed_state(collapsed: bool) -> bool {
    !collapsed
}

pub(crate) fn gpui_sidebar_chrome_visible(sidebar_collapsed: bool) -> bool {
    !sidebar_collapsed
}

/// CDXC:Sidebar 2026-09-15 DECISION:
/// User: the sessions sidebar always sits on the left; the right-side placement (`sidebarSide`, Move Sidebar, `ghostex move-sidebar`) was removed as too hard to maintain.
/// The divider therefore always follows the sidebar's right edge.
pub(crate) fn gpui_sidebar_divider_x_bounds(sidebar_width: f32) -> (f32, f32) {
    (sidebar_width, sidebar_width + SIDEBAR_DIVIDER_WIDTH)
}
