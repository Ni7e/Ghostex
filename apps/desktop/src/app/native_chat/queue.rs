use super::{appearance::ChatAppearance, state::NativeChatView, transcript::text};
use crate::app::native_chat::cursor::ChatCursor as _;
use gpui::prelude::FluentBuilder as _;
use gpui::{
    AnyElement, AppContext as _, Context, InteractiveElement as _, IntoElement, ParentElement as _,
    Render, StatefulInteractiveElement as _, Styled as _, Window, div, px,
};
use serde_json::{Value, json};

#[derive(Clone)]
struct QueuedPromptDrag {
    session: gpui::EntityId,
    prompt: String,
    preview: String,
    appearance: ChatAppearance,
}

impl Render for QueuedPromptDrag {
    fn render(&mut self, _: &mut Window, _: &mut Context<Self>) -> impl IntoElement {
        let p = &self.appearance;
        div()
            .px(px(8.0 * p.scale))
            .h(px(28.0 * p.scale))
            .max_w(px(500.0 * p.scale))
            .flex()
            .items_center()
            .rounded(px(8.0 * p.scale))
            .bg(p.input)
            .border_1()
            .border_color(p.border)
            .text_color(p.muted)
            .font_family(p.font.clone())
            .text_size(px(12.0 * p.scale))
            .text_ellipsis()
            .child(self.preview.clone())
    }
}

fn grip(p: &ChatAppearance) -> AnyElement {
    div()
        .flex()
        .flex_col()
        .gap(px(2.0 * p.scale))
        .children((0..3).map(|_| {
            div()
                .flex()
                .gap(px(2.0 * p.scale))
                .children((0..2).map(|_| div().size(px(1.5 * p.scale)).rounded_full().bg(p.muted)))
        }))
        .into_any_element()
}

impl NativeChatView {
    fn queue_action(
        &self,
        id: String,
        label: &'static str,
        icon: &'static str,
        disabled: bool,
        command: Value,
        p: &ChatAppearance,
        cx: &Context<Self>,
    ) -> AnyElement {
        div()
            .id(id)
            .size(px(24.0 * p.scale))
            .flex()
            .items_center()
            .justify_center()
            .rounded(px(5.0 * p.scale))
            .tooltip(move |window, cx| {
                gpui_component::tooltip::Tooltip::new(label).build(window, cx)
            })
            .when(disabled, |this| this.opacity(0.4))
            .when(!disabled, |this| {
                this.chat_cursor_pointer()
                    .hover(|style| style.text_color(p.foreground))
                    .on_click(cx.listener(move |this, _, _, cx| this.invoke(command.clone(), cx)))
            })
            .child(gpui::svg().path(icon).size(px(14.0 * p.scale)))
            .into_any_element()
    }

