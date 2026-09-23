//! The header's three panel toggles: hide sidebar on the leading side, the command terminal and the
//! view panel on the trailing side.

use gpui::InteractiveElement as _;
use gpui::IntoElement;
use gpui::MouseButton;
use gpui::ParentElement as _;
use gpui::Styled as _;
use gpui::div;
use gpui::prelude::FluentBuilder as _;
use gpui::px;
use gpui_component::h_flex;
use gpui_component::tooltip::ManagedTooltipExt as _;
use gpui_component::tooltip::ManagedTooltipPlacement;

use crate::app::consts::*;
use crate::app::helpers::*;
use crate::app::model::*;
use crate::*;

pub(crate) fn header_panel_toggle_button(
    id: &'static str,
    icon: &'static str,
    size_reduction: f32,
    enabled: bool,
) -> gpui::Stateful<gpui::Div> {
    // One shape on every OS, so the sidebar's Search row can reserve the same width for its two
    // leading toggles everywhere (native_sidebar/navigation.rs).
    div()
        .id(id)
        .relative()
        .flex()
        .flex_shrink_0()
        .h(px(TITLEBAR_CONTROL_HEIGHT - size_reduction))
        .items_center()
        .justify_center()
        .px(px(TITLEBAR_BUTTON_HORIZONTAL_PADDING))
        .rounded(px(TITLEBAR_BUTTON_RADIUS))
        .cursor_default()
        // Windows: occlude the ancestor Drag hitbox so WM_NCHITTEST keeps the button in the client
        // area (see the CDXC:PlatformSupport note in action_buttons.rs).
        .when(cfg!(target_os = "windows"), |this| this.occlude())
        .when(enabled, |this| {
            this.hover(|this| this.bg(titlebar_button_hover_color()))
        })
        .child(
            div()
                .flex()
                .ml(px(TITLEBAR_SIDEBAR_COLLAPSE_ICON_LEFT_OFFSET))
                .mt(px(TITLEBAR_SIDEBAR_COLLAPSE_ICON_TOP_OFFSET))
                .items_center()
                .justify_center()
                .child(titlebar_svg_icon(
                    icon,
                    TITLEBAR_SIDEBAR_COLLAPSE_ICON_SIZE - size_reduction,
                    if enabled {
                        titlebar_active_text_color()
                    } else {
                        titlebar_disabled_text_color()
                    },
                )),
        )
}

impl GhostexGpuiApp {
    /// CDXC:Titlebar 2026-09-21 DECISION:
    /// User: the command terminal and view panel toggles never move from the top right of the app
    /// when the view panel opens or closes; with the panel open they sit right of its Expand
    /// button. So the pair is the last thing in whichever half of the band reaches the window's
    /// trailing edge: the header while the panel is closed, the view tab strip while it is open.
    pub(crate) fn render_workarea_panel_toggles(
        &self,
        cx: &mut gpui::Context<Self>,
    ) -> impl IntoElement {
        h_flex()
            .flex_shrink_0()
            .h(px(TITLEBAR_CONTROL_HEIGHT))
            .items_center()
            .gap(px(2.0))
            .child(
                // Visual-only separator: a plain div with no id and no interactivity, so it
                // registers no hitbox and the band's drag area keeps the gap.
                div()
                    .w(px(1.0))
                    .h(px(16.0))
                    .mx(px(3.0))
                    .bg(titlebar_button_border_color()),
            )
            .child(self.render_workarea_header_command_terminal_toggle(cx))
            .child(self.render_workarea_header_view_panel_toggle(cx))
    }

    pub(crate) fn render_sidebar_collapse_button(
        &self,
        cx: &mut gpui::Context<Self>,
    ) -> impl IntoElement {
        /*
        CDXC:Titlebar 2026-06-22-19:39:
        The visible sidebar toggle should match the macOS React titlebar's current flat layout-sidebar icon. Do not render the old blue circular chevron visual.

        CDXC:Sidebar 2026-06-26-10:04:
        The GPUI header sidebar button toggles the same in-shell collapsed chrome state as Cmd+B and the shared command-palette action. Collapse hides the sidebar and divider siblings without writing sidebarWidth, so the user's expanded width is restored on the next toggle.
        */
        header_panel_toggle_button(
            "ghostex-gpui-sidebar-collapse",
            TITLEBAR_ICON_LAYOUT_SIDEBAR,
            0.0,
            true,
        )
        .on_mouse_down(
            MouseButton::Left,
            cx.listener(|this, _, window, cx| {
                window.prevent_default();
                cx.stop_propagation();
                this.toggle_gpui_sidebar_collapsed(cx);
            }),
        )
        .managed_tooltip_with_placement(ManagedTooltipPlacement::Right, {
            let tooltip = titlebar_tooltip_label("Toggle sidebar", "toggleSidebarCollapsed");
            move |window, cx| titlebar_tooltip(tooltip.clone(), window, cx)
        })
    }

