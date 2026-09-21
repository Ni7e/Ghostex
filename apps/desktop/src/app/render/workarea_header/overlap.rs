//! Which column's content passes under the floating header, and the ramp that fades it out.

use gpui::IntoElement;
use gpui::Styled as _;
use gpui::div;
use gpui::px;

use crate::app::consts::*;
use crate::app::helpers::*;
use crate::*;

impl GhostexGpuiApp {
    /*
    CDXC:Titlebar 2026-09-20 WHY:
    The user's approval for the header-over-transcript overlap, and its scope, are recorded on the
    header itself in `shell.rs`; this decides which column may take it. Only GPUI-painted scrolling
    content may pass under the header: a CEF page and a libghostty terminal are AppKit child views
    of the window's content view, so they paint *over* everything GPUI draws, and a view surface, a
    React chat page or a native terminal that reached the top of the column would cover the header
    instead of fading under it. A terminal grid is also sized from its
    body, so two of its rows would sit behind the header where a full-screen TUI needs them. That
    leaves the GPUI chat transcript, which is a scrolling document, and only while the pane tab bar
    is hidden: the tab bar is chrome, and chrome under the header would be chrome the user cannot
    see or click. Every other column keeps its old top edge, one header height below the window.
    */
    fn agents_column_solo_gpui_chat(
        &self,
    ) -> Option<&gpui::Entity<crate::app::native_chat::state::NativeChatView>> {
        if self.agents_workspace_tab_bar_visible() {
            return None;
        }
        let leaves = self.agents_workspace.rendered_leaf_order();
        let [pane_id] = leaves[..] else {
            return None;
        };
        let session_id = self.agents_workspace.active_session_in_pane(pane_id)?;
        if !self.session_chat_use_gpui || !self.agents_chat_mode_sessions.contains(&session_id) {
            return None;
        }
        self.native_chat_views.get(&session_id)
    }

    pub(crate) fn agents_column_flows_under_workarea_header(&self, cx: &gpui::App) -> bool {
        self.agents_column_solo_gpui_chat()
            .is_some_and(|chat| !chat.read(cx).renders_region_above_transcript())
    }

    /// CDXC:Titlebar 2026-09-21 DECISION:
    /// User: "we should not show the mask when there's no more to scroll to". The fade only
    /// exists to show content passing under the header, so at the transcript's top, where nothing
    /// is under the header, the first message is drawn at full strength.
    pub(crate) fn workarea_header_content_fade_visible(&self, cx: &gpui::App) -> bool {
        self.agents_column_solo_gpui_chat().is_some_and(|chat| {
            let chat = chat.read(cx);
            !chat.renders_region_above_transcript() && !chat.transcript_scrolled_to_top()
        })
    }

    /// CDXC:Titlebar 2026-09-21 DECISION:
    /// User: a GPUI chat shows no background behind the header and no line under it in any of its
    /// states. So the whole band takes the chat's own surface and the pane drops its top border
    /// whenever the column is one GPUI chat, including the states that keep chrome above the
    /// transcript (the error banner, the "load earlier turns" row, the search bar, the fork
    /// button), which used to fall back to the workspace background and a hairline and read as a
    /// separate bar. Whether the transcript also scrolls *under* the row is still
    /// `agents_column_flows_under_workarea_header`; this only decides what the band looks like.
    pub(crate) fn agents_column_meets_gpui_chat(&self) -> bool {
        self.agents_column_solo_gpui_chat().is_some()
    }

    /*
    CDXC:Titlebar 2026-09-20 WHY:
    A blocking hitbox also blocks the window root's own `on_mouse_move` and `on_mouse_up`, which is
    where every resize drag and every tab drag is tracked: with the header blocking unconditionally,
    dragging a divider or a tab up into its band froze the drag and a release there never ended it.
    While one of those drags is in flight the header is not a click target anyway, so it stops
    blocking for exactly that time. It still paints over the same pixels; only the mouse passes.
    */
    pub(crate) fn workarea_header_blocks_mouse(&self) -> bool {
        !(self.resize_rail_drag_active()
            || self.workspace_tab_drag_active
            || self.command_tab_drag_active
            || self.browser_tab_drag_active
            || self.view_tab_drag.is_some())
    }

    /// The colour the header row paints, which is the colour of whatever is directly beneath it:
    /// the chat's own background over a GPUI chat column, whether its transcript passes under the
    /// row or starts below it, and the workspace background everywhere else. The fade ramp reads
    /// the same answer, so it always ramps one surface out instead of crossfading two.
    pub(crate) fn workarea_header_surface_color(&self) -> gpui::Hsla {
        if self.agents_column_meets_gpui_chat() {
            gpui_session_chat_background_color()
        } else {
            workspace_background_color()
        }
    }

    /// How far below the window's top edge a column starts: nothing when its content really does
    /// pass under the header, the header's own height when it must stay clear of it.
    pub(crate) fn workarea_header_column_top_inset(&self, flows_under_header: bool) -> f32 {
        if flows_under_header {
            0.0
        } else {
            WORKAREA_HEADER_HEIGHT
        }
    }

    /// The ramp that fades the content passing under the header, painted by the column that owns
    /// that content so it can never reach a neighbouring column's chrome. It carries no id, no
    /// listener, no hover style and no cursor, which is what keeps GPUI from giving it a hitbox at
    /// all: the transcript underneath keeps every click, drag and scroll it had. It ramps from the
    /// header's own colour, which is the chat's background here, so the strip really does fade one
    /// surface out rather than crossfade the workspace background into the chat's.
    pub(crate) fn render_workarea_header_content_fade(&self) -> impl IntoElement {
        let background = gpui_session_chat_background_color();
        div()
            .absolute()
            .top(px(WORKAREA_HEADER_HEIGHT))
            .left_0()
            .right_0()
            .h(px(WORKAREA_HEADER_FADE_HEIGHT))
            .bg(gpui::linear_gradient(
                180.0,
                gpui::linear_color_stop(background, 0.0),
                gpui::linear_color_stop(background.opacity(0.0), 1.0),
            ))
    }
}
