use super::drag::SidebarDrag;
use gpui::AppContext;
use gpui::prelude::FluentBuilder;
use gpui::{
    AnyElement, FontWeight, InteractiveElement, IntoElement, MouseButton, ParentElement,
    StatefulInteractiveElement, Styled, div, px, rgb,
};
use gpui_component::{h_flex, v_flex};
use serde_json::json;

use super::{
    appearance::SidebarAppearance,
    model::{NativeSidebarSnapshot, NativeSidebarSpace},
};
use crate::GhostexGpuiApp;
use crate::app::helpers::*;

impl GhostexGpuiApp {
    pub(crate) fn render_native_sidebar_selectors(
        &self,
        snapshot: &NativeSidebarSnapshot,
        appearance: &SidebarAppearance,
        cx: &mut gpui::Context<Self>,
    ) -> AnyElement {
        let scale = appearance.scale;
        // Space buttons have a fixed 28px face and 4px gap in both renderers.
        let capacity = (((self.sidebar_width / scale - 13.0) + 4.0) / 32.0)
            .floor()
            .max(2.0) as usize;
        let user_spaces: Vec<_> = snapshot
            .spaces
            .iter()
            .filter(|space| space.id != "other")
            .collect();
        let overflow = user_spaces.len() + 1 > capacity;
        let mut visible: Vec<_> = user_spaces
            .iter()
            .copied()
            .take(if overflow {
                capacity - 2
            } else {
                user_spaces.len()
            })
            .collect();
        if let Some(selected) = user_spaces.iter().find(|space| space.selected) {
            if !visible.iter().any(|space| space.id == selected.id) && overflow {
                visible.pop();
                visible.push(selected);
            }
        }
        let hidden: Vec<_> = user_spaces
            .iter()
            .filter(|space| !visible.iter().any(|item| item.id == space.id))
            .map(|space| (*space).clone())
            .collect();
        v_flex().w_full().flex_shrink_0()
            .children(self.render_native_machine_tabs(snapshot, appearance, cx))
            .child(div().h(px(13.0 * scale)).flex_shrink_0())
            .when(snapshot.spaces_enabled, |column| column.child(h_flex().w_full().h(px(40.0 * scale)).pb(px(12.0 * scale)).pl(px(3.0 * scale)).pr(px(10.0 * scale)).gap(px(4.0 * scale))
                .when(user_spaces.is_empty(), |row| row.child(h_flex().id("native-sidebar-create-space").flex_1().h(px(28.0 * scale)).px(px(10.0 * scale)).gap(px(6.0 * scale)).rounded(px(6.0 * scale)).border_1().border_color(appearance.muted.opacity(0.25)).text_size(px(12.0 * scale))
                    .child(titlebar_svg_icon("titlebar/plus.svg", 14.0 * scale, appearance.muted)).child("Create space")
                    .on_click(cx.listener(|app, _, _, cx| { cx.stop_propagation(); app.dispatch_native_sidebar_ui(json!({"type": "editSpace"}), cx); }))))
                .children(visible.into_iter().chain(snapshot.spaces.iter().filter(|space| space.id == "other")).map(|space| self.render_native_sidebar_space(space, appearance, cx)))
                .when(overflow, |row| row.child(div().id("native-sidebar-more-spaces").size(px(28.0 * scale)).flex().items_center().justify_center().rounded(px(6.0 * scale)).hover(|row| row.bg(appearance.hover))
                    .child(titlebar_svg_icon("titlebar/dots.svg", 16.0 * scale, appearance.muted))
                    .on_click(cx.listener(move |_, event: &gpui::ClickEvent, window, cx| {
                        let mut items = vec![json!({"label": "New Space", "icon": "plus", "command": {"type": "editSpace"}}), json!({"separator": true})];
                        items.extend(hidden.iter().map(|space| json!({"label": space.name, "icon": space.icon, "iconColor": space.color, "checked": space.selected, "command": {"type": "selectSpace", "spaceId": space.id}})));
                        Self::show_native_sidebar_menu(&json!(items), event.position(), scale, window, cx);
                    }))))))
            .into_any_element()
    }

