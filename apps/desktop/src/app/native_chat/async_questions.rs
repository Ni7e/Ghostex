use super::{appearance::ChatAppearance, state::NativeChatView, transcript::text};
use crate::app::helpers::ThrottledAnimationExt;
use gpui::prelude::FluentBuilder as _;
use gpui::{
    AnyElement, AppContext as _, Context, Focusable as _, InteractiveElement as _, IntoElement,
    ParentElement as _, StatefulInteractiveElement as _, Styled as _, Window, div, px, relative,
    rgb, svg,
};
use gpui_component::input::{Input, InputEvent, InputState};
use serde_json::json;
use std::time::Duration;

impl NativeChatView {
    pub(super) fn render_async_questions(
        &mut self,
        p: &ChatAppearance,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) -> Option<AnyElement> {
        let state = self.snapshot["asyncQuestions"].clone();
        let question = &state["question"];
        let key = question["key"].as_str()?.to_owned();
        let s = p.scale;
        let collapsed = state["collapsed"] == true;
        let count = state["count"].as_u64().unwrap_or(1);
        let index = state["index"].as_u64().unwrap_or(0);
        let busy = state["disabled"] == true;
        let mut indicator = div().relative().size(px(16.0 * s)).flex_shrink_0();
        if state["working"] == true {
            indicator =
                indicator.child(if crate::app::helpers::gpui_macos_reduce_motion_enabled() {
                    question_spinner(s, 0.0)
                } else {
                    div()
                        .size_full()
                        .with_throttled_animation(
                            "async-question-working",
                            Duration::from_millis(820),
                            move |ring, progress| ring.child(question_spinner(s, progress)),
                        )
                        .into_any_element()
                });
        }
        indicator = indicator.child(
            div()
                .absolute()
                .left(px(5.0 * s))
                .top(px(5.0 * s))
                .size(px(6.0 * s))
                .rounded_full()
                .bg(rgb(0xf472b6)),
        );
        let header =
            div()
                .id("async-question-header")
                .role(gpui::Role::Button)
                .text_color(p.primary)
                .aria_label(if collapsed {
                    "Expand questions from Codex"
                } else {
                    "Collapse questions from Codex"
                })
                .flex()
                .items_center()
                .gap(px(8.0 * s))
                .px(px(16.0 * s))
                .py(px(12.0 * s))
                .text_size(px(12.0 * s))
                .line_height(relative(1.4))
                .cursor_pointer()
                .child(indicator)
                .child(
                    div()
                        .font_weight(gpui::FontWeight::MEDIUM)
                        .child(if count > 1 {
                            "Questions from Codex"
                        } else {
                            "Question from Codex"
                        }),
                )
                .child(div().min_w_0().flex_1().text_color(p.muted).child(
                    if state["working"] == true {
                        "Still working"
                    } else {
                        ""
                    },
                ))
                .child(
                    div()
                        .text_color(p.muted)
                        .child(format!("{}/{count}", index + 1)),
                )
                .child(
                    svg()
                        .path(if collapsed {
                            "titlebar/chevron-right.svg"
                        } else {
                            "titlebar/chevron-down.svg"
                        })
                        .size(px(16.0 * s))
                        .text_color(p.foreground),
                )
                .on_click(cx.listener(|this, _, _, cx| {
                    this.invoke(json!({"type":"asyncQuestionToggle"}), cx)
                }));
        let mut card = div()
            .w_full()
            .min_w_0()
            .overflow_hidden()
            .rounded(px(16.0 * s))
            .border_1()
            .border_color(p.input_border)
            .bg(p.card_background)
            .text_color(p.foreground)
            .text_size(px(13.0 * s))
            .line_height(relative(1.4))
            .child(header);
        if collapsed {
            return Some(card.into_any_element());
        }
        let pane_height = f32::from(self.bounds.get().size.height);
        let mut body = div()
            .id("async-question-body")
            .flex()
            .flex_col()
            .gap(px(12.0 * s))
            .max_h(px((pane_height * 0.42 - 44.0 * s)
                .max(64.0 * s)
                .min(360.0 * s)))
            .overflow_y_scroll()
            .px(px(16.0 * s))
            .pb(px(12.0 * s))
            .child(div().flex_shrink_0().child(text(question, "title")));
        let options = question["options"].as_array();
        if let Some(options) = options.filter(|options| !options.is_empty()) {
            let mut choices = div().flex().flex_col().flex_shrink_0().gap(px(6.0 * s));
            for (option_index, option) in options.iter().enumerate() {
                let selected = state["selected"].as_array().is_some_and(|values| {
                    values
                        .iter()
                        .any(|value| value.as_u64() == Some(option_index as u64))
                });
                choices = choices.child(self.question_choice(
                    format!("async-option:{key}:{option_index}"),
                    option.as_str().unwrap_or_default().into(),
                    String::new(),
                    selected,
                    None,
                    busy,
                    json!({"type":"asyncQuestionOption","key":key,"index":option_index}),
                    p,
                    cx,
                ));
            }
            body = body.child(choices);
        }
        let answer = text(&state["draft"], "other");
        if self
            .async_answer_input
            .as_ref()
            .is_none_or(|(previous, _)| previous != &key)
        {
            let input = cx.new(|cx| {
                InputState::new(window, cx)
                    .multi_line(true)
                    .submit_on_enter(true)
                    .auto_grow(1, 5)
                    .placeholder(if options.is_some_and(|options| !options.is_empty()) {
                        "Or write your own answer…"
                    } else {
                        "Write your answer…"
                    })
                    .default_value(answer.clone())
            });
            let question_key = key.clone();
            self.async_answer_subscription = Some(cx.subscribe_in(&input, window, move |this, input, event: &InputEvent, window, cx| match event {
                InputEvent::Change => this.invoke(json!({"type":"asyncQuestionText","key":question_key,"text":input.read(cx).value().to_string()}), cx),
                InputEvent::PressEnter { shift: false, .. } => this.invoke(json!({"type":"asyncQuestionSend"}), cx),
                InputEvent::Focus => { super::focus::reclaim_keyboard_focus(window); cx.notify(); },
                InputEvent::Blur => cx.notify(),
                _ => {},
            }));
            self.async_answer_input = Some((key, input));
        }
        let input = self.async_answer_input.as_ref().unwrap().1.clone();
        if input.read(cx).value().as_str() != answer {
            input.update(cx, |input, cx| input.set_value(answer, window, cx));
        }
        let focused = input.read(cx).focus_handle(cx).is_focused(window);
        body = body.child(
            Input::new(&input)
                .aria_label("Your answer")
                .appearance(false)
                .bordered(false)
                .focus_bordered(false)
                .disabled(state["submitting"] == true || state["loading"] == true)
                .placeholder_color(p.muted.opacity(0.6))
                .w_full()
                .min_w_0()
                .min_h(px(60.0 * s))
                .max_h(px(118.0 * s))
                .flex_shrink_0()
                .border_1()
                .border_color(p.input_border)
                .when(focused, |input| {
                    input.border_color(p.ring).shadow(vec![
                        gpui::BoxShadow::new(px(0.0), px(0.0), p.ring.opacity(0.2))
                            .spread_radius(px(3.0 * s))
                            .inset(),
                    ])
                })
                .rounded(px(12.0 * s))
                .bg(p.background)
                .px(px(10.0 * s))
                .py(px(8.0 * s))
                .text_size(px(13.0 * s))
                .line_height(px(24.0 * s))
                .text_color(p.foreground),
        );
        if let Some(error) = state["error"].as_str().filter(|value| !value.is_empty()) {
            body = body.child(
                div()
                    .flex_shrink_0()
                    .text_color(rgb(0xef4444))
                    .child(error.to_owned()),
            );
        }
        if state["canSend"] == false {
            body =
                body.child(div().flex_shrink_0().text_color(p.muted).child(
                    "Answers are unavailable while this chat is read-only or disconnected.",
                ));
        }
        let mut actions = div()
            .flex()
            .flex_wrap()
            .flex_shrink_0()
            .items_center()
            .gap(px(4.0 * s))
            .text_size(px(14.0 * s));
        if count > 1 {
            for (direction, label, icon, disabled) in [
                (
                    "previous",
                    "Previous question",
                    "titlebar/chevron-left.svg",
                    state["previousDisabled"] == true,
                ),
                (
                    "next",
                    "Next question",
                    "titlebar/chevron-right.svg",
                    state["nextDisabled"] == true,
                ),
            ] {
                actions = actions.child(
                    div()
                        .id(format!("async-{direction}"))
                        .role(gpui::Role::Button)
                        .aria_label(label)
                        .size(px(28.0 * s))
                        .flex()
                        .items_center()
                        .justify_center()
                        .rounded(px(8.0 * s))
                        .when(disabled, |button| button.opacity(0.5))
                        .when(!disabled, |button| {
                            button
                                .cursor_pointer()
                                .hover(|style| style.bg(p.input))
                                .on_click(cx.listener(move |this, _, _, cx| {
                                    this.invoke(
                                    json!({"type":"asyncQuestionNavigate","direction":direction}),
                                    cx,
                                )
                                }))
                        })
                        .child(svg().path(icon).size(px(16.0 * s)).text_color(p.primary)),
                );
            }
        }
        actions = actions
            .child(div().flex_1())
            .child(
                self.question_button(
                    "async-skip",
                    "Skip",
                    json!({"type":"asyncQuestionSkip"}),
                    busy,
                    true,
                    false,
                    p,
                    cx,
                )
                .text_color(p.primary)
                .font_weight(gpui::FontWeight::MEDIUM)
                .line_height(px(20.0 * s)),
            )
            .child(
                self.question_button(
                    "async-send",
                    if state["submitting"] == true {
                        "Sending…"
                    } else {
                        "Send answer"
                    },
                    json!({"type":"asyncQuestionSend"}),
                    busy || text(&state, "answer").trim().is_empty(),
                    false,
                    false,
                    p,
                    cx,
                )
                .font_weight(gpui::FontWeight::MEDIUM)
                .line_height(px(20.0 * s)),
            );
        body = body.child(actions);
        card = card.child(body);
        Some(card.into_any_element())
    }
}

fn question_spinner(scale: f32, phase: f32) -> AnyElement {
    gpui::canvas(
        |_, _, _| (),
        move |bounds, _, window, _| {
            let radius = 7.25 * scale;
            let at = |angle: f32| {
                bounds.center() + gpui::point(px(radius * angle.cos()), px(radius * angle.sin()))
            };
            let start = std::f32::consts::FRAC_PI_4 + std::f32::consts::TAU * phase;
            let mut path = gpui::PathBuilder::stroke(px(1.5 * scale));
            path.move_to(at(start));
            path.arc_to(
                gpui::point(px(radius), px(radius)),
                px(0.0),
                true,
                true,
                at(start + std::f32::consts::PI * 1.5),
            );
            if let Ok(path) = path.build() {
                window.paint_path(path, rgb(0xd99a62));
            }
        },
    )
    .size_full()
    .into_any_element()
}
