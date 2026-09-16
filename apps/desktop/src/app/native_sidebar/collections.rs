use super::{
    appearance::SidebarAppearance,
    model::{NativeSidebarCollection, NativeSidebarSnapshot},
};
use crate::{
    GhostexGpuiApp,
    app::{consts::*, helpers::*},
};
use gpui::prelude::FluentBuilder;
use gpui::{
    AnyElement, AppContext, FontWeight, InteractiveElement, IntoElement, MouseButton,
    ParentElement, StatefulInteractiveElement, Styled, div, px, rgb,
};
use gpui_component::{
    h_flex,
    input::{Escape, Input},
    v_flex,
};
use serde_json::json;

impl GhostexGpuiApp {
    pub(crate) fn render_native_collection(
        &self,
        collection: &NativeSidebarCollection,
        snapshot: &NativeSidebarSnapshot,
        appearance: &SidebarAppearance,
        cx: &mut gpui::Context<Self>,
    ) -> AnyElement {
        let id = collection.collection_id.clone();
        let hovered = self.native_sidebar.hovered_collection.as_ref() == Some(&id);
        let hover_id = id.clone();
        let drop_position = self.native_sidebar_drop_position("targetId", &id);
        let drop_inside = self
            .native_sidebar
            .drop_command
            .as_ref()
            .is_some_and(|command| command["collectionId"] == id);
        let rename_id = id.clone();
        let drop_id = id.clone();
        let dragged = super::drag::SidebarDrag {
            kind: "collection",
            id: id.clone(),
            title: collection.title.clone(),
            scale: appearance.scale,
        };
        let bulk_id = id.clone();
        let menu = collection.menu.clone();
        let scale = appearance.scale;
        let color = u32::from_str_radix(collection.color.trim_start_matches('#'), 16)
            .map(rgb)
            .map(gpui::Hsla::from)
            .unwrap_or(appearance.muted);
        let style = snapshot.hud["settings"]["sidebarProjectGroupStyle"]
            .as_str()
            .unwrap_or("branched");
        let rail_width = if style == "quiet" {
            1.0
        } else if style == "branched" {
            2.0
        } else {
            3.0
        };
        let rail_color = if style == "quiet" {
            color
                .blend(titlebar_active_text_color().opacity(0.45))
                .opacity(0.42)
        } else if style == "branched" {
            color.opacity(0.18)
        } else {
            color
        };
        let active = collection.collapsed && collection.contains_active_session;
        let name = match self
            .native_sidebar
            .name_editor
            .as_ref()
            .filter(|editor| editor.kind == "collection" && editor.id == id)
        {
            Some(editor) => div()
                .flex_1()
                .min_w_0()
                .on_action(cx.listener(|app, _: &Escape, _, cx| {
                    cx.stop_propagation();
                    app.finish_native_sidebar_rename(false, cx);
                }))
                .child(Input::new(&editor.input).h(px(24.0 * scale)))
                .into_any_element(),
            None => div()
                .id(format!("native-collection-title-{id}"))
                .flex_1()
                .min_w_0()
                .text_ellipsis()
                .text_size(px(15.55 * scale))
                .font_weight(FontWeight::LIGHT)
                .child(collection.title.clone())
                .on_click(
                    cx.listener(move |app, event: &gpui::ClickEvent, window, cx| {
                        if event.click_count() == 2 {
                            cx.stop_propagation();
                            app.begin_native_collection_rename(&rename_id, window, cx);
                        }
                    }),
                )
                .into_any_element(),
        };
        v_flex().relative().flex_shrink_0().ml(px(3.0 * scale)).mr(px(5.0 * scale)).mb(px(10.0 * scale)).pb(px(5.0 * scale)).pl(px((rail_width + 10.0) * scale))
            .child(div().absolute().left_0().top(px(if style == "branched" { 0.0 } else { scale })).bottom(px(5.0 * scale)).w(px(rail_width * scale)).bg(rail_color))
            .child(h_flex().id(format!("native-collection-{id}")).relative().ml(px(if style == "branched" { -10.0 } else { -9.0 } * scale)).h(px(30.0 * scale)).pl(px(5.0 * scale)).pr(px(8.0 * scale)).gap(px(5.0 * scale))
                .when(style == "header", |row| row.bg(color.opacity(0.12)))
                .when(style == "branched", |row| row.bg(color.opacity(0.18)))
                .hover(|row| row.bg(color.opacity(0.22)))
                .when(active, |row| row.bg(appearance.selected).rounded(px(5.0 * scale)).child(super::decorations::selected_outline(appearance)))
                .child(div().w(px(20.0 * scale)).flex().justify_center().child(titlebar_svg_icon(if collection.collapsed { COMMAND_ICON_CHEVRON_RIGHT } else { COMMAND_ICON_CHEVRON_DOWN }, 12.0 * scale, appearance.muted)))
                .when_some(drop_position, |row, position| row.child(super::drag::drop_line(position, scale)))
                .when(drop_inside, |row| row.bg(color.opacity(0.28)))
                .child(name)
                .when(collection.collapsed && collection.working_count > 0, |row| row.child(div().text_size(px(10.0 * scale)).text_color(rgb(0xd99a62)).child(collection.working_count.to_string())))
                .when(collection.collapsed && collection.attention_count > 0, |row| row.child(div().text_size(px(10.0 * scale)).text_color(rgb(0x95d7f6)).child(collection.attention_count.to_string())))
                .when(collection.collapsed && collection.working_count == 0 && collection.attention_count == 0 && collection.awake_count > 0, |row| row.child(div().text_size(px(10.0 * scale)).child(collection.awake_count.to_string())))
                .when(!collection.collapsed && hovered, |row| row.child(div().id(format!("native-collection-bulk-{id}")).size(px(22.0 * scale)).flex().items_center().justify_center().child(titlebar_svg_icon("titlebar/arrows-diagonal.svg", 14.0 * scale, appearance.muted))
                    .on_click(cx.listener(move |app, _, _, cx| { cx.stop_propagation(); app.dispatch_native_sidebar_ui(json!({ "type": "collectionAction", "collectionId": bulk_id, "action": "toggleProjects" }), cx); }))))
                .on_hover(cx.listener(move |app, hovered, _, cx| {
                    if *hovered { app.native_sidebar.hovered_collection = Some(hover_id.clone()); }
                    else if app.native_sidebar.hovered_collection.as_ref() == Some(&hover_id) { app.native_sidebar.hovered_collection = None; }
                    cx.notify();
                }))
                .on_drag(dragged, |dragged, _, _, cx| cx.new(|_| dragged.clone()))
                .on_drag_move::<super::drag::SidebarDrag>(cx.listener(move |app, event, _, cx| app.update_native_sidebar_drop(event, "collection", &drop_id, None, cx)))
                .on_drop::<super::drag::SidebarDrag>(cx.listener(|app, _, _, cx| app.finish_native_sidebar_drop(cx)))
                .on_mouse_down(MouseButton::Right, move |event, window, cx| { cx.stop_propagation(); Self::show_native_sidebar_menu(&menu, event.position, scale, window, cx); })
                .on_click(cx.listener(move |app, _, _, cx| { cx.stop_propagation(); app.dispatch_native_sidebar_ui(json!({ "type": "collectionAction", "collectionId": id, "action": "toggle" }), cx); })))
            .when(self.native_sidebar.disclosures.present(&format!("collection:{}", collection.collection_id), collection.collapsed), |column| {
                let content = v_flex().w_full().pt(px(5.0 * scale)).pl(px(8.0 * scale))
                    .children(collection.group_ids.iter().filter_map(|id| snapshot.groups.iter().find(|group| &group.group_id == id)).map(|group| div().mb(px(if group.collapsed { 5.0 } else { 7.0 } * scale)).child(self.render_native_sidebar_group(group, &snapshot.hud, appearance, cx))));
                column.child(self.render_native_disclosure(format!("collection:{}", collection.collection_id), content.into_any_element(), cx))
            })
            .into_any_element()
    }
}
