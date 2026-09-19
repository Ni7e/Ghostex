use super::{appearance::ChatAppearance, state::NativeChatView, transcript::text};
use crate::app::native_chat::cursor::ChatCursor as _;
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
    /// The gutter rail is three fixed slots, one row apart, in the order Copy, Reply by Annotating, Save to Markdown: a reply that cannot be annotated leaves that slot empty rather than pulling Save up under Copy, so an action is always in the same place.
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
                .chat_cursor_pointer()
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
        let can_annotate =
            self.config.app.is_some() && message["actionContent"]["canAnnotate"] == true;
        let can_save = message["actionContent"]["canSaveMarkdown"] == true;
        div()
            .flex()
            .tab_group()
            .when(rail, |actions| actions.flex_col().gap(px(2.0 * p.scale)))
            .child(button(
                ReplyAction::Copy,
                "Copy message",
                "chat-actions/copy",
            ))
            .when(can_annotate, |actions| {
                actions.child(button(
                    ReplyAction::Annotate,
                    "Reply by Annotating",
                    "chat-actions/annotate",
                ))
            })
            .when(rail && !can_annotate && can_save, |actions| {
                actions.child(div().size(px(24.0 * p.scale)).flex_shrink_0())
            })
            .when(can_save, |actions| {
                actions.child(button(
                    ReplyAction::SaveMarkdown,
                    "Save message to Markdown",
                    "chat-actions/save",
                ))
            })
            .into_any_element()
    }

    /// CDXC:SavedPrompts 2026-09-06 DECISION:
    /// User: add Save prompt between Copy and Rewind on user messages, using the input box's stack-push icon.
    ///
    /// The prompt's own rail (React: `CopyFooter` on a user row). Rewind is offered only when the
    /// host can reach `/api/rewindSessionChat`, the session runs an agent whose rewind Ghostex
    /// drives, and the composer could send right now, because the daemon types the rewind into that
    /// same pane. Which prompt is a rewind target at all is decided in
    /// packages/shared/session-chat-presentation/message-rewind.ts.
    pub(super) fn user_actions(
        &self,
        message: &Value,
        p: &ChatAppearance,
        window: &mut gpui::Window,
        cx: &mut Context<Self>,
    ) -> AnyElement {
        let id = text(message, "id");
        let prompt = text(message, "copyText");
        // Nothing to copy, save, or rewind to: an empty prompt keeps its rail off entirely.
        if prompt.is_empty() {
            return div().into_any_element();
        }
        let saved = self.snapshot["savedPrompts"][id.as_str()]
            .as_str()
            .unwrap_or("");
        // A rewind types into the session's own pane, so a child transcript never offers one
        // (React's subagent viewer mounts its list without `rewindToMessage` for the same reason).
        let rewindable = !self.in_subagent
            && message["canRewind"] == true
            && self.snapshot["rewindAvailable"] == true
            && self.snapshot["rewindEnabled"] == true;
        // React passes `onSavePrompt` only when the host has a stash bridge, the same capability
        // behind the composer's Stash control, so a host without one offers Copy alone.
        let savable = self.snapshot["composerActions"]["stash"] == true;
        /*
        CDXC:SessionChat 2026-09-18 SEE-ALSO:
        `.ghostex-chat-user-message` in packages/core-ui/styles/chat.css carries the user decision
        this mirrors: the rail sits left of the bubble, horizontal for one- or two-line prompts and
        vertical for longer ones. React measures the rendered bubble
        (`SessionChatUserMessageLayout`); GPUI measures the row the rail stretches to, the taller of
        bubble and rail, so the threshold also allows for the rail's own column height.
        */
        let s = p.scale;
        let buttons = 1.0 + f32::from(savable) + f32::from(rewindable);
        let measured = window.use_keyed_state(
            gpui::SharedString::from(format!("user-actions-height:{id}")),
            cx,
            |_, _| 0.0_f32,
        );
        let compact =
            *measured.read(cx) <= ((12.0 + buttons * 24.0) * s).max((2.0 * 22.75 + 26.0) * s + 1.0);
        let button = |key: &str, label: String, icon: &'static str, action: Value| {
            let icon_color = p.muted;
            div()
                .id(gpui::SharedString::from(format!("{key}:{id}")))
                .group("native-chat-user-action")
                .role(gpui::Role::Button)
                .aria_label(label.clone())
                .tab_index(0)
                .size(px(24.0 * p.scale))
                .flex_shrink_0()
                .flex()
                .items_center()
                .justify_center()
                .rounded(px(6.0 * p.scale))
                .chat_cursor_pointer()
                .hover(|style| style.bg(p.border.opacity(0.4)))
                .tooltip(move |window, cx| {
                    gpui_component::tooltip::Tooltip::new(label.clone()).build(window, cx)
                })
                .child(
                    svg()
                        .path(icon)
                        .size(px(12.0 * p.scale))
                        .text_color(icon_color)
                        .group_hover("native-chat-user-action", |style| {
                            style.text_color(p.foreground)
                        }),
                )
                .on_click(cx.listener(move |chat, _, _, cx| {
                    if action["type"] == "copyPrompt" {
                        cx.write_to_clipboard(gpui::ClipboardItem::new_string(text(
                            &action, "text",
                        )));
                        crate::app::helpers::gpui_play_copy_sound();
                    } else {
                        chat.invoke(action.clone(), cx);
                    }
                }))
        };
        div()
            .self_stretch()
            .relative()
            .flex()
            .flex_shrink_0()
            .when(compact, |rail| rail.items_center())
            .when(!compact, |rail| {
                rail.flex_col().child(div().h(px(12.0 * s)).flex_shrink_0())
            })
            .opacity(0.0)
            .group_hover("native-chat-message", |style| style.opacity(1.0))
            .child(
                gpui::canvas(
                    move |bounds, _, cx| {
                        let height = bounds.size.height.as_f32();
                        measured.update(cx, |value, cx| {
                            if (*value - height).abs() > 0.5 {
                                *value = height;
                                cx.notify();
                            }
                        });
                    },
                    |_, _, _, _| {},
                )
                .absolute()
                .size_full(),
            )
            .child(button(
                "copy",
                "Copy message".into(),
                "chat-actions/copy",
                json!({"type":"copyPrompt","text":prompt.clone()}),
            ))
            .when(savable, |rail| {
                rail.child(button(
                    "save-prompt",
                    match saved {
                        "saved" => "Prompt saved",
                        "saving" => "Saving prompt",
                        "error" => "Could not save prompt. Click to retry.",
                        _ => "Save prompt",
                    }
                    .into(),
                    if saved == "saved" {
                        "chat-actions/saved"
                    } else {
                        "chat-actions/savePrompt"
                    },
                    json!({"type":"savePrompt","messageId":id.clone(),"prompt":prompt.clone()}),
                ))
            })
            .when(rewindable, |rail| {
                rail.child(button(
                    "rewind",
                    "Rewind to here".into(),
                    "chat-actions/rewind",
                    json!({"type":"rewindOpen","messageId":id.clone(),"prompt":prompt.clone()}),
                ))
            })
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
