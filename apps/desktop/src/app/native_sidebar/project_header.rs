use super::drag::SidebarDropTarget;
use super::drag_source::SidebarDragSource;
use super::{appearance::SidebarAppearance, drag::SidebarDrag, model::NativeSidebarGroup};
use crate::{
    GhostexGpuiApp,
    app::{consts::*, helpers::*},
};
use gpui::prelude::FluentBuilder;
use gpui::{
    AnyElement, InteractiveElement, IntoElement, MouseButton, ParentElement,
    StatefulInteractiveElement, Styled, div, img, px,
};
use gpui_component::h_flex;
use serde_json::{Value, json};

impl GhostexGpuiApp {
    pub(crate) fn render_native_project_header(
        &self,
        group: &NativeSidebarGroup,
        hud: &Value,
        appearance: &SidebarAppearance,
        cx: &mut gpui::Context<Self>,
    ) -> AnyElement {
        let id = group.group_id.clone();
        let drop_position = self
            .native_sidebar_drop_position("targetGroupId", &id)
            .or_else(|| self.native_sidebar_drop_position("targetId", &id));
        let hover_id = id.clone();
        let drag_id = id.clone();
        let menu = group.menu.clone();
        let scale = appearance.scale;
        let hovered = self.native_sidebar.hovered_group.as_ref() == Some(&id);
        let icon_image = group
            .project_context
            .as_ref()
            .and_then(|project| {
                project
                    .get("iconDataUrl")
                    .or_else(|| project.get("discoveredIconDataUrl"))
            })
            .and_then(Value::as_str)
            .and_then(super::images::sidebar_image);
        let dragged = SidebarDrag {
            kind: "group",
            preview: super::drag::SidebarDragPreview::Row(super::row_drag::RowDragPreview {
                identity: super::row_drag::RowDragIdentity::Project {
                    image: icon_image.clone(),
                    show_icon: hud["settings"]["showProjectIcons"].as_bool() != Some(false),
                },
                appearance: appearance.clone(),
                width: px(0.0),
                pointer_x: px(0.0),
            }),
            id: id.clone(),
            title: group.title.clone(),
            scale,
        };
        let tooltip = group.title_tooltip.clone();
        let title = if let Some(editor) = self
            .native_sidebar
            .name_editor
            .as_ref()
            .filter(|editor| editor.kind == "group" && editor.id == id)
        {
            div()
                .flex_1()
                .min_w_0()
                .on_action(
                    cx.listener(|app, _: &gpui_component::input::Escape, _, cx| {
                        cx.stop_propagation();
                        app.finish_native_sidebar_rename(false, cx);
                    }),
                )
                .child(gpui_component::input::Input::new(&editor.input).h(px(24.0 * scale)))
                .into_any_element()
        } else {
            div()
                .id(format!("native-project-title-{id}"))
                .flex_1()
                .min_w_0()
                .text_ellipsis()
                .font_weight(gpui::FontWeight::LIGHT)
                .child(group.title.clone())
                .when_some(tooltip, |title, tooltip| {
                    title.when(
                        self.native_sidebar.pointer_inside
                            && self.native_sidebar.menu.is_none()
                            && !cx.has_active_drag(),
                        |row| {
                            row.tooltip_show_delay(appearance.tooltip_delay).tooltip(
                                move |window, cx| {
                                    super::tooltips::sidebar_tooltip(
                                        tooltip.clone(),
                                        scale,
                                        window,
                                        cx,
                                    )
                                },
                            )
                        },
                    )
                })
                .into_any_element()
        };
        let branch_color = group
            .collection_color
            .as_ref()
            .and_then(|color| u32::from_str_radix(color.trim_start_matches('#'), 16).ok())
            .map(gpui::rgb)
            .map(gpui::Hsla::from)
            .unwrap_or(appearance.foreground)
            .opacity(0.18);
        let mut actions = group.header_actions.clone();
        if group.show_list_toggle {
            actions.insert(0, json!({ "label": if group.expanded { "Compact" } else { "Full" }, "icon": if group.expanded { "chevron-up" } else { "chevron-down" }, "command": { "type": "toggleList", "groupId": group.storage_id } }));
        }
        h_flex()
            .id(format!("native-sidebar-project-{id}"))
            .relative()
            .h(px(30.0 * scale))
            .w_full()
            .px(px(8.0 * scale))
            .gap(px(10.0 * scale))
            .cursor_default()
            .when(group.is_stale, |row| row.opacity(0.55))
            .hover(|row| row.bg(appearance.hover))
            .when(hovered || group.collapsed, |row| {
                row.child(
                    div()
                        .absolute()
                        .left(px(-13.0 * scale))
                        .top(px(7.0 * scale))
                        .child(titlebar_svg_icon(
                            if group.collapsed {
                                COMMAND_ICON_CHEVRON_RIGHT
                            } else {
                                COMMAND_ICON_CHEVRON_DOWN
                            },
                            16.0 * scale,
                            appearance.muted,
                        )),
                )
            })
            .when(
                !hovered
                    && !group.collapsed
                    && hud["settings"]["sidebarProjectGroupStyle"]
                        .as_str()
                        .unwrap_or("branched")
                        == "branched",
                |row| {
                    row.child(
                        div()
                            .absolute()
                            .left(px(if group.collection_color.is_some() {
                                -35.0
                            } else {
                                -13.0
                            } * scale))
                            .top(px(14.0 * scale))
                            .w(px(if group.collection_color.is_some() {
                                39.0
                            } else {
                                13.0
                            } * scale))
                            .h(px(2.0 * scale))
                            .bg(branch_color),
                    )
                },
            )
            .when(
                hud["settings"]["showProjectIcons"].as_bool() != Some(false),
                |row| {
                    row.child(match icon_image {
                        Some(image) => img(image)
                            .size(px(16.0 * scale))
                            .flex_shrink_0()
                            .into_any_element(),
                        None => titlebar_svg_icon(
                            TITLEBAR_ICON_FOLDER_OPEN,
                            16.0 * scale,
                            appearance.muted,
                        )
                        .into_any_element(),
                    })
                },
            )
            .when(group.collapsed && group.is_active, |row| {
                row.bg(appearance.selected)
                    .rounded(px(5.0 * scale))
                    .child(super::decorations::selected_outline(appearance))
            })
            .when_some(drop_position, |row, position| {
                row.child(super::drag::drop_line(position, scale))
            })
            .child(title)
            .when(!hovered, |row| {
                row.children(super::project_status::project_status(
                    group, hud, appearance,
                ))
            })
            .when(hovered, |row| {
                row.child(
                    h_flex()
                        .h_full()
                        .gap(px(2.0 * scale))
                        .flex_shrink_0()
                        .children(actions.into_iter().enumerate().map(|(index, item)| {
                            let label = item["label"].as_str().unwrap_or("").to_owned();
                            let command = item.get("command").cloned();
                            let children = item.get("children").cloned();
                            let image = item["imageDataUrl"].as_str().and_then(|value| {
                                super::images::agent_image(
                                    value,
                                    item["agentIcon"].as_str(),
                                    appearance.light,
                                )
                            });
                            let glyph = match image {
                                Some(image) => img(image).size(px(14.0 * scale)).into_any_element(),
                                None => gpui::svg()
                                    .path(gpui_sidebar_command_icon_asset_path(
                                        item["icon"].as_str(),
                                    ))
                                    .size(px(14.0 * scale))
                                    .text_color(appearance.muted)
                                    .into_any_element(),
                            };
                            div()
                                .id(format!("native-project-action-{id}-{index}"))
                                .size(px(22.0 * scale))
                                .flex()
                                .items_center()
                                .justify_center()
                                .rounded(px(4.0 * scale))
                                .cursor_pointer()
                                .hover(|button| button.bg(appearance.hover))
                                .child(glyph)
                                .when(
                                    self.native_sidebar.pointer_inside
                                        && self.native_sidebar.menu.is_none()
                                        && !cx.has_active_drag(),
                                    |row| {
                                        row.tooltip_show_delay(appearance.tooltip_delay).tooltip(
                                            move |window, cx| {
                                                titlebar_tooltip(label.clone(), window, cx)
                                            },
                                        )
                                    },
                                )
                                .on_click(cx.listener(
                                    move |app, event: &gpui::ClickEvent, window, cx| {
                                        cx.stop_propagation();
                                        if let Some(children) = &children {
                                            Self::show_native_sidebar_menu(
                                                children,
                                                event.position(),
                                                scale,
                                                window,
                                                cx,
                                            );
                                        } else if let Some(command) = &command {
                                            app.dispatch_native_sidebar_ui(command.clone(), cx);
                                        }
                                    },
                                ))
                        })),
                )
            })
            .on_hover(cx.listener(move |app, hovered, _, cx| {
                if *hovered {
                    app.native_sidebar.hovered_group = Some(hover_id.clone());
                } else if app.native_sidebar.hovered_group.as_ref() == Some(&hover_id) {
                    app.native_sidebar.hovered_group = None;
                }
                cx.notify();
            }))
            .on_mouse_down(MouseButton::Right, move |event, window, cx| {
                cx.stop_propagation();
                Self::show_native_sidebar_menu(&menu, event.position, scale, window, cx);
            })
            .sidebar_drag_source(dragged, cx)
            .sidebar_drop_target("group", drag_id, None, cx)
            .on_click(cx.listener(move |app, _, _, cx| {
                cx.stop_propagation();
                app.dispatch_native_sidebar_ui(json!({"type": "toggleGroup", "groupId": id}), cx);
            }))
            .into_any_element()
    }
}
