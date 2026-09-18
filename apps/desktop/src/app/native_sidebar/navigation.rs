use gpui::prelude::FluentBuilder;
use gpui::{
    AnyElement, InteractiveElement, IntoElement, ParentElement, StatefulInteractiveElement, Styled,
    div, px,
};
use gpui_component::h_flex;
use serde_json::json;

use super::appearance::SidebarAppearance;
use crate::app::consts::*;
use crate::app::helpers::*;
use crate::*;

impl GhostexGpuiApp {
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
        h_flex()
            .w_full()
            .h(px((if footer { 35.0 } else { 34.0 }) * scale))
            .pt(px((if footer { 3.0 } else { 5.0 }) * scale))
            .pb(px((if footer { 3.0 } else { 2.0 }) * scale))
            .when(!footer, |row| row.px(px(5.0 * scale)).gap(px(4.0 * scale)))
            .when(footer, |row| {
                row.border_t_1().border_color(chrome_ink().opacity(0.12))
            })
            .flex_shrink_0()
            .text_color(titlebar_active_text_color().opacity(0.52))
            .child(
                h_flex()
                    .id(format!("native-sidebar-{label}"))
                    .flex_1()
                    .h(px((if footer { 28.0 } else { 27.0 }) * scale))
                    .min_w_0()
                    .pl(px((if footer { 12.0 } else { 7.0 }) * scale))
                    .pr(px(15.0 * scale))
                    .gap(px(11.0 * scale))
                    .cursor_default()
                    .hover(|row| row.text_color(titlebar_active_text_color()))
                    .child(titlebar_svg_icon(
                        if footer {
                            "titlebar/bolt.svg"
                        } else {
                            BROWSER_ICON_SEARCH
                        },
                        15.0 * scale,
                        titlebar_active_text_color().opacity(0.52),
                    ))
                    .child(label)
                    .child(div().flex_1())
                    .child(
                        div()
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
            .when(!footer, |row| {
                row.child(
                    div()
                        .id("native-sidebar-more")
                        .h_full()
                        .w(px(40.0 * scale))
                        .rounded(px(5.0 * scale))
                        .flex()
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
            .into_any_element()
    }
}
