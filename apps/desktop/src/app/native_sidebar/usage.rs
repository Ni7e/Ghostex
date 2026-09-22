// The account usage strip at the bottom of the sidebar, directly above the
// Commands row. The meters themselves are the shared renderer in
// app/titlebar/account_usage.rs; this module owns only the strip around them.

use gpui::prelude::FluentBuilder as _;
use gpui::{
    AnyElement, InteractiveElement as _, IntoElement, ParentElement as _,
    StatefulInteractiveElement as _, Styled as _, Window, deferred, div, px,
};
use gpui_component::tooltip::ManagedTooltipExt as _;
use gpui_component::tooltip::ManagedTooltipPlacement;
use gpui_component::{h_flex, v_flex};

use super::appearance::SidebarAppearance;
use crate::GhostexGpuiApp;
use crate::app::helpers::*;
use crate::app::titlebar::account_usage::{
    ACCOUNT_USAGE_BADGE_GAP, ACCOUNT_USAGE_BADGE_GLYPH_WIDTH, ACCOUNT_USAGE_BADGE_TEXT_SIZE,
    GpuiAccountUsageMeter, GpuiAccountUsageMeterHost,
};

/// The narrowest a meter reads at: a provider glyph plus two monospace numbers.
/// The strip fits as many of these per row as the current sidebar width allows.
const SIDEBAR_USAGE_METER_MIN_WIDTH: f32 = 58.0;

/// Four meters per row, whatever the sidebar's width allows below that.
const SIDEBAR_USAGE_MAX_COLUMNS: usize = 4;

/// The space between two cards, and between two rows of them.
const SIDEBAR_USAGE_GAP: f32 = 4.0;

/// The strip's own inset. The cards fill the width left between these two edges,
/// so this is also the gap the user sees before the first card and after the last.
const SIDEBAR_USAGE_INSET: f32 = 8.0;

/// One monospaced character cell as a fraction of the badge's text size. Only the clamp
/// in `align_badge_columns` reads it, and it errs high on purpose: over-estimating a cell
/// pads one character less, while under-estimating would let a card overflow its column.
const SIDEBAR_USAGE_BADGE_ADVANCE: f32 = 0.65;

/// The Commands row's height and top padding (navigation.rs); the peek sits on the row.
const SIDEBAR_FOOTER_ROW_HEIGHT: f32 = 36.0;
const SIDEBAR_FOOTER_ROW_TOP_PADDING: f32 = 5.0;

/// An account this close to its limit lights the Commands row's pin while the
/// strip is unpinned, so putting the strip away never puts the warning away.
const SIDEBAR_USAGE_ALERT_PRESSURE: f64 = 0.9;

impl GhostexGpuiApp {
    /// CDXC:Sidebar 2026-09-22 DECISION:
    /// User: hovering the account usage button at the bottom of the sidebar shows the accounts floating over the bottom of the list, without pushing the content or the scroll area; the button itself looks like a pin, and clicking it pins the strip in place, where it sits above the Commands row as before. This supersedes the 2026-09-20 rule that the chart button was a plain show/hide toggle: a click still pins and unpins, and a hover now peeks.
    ///
    /// CDXC:Sidebar 2026-09-20 DECISION:
    /// User: each meter is a card with its own background, the cards fill their column so the rows line up, and their content is centred, which is the `space-around` look the user asked for: the gap from the sidebar's edge to the first card's content matches the gap from the last card's content to the other edge. The strip also sits lower, with more room between the session list and the first row of cards.
    ///
    /// CDXC:Sidebar 2026-09-20 WHY:
    /// The strip itself takes no click any more. A press on a meter still opens that account's usage popup, and the strip's padding and its leftover columns are inert, so the only way in and out is the Commands row button.
    pub(crate) fn render_native_sidebar_usage(
        &self,
        appearance: &SidebarAppearance,
        window: &mut Window,
        cx: &mut gpui::Context<Self>,
    ) -> Option<AnyElement> {
        if !self.sidebar_usage_visible {
            return None;
        }
        self.render_native_sidebar_usage_strip(appearance, window, cx)
    }

    /// The unpinned strip, floating over the bottom of the list while the pin or the strip
    /// itself is hovered. It is a deferred, absolutely placed child of the sidebar root, so the
    /// list and its scroll area keep their size.
    pub(crate) fn render_native_sidebar_usage_peek(
        &self,
        appearance: &SidebarAppearance,
        window: &mut Window,
        cx: &mut gpui::Context<Self>,
    ) -> Option<AnyElement> {
        if self.sidebar_usage_visible
            || !(self.native_sidebar.usage_pin_hovered || self.native_sidebar.usage_peek_hovered)
        {
            return None;
        }
        let strip = self.render_native_sidebar_usage_strip(appearance, window, cx)?;
        let scale = appearance.scale;
        // The peek's box reaches down to the top of the pin's own hitbox (the Commands row's
        // 5px top padding sits between them), so a pointer sliding from the pin up into a card
        // never crosses a strip of nothing that would have closed the peek halfway.
        let bottom = (SIDEBAR_FOOTER_ROW_HEIGHT - SIDEBAR_FOOTER_ROW_TOP_PADDING) * scale;
        Some(
            deferred(
                div()
                    .id("native-sidebar-usage-peek")
                    .absolute()
                    .left_0()
                    .right_0()
                    .bottom(px(bottom))
                    .bg(titlebar_background())
                    .border_t_1()
                    .border_color(appearance.hover)
                    .on_hover(cx.listener(|app, hovered: &bool, _, cx| {
                        if app.native_sidebar.usage_peek_hovered != *hovered {
                            app.native_sidebar.usage_peek_hovered = *hovered;
                            cx.notify();
                        }
                    }))
                    .child(strip),
            )
            .with_priority(6)
            .into_any_element(),
        )
    }

