use super::{appearance::ChatAppearance, state::NativeChatView};
use gpui::prelude::FluentBuilder as _;
use gpui::{AnyElement, IntoElement, ParentElement as _, Styled as _, div, px};

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
        let has_actions = !actions.is_empty();
        let panel_color = p.card_panel;
        let footer_color = p.card_footer;
        div()
            .w_full()
            .min_w_0()
            .flex()
            .flex_col()
            .border_1()
            .border_color(p.input_border)
            .rounded(px(12.0 * s))
            // CDXC:SessionChat 2026-09-18 WHY:
            // GPUI overflow masks are rectangular, so a square child fill leaked beyond the status card's rounded corners.
            // Paint the outer tone on the rounded shell and round only the inset panel's top corners when a footer supplies the bottom tone.
            .bg(if has_actions {
                footer_color
            } else {
                panel_color
            })
            .overflow_hidden()
            .text_color(p.card_muted)
            .child(
                div()
                    .flex()
                    .flex_col()
                    .px(px(16.0 * s))
                    .py(px(12.0 * s))
                    .when(has_actions, |panel| {
                        panel
                            .rounded_t(px((12.0 * s - 1.0).max(0.0)))
                            .bg(panel_color)
                    })
                    .child(header)
                    .when(!body.is_empty(), |panel| {
                        panel.child(
                            div()
                                .flex()
                                .flex_col()
                                .gap(px(12.0 * s))
                                .pt(px(8.0 * s))
                                .children(body),
                        )
                    }),
            )
            .when(has_actions, |this| {
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
                        .border_color(p.control_border.opacity(0.65))
                        .children(actions),
                )
            })
            .into_any_element()
    }
}
