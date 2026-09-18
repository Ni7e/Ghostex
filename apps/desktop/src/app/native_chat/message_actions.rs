use super::{appearance::ChatAppearance, state::NativeChatView, transcript::text};
use gpui::prelude::FluentBuilder as _;
use gpui::{
    AnyElement, Context, InteractiveElement, IntoElement, ParentElement,
    StatefulInteractiveElement, Styled, div, px, svg,
};
use serde_json::{Value, json};

#[derive(Clone, Copy)]
enum ReplyAction {
    Copy,
    Annotate,
    SaveMarkdown,
}

impl NativeChatView {
    pub(super) fn reply_focus(
        &self,
        message: &Value,
        window: &mut gpui::Window,
        cx: &mut Context<Self>,
    ) -> Option<(gpui::FocusHandle, bool)> {
        if !self.has_reply_actions(message) {
            return None;
        }
        let state = window.use_keyed_state(
            format!("reply-focus:{}", text(message, "id")),
            cx,
            |window, cx| {
                let focus = cx.focus_handle();
                cx.on_focus_in(&focus, window, |_, _, cx| cx.notify())
                    .detach();
                cx.on_focus_out(&focus, window, |_, _, _, cx| cx.notify())
                    .detach();
                focus
            },
        );
        let focus = state.read(cx).clone();
        let focused = focus.contains_focused(window, cx);
        Some((focus, focused))
    }

    pub(super) fn has_reply_actions(&self, message: &Value) -> bool {
        message["role"] == "assistant"
            && message["actionContent"]["copyable"] == true
            && self.snapshot["finalIds"]
                .as_array()
                .is_some_and(|ids| ids.iter().any(|id| id == &message["id"]))
    }

    pub(super) fn reply_marker(
        &self,
        message: &Value,
        focused: bool,
        p: &ChatAppearance,
        cx: &Context<Self>,
    ) -> AnyElement {
        let actions = self.has_reply_actions(message)
            && message["tools"].as_array().is_none_or(Vec::is_empty);
        div()
            .relative()
            .w(px(16.0 * p.scale))
            .h(px(22.75 * p.scale))
            .ml(px(2.0 * p.scale))
            .flex_shrink_0()
            .child(
                div()
                    .absolute()
                    .left(px(6.0 * p.scale))
                    .top(px(9.5 * p.scale))
                    .size(px(4.0 * p.scale))
                    .rounded_full()
                    .bg(p.primary)
                    .when(actions && focused, |dot| dot.opacity(0.0))
                    .when(actions, |dot| {
                        dot.group_hover("native-chat-message", |style| style.opacity(0.0))
                    }),
            )
            .when(actions, |marker| {
                marker.child(
                    div()
                        .absolute()
                        .left(px(-4.0 * p.scale))
                        .top(px(-0.5 * p.scale))
                        .child(self.reply_actions(message, true, focused, p, cx)),
                )
            })
            .into_any_element()
    }

    /// CDXC:SessionChat 2026-09-18 SEE-ALSO:
    /// React's CopyFooter and .ghostex-chat-final-actions place plain-reply actions in the marker gutter without adding a footer to the transcript height.
    pub(super) fn reply_actions(
        &self,
        message: &Value,
        rail: bool,
        focused: bool,
        p: &ChatAppearance,
        cx: &Context<Self>,
    ) -> AnyElement {
        let id = text(message, "id");
        let markdown = text(message, "copyText");
        let icon_color = if p.light { p.muted } else { p.primary };
        let hover_background = if p.light {
            gpui::rgb(0xfafafa).into()
        } else {
            gpui::Hsla::from(gpui::rgb(0xffffff)).opacity(5.0 / 255.0)
        };
        let button = |action: ReplyAction, label: &'static str, icon: &'static str| {
            let click_markdown = markdown.clone();
            div()
                .id(format!("reply-action:{id}:{label}"))
                .group("native-chat-reply-action")
                .role(gpui::Role::Button)
                .aria_label(label)
                .tab_index(0)
                .size(px(24.0 * p.scale))
                .flex_shrink_0()
                .flex()
                .items_center()
                .justify_center()
                .rounded(px(8.0 * p.scale))
                .border(px(p.scale))
                .border_color(gpui::transparent_black())
                .cursor_pointer()
                .opacity(if focused { 1.0 } else { 0.0 })
                .group_hover("native-chat-message", |style| style.opacity(1.0))
                .focus(|style| style.opacity(1.0))
                .focus_visible(|mut style| {
                    style = style.border_color(p.ring);
                    style.box_shadow = Some(vec![gpui::BoxShadow {
                        color: p.ring.opacity(0.2),
                        offset: gpui::point(px(0.0), px(0.0)),
                        blur_radius: px(0.0),
                        spread_radius: px(3.0 * p.scale),
                        inset: false,
                    }]);
                    style
                })
                .hover(|style| style.bg(hover_background))
                .tooltip(move |window, cx| {
                    gpui_component::tooltip::Tooltip::new(label).build(window, cx)
                })
                .child(
                    svg()
                        .path(icon)
                        .size(px(12.0 * p.scale))
                        .text_color(icon_color)
                        .group_hover("native-chat-reply-action", |style| {
                            style.text_color(p.foreground)
                        }),
                )
                .on_click(cx.listener(move |chat, _, _, cx| {
                    chat.perform_reply_action(action, &click_markdown, cx)
                }))
        };
        div()
            .flex()
            .tab_group()
            .when(rail, |actions| actions.flex_col().gap(px(2.0 * p.scale)))
            .child(button(
                ReplyAction::Copy,
                "Copy message",
                "chat-actions/copy",
            ))
            .when(
                self.config.app.is_some() && message["actionContent"]["canAnnotate"] == true,
                |actions| {
                    actions.child(button(
                        ReplyAction::Annotate,
                        "Reply by Annotating",
                        "chat-actions/annotate",
                    ))
                },
            )
            .when(
                message["actionContent"]["canSaveMarkdown"] == true,
                |actions| {
                    actions.child(button(
                        ReplyAction::SaveMarkdown,
                        "Save message to Markdown",
                        "chat-actions/save",
                    ))
                },
            )
            .into_any_element()
    }

    fn perform_reply_action(
        &mut self,
        action: ReplyAction,
        markdown: &str,
        cx: &mut Context<Self>,
    ) {
        match action {
            ReplyAction::Copy => {
                cx.write_to_clipboard(gpui::ClipboardItem::new_string(markdown.to_owned()));
                crate::app::helpers::gpui_play_copy_sound();
            }
            ReplyAction::SaveMarkdown => {
                self.invoke(json!({"type":"markdownSaveOpen","markdown":markdown}), cx)
            }
            ReplyAction::Annotate => self.host("annotateReply", json!({"markdown":markdown}), cx),
        }
    }
}
