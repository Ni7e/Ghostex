use gpui::{AnyView, App, FontWeight, ParentElement, Styled, Window, div, px};
use gpui_component::{tooltip::Tooltip, v_flex};

pub(super) fn sidebar_tooltip(
    text: String,
    scale: f32,
    window: &mut Window,
    cx: &mut App,
) -> AnyView {
    Tooltip::element(move |_, _| {
        v_flex()
            .max_w(px(320.0 * scale))
            .gap(px(3.0 * scale))
            .children(text.lines().enumerate().map(|(index, line)| {
                div()
                    .text_size(px(12.0 * scale))
                    .font_weight(if index == 0 {
                        FontWeight::MEDIUM
                    } else {
                        FontWeight::NORMAL
                    })
                    .child(line.to_owned())
            }))
    })
    .py(px(6.0 * scale))
    .px(px(8.0 * scale))
    .build(window, cx)
}
