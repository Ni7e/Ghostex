use super::{appearance::ChatAppearance, state::NativeChatView, transcript::text};
use gpui::StatefulInteractiveElement;
use gpui::prelude::FluentBuilder as _;
use gpui::{
    AnyElement, Context, InteractiveElement as _, IntoElement, ParentElement as _, Styled as _,
    Window, div, px,
};
use gpui_component::input::Input;
use serde_json::{Value, json};

impl NativeChatView {
    pub(crate) fn icon_command(
        &self,
        id: &'static str,
        label: &'static str,
        icon: &'static str,
        command: Value,
        p: &ChatAppearance,
        cx: &Context<Self>,
    ) -> AnyElement {
        div()
            .id(id)
            .role(gpui::Role::Button)
            .aria_label(label)
            .cursor_pointer()
            .size(px(24.0 * p.scale))
            .flex()
            .items_center()
            .justify_center()
            .rounded(px(5.0 * p.scale))
            .hover(|style| style.bg(p.border))
            .tooltip(move |window, cx| {
                gpui_component::tooltip::Tooltip::new(label).build(window, cx)
            })
            .child(
                gpui::svg()
                    .path(icon)
                    .size(px(14.0 * p.scale))
                    .text_color(p.primary),
            )
            .on_click(cx.listener(move |this, _, _, cx| this.invoke(command.clone(), cx)))
            .into_any_element()
    }
    pub(crate) fn send(&mut self, queued: bool, window: &mut Window, cx: &mut Context<Self>) {
        self.submit(if queued { "queue" } else { "send" }, window, cx);
    }

    pub(crate) fn submit(&mut self, mode: &str, window: &mut Window, cx: &mut Context<Self>) {
        if !self.composer_ready || self.draft.trim().is_empty() || self.pending_send {
            return;
        }
        if mode != "send" && self.snapshot["queue"]["capabilities"]["canQueue"] != true {
            return;
        }
        let blocked = self.snapshot["sendBlockedReason"]
            .as_str()
            .map(str::to_owned);
        if let Some(reason) = blocked {
            self.report_send_blocked(&reason, cx);
            return;
        }
        self.update_suggestion_selection(cx);
        if mode == "send" && self.snapshot["composerCommand"].is_string() {
            self.invoke(json!({"type":"completeComposerCommand"}), cx);
            self.ensure_input(window, cx);
            return;
        }
        let next_id = match crate::app::helpers::gpui_random_uuid_string() {
            Ok(id) => id,
            Err(error) => {
                self.error = Some(error);
                cx.notify();
                return;
            }
        };
        self.close_maximized(cx);
        self.pending_send = true;
        let submission = json!({"type":mode,"text":self.draft,
            "draftVersion":{"draftId":self.draft_id,"revision":self.draft_revision.max(1)}});
        self.draft.clear();
        self.draft_id = next_id;
        self.draft_revision = 1;
        if let Some(input) = &self.input {
            input.update(cx, |input, cx| input.set_value("", window, cx));
        }
        cx.emit(super::state::NativeChatEvent::DraftState(true));
        self.invoke(submission, cx);
    }

    pub(crate) fn chat_button(
        &self,
        id: String,
        label: String,
        command: Value,
        p: &ChatAppearance,
        cx: &Context<Self>,
    ) -> AnyElement {
        div()
            .id(id)
            .role(gpui::Role::Button)
            .aria_label(label.clone())
            .cursor_pointer()
            .px(px(8.0 * p.scale))
            .py(px(4.0 * p.scale))
            .rounded(px(6.0 * p.scale))
            .border_1()
            .border_color(p.border)
            .text_color(p.primary)
            .hover(|style| style.bg(p.border))
            .child(label)
            .on_click(cx.listener(move |this, _, _, cx| this.invoke(command.clone(), cx)))
            .into_any_element()
    }

