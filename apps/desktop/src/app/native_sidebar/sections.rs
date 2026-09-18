use super::{
    appearance::SidebarAppearance,
    model::{NativeSidebarGroup, NativeSidebarSection},
};
use crate::{
    GhostexGpuiApp,
    app::{consts::*, helpers::*},
};
use gpui::prelude::FluentBuilder;
use gpui::{
    AnyElement, FontWeight, InteractiveElement, IntoElement, ParentElement,
    StatefulInteractiveElement, Styled, div, px, rgb,
};
use gpui_component::h_flex;
use serde_json::json;

impl GhostexGpuiApp {
    pub(crate) fn render_native_section_header(
        &self,
        group: &NativeSidebarGroup,
        section: &NativeSidebarSection,
        appearance: &SidebarAppearance,
        cx: &mut gpui::Context<Self>,
    ) -> AnyElement {
        let scale = appearance.scale;
        let storage_id = group.storage_id.clone();
        let section_id = section.id.clone();
        let key = format!("{}-{}", group.group_id, section.id);
        let hovered = self.native_sidebar.hovered_section.as_ref() == Some(&key);
        let indicator = h_flex()
            .gap(px(4.0 * scale))
            .when(section.working_count > 0, |row| {
                row.child(div().size(px(8.0 * scale)).rounded_full().bg(rgb(0xffb454)))
            })
            .when(section.attention_count > 0, |row| {
                row.child(div().size(px(8.0 * scale)).rounded_full().bg(rgb(0x95d7f6)))
            })
            .when(section.question_count > 0, |row| {
                row.child(div().size(px(8.0 * scale)).rounded_full().bg(rgb(0xf472b6)))
            })
            .when(
                section.collapsed && section.contains_active_session,
                |row| {
                    row.child(
                        div()
                            .size(px(9.0 * scale))
                            .rounded_full()
                            .border(px(1.5 * scale))
                            .border_color(chrome_color(0xa3a3a3, 0x858585)),
                    )
                },
            );
        // CDXC:Sidebar 2026-09-18 DECISION:
        // User: a section heading is exactly as wide as a session card (the same 3px insets) with the card's 5px/6px side padding, and it has bottom padding too so the label sits centred in its rounded hover fill.
        // This supersedes the 2026-09-16 rule of letting the heading run through the sidebar's right edge for the native sidebar.
        h_flex()
            .id(format!("native-sidebar-section-{key}"))
            .mx(px(3.0 * scale))
            .h(px(20.0 * scale))
            .py(px(3.0 * scale))
            .pl(px(5.0 * scale))
            .pr(px(6.0 * scale))
            .gap(px(5.0 * scale))
            .text_size(px(12.0 * scale))
            .font_weight(FontWeight::LIGHT)
            .text_color(chrome_color(0xd8d8d8, 0x292929).opacity(0.34))
            // CDXC:Sidebar 2026-09-18 DECISION: User: the section heading's hover fill has rounded corners, like the session rows; this supersedes the 2026-09-16 square-corner decision for the native sidebar.
            .rounded(px(5.0 * scale))
            .hover(|row| {
                row.bg(chrome_ink().opacity(0.06))
                    .text_color(chrome_color(0xd8d8d8, 0x292929).opacity(0.58))
            })
            .child(section.id.to_uppercase())
            .child(if hovered {
                titlebar_svg_icon(
                    if section.collapsed {
                        COMMAND_ICON_CHEVRON_RIGHT
                    } else {
                        COMMAND_ICON_CHEVRON_DOWN
                    },
                    12.0 * scale,
                    appearance.muted,
                )
                .into_any_element()
            } else {
                indicator.into_any_element()
            })
            .child(div().flex_1())
            .when(section.collapsed, |row| {
                row.child(section.count.to_string())
            })
            .on_hover(cx.listener(move |app, hovered, _, cx| {
                if *hovered {
                    app.native_sidebar.hovered_section = Some(key.clone());
                } else if app.native_sidebar.hovered_section.as_ref() == Some(&key) {
                    app.native_sidebar.hovered_section = None;
                }
                cx.notify();
            }))
            .on_click(cx.listener(move |app, _, _, cx| {
                cx.stop_propagation();
                app.dispatch_native_sidebar_ui(
                    json!({"type": "toggleSection", "groupId": storage_id, "section": section_id}),
                    cx,
                );
            }))
            .into_any_element()
    }
}
