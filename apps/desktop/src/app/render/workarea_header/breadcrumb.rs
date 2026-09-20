//! The header's leading half: the window-control reserve, the panel/navigation controls that used
//! to open the titlebar's project slot, and the project → session breadcrumb.

use gpui::FontWeight;
use gpui::IntoElement;
use gpui::ObjectFit;
use gpui::ParentElement as _;
use gpui::Styled as _;
use gpui::StyledImage as _;
use gpui::img;
use gpui::prelude::FluentBuilder as _;
use gpui::px;
use gpui_component::h_flex;

use crate::app::consts::*;
use crate::app::helpers::*;
use crate::*;

impl GhostexGpuiApp {
    /// The title of the session the breadcrumb names, taken from the sidebar snapshot's focused
    /// row so the header and the sidebar can never disagree about which session is current.
    pub(crate) fn workarea_header_session_title(&self) -> Option<String> {
        let snapshot = self.native_sidebar.snapshot.as_ref()?;
        snapshot
            .groups
            .iter()
            .flat_map(|group| group.sessions.iter())
            .find(|session| session.is_focused)
            .map(|session| {
                session
                    .display_title
                    .clone()
                    .unwrap_or_else(|| session.alias.clone())
            })
            .filter(|title| !title.trim().is_empty())
    }

    /// CDXC:Titlebar 2026-09-10 WHY:
    /// The centered header gives the left region a zero flex basis; auto-sized descendants can retain their minimum measured width and collapse the project label even with space available.
    /// Both the breadcrumb and its label must grow into the width allocated by their parent.
    pub(crate) fn render_workarea_header_breadcrumb(
        &self,
        show_compact_mode_dropdown: bool,
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
        */
        let leading_inset = if self.sidebar_collapsed {
            WINDOW_CONTROLS_LEADING_RESERVE.max(WORKAREA_HEADER_EDGE_PADDING)
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
            .child(self.render_sidebar_collapse_button(cx))
            /*
            CDXC:Navigation 2026-08-19:
            Back/Forward sit LEFT of the project name, next to the sidebar
            toggle. Placing them after the name made them slide horizontally
            every time the active project's title changed length, which is
            exactly the kind of moving target a frequently clicked control must
            not be.
            */
            .child(self.render_titlebar_navigation_history_buttons(cx))
            .when(show_compact_mode_dropdown, |this| {
                this.child(self.render_compact_mode_dropdown(cx))
            })
            // CDXC:Titlebar 2026-09-19 DECISION:
            // User: the Update button sits on the left just before the project name, after the bell and the compact view dropdown, so showing or hiding it only moves the project name and never shifts Back/Forward.
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
                            h_flex()
                                // Capped so a long project name cannot push the session title out
                                // of the breadcrumb, the way the old project slot was capped.
                                .max_w(px(210.0))
                                .min_w_0()
                                .items_center()
                                .overflow_hidden()
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
                            h_flex()
                                .min_w_0()
                                .items_center()
                                .overflow_hidden()
                                .whitespace_nowrap()
                                .text_color(titlebar_text_color())
                                .child(title),
                        )
                    }),
            )
    }
}