    pub(crate) fn host_button(
        &self,
        action: &'static str,
        icon: &'static str,
        p: &ChatAppearance,
        cx: &Context<Self>,
    ) -> AnyElement {
        let label = match action {
            "moreActions" => "More actions",
            "maximizeComposer" if self.maximized_window.is_some() => "Exit maximize",
            "maximizeComposer" => "Maximize",
            "summaryMode" => "Summary mode",
            "sessionNote" => "Session note",
            "stashPrompt" => "Stash prompt",
            "attachPath" => "Attach a file or folder",
            "terminalView" => "Terminal View",
            _ => action,
        };
        // CDXC:SessionChat 2026-09-18 SEE-ALSO: The stash count badge, the session-note presence dot and the pressed Summary/Note states come from `packages/shared/session-chat-controller/native-composer-chrome.ts`, the shared form of React's `session-chat-composer-actions.tsx` chrome.
        let chrome = &self.snapshot["composerChrome"];
        let pressed = match action {
            "summaryMode" => chrome["summaryPressed"] == true,
            "sessionNote" => chrome["notePressed"] == true,
            "maximizeComposer" => self.maximized_window.is_some(),
            _ => false,
        };
        let badge = match action {
            "stashPrompt" => chrome["stashBadge"].as_str().map(str::to_owned),
            "sessionNote" if chrome["notePresence"] == true => Some(String::new()),
            _ => None,
        };
        div()
            .id(action)
            .relative()
            .role(gpui::Role::Button)
            .aria_label(label)
            .cursor_pointer()
            .size(px(28.0 * p.scale))
            .flex()
            .items_center()
            .justify_center()
            .rounded_full()
            .when(pressed, |this| this.bg(p.border))
            .hover(|style| style.bg(p.border))
            .child(
                gpui::svg()
                    .path(icon)
                    .size(px(16.0 * p.scale))
                    .text_color(if pressed {
                        p.control_primary
                    } else {
                        p.primary
                    }),
            )
            .when_some(badge, |this, badge| {
                let dot = badge.is_empty();
                this.child(
                    div()
                        .absolute()
                        .top(px(0.0))
                        .right(px(0.0))
                        .size(px(if dot { 6.0 } else { 12.0 } * p.scale))
                        .flex()
                        .items_center()
                        .justify_center()
                        .rounded_full()
                        .bg(p.foreground)
                        .text_color(p.background)
                        .text_size(px(9.0 * p.scale))
                        .line_height(px(9.0 * p.scale))
                        .child(badge),
                )
            })
            .tooltip(move |window, cx| {
                gpui_component::tooltip::Tooltip::new(label).build(window, cx)
            })
            .on_click(
                cx.listener(move |this, event: &gpui::ClickEvent, window, cx| {
                    this.perform_composer_action(action, event.position(), window, cx)
                }),
            )
            .when(action == "stashPrompt", |this| {
                this.on_mouse_down(
                    gpui::MouseButton::Right,
                    cx.listener(|this, _, _, cx| {
                        this.host("stashedPrompts", json!({}), cx);
                        cx.stop_propagation();
                    }),
                )
            })
            .into_any_element()
    }

