use gpui::prelude::FluentBuilder;
use gpui::{
    AnyElement, InteractiveElement, IntoElement, ParentElement, StatefulInteractiveElement, Styled,
    WindowControlArea, div, px,
};
use gpui_component::h_flex;
use gpui_component::tooltip::ManagedTooltipExt as _;
use gpui_component::tooltip::ManagedTooltipPlacement;
use serde_json::json;

use super::appearance::SidebarAppearance;
use crate::app::consts::*;
use crate::app::helpers::*;
use crate::*;

impl GhostexGpuiApp {
    /// CDXC:Sidebar 2026-09-19 DECISION:
    /// User: the Search row and the Commands row are each one pixel taller.
    /// Both rows keep those heights now that the hairlines are gone; the pixel each border used to
    /// take out of the border-box went back into the padding, so neither row's content moved.
    pub(crate) fn render_native_sidebar_navigation(
        &self,
        appearance: &SidebarAppearance,
        footer: bool,
        cx: &mut gpui::Context<Self>,
    ) -> AnyElement {
        let scale = appearance.scale;
        let label = if footer { "Commands" } else { "Search" };
        let action_id = if footer { "commands" } else { "sessions" };
        let snapshot = self
            .native_sidebar
            .snapshot
            .as_ref()
            .expect("navigation follows a snapshot");
        let shortcut = if footer {
            &snapshot.commands_shortcut
        } else {
            &snapshot.search_shortcut
        };
        let more_menu = snapshot.more_menu.clone();
        /*
        CDXC:Sidebar 2026-09-20 DECISION:
        User: with the titlebar row deleted, the sidebar's Search row is what sits in the window's
        top-left corner, so it reserves the macOS traffic lights and is the window's drag handle
        there. It does so only while the sidebar is docked: the hover-reveal panel renders this same
        row below the workarea header, where there are no lights to clear.
        CDXC:Sidebar 2026-09-20 WHY:
        macOS only. Windows and Linux keep their caption buttons as trailing children of the
        workarea header, and a Drag region here would swallow this row's own clicks there, because
        WM_NCHITTEST needs every interactive child to occlude it and the sidebar's rows do not.
        */
        let reserves_window_controls =
            cfg!(target_os = "macos") && !footer && !self.sidebar_collapsed;
        h_flex()
            .w_full()
            .h(px((if footer { 36.0 } else { 35.0 }) * scale))
            .pt(px(5.0 * scale))
            .pb(px(3.0 * scale))
            .when(!footer, |row| row.px(px(5.0 * scale)).gap(px(4.0 * scale)))
            .when(reserves_window_controls, |row| {
                row.pl(px(WINDOW_CONTROLS_LEADING_RESERVE - 7.0 * scale))
                    .window_control_area(WindowControlArea::Drag)
            })
            /*
            CDXC:Sidebar 2026-09-20 DECISION:
            User, reviewing the 2026-09-19 screens: there is no rule under the Search row and none
            above the usage strip or the Commands row. The session list fades out at both ends
            instead (native_sidebar/scroll_fade.rs), so these rows draw no border at all. This
            supersedes the 2026-09-19 rule that framed the list with a hairline at each end.
            */
            .flex_shrink_0()
            .text_color(titlebar_active_text_color().opacity(0.52))
            /*
            CDXC:Sidebar 2026-09-20 WHY:
            The sidebar can be dragged down to `SIDEBAR_MIN_WIDTH`, and this row now carries more
            than it used to: the macOS traffic-light reserve, the notification bell and the Settings
            gear. Without a clip and without fixed-size trailing controls the glyphs simply painted
            over each other there, so the label is the one thing that shrinks and is clipped, and
            everything beside it keeps its own box.
            */
            .child(
                h_flex()
                    .id(format!("native-sidebar-{label}"))
                    .flex_1()
                    .h(px((if footer { 28.0 } else { 27.0 }) * scale))
                    .min_w_0()
                    .overflow_hidden()
                    .pl(px((if footer { 12.0 } else { 7.0 }) * scale))
                    .pr(px(15.0 * scale))
                    .gap(px(11.0 * scale))
                    .cursor_default()
                    .hover(|row| row.text_color(titlebar_active_text_color()))
                    .child(
                        div()
                            .flex()
                            .flex_shrink_0()
                            .items_center()
                            .child(titlebar_svg_icon(
                                if footer {
                                    "titlebar/bolt.svg"
                                } else {
                                    BROWSER_ICON_SEARCH
                                },
                                15.0 * scale,
                                titlebar_active_text_color().opacity(0.52),
                            )),
                    )
                    .child(
                        div()
                            .min_w_0()
                            .overflow_hidden()
                            .whitespace_nowrap()
                            .child(label),
                    )
                    .child(div().flex_1())
                    .child(
                        div()
                            .flex_shrink_0()
                            .text_color(titlebar_active_text_color().opacity(0.38))
                            .text_size(px(11.0 * scale))
                            .child(shortcut.clone().unwrap_or_default()),
                    )
                    .on_click(cx.listener(move |app, _, _, cx| {
                        cx.stop_propagation();
                        app.dispatch_native_sidebar_ui(
                            json!({"type": "sidebarAction", "action": action_id}),
                            cx,
                        );
                    })),
            )
            // CDXC:Notifications 2026-09-20 DECISION:
            // User: the notification bell sits in the sidebar's top row, before the sidebar menu button.
            .when(
                !footer && self.titlebar_notification_bell_visible(),
                |row| row.child(self.render_sidebar_notification_bell(appearance, cx)),
            )
            .when(!footer, |row| {
                row.child(
                    div()
                        .id("native-sidebar-more")
                        .h_full()
                        .w(px(40.0 * scale))
                        .rounded(px(5.0 * scale))
                        .flex()
                        .flex_shrink_0()
                        .items_center()
                        .justify_center()
                        .cursor_default()
                        .hover(|row| row.bg(appearance.hover))
                        .child(titlebar_svg_icon(
                            "titlebar/menu-2.svg",
                            15.0 * scale,
                            appearance.muted,
                        ))
                        .on_click(cx.listener(move |_, event: &gpui::ClickEvent, window, cx| {
                            Self::show_native_sidebar_menu(
                                &more_menu,
                                event.position(),
                                scale,
                                window,
                                cx,
                            );
                        })),
                )
            })
            /*
            CDXC:Sidebar 2026-09-20 DECISION:
            User: Settings gets a one-click gear immediately to the right of the Commands
            row, and the Commands row keeps its full-width shape and its shortcut hint
            rather than shrinking to an icon. The sidebar menu keeps its own Settings and
            Hotkeys entries; that duplication is deliberate.
            */
            .when(footer, |row| {
                row.child(
                    div()
                        .id("native-sidebar-settings")
                        .h(px(28.0 * scale))
                        .w(px(34.0 * scale))
                        .mr(px(6.0 * scale))
                        .rounded(px(5.0 * scale))
                        .flex()
                        .flex_shrink_0()
                        .items_center()
                        .justify_center()
                        .cursor_default()
                        .hover(|row| row.bg(appearance.hover))
                        .child(titlebar_svg_icon(
                            TITLEBAR_ICON_SETTINGS,
                            15.0 * scale,
                            appearance.muted,
                        ))
                        .on_click(cx.listener(move |app, _, _, cx| {
                            cx.stop_propagation();
                            app.dispatch_native_sidebar_ui(
                                json!({"type": "sidebarAction", "action": "settings"}),
                                cx,
                            );
                        }))
                        .managed_discrete_tooltip_with_placement(
                            ManagedTooltipPlacement::Right,
                            appearance.tooltip_delay,
                            |window, cx| {
                                titlebar_tooltip(
                                    titlebar_tooltip_label("Settings", "openSettings"),
                                    window,
                                    cx,
                                )
                            },
                        ),
                )
            })
            .into_any_element()
    }
}
