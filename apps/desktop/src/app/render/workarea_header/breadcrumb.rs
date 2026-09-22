//! The header's leading half: the window-control reserve, the panel/navigation controls that used
//! to open the titlebar's project slot, and the project → session breadcrumb.

use gpui::FontWeight;
use gpui::IntoElement;
use gpui::ObjectFit;
use gpui::ParentElement as _;
use gpui::Styled as _;
use gpui::StyledImage as _;
use gpui::div;
use gpui::img;
use gpui::prelude::FluentBuilder as _;
use gpui::px;
use gpui_component::h_flex;

use crate::app::consts::*;
use crate::app::helpers::*;
use crate::*;

impl GhostexGpuiApp {
    /// CDXC:Titlebar 2026-09-20 DECISION:
    /// User: the breadcrumb names the project and the focused session of the sessions column, as
    /// the 2026-09-19 screens draw it. It is the open view's tab, not the breadcrumb, that says
    /// which view is on the right, so the title comes from the focused Agents pane's active tab.
    /// This supersedes the phase 2 rule that read the sidebar snapshot's focused row, which named
    /// the Browser's page ("Ghostex / Example Domain") as soon as a view took that row.
    ///
    /// CDXC:Titlebar 2026-09-20 WHY:
    /// The pane's title is the sidebar's own projection of that session (`agents_workspace.session`
    /// is written from the sidebar snapshot), so the header and the sidebar still cannot disagree
    /// about what a session is called; they only stop disagreeing about which session is current.
    pub(crate) fn workarea_header_session_title(&self) -> Option<String> {
        let workspace = &self.agents_workspace;
        let pane_id = workspace
            .focus_mode_pane
            .into_iter()
            .chain(std::iter::once(workspace.focused_pane))
            .chain(workspace.rendered_leaf_order())
            .find(|pane_id| workspace.find_leaf(*pane_id).is_some())?;
        let session_id = workspace.active_session_in_pane(pane_id)?;
        workspace
            .session(session_id)
            .map(|session| session.title.clone())
            .filter(|title| !title.trim().is_empty())
    }

