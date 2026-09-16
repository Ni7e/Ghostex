use super::{
    appearance::SidebarAppearance,
    model::{NativeSidebarGroup, NativeSidebarSession},
};
use crate::{GhostexGpuiApp, app::helpers::*};
use gpui::prelude::FluentBuilder;
use gpui::{
    AnyElement, InteractiveElement, IntoElement, ParentElement, StatefulInteractiveElement, Styled,
    div, px,
};
use gpui_component::h_flex;
use serde_json::{Value, json};

impl GhostexGpuiApp {
    pub(crate) fn render_native_session_hover_actions(
        &self,
        group: &NativeSidebarGroup,
        session: &NativeSidebarSession,
        appearance: &SidebarAppearance,
        cx: &mut gpui::Context<Self>,
    ) -> AnyElement {
        let id = session.session_id.clone();
        let scale = appearance.scale;
        let expanded = group.hover_actions_expanded;
        let chevron = session.details.get("hoverChevron").and_then(Value::as_bool) == Some(true);
        let before = session.details.get("hoverBefore").and_then(Value::as_array);
        let after = session.details.get("hoverAfter").and_then(Value::as_array);
        let mut actions = Vec::new();
        if expanded || !chevron {
            actions.extend(before.into_iter().flatten().cloned());
        }
        if chevron && before.is_some_and(|actions| !actions.is_empty()) {
            actions.push(json!({ "label": if expanded { "Collapse actions" } else { "Expand actions" }, "icon": if expanded { "chevron-right" } else { "chevron-left" }, "expand": true }));
        }
        actions.extend(after.into_iter().flatten().cloned());
        h_flex()
            .flex_shrink_0()
            .h_full()
            .gap(px(2.0 * scale))
            .children(actions.into_iter().enumerate().map(|(index, item)| {
                let label = item["label"].as_str().unwrap_or("").to_owned();
                let command = item.get("command").cloned();
                let menu = item.get("children").cloned();
                let expand = item["expand"].as_bool() == Some(true);
                let storage_id = group.storage_id.clone();
                div()
                    .id(format!("native-sidebar-hover-{id}-{index}"))
                    .size(px(20.0 * scale))
                    .flex()
                    .items_center()
                    .justify_center()
                    .rounded(px(4.0 * scale))
                    .cursor_pointer()
                    .when(appearance.light, |item| item.bg(gpui::rgb(0xf4f4f5)))
                    .hover(|item| {
                        item.bg(if appearance.light {
                            gpui::rgb(0xe4e4e7).into()
                        } else {
                            appearance.hover
                        })
                    })
                    .child(
                        gpui::svg()
                            .path(gpui_sidebar_command_icon_asset_path(item["icon"].as_str()))
                            .size(px(14.0 * scale))
                            .text_color(appearance.muted),
                    )
                    .when(
                        self.native_sidebar.pointer_inside
                            && self.native_sidebar.menu.is_none()
                            && !cx.has_active_drag(),
                        |row| {
                            row.tooltip_show_delay(appearance.tooltip_delay).tooltip(
                                move |window, cx| titlebar_tooltip(label.clone(), window, cx),
                            )
                        },
                    )
                    .on_click(
                        cx.listener(move |app, event: &gpui::ClickEvent, window, cx| {
                            cx.stop_propagation();
                            if expand {
                                app.dispatch_native_sidebar_ui(
                                    json!({"type": "toggleHoverActions", "groupId": storage_id}),
                                    cx,
                                );
                            } else if let Some(menu) = &menu {
                                Self::show_native_sidebar_menu(
                                    menu,
                                    event.position(),
                                    scale,
                                    window,
                                    cx,
                                );
                            } else if let Some(command) = &command {
                                app.dispatch_native_sidebar_ui(command.clone(), cx);
                            }
                        }),
                    )
            }))
            .into_any_element()
    }
}