    fn render_native_sidebar_usage_strip(
        &self,
        appearance: &SidebarAppearance,
        window: &mut Window,
        cx: &mut gpui::Context<Self>,
    ) -> Option<AnyElement> {
        let mut meters = self.account_usage_meters();
        if meters.is_empty() {
            return None;
        }
        let scale = appearance.scale;
        let gap = SIDEBAR_USAGE_GAP * scale;
        // Every column but the last carries a gap, so the row fits one more card than
        // the plain division would allow.
        let usable_width = (self.sidebar_width - 2.0 * SIDEBAR_USAGE_INSET * scale + gap).max(0.0);
        let columns = ((usable_width / (SIDEBAR_USAGE_METER_MIN_WIDTH * scale + gap)).floor()
            as usize)
            .clamp(1, SIDEBAR_USAGE_MAX_COLUMNS);

        /*
        CDXC:Sidebar 2026-09-20 WHY:
        Resting, hovered and popup-open have to stay three separable fills now that resting is a
        filled card. The old neutral hover (grey at 0.12) landed within a point of the card on the
        sidebar's dark fill and simply vanished, so each state is a step of the same ink instead.
        */
        let (card, card_hover, card_open) = if appearance.light {
            (
                gpui::rgb(0x000000).opacity(0.05),
                gpui::rgb(0x000000).opacity(0.10),
                gpui::rgb(0x000000).opacity(0.17),
            )
        } else {
            (
                gpui::rgb(0xffffff).opacity(0.05),
                gpui::rgb(0xffffff).opacity(0.11),
                gpui::rgb(0xffffff).opacity(0.20),
            )
        };
        let host = GpuiAccountUsageMeterHost {
            element_id_prefix: "native-sidebar-usage-meter",
            anchor_key_prefix: "native-sidebar-usage-meter-anchor",
            height: 26.0 * scale,
            padding_x: 4.0 * scale,
            corner_radius: 7.0 * scale,
            background: card.into(),
            fill_width: true,
            hover_background: card_hover.into(),
            // Brighter than the hovered card, so the account whose popup is open
            // stays distinct from the one merely under the pointer.
            open_background: card_open.into(),
            scale,
        };

        align_badge_columns(&mut meters, &host, columns, self.sidebar_width);

        let rows = meters
            .chunks(columns)
            .map(|row| self.render_native_sidebar_usage_row(row, columns, &host, scale, window, cx))
            .collect::<Vec<_>>();

        Some(
            div()
                .w_full()
                .flex_shrink_0()
                .px(px(SIDEBAR_USAGE_INSET * scale))
                .pt(px(10.0 * scale))
                .pb(px(4.0 * scale))
                .child(
                    v_flex()
                        .w_full()
                        .gap(px(SIDEBAR_USAGE_GAP * scale))
                        .cursor_default()
                        .children(rows),
                )
                .into_any_element(),
        )
    }

    fn render_native_sidebar_usage_row(
        &self,
        row: &[GpuiAccountUsageMeter],
        columns: usize,
        host: &GpuiAccountUsageMeterHost,
        scale: f32,
        window: &mut Window,
        cx: &mut gpui::Context<Self>,
    ) -> AnyElement {
        h_flex()
            .w_full()
            .gap(px(SIDEBAR_USAGE_GAP * scale))
            .children(row.iter().map(|meter| {
                div()
                    .flex_1()
                    .min_w_0()
                    .flex()
                    .child(self.render_account_usage_meter(meter, host, window, cx))
            }))
            // The last row keeps its empty columns so the cards above them stay aligned.
            .children((row.len()..columns).map(|_| div().flex_1().min_w_0().h(px(host.height))))
            .into_any_element()
    }

