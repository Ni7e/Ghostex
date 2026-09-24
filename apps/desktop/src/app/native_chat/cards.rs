use super::{appearance::ChatAppearance, state::NativeChatView};
use gpui::prelude::FluentBuilder as _;
use gpui::{
    AnyElement, Div, Hsla, InteractiveElement as _, IntoElement, ParentElement as _, Stateful,
    Styled as _, div, px,
};

/// The fill a pressable card, or the pressable header of one, takes under the pointer.
pub(super) fn card_hover_fill(p: &ChatAppearance) -> Hsla {
    p.foreground.opacity(0.04)
}

/// CDXC:SessionChat 2026-09-23 DECISION:
/// User: "when i hover over this kind of card, you're making the only middle part change color, I want all of it to change color", and the same for "all very similar components in the chat view". A status card's pressable header reaches out to the card's own edges, so its hover lights the whole card while the card is folded to that header, and the card's full width above its body when it is open, never a band inside the padding.
/// SEE-ALSO: `.ghostex-chat-status-card-header` in packages/core-ui/chat/session-chat-status-card.css, whose 2026-09-16 decision already gives React's collapsible cards this hover and whose spacing this copies.
///
/// `has_body` is whether the card shows a body under the header, and `has_actions` whether a footer follows the panel; a header with neither below it is the whole card and rounds every corner.
pub(super) fn status_card_press_header(
    header: Stateful<Div>,
    has_body: bool,
    has_actions: bool,
    p: &ChatAppearance,
) -> Stateful<Div> {
    let s = p.scale;
    // The panel's padding, which the header takes back so its fill meets the card's border.
    let (pad_x, pad_y) = (16.0 * s, 12.0 * s);
    let radius = px((12.0 * s - 1.0).max(0.0));
    let hover = card_hover_fill(p);
    header
        .mx(px(-pad_x))
        .mt(px(-pad_y))
        .px(px(pad_x))
        .pt(px(pad_y))
        .when(has_body, |this| this.mb(px(-2.0 * s)).pb(px(6.0 * s)))
        .when(!has_body, |this| this.mb(px(-pad_y)).pb(px(pad_y)))
        .map(|this| {
            if has_body || has_actions {
                this.rounded_t(radius)
            } else {
                this.rounded(radius)
            }
        })
        .hover(move |style| style.bg(hover))
}

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
