/*!
The account-switch card: the modal-style card centered over the whole chat pane
while a Claude or Codex account switch runs. A port of `AccountSwitchCard`
(packages/core-ui/accounts/account-switch-card.tsx) and its
account-switch-card.css, drawn from the host's `accountSwitchCard` projection
(packages/shared/session-chat-controller/native-accounts.ts). The copy, steps and
usage levels come from accountSwitchCardPresentation, shared with React.

CDXC:AgentProviders 2026-09-18 SEE-ALSO: the backdrop covers the transcript and
the composer and takes the pointer until the switch finishes; a failed switch
lets the pointer through (the 2026-09-16 decision in account-switch-card.css).
The 600px and 480px container queries there are the `Layout` variants here.
*/

use super::{
    appearance::ChatAppearance, new_session_welcome::brand_logo_color, state::NativeChatView,
};
use crate::app::native_chat::cursor::ChatCursor as _;
use crate::app::window::native_modal_kit::css_mix;
use gpui::prelude::FluentBuilder as _;
use gpui::{
    Animation, AnimationExt as _, AnyElement, Context, FontWeight, Hsla, InteractiveElement as _,
    IntoElement, ParentElement as _, Rgba, StatefulInteractiveElement as _, Styled as _, div, px,
    relative, rgb, rgba, svg,
};
use serde_json::{Value, json};
use std::time::Duration;

#[derive(Clone, Copy, PartialEq)]
enum Layout {
    Wide,
    /// `@container account-switch (max-width: 600px)`: the accounts stack.
    Medium,
    /// `@container account-switch (max-width: 480px)`: pills, vertical steps.
    Narrow,
}

struct Palette {
    backdrop: Rgba,
    surface: Rgba,
    border: Rgba,
    title: Rgba,
    lede: Rgba,
    route_surface: Rgba,
    route_border: Rgba,
    role: Rgba,
    role_to: Rgba,
    identity: Rgba,
    identity_to: Rgba,
    arrow: Rgba,
    verified: Rgba,
    usage_border: Rgba,
    usage_surface: Rgba,
    usage_label: Rgba,
    usage_reset: Rgba,
    low: Rgba,
    moderate: Rgba,
    high: Rgba,
    exhausted: Rgba,
    unknown: Rgba,
    step: Rgba,
    step_border: Rgba,
    step_surface: Rgba,
    step_active: Rgba,
    step_active_surface: Rgba,
    step_active_number: Rgba,
    step_done: Rgba,
    step_done_surface: Rgba,
    step_done_border: Rgba,
    step_done_number: Rgba,
    track: Rgba,
    track_done: Rgba,
    motion: Rgba,
    success_title: Rgba,
    failed_title: Rgba,
    failure: Rgba,
}

