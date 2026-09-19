use super::drag::SidebarDrag;
use super::drag::SidebarDropTarget;
use super::drag_source::SidebarDragSource;
use super::session_list::{SESSION_HEIGHT, SESSION_INSET_X, SESSION_SPACING};
use gpui::prelude::FluentBuilder;
use gpui::{
    AnyElement, InteractiveElement, IntoElement, MouseButton, ParentElement,
    StatefulInteractiveElement, Styled, div, px, rgb,
};
use gpui_component::h_flex;
use serde_json::{Value, json};

use super::{
    appearance::SidebarAppearance,
    model::{NativeSidebarGroup, NativeSidebarSession},
};
use crate::GhostexGpuiApp;
use crate::app::helpers::*;

impl GhostexGpuiApp {
    pub(crate) fn render_native_sidebar_session(
        &self,
        group: &NativeSidebarGroup,
        session: &std::sync::Arc<NativeSidebarSession>,
        hud: &Value,
        appearance: &SidebarAppearance,
        cx: &mut gpui::Context<Self>,
    ) -> AnyElement {
        let view = cx.entity().clone();
        let completion = self
            .native_sidebar
            .completion_flashes
            .get(&session.session_id)
            .copied();
        let reveal_id = session.session_id.clone();
        let session_id = session.session_id.clone();
        let group_id = group.group_id.clone();
        let drag_id = session_id.clone();
        let drag_group_id = group_id.clone();
        let dragged = SidebarDrag {
            kind: "session",
            preview: super::drag::SidebarDragPreview::Row(super::row_drag::RowDragPreview {
                identity: super::row_drag::RowDragIdentity::Session {
                    session: session.clone(),
                },
                appearance: appearance.clone(),
                width: px(0.0),
                pointer_x: px(0.0),
            }),
            id: session_id.clone(),
            title: session.title().to_owned(),
            scale: appearance.scale,
        };
        let can_drag = !session.is_browser()
            && !group.is_stale
            && group.remote_machine_context.is_none()
            && (session.is_pinned || hud["activeSessionsSortMode"] == "manual");
        let selected = session
            .details
            .get("isMultiSelected")
            .and_then(Value::as_bool)
            == Some(true);
        let drop_position = self.native_sidebar_drop_position("targetSessionId", &session_id);
        let scale = appearance.scale;
        let hovered = self.native_sidebar.hovered_session.as_deref() == Some(&session_id);
        let focused = self
            .native_sidebar
            .session_draws_focused(&session_id, session.is_focused);
        let stale = group.is_stale && !session.is_browser();
        let sleeping = session.lifecycle_state.as_deref() == Some("sleeping");
        let icon = super::icons::session_icon(session, hud, appearance, hovered);
        let double_click_rename = hud["settings"]["renameSessionOnDoubleClick"].as_bool()
            == Some(true)
            && !session.is_browser();
        let context_id = session_id.clone();
        let close_id = session_id.clone();
        let context_session = session.clone();
        let tooltip = session
            .details
            .get("titleTooltip")
            .and_then(Value::as_str)
            .unwrap_or(session.title())
            .to_owned();
        let question = session
            .details
            .get("pendingQuestionCount")
            .and_then(Value::as_u64)
            .unwrap_or(0)
            > 0;
        let timer = session.details.get("timerLabel").and_then(Value::as_str);
        let show_time = hud
            .get("settings")
            .and_then(|settings| settings.get("hideLastActiveTimeOnSessionCards"))
            .and_then(Value::as_bool)
            != Some(true);
        let time = timer
            .or_else(|| {
                session
                    .details
                    .get("lastInteractionLabel")
                    .and_then(Value::as_str)
            })
            .unwrap_or("")
            .to_owned();
        div().on_children_prepainted(move |bounds, window, cx| { if completion.is_some_and(|start| start.elapsed().as_secs_f32() < 3.0) { window.request_animation_frame(); cx.notify(view.entity_id()); } if let Some(bounds) = bounds.first() { view.update(cx, |app, cx| app.reveal_native_session_bounds(&reveal_id, *bounds, scale, window, cx)); } }).w_full().pb(px(SESSION_SPACING * scale)).px(px(SESSION_INSET_X * scale))
            .child(h_flex()
                .id(format!("native-sidebar-session-{session_id}"))
                .relative().h(px(SESSION_HEIGHT * scale)).w_full().min_w_0().pl(px(5.0 * scale)).pr(px(6.0 * scale)).gap(px(6.0 * scale)).rounded(px(5.0 * scale))
                .cursor_default()
                .when(stale, |row| row.opacity(0.55))
                .when(self.native_sidebar.is_dragging("session", &session_id), |row| row.opacity(0.2))
                .when_some(completion, |row, start| row.opacity(super::status::completion_opacity(start)))
                .when(session.is_visible && !focused, |row| row.bg(appearance.visible))
                .when(focused, |row| row.bg(appearance.session_selected))
                .when(session.is_visible || focused, |row| row.text_color(chrome_color(0xd8d8d8, 0x292929)))
                .when(selected, |row| row.border_1().border_color(rgb(0x2f8cff)))
                .when(drop_position == Some("before"), |row| row.border_t_1().border_color(rgb(0x60a5fa)))
                .when(drop_position == Some("after"), |row| row.border_b_1().border_color(rgb(0x60a5fa)))
                .when(!focused, |row| row.hover(|row| row.bg(appearance.session_hover)))
                .when(focused, |row| row.child(super::decorations::session_outline(appearance)))
                .child(self.render_native_session_identity(session, icon, appearance, cx))
                .children(self.render_native_session_decorations(session, appearance, cx))
                .when_some(self.native_sidebar.reveal_flash.as_ref().filter(|(id, _)| id == &session.session_id).map(|(_, start)| *start), |row, start| row.child(super::scroll::reveal_flash(start, scale)))
                .child(div().id(format!("native-session-title-{session_id}")).flex_1().min_w_0().truncate().child(session.title().to_owned()).when(self.native_sidebar.pointer_inside && self.native_sidebar.menu.is_none() && !cx.has_active_drag(), |row| row.tooltip_show_delay(appearance.tooltip_delay).tooltip(move |window, cx| super::tooltips::sidebar_tooltip(tooltip.clone(), scale, window, cx))))
                .when(!hovered && !question, |row| row.children(super::status::activity_indicator(&session.activity, scale)))
                .when(!hovered && !question && (timer.is_some() || (show_time && session.activity != "working" && session.activity != "attention")), |row| row.child(div().text_size(px(13.55 * scale)).text_color(if sleeping { chrome_color(0x686868, 0x959595) } else { chrome_color(0xa6a6a6, 0x424242) }).child(time)))
                .when(hovered, |row| row.child(self.render_native_session_hover_actions(group, session, appearance, cx)))
                .when(question, |row| row.child(super::status::question_indicator(session.activity == "working", scale)))
                .when(can_drag && self.native_sidebar.menu.is_none(), |row| row.sidebar_drag_source(dragged, cx))
.sidebar_drop_target("session", drag_id, Some(drag_group_id), cx)
                .on_mouse_down(MouseButton::Middle, |_, window, _| {
                    window.prevent_default();
                })
                .on_aux_click(cx.listener(move |app, event: &gpui::ClickEvent, window, cx| {
                    if !event.is_middle_click() { return; }
                    window.prevent_default();
                    cx.stop_propagation();
                    app.close_native_sidebar_menu(window, cx);
                    app.dispatch_native_sidebar_command(
                        json!({"type": "closeSession", "sessionId": close_id}),
                        cx,
                    );
                }))
                .on_click(cx.listener(move |app, event: &gpui::ClickEvent, _, cx| {
                    cx.stop_propagation();
                    if event.click_count() == 2 && double_click_rename {
                        app.dispatch_native_sidebar_ui(json!({"type": "sessionAction", "sessionId": session_id, "action": "rename"}), cx);
                        return;
                    }
                    if stale { return; }
                    let modifiers = event.modifiers();
                    let mode = if modifiers.shift { "range" } else if modifiers.platform || modifiers.control { "additive" } else { "focus" };
                    if mode == "focus" {
                        app.native_sidebar.optimistic_focus = Some((session_id.clone(), std::time::Instant::now()));
                        cx.notify();
                    }
                    app.dispatch_native_sidebar_ui(json!({"type": "selectSession", "sessionId": session_id, "mode": mode}), cx);
                    if mode == "focus" {
                        app.react_to_native_sidebar_session_click(&session_id, cx);
                    }
                }))
                .on_mouse_down(MouseButton::Right, cx.listener(move |app, event: &gpui::MouseDownEvent, window, cx| {
                    cx.stop_propagation();
                    if !selected { app.dispatch_native_sidebar_ui(json!({"type": "selectSession", "mode": "clear", "sessionId": context_id}), cx); }
                    Self::show_native_sidebar_menu(context_session.details.get("menu").unwrap_or(&Value::Null), event.position, scale, window, cx);
                })))
            .into_any_element()
    }
}
