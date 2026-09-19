use super::super::appearance::ChatAppearance;
use super::window::SuggestionPanel;
use crate::app::native_chat::cursor::ChatCursor as _;
use gpui::prelude::FluentBuilder as _;
use gpui::{
    AnimationExt as _, Context, InteractiveElement as _, IntoElement, ParentElement as _, Render,
    StatefulInteractiveElement as _, Styled as _, Window, div, px,
};
use serde_json::json;

impl Render for SuggestionPanel {
    fn render(&mut self, _window: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
        let state = self.chat.read(cx).snapshot.clone();
        let p = ChatAppearance::current(&state);
        let s = p.scale;
        let data = &state["suggestions"];
        let rows = data["rows"].as_array().cloned().unwrap_or_default();
        let selected = data["selected"].as_u64().unwrap_or(0) as usize;
        if self.selected != Some(selected) {
            self.selected = Some(selected);
            self.scroll
                .scroll_to_item(selected + 1 + usize::from(data["status"].is_string()));
        }
        let files = data["kind"] == "file";
        let mut body = div()
            .id("suggestion-list")
            .role(gpui::Role::ListBox)
            .aria_label(match data["kind"].as_str() {
                Some("slash") => "Slash commands",
                Some("skill") => "Available skills",
                _ => "Project files",
            })
            .size_full()
            .overflow_y_scroll()
            .track_scroll(&self.scroll)
            .p(px(6.0 * s))
            .child(
                div()
                    .px(px(12.0 * s))
                    .pt(px(8.0 * s))
                    .pb(px(4.0 * s))
                    .text_size(px(10.0 * s))
                    .font_weight(gpui::FontWeight::SEMIBOLD)
                    .text_color(p.muted)
                    .child(data["heading"].as_str().unwrap_or_default().to_uppercase()),
            );
        if let Some(status) = data["status"].as_str() {
            body = body.child(
                div()
                    .flex()
                    .items_center()
                    .gap(px(10.0 * s))
                    .justify_between()
                    .px(px(12.0 * s))
                    .py(px(8.0 * s))
                    .text_color(p.muted)
                    .when(data["loading"] == true, |row| {
                        row.child(suggestion_spinner(px(16.0 * s), p.muted))
                    })
                    .child(div().flex_1().min_w_0().child(status.to_owned()))
                    .when(data["retry"] == true, |row| {
                        row.child(
                            div()
                                .id("retry-skills")
                                .role(gpui::Role::Button)
                                .aria_label("Retry")
                                .chat_cursor_pointer()
                                .border_1()
                                .border_color(p.border)
                                .rounded(px(6.0 * s))
                                .px(px(8.0 * s))
                                .child("Retry")
                                .on_mouse_down(
                                    gpui::MouseButton::Left,
                                    cx.listener(|this, _, window, cx| {
                                        window.prevent_default();
                                        cx.stop_propagation();
                                        this.choose(json!({"type":"suggestionRetry"}), cx);
                                    }),
                                ),
                        )
                    }),
            );
        }
        for (index, row) in rows.into_iter().enumerate() {
            let label = row["label"].as_str().unwrap_or_default().to_owned();
            let detail = row["detail"].as_str().unwrap_or_default().to_owned();
            body = body.child(
                div()
                    .id(("suggestion", index))
                    .role(gpui::Role::ListBoxOption)
                    .aria_selected(index == selected)
                    .aria_label(format!("{label} {detail}"))
                    .flex()
                    .items_center()
                    .gap(px(10.0 * s))
                    .w_full()
                    .min_w_0()
                    .px(px(12.0 * s))
                    .py(px(8.0 * s))
                    .rounded(px(8.0 * s))
                    .chat_cursor_pointer()
                    .when(index == selected, |row| {
                        row.bg(gpui::rgb(if p.light { 0xf4f4f5 } else { 0x333333 }))
                    })
                    .when(files, |row| {
                        row.child(
                            gpui::svg()
                                .path("titlebar/file.svg")
                                .size(px(16.0 * s))
                                .flex_shrink_0()
                                .text_color(p.muted),
                        )
                    })
                    .child(
                        div()
                            .min_w_0()
                            .truncate()
                            .when(!files, |text| text.w(px(200.0 * s)).flex_shrink_0())
                            .when(files, |text| {
                                text.flex_shrink_0().font_weight(gpui::FontWeight::SEMIBOLD)
                            })
                            .child(label),
                    )
                    .child(
                        div()
                            .flex_1()
                            .min_w_0()
                            .truncate()
                            .text_color(p.muted)
                            .child(detail),
                    )
                    .on_mouse_move(cx.listener(move |this, _, _, cx| {
                        if this.selected != Some(index) {
                            this.chat.update(cx, |chat, cx| {
                                chat.invoke(json!({"type":"suggestionHighlight","index":index}), cx)
                            });
                        }
                    }))
                    .on_mouse_down(
                        gpui::MouseButton::Left,
                        cx.listener(move |this, _, window, cx| {
                            window.prevent_default();
                            cx.stop_propagation();
                            this.choose(json!({"type":"suggestionPick","index":index}), cx);
                        }),
                    ),
            );
        }
        div()
            .size_full()
            .rounded(px(16.0 * s))
            .border_1()
            .border_color(p.composer_border)
            .bg(gpui::rgb(if p.light { 0xffffff } else { 0x171717 }))
            .text_color(p.primary)
            .font_family(p.font)
            .text_size(px(14.0 * s))
            .line_height(px(20.0 * s))
            .overflow_hidden()
            .child(body)
    }
}

/// React's `IconLoader2` beside "Loading skills…" and "Listing project files…", still when the
/// system asks for reduced motion.
fn suggestion_spinner(size: gpui::Pixels, color: gpui::Hsla) -> gpui::AnyElement {
    let glyph = gpui::svg()
        .path("titlebar/loader2.svg")
        .size(size)
        .flex_shrink_0()
        .text_color(color);
    if crate::app::helpers::gpui_macos_reduce_motion_enabled() {
        return glyph.into_any_element();
    }
    glyph
        .with_animation(
            "suggestion-loading-spinner",
            gpui::Animation::new(std::time::Duration::from_millis(900)).repeat(),
            |svg, delta| {
                svg.with_transformation(gpui::Transformation::rotate(gpui::radians(
                    delta * std::f32::consts::TAU,
                )))
            },
        )
        .into_any_element()
}
