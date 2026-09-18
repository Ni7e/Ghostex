use super::{appearance::SidebarAppearance, model::NativeSidebarSnapshot};
use crate::{GhostexGpuiApp, app::helpers::*};
use gpui::prelude::FluentBuilder;
use gpui::{
    AnyElement, FontWeight, InteractiveElement, IntoElement, MouseButton, ParentElement,
    StatefulInteractiveElement, Styled, div, px, relative,
};
use gpui_component::{h_flex, v_flex};
use serde_json::json;

impl GhostexGpuiApp {
    pub(crate) fn render_native_sidebar_empty(
        &self,
        snapshot: &NativeSidebarSnapshot,
        appearance: &SidebarAppearance,
        cx: &mut gpui::Context<Self>,
    ) -> AnyElement {
        let scale = appearance.scale;
        let state = &snapshot.empty_state;
        if state["loading"] == true {
            return v_flex()
                .px(px(18.0 * scale))
                .py(px(8.0 * scale))
                .gap(px(8.0 * scale))
                .children([72, 56, 64, 48, 68, 52, 60].map(|width| {
                    h_flex()
                        .h(px(28.0 * scale))
                        .gap(px(10.0 * scale))
                        .child(
                            div()
                                .size(px(16.0 * scale))
                                .rounded(px(4.0 * scale))
                                .bg(appearance.foreground),
                        )
                        .child(
                            div()
                                .w(relative(width as f32 / 100.0))
                                .h(px(12.0 * scale))
                                .rounded(px(4.0 * scale))
                                .bg(appearance.foreground),
                        )
                        .with_throttled_animation(
                            format!("sidebar-loading-{width}"),
                            std::time::Duration::from_millis(1400),
                            |row, progress| {
                                row.opacity(0.1 + 0.1 * (std::f32::consts::PI * progress).sin())
                            },
                        )
                }))
                .into_any_element();
        }
        let error = state["error"] == true;
        let add = state["canAddProject"] == true;
        let action = if error { "loadSessions" } else { "addProject" };
        let empty_menu = json!([{ "label": "Add Project", "icon": "plus", "command": {"type": "sidebarAction", "action": "addProject"} }]);
        v_flex()
            .id("native-sidebar-empty")
            .items_start()
            .flex_1()
            .w_full()
            .mt(px(8.0 * scale))
            .pl(px(18.0 * scale))
            .text_color(appearance.muted)
            .font_weight(FontWeight::MEDIUM)
            .child(state["copy"].as_str().unwrap_or_default().to_owned())
            .when(error || add, |column| {
                column.child(
                    h_flex()
                        .id("native-sidebar-empty-action")
                        .mt(px(12.0 * scale))
                        .h(px(30.0 * scale))
                        .pl(px(10.0 * scale))
                        .pr(px(12.0 * scale))
                        .gap(px(6.0 * scale))
                        .rounded(px(8.0 * scale))
                        .border_1()
                        .border_color(appearance.foreground.opacity(0.22))
                        .text_color(appearance.foreground.opacity(0.8))
                        .text_size(px(12.5 * scale))
                        .font_weight(FontWeight::SEMIBOLD)
                        .cursor_pointer()
                        .hover(|row| row.bg(appearance.hover))
                        .when(!error, |row| {
                            row.child(titlebar_svg_icon(
                                "titlebar/plus.svg",
                                14.0 * scale,
                                appearance.foreground,
                            ))
                        })
                        .child(if error {
                            "Load Sessions"
                        } else {
                            "Add Project"
                        })
                        .on_click(cx.listener(move |app, _, _, cx| {
                            cx.stop_propagation();
                            app.dispatch_native_sidebar_ui(
                                json!({"type": "sidebarAction", "action": action}),
                                cx,
                            );
                        })),
                )
            })
            .when(add, |column| {
                column.on_mouse_down(MouseButton::Right, move |event, window, cx| {
                    cx.stop_propagation();
                    Self::show_native_sidebar_menu(&empty_menu, event.position, scale, window, cx);
                })
            })
            .into_any_element()
    }
}