impl Palette {
    /// The card-scoped `--as-*` variables, dark defaults and the light chat set.
    fn new(light: bool) -> Self {
        let pick = |dark: u32, light_color: u32| rgb(if light { light_color } else { dark });
        Self {
            backdrop: rgba(if light { 0x00000061 } else { 0x00000094 }),
            surface: pick(0x141414, 0xffffff),
            border: if light {
                rgba(0x0000001f)
            } else {
                rgb(0x2a2a2a)
            },
            title: pick(0xe5e5e5, 0x1f1f1f),
            lede: pick(0x929292, 0x6b6b6b),
            route_surface: pick(0x181818, 0xf6f6f6),
            route_border: if light {
                rgba(0x0000001a)
            } else {
                rgb(0x282828)
            },
            role: pick(0x858585, 0x7a7a7a),
            role_to: pick(0xa9b7b0, 0x4f6b58),
            identity: pick(0xc2c2c2, 0x3a3a3a),
            identity_to: pick(0xe3e3e3, 0x1f1f1f),
            arrow: pick(0x7d7d7d, 0x9a9a9a),
            verified: pick(0xa6c5ad, 0x3f7a52),
            usage_border: pick(0x242424, 0xe2e2e2),
            usage_surface: pick(0x191919, 0xfafafa),
            usage_label: pick(0xadadad, 0x6f6f6f),
            usage_reset: pick(0x929292, 0x808080),
            low: pick(0x96bca5, 0x3f8a57),
            moderate: pick(0xd3bd78, 0xa3801e),
            high: pick(0xdf9e70, 0xc2641f),
            exhausted: pick(0xed8585, 0xd13c3c),
            unknown: pick(0x999999, 0x8a8a8a),
            step: pick(0x797979, 0x8a8a8a),
            step_border: pick(0x303030, 0xdcdcdc),
            step_surface: pick(0x191919, 0xf3f3f3),
            step_active: pick(0xd3d3d3, 0x1f1f1f),
            step_active_surface: pick(0xd0d8d2, 0x26302a),
            step_active_number: pick(0x202722, 0xffffff),
            step_done: pick(0xa0b1a3, 0x4c7a58),
            step_done_surface: pick(0x1f2922, 0xe3efe6),
            step_done_border: pick(0x354d3d, 0xb7d3c0),
            step_done_number: pick(0xabcbb4, 0x2f6b40),
            track: pick(0x2d2d2d, 0xe4e4e4),
            track_done: pick(0x708775, 0x8db99a),
            motion: pick(0xbbcbbf, 0x4a8a5c),
            success_title: pick(0xc5d9cc, 0x2f6b40),
            failed_title: pick(0xd7bda6, 0x9a5b1c),
            failure: pick(0xa59a91, 0x7a6a5c),
        }
    }

    fn tone(&self, level: &str) -> Rgba {
        match level {
            "moderate" => self.moderate,
            "high" => self.high,
            "exhausted" => self.exhausted,
            "unknown" => self.unknown,
            _ => self.low,
        }
    }
}

fn hsla(color: Rgba) -> Hsla {
    color.into()
}

fn text(value: &Value, key: &str) -> String {
    value[key].as_str().unwrap_or_default().to_owned()
}

fn usage_card(card: &Value, layout: Layout, palette: &Palette, s: f32) -> AnyElement {
    let tone = palette.tone(card["level"].as_str().unwrap_or("unknown"));
    let used = card["used"].as_f64().map(|used| used.round() as i64);
    let base = div()
        .min_w_0()
        .border_1()
        .border_color(hsla(css_mix(tone, 0.19, palette.usage_border)))
        .bg(hsla(css_mix(tone, 0.05, palette.usage_surface)));
    // Explicit line heights: the chat root's 22.75px transcript line height must not leak in.
    let label = div()
        .text_size(px(10.0 * s))
        .line_height(px(13.0 * s))
        .text_color(hsla(palette.usage_label))
        .whitespace_nowrap()
        .child(text(card, "label"));
    if layout == Layout::Narrow {
        return base
            .flex()
            .items_baseline()
            .gap(px(5.0 * s))
            .py(px(4.0 * s))
            .px(px(9.0 * s))
            .rounded_full()
            .child(label)
            .child(
                div()
                    .flex()
                    .items_baseline()
                    .text_size(px(13.0 * s))
                    .line_height(px(16.9 * s))
                    .font_weight(FontWeight::SEMIBOLD)
                    .text_color(hsla(tone))
                    .child(used.map_or("–".to_owned(), |used| used.to_string()))
                    .when(used.is_some(), |this| {
                        this.child(
                            div()
                                .text_size(px(10.0 * s))
                                .font_weight(FontWeight::NORMAL)
                                .child("%"),
                        )
                    }),
            )
            .into_any_element();
    }
    let reset = card["reset"].as_str().map(str::to_owned);
    base.flex_1()
        .flex_basis(px(0.0))
        .flex()
        .flex_col()
        .items_center()
        .pt(px(12.0 * s))
        .px(px(4.0 * s))
        .pb(px(10.0 * s))
        .rounded(px(10.0 * s))
        .child(label)
        .child(
            div()
                .mt(px(8.0 * s))
                .flex()
                .items_baseline()
                .text_size(px(23.0 * s))
                .line_height(px(27.6 * s))
                .font_weight(FontWeight::SEMIBOLD)
                .text_color(hsla(tone))
                .child(used.map_or("–".to_owned(), |used| used.to_string()))
                .when(used.is_some(), |this| {
                    this.child(
                        div()
                            .ml(px(1.0 * s))
                            .text_size(px(12.0 * s))
                            .font_weight(FontWeight::NORMAL)
                            .child("%"),
                    )
                }),
        )
        .child(
            div()
                .mt(px(12.0 * s))
                .flex()
                .items_center()
                .justify_center()
                .gap(px(3.0 * s))
                .text_size(px(9.0 * s))
                .line_height(px(11.5 * s))
                .whitespace_nowrap()
                .text_color(hsla(palette.usage_reset))
                .when(reset.is_some(), |this| {
                    this.child(
                        svg()
                            .path("titlebar/refresh.svg")
                            .flex_shrink_0()
                            .size(px(10.0 * s))
                            .text_color(hsla(palette.usage_reset)),
                    )
                })
                .child(reset.unwrap_or_else(|| "–".to_owned())),
        )
        .into_any_element()
}

