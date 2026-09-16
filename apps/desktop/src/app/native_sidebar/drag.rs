use crate::{GhostexGpuiApp, app::helpers::*};
use gpui::{
    AnyElement, Context, DragMoveEvent, IntoElement, ParentElement, Render, Styled, Window, div, px,
};
use serde_json::{Value, json};

#[derive(Clone)]
pub(crate) struct SidebarDrag {
    pub(crate) kind: &'static str,
    pub(crate) id: String,
    pub(crate) title: String,
    pub(crate) scale: f32,
}

impl Render for SidebarDrag {
    fn render(&mut self, _: &mut Window, _: &mut Context<Self>) -> impl IntoElement {
        div()
            .h(px(34.0 * self.scale))
            .px(px(8.0 * self.scale))
            .flex()
            .items_center()
            .max_w(px(260.0 * self.scale))
            .rounded(px(5.0 * self.scale))
            .bg(titlebar_background())
            .text_color(chrome_color(0xb4b8c0, 0x262626))
            .text_size(px(15.55 * self.scale))
            .child(self.title.clone())
            .into_any_element()
    }
}

impl GhostexGpuiApp {
    pub(crate) fn update_native_sidebar_drop(
        &mut self,
        event: &DragMoveEvent<SidebarDrag>,
        target_kind: &str,
        target_id: &str,
        group_id: Option<&str>,
        cx: &mut Context<Self>,
    ) {
        let source = event.drag(cx);
        if source.kind == target_kind && source.id == target_id {
            self.native_sidebar.drop_command = None;
            cx.notify();
            return;
        }
        if target_kind == "session" {
            let Some(snapshot) = self.native_sidebar.snapshot.as_ref() else {
                return;
            };
            let origin = snapshot.groups.iter().find_map(|group| {
                group
                    .sessions
                    .iter()
                    .find(|session| session.session_id == source.id)
                    .map(|session| (group, session))
            });
            let target = snapshot.groups.iter().find_map(|group| {
                group
                    .sessions
                    .iter()
                    .find(|session| session.session_id == target_id)
                    .map(|session| (group, session))
            });
            let valid = match (origin, target) {
                (Some((origin, session)), Some((target, target_session))) => {
                    !session.is_browser()
                        && !origin.is_stale
                        && !target.is_stale
                        && if session.is_pinned {
                            origin.group_id == target.group_id && target_session.is_pinned
                        } else {
                            origin.remote_machine_context.is_none()
                                && target.remote_machine_context.is_none()
                                && snapshot.hud["activeSessionsSortMode"] == "manual"
                        }
                }
                _ => false,
            };
            if !valid {
                self.native_sidebar.drop_command = None;
                cx.notify();
                return;
            }
        }
        let after = if target_kind == "space" {
            event.event.position.x > event.bounds.center().x
        } else {
            event.event.position.y > event.bounds.center().y
        };
        let position = if after { "after" } else { "before" };
        let command = if target_kind == "space" && matches!(source.kind, "group" | "collection") {
            json!({"type": "moveToSpace", "sourceKind": source.kind, "sourceId": source.id, "spaceId": target_id})
        } else if source.kind == "group" && matches!(target_kind, "collection" | "ungroup") {
            json!({"type": "moveToCollection", "sourceKind": source.kind, "sourceId": source.id, "collectionId": if target_kind == "collection" { Some(target_id) } else { None }})
        } else if source.kind == "collection" && matches!(target_kind, "group" | "collection") {
            json!({"type": "moveCollection", "sourceId": source.id, "targetKind": target_kind, "targetId": target_id, "position": position})
        } else if source.kind == target_kind {
            match target_kind {
                "session" => {
                    json!({"type": "moveSession", "sessionId": source.id, "groupId": group_id, "targetSessionId": target_id, "position": position})
                }
                "group" => {
                    json!({"type": "moveGroup", "groupId": source.id, "targetGroupId": target_id, "position": position})
                }
                "space" => {
                    json!({"type": "moveSpace", "spaceId": source.id, "targetSpaceId": target_id, "position": position})
                }
                _ => return,
            }
        } else {
            self.native_sidebar.drop_command = None;
            cx.notify();
            return;
        };
        if self.native_sidebar.drop_command.as_ref() != Some(&command) {
            self.native_sidebar.drop_command = Some(command);
            cx.notify();
        }
    }

    pub(crate) fn finish_native_sidebar_drop(&mut self, cx: &mut Context<Self>) {
        if let Some(command) = self.native_sidebar.drop_command.take() {
            self.dispatch_native_sidebar_ui(command, cx);
        }
        cx.notify();
    }

    pub(crate) fn native_sidebar_drop_position(&self, key: &str, id: &str) -> Option<&str> {
        let command = self.native_sidebar.drop_command.as_ref()?;
        (command.get(key)?.as_str()? == id)
            .then(|| command.get("position").and_then(Value::as_str))
            .flatten()
    }
}

pub(super) fn drop_line(position: &str, scale: f32) -> AnyElement {
    let mut line = div()
        .absolute()
        .left_0()
        .right_0()
        .h(px(2.0 * scale))
        .bg(gpui::rgb(0x60a5fa));
    if position == "after" {
        line = line.bottom(px(-3.0 * scale));
    } else {
        line = line.top(px(-3.0 * scale));
    }
    line.into_any_element()
}
