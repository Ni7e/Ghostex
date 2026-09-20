//! The band across the top of the workspace column, and how it is divided when a view panel is
//! open: the header row over the Agents column, the view panel's tab strip over the view panel.

use gpui::IntoElement;
use gpui::ParentElement as _;
use gpui::Styled as _;
use gpui::Window;
use gpui::div;
use gpui::prelude::FluentBuilder as _;
use gpui::px;
use gpui::relative;
use gpui_component::h_flex;

use crate::app::consts::*;
use crate::app::helpers::*;
use crate::app::model::*;
use crate::*;

impl GhostexGpuiApp {
    /// CDXC:Titlebar 2026-09-20 DECISION:
    /// User (screens 02 to 07): the header and the view panel's tab strip are one band of chrome.
    /// The header covers the sessions column and ends at the split divider, and the tab strip takes
    /// the band from there to the edge of the view panel, so Start/Open/Commit and the `⋯` menu sit
    /// over the column they act on and the tabs sit over the panel they open. This supersedes the
    /// phase 4 arrangement that stacked the strip in a second 36px row under a header spanning the
    /// whole workspace column, which cost the view a band of chrome the mockup does not draw.
    ///
    /// CDXC:Titlebar 2026-09-20 WHY:
    /// The two halves are sized by the same flex rules as the columns beneath them (the same grow
    /// ratio, `flex_basis(0)`, the same minimum widths, the same divider width between them), so
    /// they line up during a divider drag and a window resize without anyone measuring a bounds
    /// rectangle from the previous frame. Nothing here overlaps anything: the header row, the
    /// divider gap and the strip are non-overlapping siblings of one row, and only the band as a
    /// whole floats over the content beneath it, which is the overlap the user already approved.
    pub(crate) fn render_workarea_header(
        &self,
        window: &mut Window,
        cx: &mut gpui::Context<Self>,
    ) -> impl IntoElement {
        let hosts_tab_strip = self.workarea_header_hosts_view_tab_strip();
        let split_ratio = workarea_split_ratio(self.project_editor_shell.workarea_split_ratio);
        let trailing_reserve = self.workarea_header_trailing_dock_reserve(window);
        let strip_mode = self.open_view_mode().unwrap_or(TitlebarMode::Agents);
        h_flex()
            .absolute()
            .top_0()
            .left_0()
            .right_0()
            .h(px(WORKAREA_HEADER_HEIGHT))
            .items_stretch()
            // The band's own fill shows only in the gaps its children leave: the split divider's
            // column, and the width a right-docked command pane keeps for itself.
            .bg(workspace_background_color())
            .child(
                div()
                    .flex()
                    .h_full()
                    .min_h_0()
                    .when(!hosts_tab_strip, |region| region.flex_1().min_w_0())
                    .when(hosts_tab_strip, |region| {
                        region
                            .flex_grow(split_ratio)
                            .flex_shrink(1.0)
                            .flex_basis(relative(0.0))
                            .min_w(px(WORKAREA_AGENTS_COLUMN_MIN_WIDTH))
                    })
                    .child(self.render_workarea_header_row(window, cx)),
            )
            .when(hosts_tab_strip, |band| {
                band.child(
                    div()
                        .flex_shrink_0()
                        .h_full()
                        .w(px(WORKSPACE_SPLIT_HANDLE_THICKNESS)),
                )
                .child(
                    div()
                        .flex()
                        .flex_grow(1.0 - split_ratio)
                        .flex_shrink(1.0)
                        .flex_basis(relative(0.0))
                        .h_full()
                        .min_h_0()
                        .min_w(px(WORKAREA_VIEW_PANEL_MIN_WIDTH))
                        .overflow_hidden()
                        .child(self.render_view_tab_strip(strip_mode, cx)),
                )
            })
            .when(trailing_reserve > 0.0, |band| {
                band.child(div().flex_shrink_0().h_full().w(px(trailing_reserve)))
            })
    }

    /// True while the view panel is a column beside the Agents workspace, which is the only state in
    /// which the band has two halves. Expanded, the panel owns the whole workarea and there is no
    /// column boundary to line the strip up with, so the strip stays a row of its own under the
    /// header (`render_maximized_view_panel`).
    pub(crate) fn workarea_header_hosts_view_tab_strip(&self) -> bool {
        self.view_panel_open() && !self.view_panel_maximized()
    }

    /// CDXC:CommandPane 2026-09-20 WHY:
    /// A right-docked command pane is a sibling column of the whole workarea, so the band has to
    /// keep its width free or the tab strip would run on past the view panel and over the pane's own
    /// tab bar. The plan is recomputed from the same inputs `render_workspace_with_command_pane`
    /// uses, in the same frame, rather than read back from a recorded bounds rectangle.
    fn workarea_header_trailing_dock_reserve(&self, window: &Window) -> f32 {
        let workspace_width =
            command_pane_workspace_width(window, self.sidebar_width, self.sidebar_collapsed);
        match command_pane_workspace_layout_plan(
            self.command_pane.mode,
            self.command_pane.has_sessions(),
            command_pane_content_height(window),
            self.command_pane.height_ratio,
            self.command_pane_side,
            workspace_width,
            self.command_pane.width_ratio,
        ) {
            CommandPaneWorkspaceLayoutPlan::PinnedRight { panel_width } => {
                panel_width + COMMAND_PANE_SPLIT_HANDLE_THICKNESS
            }
            _ => 0.0,
        }
    }

    /// How wide the header row itself gets this frame: the whole band, minus anything a right dock
    /// reserves, minus the view panel's share of the split while the strip shares the band. The
    /// header drops its labels from this width rather than from the window's, because with a view
    /// open the labels have only the sessions column to fit in.
    pub(crate) fn workarea_header_row_width(&self, window: &Window) -> f32 {
        let band_width =
            (command_pane_workspace_width(window, self.sidebar_width, self.sidebar_collapsed)
                - self.workarea_header_trailing_dock_reserve(window))
            .max(0.0);
        if !self.workarea_header_hosts_view_tab_strip() {
            return band_width;
        }
        let split_span = (band_width - WORKSPACE_SPLIT_HANDLE_THICKNESS).max(0.0);
        let ratio = workarea_split_ratio_for_span(
            self.project_editor_shell.workarea_split_ratio,
            split_span,
        );
        split_span * ratio
    }
}