    /// The Commands row's account-usage pin: hovering it peeks the strip, clicking it
    /// pins or unpins it. It carries a dot while the strip is unpinned and an account is
    /// close to a limit, so putting the meters away never puts the warning away.
    pub(crate) fn render_native_sidebar_usage_toggle(
        &self,
        appearance: &SidebarAppearance,
        cx: &mut gpui::Context<Self>,
    ) -> Option<AnyElement> {
        // One pass over the accounts per frame: the button exists only once an
        // account is starred, and the same list decides whether it is alerting.
        let meters = self.account_usage_meters();
        if meters.is_empty() {
            return None;
        }
        let scale = appearance.scale;
        let visible = self.sidebar_usage_visible;
        let alerting = !visible
            && meters
                .iter()
                .any(|meter| meter.pressure >= SIDEBAR_USAGE_ALERT_PRESSURE);
        let tooltip_delay = appearance.tooltip_delay;
        Some(
            div()
                .id("native-sidebar-usage-toggle")
                .role(gpui::Role::Button)
                .aria_label("Account usage")
                .relative()
                .h(px(28.0 * scale))
                .w(px(34.0 * scale))
                .mr(px(2.0 * scale))
                .rounded(px(5.0 * scale))
                .flex()
                .flex_shrink_0()
                .items_center()
                .justify_center()
                .cursor_default()
                .when(visible, |button| button.bg(appearance.hover))
                .hover(|button| button.bg(appearance.hover))
                .on_hover(cx.listener(|app, hovered: &bool, _, cx| {
                    if app.native_sidebar.usage_pin_hovered != *hovered {
                        app.native_sidebar.usage_pin_hovered = *hovered;
                        cx.notify();
                    }
                }))
                .child(titlebar_svg_icon(
                    if visible {
                        "titlebar/pin-filled.svg"
                    } else {
                        "titlebar/pin.svg"
                    },
                    15.0 * scale,
                    if visible {
                        titlebar_active_text_color()
                    } else {
                        appearance.muted
                    },
                ))
                .when(alerting, |button| {
                    button.child(
                        div()
                            .absolute()
                            .top(px(5.0 * scale))
                            .right(px(6.0 * scale))
                            .size(px(5.0 * scale))
                            .rounded_full()
                            .bg(chrome_color(0xe2a06a, 0xb4642a)),
                    )
                })
                .on_click(cx.listener(|app, _, _, cx| {
                    cx.stop_propagation();
                    app.toggle_native_sidebar_usage_visible(cx);
                }))
                .managed_discrete_tooltip_with_placement(
                    ManagedTooltipPlacement::Right,
                    tooltip_delay,
                    move |window, cx| {
                        titlebar_tooltip(
                            if visible {
                                "Unpin account usage"
                            } else {
                                "Pin account usage"
                            },
                            window,
                            cx,
                        )
                    },
                )
                .into_any_element(),
        )
    }

    pub(crate) fn toggle_native_sidebar_usage_visible(&mut self, cx: &mut gpui::Context<Self>) {
        self.sidebar_usage_visible = !self.sidebar_usage_visible;
        self.persist_shell_layout_state();
        cx.notify();
    }
}

/// CDXC:Sidebar 2026-09-20 DECISION:
/// User: a card in one row must line up with the card above it. A card centres its glyph and its
/// number block as one group, so a short block ("5%" over "10%") pushed its glyph right of the wider
/// one ("100%" over "0rs") in the row above. Every line is padded on the left to the width of the
/// longest line in the strip, which the monospaced badge font makes exact, so every card's content
/// is the same width, every glyph sits at the same place in its column, and the numbers right-align
/// on their last character inside a card as well.
///
/// CDXC:Sidebar 2026-09-20 DECISION:
/// User: the padding is clamped to the characters a column can actually show. A Codex line like
/// "100/45%" is seven cells, and widening all eight cards to match it would have made every card
/// clip on a narrow sidebar instead of only that one; a strip that cannot align without clipping
/// stays unaligned instead.
fn align_badge_columns(
    meters: &mut [GpuiAccountUsageMeter],
    host: &GpuiAccountUsageMeterHost,
    columns: usize,
    sidebar_width: f32,
) {
    let longest = meters
        .iter()
        .flat_map(|meter| meter.badge_lines.iter())
        .map(|line| line.chars().count())
        .max()
        .unwrap_or(0);
    if longest == 0 {
        return;
    }
    let scale = host.scale;
    let gap = SIDEBAR_USAGE_GAP * scale;
    let column_width = (sidebar_width
        - 2.0 * SIDEBAR_USAGE_INSET * scale
        - columns.saturating_sub(1) as f32 * gap)
        / columns.max(1) as f32;
    let room = column_width
        - 2.0 * host.padding_x
        - ACCOUNT_USAGE_BADGE_GLYPH_WIDTH * scale
        - ACCOUNT_USAGE_BADGE_GAP * scale;
    let cell = ACCOUNT_USAGE_BADGE_TEXT_SIZE * scale * SIDEBAR_USAGE_BADGE_ADVANCE;
    let fits = if cell > 0.0 {
        (room / cell).floor().max(1.0) as usize
    } else {
        longest
    };
    let width = longest.min(fits);
    for line in meters
        .iter_mut()
        .flat_map(|meter| meter.badge_lines.iter_mut())
    {
        if line.chars().count() < width {
            *line = format!("{line:>width$}");
        }
    }
}