    /// CDXC:Workarea 2026-09-23 DECISION:
    /// User: "a new button with a chat icon to the top left that allows just toggling the agents
    /// area", called the Agents Panel, right of the Toggle sidebar button, and the Expand side
    /// panel and Expand side panel fully buttons stay "in sync with the current state as much as
    /// possible". There is one state for all three, not a fourth flag: `view_panel_maximized` (the
    /// Agents Panel is folded away) and `sidebar_collapsed`. It flips only the panel, so a fully
    /// expanded view keeps its hidden sidebar and Expand fully simply stops reading as on; the
    /// Toggle sidebar button beside it owns the sidebar. User: the button never shows as active
    /// while the panel is shown, the way Toggle sidebar never does (supersedes the 2026-09-22 lit
    /// state). Without an open view the panel is the whole workarea and there is nothing to fold
    /// it behind, so the button is disabled the way Expand is, and says so.
    pub(crate) fn render_workarea_header_agents_toggle(
        &self,
        cx: &mut gpui::Context<Self>,
    ) -> impl IntoElement {
        let enabled = self.open_view_mode().is_some();
        let tooltip = if enabled {
            titlebar_tooltip_label("Toggle Agents Panel", "expandViewPanel")
        } else {
            "Open a view to hide the Agents Panel".into()
        };
        header_panel_toggle_button(
            "ghostex-gpui-workarea-header-agents-toggle",
            TITLEBAR_ICON_MESSAGE,
            0.0,
            enabled,
        )
        .when(enabled, |this| {
            this.on_mouse_down(
                MouseButton::Left,
                cx.listener(|this, _, window, cx| {
                    window.prevent_default();
                    cx.stop_propagation();
                    this.toggle_view_panel_maximized(cx);
                }),
            )
        })
        .managed_tooltip_with_placement(ManagedTooltipPlacement::Right, move |window, cx| {
            titlebar_tooltip(tooltip.clone(), window, cx)
        })
    }

    /// CDXC:CommandPane 2026-09-20 DECISION:
    /// User: the header carries a command-terminal toggle beside the view-panel toggle, so the
    /// command pane can be opened and closed without reaching for its collapsed strip.
    pub(crate) fn render_workarea_header_command_terminal_toggle(
        &self,
        cx: &mut gpui::Context<Self>,
    ) -> impl IntoElement {
        let expanded = self.command_pane.is_expanded();
        let tooltip = titlebar_tooltip_label("Toggle bottom panel", "openCommandsPanel");
        header_panel_toggle_button(
            "ghostex-gpui-workarea-header-command-terminal-toggle",
            TITLEBAR_ICON_PANEL_BOTTOM,
            0.0,
            true,
        )
        .when(expanded, |this| this.bg(titlebar_active_segment_color()))
        .on_mouse_down(
            MouseButton::Left,
            cx.listener(|this, _, window, cx| {
                window.prevent_default();
                cx.stop_propagation();
                this.handle_command_pane_control_action(
                    CommandPaneControlAction::ToggleExpanded,
                    None,
                    window,
                    cx,
                );
            }),
        )
        .managed_tooltip_with_placement(ManagedTooltipPlacement::Left, move |window, cx| {
            titlebar_tooltip(tooltip.clone(), window, cx)
        })
    }

    /// CDXC:Workarea 2026-09-20 DECISION:
    /// User (screen 02): the header's view-panel toggle opens the tab this project last had open,
    /// the picker when it has no tabs, and closes the panel while it is open. It is never disabled,
    /// because the picker is always something to show. This supersedes the earlier rule that it
    /// opened "the first view its context offers" and went dead when there was none.
    pub(crate) fn render_workarea_header_view_panel_toggle(
        &self,
        cx: &mut gpui::Context<Self>,
    ) -> impl IntoElement {
        let open = self.view_panel_open();
        let tooltip = titlebar_tooltip_label("Toggle side panel", "toggleViewPanel");
        header_panel_toggle_button(
            "ghostex-gpui-workarea-header-view-panel-toggle",
            TITLEBAR_ICON_PANEL_RIGHT,
            0.0,
            true,
        )
        .when(open, |this| this.bg(titlebar_active_segment_color()))
        .on_mouse_down(
            MouseButton::Left,
            cx.listener(|this, _, window, cx| {
                window.prevent_default();
                cx.stop_propagation();
                this.toggle_view_panel(window, cx);
            }),
        )
        .managed_tooltip_with_placement(ManagedTooltipPlacement::Left, move |window, cx| {
            titlebar_tooltip(tooltip.clone(), window, cx)
        })
    }
}