    /// CDXC:Titlebar 2026-09-10 WHY:
    /// The centered header gives the left region a zero flex basis; auto-sized descendants can retain their minimum measured width and collapse the project label even with space available.
    /// Both the breadcrumb and its label must grow into the width allocated by their parent.
    pub(crate) fn render_workarea_header_breadcrumb(
        &self,
        compact: bool,
        cx: &mut gpui::Context<Self>,
    ) -> impl IntoElement {
        let project_icon = self
            .latest_sidebar_project_snapshot
            .as_ref()
            .and_then(|snapshot| snapshot.project_icon_data_url.as_deref())
            .and_then(gpui_project_icon_image_from_data_url);
        let session_title = self.workarea_header_session_title();
        // Narrow drops the project half of the breadcrumb, but never leaves the header nameless:
        // with no focused session the project name is all there is to show.
        let show_project_name = !compact || session_title.is_none();
        let show_separator = show_project_name && session_title.is_some();
        /*
        CDXC:Titlebar 2026-09-20 WHY:
        With the sidebar expanded the window's top-left belongs to the sidebar's own Search row,
        which reserves the macOS traffic lights there. Collapsed, this header is what sits in that
        corner, so it reserves them instead. Windows and Linux reserve nothing on the left; their
        caption buttons are trailing children of this same header.
        CDXC:Titlebar 2026-09-21 WHY:
        Collapsed, the reveal's edge strip sits left of this header, so the reserve is measured from
        the window edge minus that strip. Without it the sidebar toggle drew 10px right of where the
        docked sidebar's Search row draws it.
        */
        let leading_inset = if self.sidebar_collapsed {
            let strip = if self.floating_reveal_edge_strip_visible() {
                crate::app::floating_reveal::model::FLOATING_REVEAL_EDGE_WIDTH
            } else {
                0.0
            };
            (WINDOW_CONTROLS_LEADING_RESERVE - strip).max(WORKAREA_HEADER_EDGE_PADDING)
        } else {
            WORKAREA_HEADER_EDGE_PADDING
        };
        h_flex()
            .pl(px(leading_inset))
            .flex_1()
            .h(px(TITLEBAR_CONTROL_HEIGHT))
            .max_w(px(620.0))
            .min_w_0()
            .items_center()
            // On macOS the docked sidebar's Search row draws the toggle (native_sidebar/navigation.rs).
            // The docked Search row puts the button's top at 5pt, while this 36pt row centres the
            // 27pt button at 4.5pt; the half point keeps it from jumping when the sidebar collapses.
            .when(
                self.sidebar_collapsed || !cfg!(target_os = "macos"),
                |this| {
                    this.child(
                        div()
                            .relative()
                            .when(cfg!(target_os = "macos"), |this| this.top(px(0.5)))
                            .child(self.render_sidebar_collapse_button(cx)),
                    )
                },
            )
            // The sessions-column toggle sits right of the sidebar toggle, and first in the row
            // when the docked sidebar's Search row has taken that toggle.
            .child(
                div()
                    .relative()
                    .when(cfg!(target_os = "macos"), |this| this.top(px(0.5)))
                    .child(self.render_workarea_header_agents_toggle(cx)),
            )
            /*
            CDXC:Navigation 2026-08-19:
            Back/Forward sit LEFT of the project name, next to the sidebar
            toggle. Placing them after the name made them slide horizontally
            every time the active project's title changed length, which is
            exactly the kind of moving target a frequently clicked control must
            not be.
            */
            .child(self.render_titlebar_navigation_history_buttons(cx))
            // CDXC:Titlebar 2026-09-20 DECISION:
            // User: the Update button sits on the left just before the project name, so showing or hiding it only moves the project name and never shifts Back/Forward.
            // This supersedes the 2026-09-19 wording, which placed it after the compact view dropdown; the view panel's tab strip replaced that dropdown.
            .when(self.update_available || self.update_downloading, |this| {
                this.child(self.render_titlebar_update_button(cx))
            })
            .child(
                h_flex()
                    .h(px(TITLEBAR_CONTROL_HEIGHT))
                    .flex_1()
                    .min_w_0()
                    .items_center()
                    .overflow_hidden()
                    .whitespace_nowrap()
                    .px(px(3.0))
                    .ml(px(5.0))
                    // The glyphs sit high in their line box next to the icon buttons, so the label
                    // is nudged down to share the buttons' visual centre line.
                    .relative()
                    .top(px(3.0))
                    .text_size(px(13.5))
                    .line_height(px(TITLEBAR_CONTROL_HEIGHT))
                    .when_some(project_icon, |this, image| {
                        this.child(
                            img(image)
                                .size(px(16.0))
                                .mr(px(6.0))
                                .flex_shrink_0()
                                .rounded(px(4.0))
                                .object_fit(ObjectFit::Fill),
                        )
                    })
                    /*
                    CDXC:Titlebar 2026-09-20 DECISION:
                    User: the header names the project and the session as one breadcrumb, and drops
                    the project name and its slash first when the column is narrow. The project icon
                    always stays, because the sidebar no longer names the active project.
                    */
                    .when(show_project_name, |this| {
                        this.child(
                            div()
                                // Capped so a long project name cannot push the session title out
                                // of the breadcrumb, the way the old project slot was capped.
                                .max_w(px(210.0))
                                .flex_shrink_0()
                                .overflow_hidden()
                                .whitespace_nowrap()
                                .text_ellipsis()
                                .font_weight(FontWeight::SEMIBOLD)
                                .text_color(titlebar_project_text_color())
                                .child(self.project_name.clone()),
                        )
                    })
                    .when(show_separator, |this| {
                        this.child(
                            h_flex()
                                .flex_shrink_0()
                                .items_center()
                                .px(px(6.0))
                                .text_color(titlebar_disabled_text_color())
                                .child("/"),
                        )
                    })
                    .when_some(session_title, |this, title| {
                        this.child(
                            div()
                                .flex_shrink(1.0)
                                .min_w_0()
                                .overflow_hidden()
                                .whitespace_nowrap()
                                .text_ellipsis()
                                .text_color(titlebar_text_color())
                                .child(title),
                        )
                    }),
            )
    }
}
