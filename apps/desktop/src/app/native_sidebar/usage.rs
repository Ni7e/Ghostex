// The account usage strip at the bottom of the sidebar, directly above the
// Commands row. The meters themselves are the shared renderer in
// app/titlebar/account_usage.rs; this module owns only the strip around them.

use gpui::prelude::FluentBuilder as _;
use gpui::{
    AnyElement, ClickEvent, InteractiveElement as _, IntoElement, ParentElement as _,
    StatefulInteractiveElement as _, Styled as _, Window, div, px,
};
use gpui_component::tooltip::ManagedTooltipPlacement;
use gpui_component::{h_flex, v_flex};

use super::appearance::SidebarAppearance;
use crate::GhostexGpuiApp;
use crate::app::titlebar::account_usage::{GpuiAccountUsageMeter, GpuiAccountUsageMeterHost};

/// The narrowest a meter reads at: a provider glyph plus two monospace numbers.
/// The collapsed row fits as many of these as the current sidebar width allows.
const SIDEBAR_USAGE_METER_MIN_WIDTH: f32 = 58.0;

/// The expanded grid is four meters per row, and the collapsed row never shows
/// more than one full row either.
const SIDEBAR_USAGE_MAX_COLUMNS: usize = 4;

impl GhostexGpuiApp {
    /// CDXC:Sidebar 2026-09-20 DECISION:
    /// User: the account usage meters sit at the bottom of the sidebar, above the Commands row, and start collapsed to a single row that holds as many meters as fit, the accounts closest to their limit first. No "Usage" label, no chevron and no overflow count: the strip itself is the toggle and its hover background is the whole affordance, and a click expands it to every account, four per row.
    ///
    /// CDXC:Sidebar 2026-09-20 WHY:
    /// Two clicks share this area, so the rule is fixed here: a press on a meter opens that account's usage popup and the meter swallows the click, and a click on any other part of the strip (its padding, the gaps between meters, the empty columns of the last row) toggles collapsed/expanded. The strip's own padding and the leftover column width are what make the toggle reachable while every meter is visible.
    pub(crate) fn render_native_sidebar_usage(
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
        let usable_width = (self.sidebar_width - 20.0 * scale).max(0.0);
        let columns = ((usable_width / (SIDEBAR_USAGE_METER_MIN_WIDTH * scale)).floor() as usize)
            .clamp(1, SIDEBAR_USAGE_MAX_COLUMNS);
        /*
        CDXC:Sidebar 2026-09-20 WHY:
        Expanding only ever adds the accounts the collapsed row had no column for, so with four
        accounts or fewer at the default sidebar width the two states are the same row and the
        toggle looks broken. The strip is the toggle, so when there is nothing to expand there is no
        toggle: no hover highlight, no click, and the meters keep their own popups. Making the two
        states differ some other way would have meant inventing a second presentation for the
        expanded strip that the 2026-09-19 screens do not draw.
        */
        let expandable = meters.len() > columns;
        let expanded = self.sidebar_usage_expanded && expandable;
        if !expanded {
            // Stable, so accounts that are equally far from their limit keep the
            // machine/provider/account order gxserver published them in.
            meters.sort_by(|left, right| right.pressure.total_cmp(&left.pressure));
            meters.truncate(columns);
        }

        let host = GpuiAccountUsageMeterHost {
            element_id_prefix: "native-sidebar-usage-meter",
            anchor_key_prefix: "native-sidebar-usage-meter-anchor",
            height: 24.0 * scale,
            padding_x: 4.0 * scale,
            corner_radius: 7.0 * scale,
            hover_background: appearance.hover,
            // Brighter than the strip's neutral hover, so the account whose popup is
            // open stays distinct while the whole strip is highlighted.
            open_background: appearance.session_selected,
            tooltip_placement: ManagedTooltipPlacement::Right,
            tooltip_delay: appearance.tooltip_delay,
            scale,
        };

        let rows = meters
            .chunks(columns)
            .map(|row| self.render_native_sidebar_usage_row(row, columns, &host, scale, window, cx))
            .collect::<Vec<_>>();

        Some(
            div()
                .w_full()
                .flex_shrink_0()
                .px(px(6.0 * scale))
                .pb(px(4.0 * scale))
                .child(
                    v_flex()
                        .id("native-sidebar-usage")
                        .w_full()
                        .p(px(4.0 * scale))
                        .gap(px(4.0 * scale))
                        .rounded(px(9.0 * scale))
                        .cursor_default()
                        .when(expandable, |strip| {
                            strip
                                .hover(|strip| strip.bg(appearance.hover))
                                .on_click(cx.listener(|app, _: &ClickEvent, _, cx| {
                                    cx.stop_propagation();
                                    app.toggle_native_sidebar_usage_expanded(cx);
                                }))
                        })
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
            .gap(px(2.0 * scale))
            .children(row.iter().map(|meter| {
                div()
                    .flex_1()
                    .min_w_0()
                    .flex()
                    .child(self.render_account_usage_meter(meter, host, window, cx))
            }))
            // The last expanded row keeps its columns so the meters above it stay
            // aligned; the empty ones belong to the strip, so clicking them toggles.
            .children((row.len()..columns).map(|_| div().flex_1().min_w_0().h(px(host.height))))
            .into_any_element()
    }

    pub(crate) fn toggle_native_sidebar_usage_expanded(&mut self, cx: &mut gpui::Context<Self>) {
        self.sidebar_usage_expanded = !self.sidebar_usage_expanded;
        self.persist_shell_layout_state();
        cx.notify();
    }
}