fn account(
    value: &Value,
    provider: &str,
    verified: bool,
    layout: Layout,
    palette: &Palette,
    appearance: &ChatAppearance,
) -> AnyElement {
    let s = appearance.scale;
    let target = value["target"] == true;
    let mark = if layout == Layout::Narrow {
        (20.0, 19.0)
    } else {
        (26.0, 25.0)
    };
    let mut cards = div()
        .flex()
        .gap(px(if layout == Layout::Narrow { 6.0 } else { 7.0 } * s));
    if layout == Layout::Narrow {
        cards = cards.flex_wrap();
    }
    for card in value["usage"].as_array().into_iter().flatten() {
        cards = cards.child(usage_card(card, layout, palette, s));
    }
    div()
        .flex_1()
        .flex_basis(px(0.0))
        .min_w_0()
        .flex()
        .flex_col()
        .child(
            div()
                .mb(px(if layout == Layout::Narrow { 8.0 } else { 13.0 } * s))
                .text_size(px(10.0 * s))
                .line_height(px(13.0 * s))
                .text_color(hsla(if target {
                    palette.role_to
                } else {
                    palette.role
                }))
                .child(text(value, "role").to_uppercase()),
        )
        .child(
            div()
                .flex()
                .items_center()
                .gap(px(match layout {
                    Layout::Wide => 10.0,
                    Layout::Medium => 7.0,
                    Layout::Narrow => 8.0,
                } * s))
                .mb(px(match layout {
                    Layout::Wide => 23.0,
                    Layout::Medium => 16.0,
                    Layout::Narrow => 10.0,
                } * s))
                .child(
                    div()
                        .flex_shrink_0()
                        .size(px(mark.0 * s))
                        .flex()
                        .items_center()
                        .justify_center()
                        .child(
                            svg()
                                .path(format!("agent-icons/{provider}.svg"))
                                .size(px(mark.1 * s))
                                .text_color(brand_logo_color(provider, appearance)),
                        ),
                )
                .child(
                    div()
                        .flex_1()
                        .min_w_0()
                        .truncate()
                        .text_size(px(if layout == Layout::Wide { 14.0 } else { 13.0 } * s))
                        .line_height(px(20.0 * s))
                        .font_weight(FontWeight::MEDIUM)
                        .text_color(hsla(if target {
                            palette.identity_to
                        } else {
                            palette.identity
                        }))
                        .child(text(value, "label")),
                )
                .when(target && verified, |this| {
                    this.child(
                        svg()
                            .path("titlebar/check.svg")
                            .flex_shrink_0()
                            .size(px(15.0 * s))
                            .text_color(hsla(palette.verified)),
                    )
                }),
        )
        .child(cards)
        .into_any_element()
}