    fn render_native_sidebar_space(
        &self,
        space: &NativeSidebarSpace,
        appearance: &SidebarAppearance,
        cx: &mut gpui::Context<Self>,
    ) -> AnyElement {
        let id = space.id.clone();
        let menu_id = id.clone();
        let drag_id = id.clone();
        let dragged = SidebarDrag {
            kind: "space",
            id: id.clone(),
            title: space.name.clone(),
            scale: appearance.scale,
        };
        let name = space.name.clone();
        let scale = appearance.scale;
        let path = gpui_sidebar_command_icon_asset_path(Some(&space.icon));
        let color = u32::from_str_radix(space.color.trim_start_matches('#'), 16)
            .map(rgb)
            .map(gpui::Hsla::from)
            .unwrap_or(appearance.foreground);
        let has_status = space.working_count > 0 || space.attention_count > 0;
        let icon = gpui::svg()
            .path(path)
            .size(px(16.0 * scale))
            .text_color(color)
            .opacity(if has_status { 0.8 } else { 1.0 });
        v_flex().id(format!("native-sidebar-space-{id}")).relative().size(px(28.0 * scale)).flex_shrink_0().items_center().justify_center().rounded(px(6.0 * scale)).border_1().border_color(gpui::transparent_black()).cursor_pointer()
            .when(space.contains_active_session && !space.selected, |row| row.bg(appearance.selected).border_color(appearance.selected_outline))
            .when(space.selected, |row| row.bg(appearance.foreground.opacity(0.12)).border_color(appearance.foreground.opacity(0.16)))
            .hover(|row| row.bg(appearance.hover))
            .child(icon)
            .when(space.working_count > 0 || space.attention_count > 0, |row| row.child(h_flex().absolute().top(px(15.5 * scale)).left_0().w_full().justify_center().h(px(9.0 * scale)).gap(px(2.0 * scale)).font_family("JetBrainsMono Nerd Font").text_size(px(9.0 * scale)).font_weight(FontWeight::BOLD)
                .when(space.working_count > 0, |row| row.child(div().text_color(rgb(0xf8ad07)).child(space.working_count.to_string())))
                .when(space.attention_count > 0, |row| row.child(div().text_color(rgb(0x95d7f6)).child(space.attention_count.to_string())))))
            .when(self.native_sidebar.pointer_inside && self.native_sidebar.menu.is_none() && !cx.has_active_drag(), |row| row.tooltip_show_delay(appearance.tooltip_delay).tooltip(move |window, cx| titlebar_tooltip(name.clone(), window, cx)))
            .when(id != "other", |row| row.on_drag(dragged, |dragged, _, _, cx| cx.new(|_| dragged.clone())))
                .on_drag_move::<SidebarDrag>(cx.listener(move |app, event, _, cx| app.update_native_sidebar_drop(event, "space", &drag_id, None, cx)))
                .on_drop::<SidebarDrag>(cx.listener(|app, _, _, cx| app.finish_native_sidebar_drop(cx)))
            .on_click(cx.listener(move |app, _, _, cx| { cx.stop_propagation(); app.dispatch_native_sidebar_ui(json!({"type": "selectSpace", "spaceId": id}), cx); }))
            .on_mouse_down(MouseButton::Right, cx.listener(move |_, event: &gpui::MouseDownEvent, window, cx| {
                cx.stop_propagation();
                let mut items = Vec::new();
                if menu_id != "other" { items.push(json!({"label": "Edit Space", "icon": "pencil", "command": {"type": "editSpace", "spaceId": menu_id}})); }
                items.push(json!({"label": "New Space", "icon": "plus", "command": {"type": "editSpace"}}));
                Self::show_native_sidebar_menu(&json!(items), event.position, scale, window, cx);
            }))
            .into_any_element()
    }
}