    pub(crate) fn render_composer(
        &mut self,
        p: &ChatAppearance,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) -> AnyElement {
        let s = p.scale;
        self.sync_composer_references(p, cx);
        let maximized = self.maximized_window.is_some();
        let collapsed = self.composer_collapsed();
        let input = self.input.as_ref().unwrap().clone();
        let attachment_previews = if collapsed {
            None
        } else {
            self.render_attachment_previews(p, cx)
        };
        let mut footer = div()
            .w_full()
            .flex()
            .flex_col()
            .gap(px(8.0 * s))
            .px(px(16.0 * s))
            .pt(px(8.0 * s))
            .pb(px(12.0 * s))
            .max_w(px(768.0 * s))
            .when(maximized, |this| this.p_0().max_w_full().h_full().min_h_0());
        if self.snapshot["incomingDraft"].is_object() {
            /*
            CDXC:Drafts 2026-09-18 DECISION:
            User (2026-09-10, React): the saved-draft notice previews the message it would restore.
            React hangs a popover off a document icon; the GPUI row puts the same preview in the
            icon's tooltip so the notice stays one line high.
            */
            let preview: String = self.snapshot["incomingDraft"]["content"]
                .as_str()
                .unwrap_or_default()
                .chars()
                .take(600)
                .collect();
            footer = footer.child(
                div()
                    .flex()
                    .items_center()
                    .gap(px(8.0 * s))
                    .child(
                        div()
                            .id("incoming-draft-preview")
                            .flex_shrink_0()
                            .size(px(20.0 * s))
                            .flex()
                            .items_center()
                            .justify_center()
                            .rounded_full()
                            .hover(|style| style.bg(p.border))
                            .child(
                                gpui::svg()
                                    .path("titlebar/file-text.svg")
                                    .size(px(14.0 * s))
                                    .text_color(p.muted),
                            )
                            .tooltip(move |window, cx| {
                                gpui_component::tooltip::Tooltip::new(preview.clone())
                                    .build(window, cx)
                            }),
                    )
                    .child(div().flex_1().child("Another saved draft is available"))
                    .child(self.chat_button(
                        "use-incoming".into(),
                        "Use".into(),
                        json!({"type":"useIncomingDraft"}),
                        p,
                        cx,
                    ))
                    .child(self.chat_button(
                        "dismiss-incoming".into(),
                        "Dismiss".into(),
                        json!({"type":"dismissIncomingDraft"}),
                        p,
                        cx,
                    )),
            );
        }
        if !maximized {
            if let Some(strip) = self.render_working_strip(p) {
                footer = footer.child(strip);
            }
        }
        // A `composerNotReady` refusal gets its own card instead of the plain error line.
        if let Some(card) = self.render_composer_not_ready(p, cx) {
            footer = footer.child(card);
        } else if let Some(error) = self.snapshot["operationError"].as_str() {
            footer = footer.child(
                div()
                    .text_color(gpui::rgb(0xef9999))
                    .child(error.to_string()),
            );
        }
        if !maximized {
            if let Some(tasks) = self.render_agent_tasks(p, cx) {
                footer = footer.child(tasks);
            }
            if let Some(fleet) = self.render_agent_fleet(p, cx) {
                footer = footer.child(fleet);
            }
        }
        if let Some(notice) = self.render_notice(p, window, cx) {
            footer = footer.child(notice);
        }
        if let Some(questions) = self.render_async_questions(p, window, cx) {
            footer = footer.child(questions);
        }
        if let Some(prompt) = self.render_prompt(p, window, cx) {
            if self.snapshot["prompt"]["kind"] == "question" {
                return div()
                    .flex()
                    .w_full()
                    .justify_center()
                    .flex_shrink_0()
                    .child(footer.child(prompt))
                    .into_any_element();
            }
            footer = footer.child(prompt);
        }
        if let Some(note) = self.render_note(p, window, cx) {
            footer = footer.child(note);
        }
        if maximized {
            if let Some(suggestions) = self.inline_suggestions(window, cx) {
                let rows = self.snapshot["suggestions"]["rows"]
                    .as_array()
                    .map_or(0, Vec::len);
                let status = self.snapshot["suggestions"]["status"].is_string();
                let height =
                    (40.0 + rows as f32 * 36.0 + if status { 36.0 } else { 0.0 }).min(290.0);
                footer = footer.child(
                    div()
                        .h(px(height * s))
                        .max_h(gpui::relative(0.4))
                        .flex_shrink_0()
                        .child(suggestions),
                );
            }
        }
        let model = text(&self.snapshot["optionLabels"], "model");
        let effort = text(&self.snapshot["optionLabels"], "options");
        let measurement = self.composer_measurement(p, window, cx);
        let composer_bounds = self.composer_bounds.clone();
        let chat = cx.weak_entity();
        let suggestion_anchor = gpui::canvas(
            move |bounds, _, cx| {
                if composer_bounds.replace(bounds) != bounds {
                    let chat = chat.clone();
                    cx.defer(move |cx| {
                        let _ = chat.update(cx, |chat, cx| chat.sync_suggestion_window(cx));
                    });
                }
            },
            |_, _, _, _| {},
        )
        .absolute()
        .size_full();
        // CDXC:SessionChat 2026-09-18 WHY: React's inline composer has a zero-height notification section before its field, contributing one grid gap even while idle. Reserve that same gap here, after any cards or note.
        footer = footer.child(
            div()
                .relative()
                .flex()
                .flex_col()
                .w_full()
                .min_w_0()
                .when(!maximized, |this| this.mt(px(8.0 * s)))
                .child(suggestion_anchor)
                .rounded(px(22.0 * s))
                .border_1()
                .border_color(p.composer_border)
                .bg(p.composer_background)
                .px(px(16.0 * s))
                .py(px(10.0 * s))
                .gap(px(6.0 * s))
                .when(maximized, |this| this.flex_1().min_h_0())
                .when(collapsed, |this| {
                    this.flex_row()
                        .items_center()
                        .gap(px(12.0 * s))
                        .py(px(8.0 * s))
                })
                .children(attachment_previews)
                .children(self.render_queue(p, cx))
                .child(
                    div()
                        .id("composer-editor")
                        .min_w_0()
                        .w_full()
                        .when(collapsed, |this| {
                            this.flex_1().h(px(32.0 * s)).overflow_hidden()
                        })
                        .when(maximized, |this| this.flex_1().h_full().min_h_0())
                        .on_mouse_down(
                            gpui::MouseButton::Left,
                            cx.listener(|this, event: &gpui::MouseDownEvent, _, cx| {
                                this.invoke(json!({"type":"composerExpand","editor":true}), cx);
                                this.click_composer_reference(event, cx);
                            }),
                        )
                        .on_mouse_down(
                            gpui::MouseButton::Right,
                            cx.listener(|this, event: &gpui::MouseDownEvent, window, cx| {
                                if this.show_composer_reference_menu(event, window, cx) {
                                    cx.stop_propagation();
                                }
                            }),
                        )
                        .child(
                            Input::new(&input)
                                .disabled(!self.composer_ready)
                                .placeholder_color(p.muted.opacity(0.6))
                                .appearance(false)
                                .bordered(false)
                                .focus_bordered(false)
                                .w_full()
                                .p_0()
                                .text_size(px(14.0 * s))
                                .text_color(p.primary)
                                .line_height(px(if collapsed { 32.0 } else { 24.0 } * s))
                                .when(collapsed, |this| this.h(px(32.0 * s)).max_h(px(32.0 * s)))
                                .when(!collapsed && !maximized, |this| this.max_h(px(160.0 * s)))
                                .when(maximized, |this| this.h_full().flex_1().min_h_0()),
                        ),
                )
                .child(
                    div()
                        .relative()
                        .flex()
                        .items_center()
                        .justify_between()
                        .gap(px(8.0 * s))
                        .when(!collapsed, |this| {
                            this.child(self.render_option_pills(&model, &effort, p, cx))
                        })
                        .child(self.render_toolbar(p, cx))
                        .when(!collapsed, |this| this.child(measurement)),
                ),
        );
        if self.snapshot["contextMeter"]["hasConfiguredItems"] == true
            || self.snapshot["contextMeter"]["starred"]
                .as_array()
                .is_some_and(|items| !items.is_empty())
        {
            footer = footer.child(self.render_context_status(p, window, cx));
        }
        div()
            .flex()
            .w_full()
            .justify_center()
            .flex_shrink_0()
            .when(maximized, |this| this.h_full().min_h_0())
            .child(footer)
            .into_any_element()
    }
}