fn step(
    index: usize,
    value: &Value,
    id: &str,
    layout: Layout,
    palette: &Palette,
    s: f32,
) -> AnyElement {
    let state = value["state"].as_str().unwrap_or("pending");
    let (color, marker_bg, marker_border, number) = match state {
        "active" => (
            palette.step_active,
            palette.step_active_surface,
            palette.step_active_surface,
            palette.step_active_number,
        ),
        "done" => (
            palette.step_done,
            palette.step_done_surface,
            palette.step_done_border,
            palette.step_done_number,
        ),
        _ => (
            palette.step,
            palette.step_surface,
            palette.step_border,
            palette.step,
        ),
    };
    let mut track = div()
        .relative()
        .h(px(2.0 * s))
        .w_full()
        .rounded(px(2.0 * s))
        .overflow_hidden()
        .bg(hsla(if state == "done" {
            palette.track_done
        } else {
            palette.track
        }));
    if state == "active" {
        // `gx-account-switch-step-progress`: a 36% bar sliding from -105% to 285% of its width.
        track = track.child(
            div()
                .absolute()
                .top_0()
                .h_full()
                .w(relative(0.36))
                .rounded(px(2.0 * s))
                .bg(hsla(palette.motion))
                .with_animation(
                    gpui::ElementId::Name(format!("account-switch-motion:{id}:{index}").into()),
                    Animation::new(Duration::from_millis(1800))
                        .repeat()
                        .with_easing(gpui::ease_in_out),
                    |bar, delta| bar.left(relative(-0.378 + 1.404 * delta)),
                ),
        );
    }
    let label = div()
        .line_height(px(15.4 * s))
        .when(layout == Layout::Medium, |this| {
            this.min_h(px(30.8 * s)).text_center()
        })
        .child(text(value, "label"));
    let copy = div()
        .flex()
        .flex_col()
        .flex_1()
        .min_w_0()
        .gap(px(if layout == Layout::Narrow { 6.0 } else { 8.0 } * s))
        .when(layout == Layout::Medium, |this| this.w_full())
        .child(label)
        .child(track);
    div()
        .min_w_0()
        .flex()
        .gap(px(10.0 * s))
        .text_size(px(11.0 * s))
        .text_color(hsla(color))
        .when(layout == Layout::Medium, |this| {
            this.flex_col().items_center()
        })
        .when(layout != Layout::Medium, |this| this.items_center())
        .when(layout != Layout::Narrow, |this| {
            this.flex_1().flex_basis(px(0.0))
        })
        .child(
            div()
                .flex_shrink_0()
                .size(px(23.0 * s))
                .flex()
                .items_center()
                .justify_center()
                .rounded_full()
                .border_1()
                .border_color(hsla(marker_border))
                .bg(hsla(marker_bg))
                .text_size(px(11.0 * s))
                .font_weight(FontWeight::MEDIUM)
                .text_color(hsla(number))
                .child((index + 1).to_string()),
        )
        .child(copy)
        .into_any_element()
}