    pub(super) fn render_queue(
        &self,
        p: &ChatAppearance,
        cx: &Context<Self>,
    ) -> Option<AnyElement> {
        let prompts = self.snapshot["queue"]["prompts"].as_array()?;
        if prompts.is_empty() {
            return None;
        }
        let capabilities = &self.snapshot["queue"]["capabilities"];
        let blocked = self.snapshot["sendBlockedReason"].is_string();
        let can_drag = !blocked && prompts.len() > 1 && capabilities["canReorder"] == true;
        let s = p.scale;
        let session = cx.entity_id();
        let rows = prompts.iter().map(|prompt| {
            let id = text(prompt, "id");
            let busy = prompt["busy"] == true;
            let failed = prompt["state"] == "failed";
            let preview = text(prompt, "preview");
            let drag = QueuedPromptDrag {
                session: session.clone(),
                prompt: id.clone(),
                preview: preview.clone(),
                appearance: p.clone(),
            };
            // CDXC:SessionChat 2026-09-22 WHY: the id is load-bearing. GPUI applies a group-hover refinement at LAYOUT time only from per-element hover state, which exists only for a div with an id; without one the `w_auto` never reaches layout and the buttons stay clipped at width 0 while the row is hovered.
            let mut actions = div()
                .id(format!("queue-actions:{id}"))
                .flex()
                .flex_shrink_0()
                .items_center()
                .w_0()
                .overflow_hidden()
                .opacity(0.0)
                .group_hover("native-chat-queue-row", |style| style.w_auto().opacity(1.0));
            for (capability, label, icon, command) in [
                (
                    "canRetry",
                    "Retry",
                    "titlebar/refresh.svg",
                    json!({"type":"retryQueue","promptId":id}),
                ),
                (
                    "canEdit",
                    "Edit",
                    "titlebar/pencil.svg",
                    json!({"type":"removeQueue","promptId":id,"edit":true}),
                ),
                (
                    "canSendNow",
                    "Send now",
                    "titlebar/arrow-up.svg",
                    json!({"type":"sendQueue","promptId":id}),
                ),
                (
                    "canRemove",
                    "Delete",
                    "titlebar/trash.svg",
                    json!({"type":"removeQueue","promptId":id}),
                ),
            ] {
                if capabilities[capability] == true && (capability != "canRetry" || failed) {
                    actions = actions.child(self.queue_action(
                        format!("queue-{capability}:{id}"),
                        label,
                        icon,
                        busy || blocked,
                        command,
                        p,
                        cx,
                    ));
                }
            }
            let source_session = session.clone();
            div()
                .id(format!("queued-prompt:{id}"))
                .group("native-chat-queue-row")
                .flex()
                .items_center()
                .min_w_0()
                .gap(px(4.0 * s))
                .min_h(px(28.0 * s))
                .pr(px(2.0 * s))
                .rounded(px(8.0 * s))
                .border_1()
                .border_color(p.border.opacity(0.58))
                .text_color(p.muted)
                .hover(|style| {
                    style
                        .bg(p.foreground.opacity(0.05))
                        .border_color(gpui::transparent_black())
                })
                .when(can_drag, |this| {
                    this.on_drop(cx.listener(move |this, drag: &QueuedPromptDrag, _, cx| {
                        if drag.session == source_session {
                            this.invoke(
                                json!({"type":"moveQueue","promptId":drag.prompt,"targetId":id}),
                                cx,
                            );
                        }
                    }))
                })
                .child(
                    div()
                        .id(format!("queue-grip:{}", text(prompt, "id")))
                        .w(px(18.0 * s))
                        .h(px(20.0 * s))
                        .flex_shrink_0()
                        .flex()
                        .items_center()
                        .justify_center()
                        .when(can_drag && !busy, |this| {
                            this.cursor_grab()
                                .on_drag(drag, |drag, _, _, cx| cx.new(|_| drag.clone()))
                        })
                        .when(!can_drag && !busy, |this| this.opacity(0.35))
                        .child(if busy {
                            gpui::svg()
                                .path("titlebar/loader2.svg")
                                .size(px(13.0 * s))
                                .into_any_element()
                        } else {
                            grip(p)
                        }),
                )
                .child(
                    div()
                        .flex_1()
                        .min_w_0()
                        .text_ellipsis()
                        .text_size(px(12.0 * s))
                        .line_height(px(20.0 * s))
                        .when(busy, |this| this.opacity(0.7))
                        .when(failed, |this| this.text_color(gpui::rgb(0xef9999)))
                        .child(preview),
                )
                .when(failed, |this| {
                    this.child(
                        div()
                            .max_w(gpui::relative(0.45))
                            .text_ellipsis()
                            .text_size(px(11.0 * s))
                            .text_color(gpui::rgb(0xef9999))
                            .child(
                                prompt["errorMessage"]
                                    .as_str()
                                    .unwrap_or("Delivery failed.")
                                    .to_owned(),
                            ),
                    )
                })
                .child(actions)
        });
        Some(
            div()
                .id("native-chat-queue")
                .w_full()
                .flex()
                .flex_col()
                .gap(px(4.0 * s))
                .max_h(px(156.0 * s))
                .pb(px(6.0 * s))
                .overflow_y_scroll()
                .children(rows)
                .into_any_element(),
        )
    }
}
