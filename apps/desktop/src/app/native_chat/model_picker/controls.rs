use super::{style::accent, window::ModelPickerWindow};
use crate::app::native_chat::cursor::ChatCursor as _;
use gpui::{
    AnyElement, Context, InteractiveElement, IntoElement, ParentElement,
    StatefulInteractiveElement, Styled, div, px, rgb,
};
use serde_json::{Value, json};

pub(super) fn button(
    id: String,
    label: String,
    enabled: bool,
    action: Value,
    cx: &mut Context<ModelPickerWindow>,
) -> gpui::Stateful<gpui::Div> {
    div()
        .id(id)
        .role(gpui::Role::Button)
        .aria_label(label)
        .chat_cursor_pointer()
        .on_mouse_down(gpui::MouseButton::Left, |_, _, cx| cx.stop_propagation())
        .on_click(cx.listener(move |view, _, _, cx| {
            if enabled {
                view.chat
                    .update(cx, |chat, cx| chat.invoke(action.clone(), cx));
            }
        }))
}

pub(super) fn footer(state: &Value, scale: f32, cx: &mut Context<ModelPickerWindow>) -> AnyElement {
    let pressed = &state["pressed"];
    let accent = accent(state);
    let closing = state["closing"] == true;
    // Codex's picker cannot commit without saving a default, so its session action stays disabled.
    let session_scope = state["sessionScope"] == true;
    // Enter commits the scope the Session-only model picks setting names; Shift+Enter commits the other.
    let session_primary = state["primaryScope"] == "session";
    let session_label = state["scopeReason"]
        .as_str()
        .map(|reason| format!("Use in this session — {reason}"))
        .unwrap_or_else(|| "Use in this session".to_string());
    let key = |control: &str,
               label: &str,
               glyph: &str,
               enabled: bool,
               cx: &mut Context<ModelPickerWindow>| {
        button(
            format!("picker-footer-{control}"),
            label.into(),
            enabled && !closing,
            json!({"type":"modelPickerControl","control":control}),
            cx,
        )
        .p(px(2.0 * scale))
        .opacity(if enabled { 1.0 } else { 0.3 })
        .child(
            div()
                .min_w(px(25.0 * scale))
                .h(px(25.0 * scale))
                .px(px(5.0 * scale))
                .rounded(px(5.0 * scale))
                .border_1()
                .border_color(
                    if pressed
                        .as_array()
                        .is_some_and(|keys| keys.iter().any(|key| key == control))
                    {
                        accent
                    } else {
                        gpui::rgba(0x74788860).into()
                    },
                )
                .bg(
                    if pressed
                        .as_array()
                        .is_some_and(|keys| keys.iter().any(|key| key == control))
                    {
                        super::style::mix(accent, rgb(0x181a20).into(), 0.35)
                    } else {
                        gpui::rgba(0x181a2070).into()
                    },
                )
                .flex()
                .items_center()
                .justify_center()
                .text_color(rgb(0xc6c8d3))
                .child(glyph.to_string()),
        )
    };
    let mut content = div()
        .flex()
        .flex_wrap()
        .items_center()
        .justify_center()
        .gap(px(if state["compactControls"] == true {
            16.0
        } else {
            24.0
        } * scale))
        .text_size(px(12.0 * scale))
        .text_color(rgb(0x9b9da9));
    if state["compactControls"] != true {
        content = content.child(
            div()
                .flex()
                .items_center()
                .gap(px(8.0 * scale))
                .child(
                    div()
                        .border_1()
                        .rounded(px(5.0 * scale))
                        .border_color(gpui::rgba(0x74788860))
                        .px(px(5.0 * scale))
                        .h(px(25.0 * scale))
                        .child(if cfg!(target_os = "macos") {
                            "⌥P"
                        } else {
                            "Alt+P"
                        }),
                )
                .child("Close"),
        );
    }
    content = content
        .child(
            div()
                .flex()
                .items_center()
                .gap(px(5.0 * scale))
                .child(key(
                    "ArrowUp",
                    "Previous model",
                    "↑",
                    state["canUp"] == true,
                    cx,
                ))
                .child(key(
                    "ArrowDown",
                    "Next model",
                    "↓",
                    state["canDown"] == true,
                    cx,
                ))
                .child("Model"),
        )
        .child(
            div()
                .flex()
                .items_center()
                .gap(px(5.0 * scale))
                .child(key(
                    "ArrowLeft",
                    "Decrease effort",
                    "←",
                    state["canLeft"] == true,
                    cx,
                ))
                .child(key(
                    "ArrowRight",
                    "Increase effort",
                    "→",
                    state["canRight"] == true,
                    cx,
                ))
                .child("Effort"),
        )
        .child(
            key(
                if session_primary {
                    "Enter"
                } else {
                    "EnterAlternate"
                },
                session_label.as_str(),
                if session_primary { "↵" } else { "⇧↵" },
                !closing && session_scope,
                cx,
            )
            .flex()
            .items_center()
            .gap(px(8.0 * scale))
            .child("Use in this session"),
        )
        .child(
            key(
                if session_primary {
                    "EnterAlternate"
                } else {
                    "Enter"
                },
                "Set as default",
                if session_primary { "⇧↵" } else { "↵" },
                !closing,
                cx,
            )
            .flex()
            .items_center()
            .gap(px(8.0 * scale))
            .child("Set as default"),
        )
        .child(
            key("Escape", "Cancel", "Esc", !closing, cx)
                .flex()
                .items_center()
                .gap(px(8.0 * scale))
                .child("Cancel"),
        );
    div()
        .absolute()
        .bottom(px(if state["compactControls"] == true {
            4.0
        } else {
            12.0
        } * scale))
        .w_full()
        .min_h(px(56.0 * scale))
        .px(px(24.0 * scale))
        .py(px(12.0 * scale))
        .flex()
        .items_center()
        .justify_center()
        .child(content)
        .into_any_element()
}
