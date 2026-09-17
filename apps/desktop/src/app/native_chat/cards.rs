use super::{appearance::ChatAppearance, state::NativeChatView, transcript::text};
use gpui::AppContext as _;
use gpui::prelude::FluentBuilder as _;
use gpui::{
    AnyElement, Context, Entity, InteractiveElement as _, IntoElement, ParentElement as _,
    StatefulInteractiveElement as _, Styled as _, Window, div, px,
};
use gpui_component::input::{Input, InputEvent, InputState};
use serde_json::{Value, json};

impl NativeChatView {
    pub(crate) fn status_card(
        &self,
        title: String,
        icon: &'static str,
        body: Vec<AnyElement>,
        actions: Vec<AnyElement>,
        p: &ChatAppearance,
    ) -> AnyElement {
        let s = p.scale;
        div()
            .w_full()
            .min_w_0()
            .flex()
            .flex_col()
            .border_1()
            .border_color(p.border)
            .rounded(px(12.0 * s))
            .overflow_hidden()
            .text_color(p.muted)
            .child(
                div()
                    .flex()
                    .flex_col()
                    .gap(px(12.0 * s))
                    .px(px(16.0 * s))
                    .py(px(12.0 * s))
                    .bg(gpui::rgb(if p.light { 0xfdfdfd } else { 0x1e1e1e }))
                    .child(
                        div()
                            .flex()
                            .items_start()
                            .gap(px(8.0 * s))
                            .child(
                                gpui::svg()
                                    .path(icon)
                                    .size(px(14.0 * s))
                                    .mt(px(4.0 * s))
                                    .flex_shrink_0(),
                            )
                            .child(div().flex_1().child(title)),
                    )
                    .children(body),
            )
            .when(!actions.is_empty(), |this| {
                this.child(
                    div()
                        .flex()
                        .flex_wrap()
                        .items_center()
                        .justify_end()
                        .gap(px(8.0 * s))
                        .px(px(16.0 * s))
                        .py(px(12.0 * s))
                        .border_t_1()
                        .border_color(p.border.opacity(0.65))
                        .bg(gpui::rgb(if p.light { 0xf5f5f5 } else { 0x151515 }))
                        .children(actions),
                )
            })
            .into_any_element()
    }

    pub(crate) fn render_prompt(
        &mut self,
        p: &ChatAppearance,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) -> Option<AnyElement> {
        if self.snapshot["questionCard"]["visible"] != true {
            self.answer_input = None;
            self.answer_subscription = None;
            return None;
        }
        if self.snapshot["questionCard"]["loading"] == true {
            return Some(self.status_card(
                "Question".into(),
                "titlebar/help-circle.svg",
                vec![div().child("Restoring your answer…").into_any_element()],
                vec![],
                p,
            ));
        }
        let prompt = self.snapshot["prompt"].clone();
        let s = p.scale;
        let mut body = Vec::new();
        let mut actions = Vec::new();
        if prompt["kind"] == "approval" {
            body.push(
                div()
                    .flex()
                    .justify_between()
                    .child("Allow this command?")
                    .child(text(&prompt, "tool"))
                    .into_any_element(),
            );
            let summary = text(&prompt, "summary");
            if !summary.is_empty() {
                body.push(
                    div()
                        .id("approval-command")
                        .max_h(px(160.0 * s))
                        .overflow_y_scroll()
                        .p(px(12.0 * s))
                        .border_1()
                        .border_color(p.border)
                        .rounded(px(8.0 * s))
                        .bg(p.background)
                        .font_family("JetBrainsMono Nerd Font")
                        .text_size(px(12.0 * s))
                        .child(summary)
                        .into_any_element(),
                );
            }
            for (label, send) in [("Deny", ""), ("Allow", "1")] {
                actions.push(self.chat_button(
                    format!("approval-{label}"),
                    label.into(),
                    json!({"type":"answer","answer":{"kind":"approval","approvalSend":send}}),
                    p,
                    cx,
                ));
            }
            return Some(self.status_card(
                "Approval request".into(),
                "titlebar/shield-check.svg",
                body,
                actions,
                p,
            ));
        }
        let index = self.snapshot["questionCard"]["questionIndex"]
            .as_u64()
            .unwrap_or(0) as usize;
        let count = prompt["questions"].as_array().map(Vec::len).unwrap_or(0);
        let question = &prompt["questions"][index];
        let draft = self.snapshot["questionCard"]["drafts"][index].clone();
        let title = question["header"]
            .as_str()
            .unwrap_or(if count > 1 { "Questions" } else { "Question" })
            .to_string();
        body.push(
            div()
                .flex()
                .items_start()
                .justify_between()
                .gap(px(8.0 * s))
                .child(
                    div()
                        .flex_1()
                        .text_color(p.foreground)
                        .child(text(question, "question")),
                )
                .when(count > 1, |this| {
                    this.child(div().flex_shrink_0().text_size(px(12.0 * s)).child(format!(
                        "question {} of {}",
                        index + 1,
                        count
                    )))
                })
                .into_any_element(),
        );
        if question["multiSelect"] == true {
            body.push(
                div()
                    .text_size(px(12.0 * s))
                    .child("Select one or more options.")
                    .into_any_element(),
            );
        }
        for (option_index, option) in question["options"]
            .as_array()
            .into_iter()
            .flatten()
            .enumerate()
        {
            let selected = draft["indices"].as_array().is_some_and(|indices| {
                indices
                    .iter()
                    .any(|i| i.as_u64() == Some(option_index as u64))
            });
            body.push(
                div()
                    .id(format!("question-option:{index}:{option_index}"))
                    .flex()
                    .gap(px(10.0 * s))
                    .w_full()
                    .px(px(10.0 * s))
                    .py(px(8.0 * s))
                    .rounded(px(8.0 * s))
                    .cursor_pointer()
                    .hover(|style| style.bg(p.border))
                    .when(selected, |this| this.bg(p.border))
                    .child(
                        div()
                            .size(px(20.0 * s))
                            .border_1()
                            .border_color(p.border)
                            .rounded(px(4.0 * s))
                            .flex()
                            .justify_center()
                            .items_center()
                            .text_size(px(11.0 * s))
                            .child(if selected {
                                "✓".into()
                            } else {
                                (option_index + 1).to_string()
                            }),
                    )
                    .child(
                        div()
                            .flex_1()
                            .flex()
                            .flex_col()
                            .child(text(option, "label"))
                            .when(option["description"].is_string(), |this| {
                                this.child(
                                    div()
                                        .text_size(px(12.0 * s))
                                        .child(text(option, "description")),
                                )
                            }),
                    )
                    .on_click(cx.listener(move |this, _, _, cx| {
                        this.invoke(json!({"type":"questionOption","index":option_index}), cx)
                    }))
                    .into_any_element(),
            );
        }
        if index > 0 {
            actions.push(self.chat_button(
                "question-back".into(),
                "←".into(),
                json!({"type":"questionBack"}),
                p,
                cx,
            ));
        }
        if question["allowCustom"] != false {
            let key = format!("{}:{index}", prompt);
            if self
                .answer_input
                .as_ref()
                .is_none_or(|(previous, _)| previous != &key)
            {
                let input = cx.new(|cx| {
                    InputState::new(window, cx)
                        .multi_line(true)
                        .submit_on_enter(true)
                        .auto_grow(1, 4)
                        .placeholder("Write a custom answer…")
                        .default_value(text(&draft, "other"))
                });
                self.answer_subscription = Some(cx.subscribe_in(&input,window,|this,input,event:&InputEvent,_,cx| match event {
                    InputEvent::Change => this.invoke(json!({"type":"questionText","text":input.read(cx).value().to_string()}),cx),
                    InputEvent::PressEnter { shift:false,.. } => this.invoke(json!({"type":"questionNext"}),cx),
                    _=>{},
                }));
                self.answer_input = Some((key, input));
            }
            actions.push(
                Input::new(&self.answer_input.as_ref().unwrap().1)
                    .disabled(self.snapshot["questionCard"]["busy"] == true)
                    .appearance(false)
                    .bordered(false)
                    .flex_1()
                    .min_w_0()
                    .text_size(px(14.0 * s))
                    .into_any_element(),
            );
        }
        actions.push(self.chat_button(
            "question-cancel".into(),
            "Cancel".into(),
            json!({"type":"questionCancel"}),
            p,
            cx,
        ));
        actions.push(
            self.chat_button(
                "question-next".into(),
                if self.snapshot["questionCard"]["answering"] == true {
                    "Sending…"
                } else if index + 1 == count {
                    "Send answer"
                } else {
                    "Next"
                }
                .into(),
                json!({"type":"questionNext"}),
                p,
                cx,
            ),
        );
        Some(self.status_card(title, "titlebar/help-circle.svg", body, actions, p))
    }

