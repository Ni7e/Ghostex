use super::super::{appearance::ChatAppearance, transcript::text};
use super::window::ContextEditorWindow;
use crate::app::native_chat::cursor::ChatCursor as _;
use gpui::prelude::FluentBuilder as _;
use gpui::{
    AnyElement, Context, InteractiveElement as _, IntoElement, ParentElement as _, Render,
    StatefulInteractiveElement as _, Styled as _, Window, div, px,
};
use gpui_component::input::Input;
use serde_json::json;

impl ContextEditorWindow {
    pub(super) fn activate_key(
        &mut self,
        event: &gpui::KeyDownEvent,
        command: serde_json::Value,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) {
        if matches!(event.keystroke.key.as_str(), "enter" | "space")
            && self.chat.read(cx).snapshot["contextEditor"]["saving"] != true
        {
            window.prevent_default();
            cx.stop_propagation();
            self.chat.update(cx, |chat, cx| chat.invoke(command, cx));
        }
    }

    fn button(
        &self,
        label: &'static str,
        command: &'static str,
        primary: bool,
        p: &ChatAppearance,
        cx: &Context<Self>,
    ) -> AnyElement {
        let disabled = self.chat.read(cx).snapshot["contextEditor"]["saving"] == true;
        div()
            .id(command)
            .focusable()
            .tab_stop(!disabled)
            .role(gpui::Role::Button)
            .aria_label(label)
            .h(px(32.0 * p.scale))
            .px(px(12.0 * p.scale))
            .flex()
            .items_center()
            .justify_center()
            .rounded(px(6.0 * p.scale))
            .border_1()
            .border_color(p.border)
            .when(primary, |item| {
                item.bg(p.foreground).text_color(p.background)
            })
            .when(disabled, |item| item.opacity(0.5))
            .when(!disabled, |item| item.chat_cursor_pointer())
            .child(label)
            .on_key_down(cx.listener(move |this, event, window, cx| {
                this.activate_key(event, json!({"type":command}), window, cx)
            }))
            .on_click(cx.listener(move |this, _, _, cx| {
                if !disabled {
                    this.chat
                        .update(cx, |chat, cx| chat.invoke(json!({"type":command}), cx));
                }
            }))
            .into_any_element()
    }
}
impl Render for ContextEditorWindow {
    fn render(&mut self, _window: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
        let snapshot = self.chat.read(cx).snapshot.clone();
        let editor = &snapshot["contextEditor"];
        let p = ChatAppearance::current(&snapshot);
        let s = p.scale;
        let mut groups = div()
            .id("context-detail-groups")
            .min_h_0()
            .flex_1()
            .overflow_y_scroll()
            .track_scroll(&self.scroll);
        if editor["groups"]
            .as_array()
            .is_some_and(|groups| groups.is_empty())
        {
            groups = groups.child(
                div()
                    .py(px(24.0 * s))
                    .text_color(p.muted)
                    .child(format!("No rows match “{}”.", text(editor, "query").trim())),
            );
        }
        for group in editor["groups"].as_array().into_iter().flatten() {
            groups = groups.child(
                div()
                    .pt(px(8.0 * s))
                    .pb(px(2.0 * s))
                    .text_size(px(10.0 * s))
                    .text_color(p.muted)
                    .child(text(group, "label").to_uppercase()),
            );
            for row in group["rows"].as_array().into_iter().flatten() {
                groups = groups.child(self.option_row(row, &text(group, "id"), false, &p, cx));
            }
        }
        let mut starred = div().flex().flex_wrap().gap(px(6.0 * s));
        for row in editor["starred"].as_array().into_iter().flatten() {
            starred = starred.child(self.option_row(row, "starred", true, &p, cx));
        }
        let no_stars = editor["starred"]
            .as_array()
            .is_none_or(|rows| rows.is_empty());
        div()
            .size_full()
            .min_h_0()
            .flex()
            .flex_col()
            .gap(px(16.0 * s))
            .p(px(24.0 * s))
            .rounded(px(12.0 * s))
            .border_1()
            .border_color(p.border)
            .bg(gpui::rgb(if p.light { 0xffffff } else { 0x191919 }))
            .font_family(p.font.clone())
            .text_size(px(13.0 * s))
            .text_color(p.foreground)
            .on_key_down(cx.listener(|this, event: &gpui::KeyDownEvent, window, cx| {
                if event.keystroke.key == "escape" {
                    window.prevent_default();
                    cx.stop_propagation();
                    this.chat.update(cx, |chat, cx| {
                        chat.invoke(json!({"type":"contextCancel"}), cx)
                    });
                }
            }))
            .child(
                div()
                    .flex()
                    .items_center()
                    .justify_between()
                    .child(
                        div()
                            .text_size(px(18.0 * s))
                            .font_weight(gpui::FontWeight::SEMIBOLD)
                            .child("Context details"),
                    )
                    .child(self.icon_button(
                        "context-close".into(),
                        "Close".into(),
                        "titlebar/x.svg",
                        json!({"type":"contextCancel"}),
                        false,
                        &p,
                        cx,
                    )),
            )
            .child(
                div()
                    .text_size(px(14.0 * s))
                    .text_color(p.muted)
                    .child(text(editor, "description")),
            )
            .child(
                Input::new(&self.filter)
                    .cleanable(true)
                    .disabled(editor["saving"] == true)
                    .h(px(32.0 * s))
                    .text_size(px(13.0 * s)),
            )
            .child(groups)
            .child(
                div()
                    .flex_shrink_0()
                    .border_t_1()
                    .border_color(p.border)
                    .pt(px(12.0 * s))
                    .child(
                        div()
                            .flex()
                            .justify_between()
                            .mb(px(6.0 * s))
                            .text_size(px(11.0 * s))
                            .text_color(p.muted)
                            .child("STATUS LINE")
                            .child(if no_stars {
                                "Star rows above to show them under the chat box."
                            } else {
                                "Drag to arrange."
                            }),
                    )
                    .child(starred),
            )
            .when_some(editor["error"].as_str(), |item, error| {
                item.child(
                    div()
                        .text_color(gpui::rgb(0xef9999))
                        .child(error.to_owned()),
                )
            })
            .child(
                div()
                    .flex()
                    .flex_shrink_0()
                    .items_center()
                    .justify_between()
                    .gap(px(8.0 * s))
                    .child(self.button("Reset to recommended", "contextReset", false, &p, cx))
                    .child(
                        div()
                            .flex()
                            .gap(px(8.0 * s))
                            .child(self.button("Cancel", "contextCancel", false, &p, cx))
                            .child(self.button("Save", "contextSave", true, &p, cx)),
                    ),
            )
    }
}
