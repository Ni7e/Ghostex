use super::{appearance::ChatAppearance, state::NativeChatView, transcript::text};
use gpui::prelude::FluentBuilder as _;
use gpui::{
    AnyElement, AppContext as _, Context, InteractiveElement as _, IntoElement, ParentElement as _,
    StatefulInteractiveElement as _, Styled as _, Window, div, px,
};
use gpui_component::input::{Input, InputEvent, InputState};
use serde_json::json;

impl NativeChatView {
    pub(crate) fn render_prompt(
        &mut self,
        p: &ChatAppearance,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) -> Option<AnyElement> {
        if self.snapshot["questionCard"]["visible"] != true {
            self.collapsed.retain(|key| !key.starts_with("question:"));
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
        let busy = self.snapshot["questionCard"]["busy"] == true;
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
                        .text_color(p.muted)
                        .line_height(px(19.6 * s))
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
        let mut choices = div()
            .id("question-options")
            .flex()
            .flex_col()
            .gap(px(6.0 * s))
            .max_h(window.viewport_size().height * 0.45)
            .overflow_y_scroll();
        for (option_index, option) in question["options"]
            .as_array()
            .into_iter()
            .flatten()
            .enumerate()
        {
            let selected = text(&draft, "other").trim().is_empty()
                && draft["indices"].as_array().is_some_and(|indices| {
                    indices
                        .iter()
                        .any(|i| i.as_u64() == Some(option_index as u64))
                });
            let label = text(option, "label");
            let description = text(option, "description");
            choices = choices.child(
                div()
                    .id(format!("question-option:{index}:{option_index}"))
                    .role(gpui::Role::Button)
                    .aria_label(label.clone())
                    .flex()
                    .items_center()
                    .gap(px(12.0 * s))
                    .w_full()
                    .px(px(12.0 * s))
                    .py(px(8.0 * s))
                    .rounded(px(8.0 * s))
                    .border_1()
                    .border_color(if selected {
                        p.primary.opacity(0.3)
                    } else {
                        p.border
                    })
                    .text_color(p.foreground)
                    .when(p.light, |row| row.bg(p.background))
                    .when(selected, |row| row.bg(p.primary.opacity(0.1)))
                    .when(busy, |row| row.opacity(0.6))
                    .when(!busy, |row| {
                        row.cursor_pointer()
                            .hover(|style| style.bg(p.input.opacity(0.3)))
                    })
                    .child(
                        div()
                            .min_w_0()
                            .flex_1()
                            .flex()
                            .flex_col()
                            .gap(px(2.0 * s))
                            .child(div().line_height(px(19.25 * s)).child(label.clone()))
                            .when(!description.is_empty() && description != label, |column| {
                                column.child(
                                    div()
                                        .text_size(px(14.0 * s))
                                        .line_height(px(19.25 * s))
                                        .text_color(p.muted)
                                        .child(description),
                                )
                            }),
                    )
                    .when(selected, |row| {
                        row.child(
                            gpui::svg()
                                .path("titlebar/check.svg")
                                .size(px(16.0 * s))
                                .text_color(p.primary),
                        )
                    })
                    .when(!selected && option_index < 9, |row| {
                        row.child(
                            div()
                                .h(px(20.0 * s))
                                .min_w(px(20.0 * s))
                                .px(px(4.0 * s))
                                .flex_shrink_0()
                                .border_1()
                                .border_color(p.border.opacity(0.6))
                                .bg(p.background.opacity(0.4))
                                .rounded(px(4.0 * s))
                                .flex()
                                .justify_center()
                                .items_center()
                                .text_size(px(13.0 * s))
                                .font_weight(gpui::FontWeight::MEDIUM)
                                .text_color(p.muted)
                                .child((option_index + 1).to_string()),
                        )
                    })
                    .when(!busy, |row| {
                        row.on_click(cx.listener(move |this, _, _, cx| {
                            this.invoke(json!({"type":"questionOption","index":option_index}), cx);
                        }))
                    }),
            );
        }
        body.push(choices.into_any_element());
        if index > 0 {
            actions.push(self.question_button(
                "question-back",
                "←",
                json!({"type":"questionBack"}),
                busy,
                true,
                false,
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
                    .focus_bordered(false)
                    .p_0()
                    .line_height(px(24.0 * s))
                    .text_color(p.foreground)
                    .flex_1()
                    .min_w_0()
                    .text_size(px(14.0 * s))
                    .into_any_element(),
            );
        } else {
            actions.push(div().min_w_0().flex_1().into_any_element());
        }
        actions.push(self.question_button(
            "question-cancel",
            "Cancel",
            json!({"type":"questionCancel"}),
            busy,
            true,
            false,
            p,
            cx,
        ));
        actions.push(self.question_button(
            "question-next",
            &text(&self.snapshot["questionCard"]["controls"], "label"),
            json!({"type":"questionNext"}),
            busy || self.snapshot["questionCard"]["controls"]["disabled"] == true,
            false,
            true,
            p,
            cx,
        ));
        let collapse_key = format!("question:{}", prompt);
        let collapsed = self.collapsed.contains(&collapse_key);
        let header = div()
            .id("question-header")
            .role(gpui::Role::Button)
            .aria_label(if collapsed {
                "Show the question and its options"
            } else {
                "Hide the question and its options"
            })
            .flex()
            .items_start()
            .gap(px(8.0 * s))
            .cursor_pointer()
            .mx(px(-16.0 * s))
            .mt(px(-12.0 * s))
            .mb(px(if collapsed { -12.0 } else { -2.0 } * s))
            .px(px(16.0 * s))
            .pt(px(12.0 * s))
            .pb(px(if collapsed { 12.0 } else { 6.0 } * s))
            .hover(|style| style.bg(p.foreground.opacity(0.04)))
            .child(
                gpui::svg()
                    .path("titlebar/help-circle.svg")
                    .size(px(14.0 * s))
                    .mt(px(4.375 * s))
                    .flex_shrink_0()
                    .text_color(p.muted),
            )
            .child(
                div()
                    .min_w_0()
                    .flex_1()
                    .flex()
                    .gap(px(8.0 * s))
                    .text_color(p.foreground)
                    .child(div().flex_shrink_0().child(title))
                    .when(collapsed, |heading| {
                        heading.child(
                            div()
                                .min_w_0()
                                .truncate()
                                .text_color(p.muted)
                                .child(text(question, "question")),
                        )
                    }),
            )
            .child(
                gpui::svg()
                    .path(if collapsed {
                        "titlebar/chevron-right.svg"
                    } else {
                        "titlebar/chevron-down.svg"
                    })
                    .size(px(14.0 * s))
                    .mt(px(4.375 * s))
                    .flex_shrink_0()
                    .text_color(p.muted),
            )
            .on_click(cx.listener(move |this, _, _, cx| {
                if !this.collapsed.remove(&collapse_key) {
                    this.collapsed.insert(collapse_key.clone());
                }
                cx.notify();
            }))
            .into_any_element();
        Some(self.status_card_with_header(
            header,
            if collapsed { vec![] } else { body },
            actions,
            p,
        ))
    }

    fn question_button(
        &self,
        id: &'static str,
        label: &str,
        action: serde_json::Value,
        disabled: bool,
        ghost: bool,
        wide: bool,
        p: &ChatAppearance,
        cx: &Context<Self>,
    ) -> AnyElement {
        let s = p.scale;
        div()
            .id(id)
            .role(gpui::Role::Button)
            .aria_label(label.to_owned())
            .h(px(28.0 * s))
            .px(px(12.0 * s))
            .flex_shrink_0()
            .flex()
            .items_center()
            .justify_center()
            .rounded(px(8.0 * s))
            .border_1()
            .border_color(if ghost {
                gpui::transparent_black()
            } else {
                p.border
            })
            .text_color(p.foreground)
            .font_weight(gpui::FontWeight::NORMAL)
            .when(wide, |button| button.min_w(px(96.0 * s)))
            .when(disabled, |button| button.opacity(0.5))
            .when(!disabled, |button| {
                button.cursor_pointer().hover(|style| style.bg(p.input))
            })
            .when(!ghost && p.light, |button| button.bg(p.background))
            .child(label.to_owned())
            .when(!disabled, |button| {
                button.on_click(cx.listener(move |this, _, _, cx| this.invoke(action.clone(), cx)))
            })
            .into_any_element()
    }
}
