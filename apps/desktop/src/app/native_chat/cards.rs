use super::{appearance::ChatAppearance, state::NativeChatView, transcript::text};
use gpui::prelude::FluentBuilder as _;
use gpui::{
    AnyElement, Context, InteractiveElement as _, IntoElement, ParentElement as _,
    StatefulInteractiveElement as _, Styled as _, Window, div, px,
};
use serde_json::json;

impl NativeChatView {
    pub(crate) fn status_card(
        &self,
        title: String,
        icon: &'static str,
        body: Vec<AnyElement>,
        actions: Vec<AnyElement>,
        p: &ChatAppearance,
    ) -> AnyElement {
        let header = div()
            .flex()
            .items_start()
            .gap(px(8.0 * p.scale))
            .child(
                gpui::svg()
                    .path(icon)
                    .size(px(14.0 * p.scale))
                    .mt(px(4.0 * p.scale))
                    .text_color(p.muted)
                    .flex_shrink_0(),
            )
            .child(div().flex_1().text_color(p.foreground).child(title))
            .into_any_element();
        self.status_card_with_header(header, body, actions, p)
    }

    pub(crate) fn status_card_with_header(
        &self,
        header: AnyElement,
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
                    .px(px(16.0 * s))
                    .py(px(12.0 * s))
                    .bg(gpui::rgb(if p.light { 0xfdfdfd } else { 0x1e1e1e }))
                    .child(header)
                    .when(!body.is_empty(), |panel| panel.child(
                        div().flex().flex_col().gap(px(12.0 * s)).pt(px(8.0 * s)).children(body)
                    )),
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
                        .py(px(10.0 * s))
                        .border_t_1()
                        .border_color(p.border.opacity(0.65))
                        .bg(gpui::rgb(if p.light { 0xf5f5f5 } else { 0x151515 }))
                        .children(actions),
                )
            })
            .into_any_element()
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