impl NativeChatView {
    /// The overlay React renders as `.gx-account-switch-overlay` while `accountStatus.visible` holds.
    pub(crate) fn render_account_switch_card(
        &self,
        appearance: &ChatAppearance,
        cx: &mut Context<Self>,
    ) -> Option<AnyElement> {
        let card = &self.snapshot["accountSwitchCard"];
        if !card.is_object() {
            return None;
        }
        let s = appearance.scale;
        let palette = Palette::new(appearance.light);
        let id = text(card, "id");
        let provider = card["provider"].as_str().unwrap_or("claude");
        let verified = card["verified"] == true;
        let phase = card["phase"].as_str().unwrap_or("switching");
        let region = f32::from(self.bounds.get().size.width) / s - 32.0;
        let layout = if region <= 480.0 {
            Layout::Narrow
        } else if region <= 600.0 {
            Layout::Medium
        } else {
            Layout::Wide
        };
        let narrow = layout == Layout::Narrow;
        let (heading_pad, title_size, lede_size) = match layout {
            Layout::Wide => ((25.0, 26.0, 22.0), 18.0, 13.0),
            Layout::Medium => ((22.0, 20.0, 20.0), 17.0, 12.0),
            Layout::Narrow => ((18.0, 16.0, 14.0), 16.0, 12.0),
        };
        let inset = match layout {
            Layout::Wide => 26.0,
            Layout::Medium => 20.0,
            Layout::Narrow => 14.0,
        };
        let heading = div()
            .id("account-switch-heading")
            .role(gpui::Role::Status)
            .pt(px(heading_pad.0 * s))
            .px(px(heading_pad.1 * s))
            .pb(px(heading_pad.2 * s))
            .child(
                div()
                    .mb(px(if narrow { 4.0 } else { 7.0 } * s))
                    .text_size(px(title_size * s))
                    .line_height(px(title_size * 1.4 * s))
                    .font_weight(FontWeight::SEMIBOLD)
                    .text_color(hsla(match phase {
                        "success" => palette.success_title,
                        "failed" => palette.failed_title,
                        _ => palette.title,
                    }))
                    .child(text(card, "heading")),
            )
            .child(
                div()
                    .text_size(px(lede_size * s))
                    .line_height(px(lede_size * if narrow { 1.5 } else { 1.6 } * s))
                    .text_color(hsla(palette.lede))
                    .child(text(card, "lede")),
            );
        let from = account(
            &card["from"],
            provider,
            verified,
            layout,
            &palette,
            appearance,
        );
        let to = account(
            &card["to"],
            provider,
            verified,
            layout,
            &palette,
            appearance,
        );
        let mut route = div()
            .mx(px(inset * s))
            .border_1()
            .border_color(hsla(palette.route_border))
            .rounded(px(14.0 * s))
            .bg(hsla(palette.route_surface))
            .flex();
        route = match layout {
            Layout::Wide => route
                .items_start()
                .gap(px(20.0 * s))
                .pt(px(18.0 * s))
                .px(px(20.0 * s))
                .pb(px(20.0 * s))
                .child(from)
                .child(
                    svg()
                        .path("titlebar/arrow-right.svg")
                        .flex_shrink_0()
                        .mt(px(36.0 * s))
                        .size(px(17.0 * s))
                        .text_color(hsla(palette.arrow)),
                )
                .child(to),
            Layout::Medium | Layout::Narrow => route
                .flex_col()
                .gap(px(if narrow { 12.0 } else { 24.0 } * s))
                .when(narrow, |this| {
                    this.pt(px(12.0 * s)).px(px(14.0 * s)).pb(px(14.0 * s))
                })
                .when(!narrow, |this| this.p(px(16.0 * s)))
                .child(from)
                .child(to),
        };
        let footer = if let Some(steps) = card["steps"].as_array() {
            let mut list = div()
                .id("account-switch-steps")
                .role(gpui::Role::List)
                .flex();
            list = match layout {
                Layout::Wide => list
                    .gap(px(22.0 * s))
                    .pt(px(22.0 * s))
                    .px(px(26.0 * s))
                    .pb(px(24.0 * s)),
                Layout::Medium => list.gap(px(8.0 * s)).p(px(20.0 * s)),
                Layout::Narrow => list
                    .flex_col()
                    .gap(px(10.0 * s))
                    .pt(px(14.0 * s))
                    .px(px(16.0 * s))
                    .pb(px(16.0 * s)),
            };
            for (index, value) in steps.iter().enumerate() {
                list = list.child(step(index, value, &id, layout, &palette, s));
            }
            list.into_any_element()
        } else {
            let retry = card["retry"].clone();
            div()
                .id("account-switch-failure")
                .role(gpui::Role::Alert)
                .mt(px(if narrow { 14.0 } else { 20.0 } * s))
                .mx(px(if narrow { 16.0 } else { 26.0 } * s))
                .mb(px(if narrow { 16.0 } else { 24.0 } * s))
                .text_size(px(12.0 * s))
                .line_height(px(20.4 * s))
                .text_color(hsla(palette.failure))
                .child(div().mb(px(14.0 * s)).child(text(card, "failure")))
                .when(retry.is_object(), |this| {
                    let busy = retry["busy"] == true;
                    let command = json!({"type":"accounts","request":{"operation":"select","accountId":retry["accountId"]}});
                    this.child(
                        div().flex().child(
                            div()
                                .id("account-switch-retry")
                                .role(gpui::Role::Button)
                                .aria_label("Retry switch")
                                .h(px(28.0 * s))
                                .px(px(10.0 * s))
                                .flex()
                                .items_center()
                                .gap(px(6.0 * s))
                                .rounded(px(8.0 * s))
                                .border_1()
                                .border_color(hsla(palette.border))
                                .text_size(px(11.0 * s))
                                .text_color(hsla(palette.title))
                                .when(busy, |this| this.opacity(0.5))
                                .when(!busy, |this| {
                                    this.chat_cursor_pointer()
                                        .hover(|style| style.bg(hsla(palette.route_surface)))
                                        .on_click(cx.listener(move |this, _, _, cx| {
                                            this.invoke(command.clone(), cx)
                                        }))
                                })
                                .child(
                                    svg()
                                        .path("titlebar/refresh.svg")
                                        .size(px(14.0 * s))
                                        .text_color(hsla(palette.title)),
                                )
                                .child("Retry switch"),
                        ),
                    )
                })
                .into_any_element()
        };
        let card_element = div()
            .id("account-switch-card")
            .role(gpui::Role::Group)
            .aria_label("Account switch status")
            .relative()
            .w_full()
            .max_w(px(610.0 * s))
            .flex_shrink_0()
            // Auto margins center the card like `align-items: safe center`: a card taller
            // than the pane starts at the top and scrolls instead of clipping.
            .my_auto()
            .rounded(px(if narrow { 16.0 } else { 22.0 } * s))
            .border_1()
            .border_color(hsla(palette.border))
            .bg(hsla(palette.surface))
            .shadow(vec![gpui::BoxShadow {
                color: hsla(rgba(0x00000073)),
                offset: gpui::point(px(0.0), px(18.0 * s)),
                blur_radius: px(48.0 * s),
                spread_radius: px(0.0),
                inset: false,
            }])
            .overflow_hidden()
            .occlude()
            .child(heading)
            .child(route)
            .child(footer)
            .with_animation(
                gpui::ElementId::Name(format!("account-switch-card:{id}").into()),
                Animation::new(Duration::from_millis(260)).with_easing(gpui::ease_out_quint()),
                move |card, delta| card.opacity(delta).top(px((1.0 - delta) * 14.0 * s)),
            );
        Some(
            div()
                .id("account-switch-overlay")
                .absolute()
                .top_0()
                .left_0()
                .size_full()
                .bg(hsla(palette.backdrop))
                // A switch in flight blocks the pane; a failed one lets the pointer through.
                .when(phase != "failed", |this| this.occlude())
                .flex()
                .flex_col()
                .items_center()
                .overflow_y_scroll()
                .py(px(24.0 * s))
                .px(px(16.0 * s))
                .font_family(appearance.font.clone())
                .child(card_element)
                .with_animation(
                    gpui::ElementId::Name(format!("account-switch-backdrop:{id}").into()),
                    Animation::new(Duration::from_millis(180)).with_easing(gpui::ease_out_quint()),
                    |overlay, delta| overlay.opacity(delta),
                )
                .into_any_element(),
        )
    }
}