    pub(crate) fn render_notice(
        &mut self,
        p: &ChatAppearance,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) -> Option<AnyElement> {
        let snapshot = self.snapshot.clone();
        let notice = &snapshot["terminalNotice"];
        if !notice.is_object() || snapshot["noticeVisible"] != true {
            self.terminal_dialog_input = None;
            return None;
        }
        let mut body = Vec::new();
        let mut actions = Vec::new();
        if notice["dialog"].is_object()
            && notice["dialog"]["rows"]
                .as_array()
                .is_some_and(Vec::is_empty)
        {
            let (body, actions) = self.render_terminal_dialog(&notice["dialog"], p, window, cx);
            return Some(self.status_card(
                text(&notice["dialog"], "title"),
                "titlebar/terminal-2.svg",
                body,
                actions,
                p,
            ));
        }
        if notice["detail"].is_string() {
            body.push(div().child(text(notice, "detail")).into_any_element());
        }
        for choice in notice["choices"].as_array().into_iter().flatten() {
            body.push(self.chat_button(
                format!("notice-choice:{}", choice["index"]),
                text(choice, "label"),
                json!({"type":"answer","answer":choice["answer"]}),
                p,
                cx,
            ));
        }
        if notice["dialog"].is_object() {
            let (dialog_body, dialog_actions) =
                self.render_terminal_dialog(&notice["dialog"], p, window, cx);
            body.extend(dialog_body);
            actions.extend(dialog_actions);
        }
        for action in notice["actions"].as_array().into_iter().flatten() {
            if action["kind"] == "switchToTerminal" {
                actions.push(self.host_button("terminalView", "titlebar/terminal-2.svg", p, cx));
            } else {
                let answer = action["answer"].clone();
                actions.push(self.chat_button(
                    format!("notice-action:{}", text(action, "id")),
                    text(action, "label"),
                    json!({"type":"answer","answer":answer}),
                    p,
                    cx,
                ));
            }
        }
        if notice["choices"].is_null() && notice["dialog"].is_null() {
            actions.push(
                div()
                    .id("dismiss-notice")
                    .cursor_pointer()
                    .child("Dismiss")
                    .on_click(cx.listener(move |this, _, _, cx| {
                        this.invoke(json!({"type":"dismissNotice"}), cx);
                    }))
                    .into_any_element(),
            );
        }
        Some(self.status_card(
            text(notice, "title"),
            "titlebar/alert-triangle.svg",
            body,
            actions,
            p,
        ))
    }
}
