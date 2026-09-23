//! The card every sleeping view, session and pane shows: what is asleep, and how to bring it back.

use gpui::AnyElement;
use gpui::FontWeight;
use gpui::IntoElement;
use gpui::ParentElement as _;
use gpui::Styled as _;
use gpui::div;
use gpui::prelude::FluentBuilder as _;
use gpui::px;
use gpui_component::v_flex;

use crate::app::helpers::*;
use crate::app::model::*;
use crate::*;

const SLEEPING_CARD_FAVICON_SIZE: f32 = 40.0;
const SLEEPING_CARD_WIDTH: f32 = 340.0;

/// CDXC:SessionSleep 2026-09-23 DECISION:
/// User: the sleeping Browser shows "the favicon + the title of the tab", like Sharp Tabs' suspended-tab page "but better", as "a card in the middle" with "the domain below the icon" and "a button says Resume"; clicking anywhere resumes, not just the button; the domain is left out when it matches the title (never "localhost / localhost"); and "reuse this same look for ... all sleeping sessions/panes in the app", where "most should be just the title". So every sleeping view, Agents pane and command pane draws this card, centred in its body. It holds no input of its own: the body it sits in owns the click (and key) that wakes it, so the Resume button is its look, not a separate target. When click-to-wake is off the button is replaced by "Press any key to resume", which is the only wake left. Supersedes the 2026-06-27 paint-only "Press Any Key to Wake" label and the 2026-06-28 detail-free sleeping-view copy.
pub(crate) fn sleeping_card(
    icon: Option<AnyElement>,
    subtitle: Option<String>,
    title: String,
    click_to_wake: bool,
) -> AnyElement {
    let ink = chrome_ink();
    let subtitle = subtitle.filter(|subtitle| {
        let subtitle = subtitle.trim().to_lowercase();
        !subtitle.is_empty() && !title.to_lowercase().contains(&subtitle)
    });

    v_flex()
        .w(px(SLEEPING_CARD_WIDTH))
        .max_w_full()
        .min_w_0()
        .items_center()
        .px(px(28.0))
        .pt(px(if icon.is_some() { 28.0 } else { 24.0 }))
        .pb(px(24.0))
        .rounded(px(16.0))
        /*
        CDXC:Theming 2026-09-23 DECISION:
        User: the sleeping card's glass is "simpler ... not overdone", like the chat's frosted message bubble: one flat wash of the ink, no gradient, lit edge, border or drop shadow. Supersedes the same day's gradient-and-shadow card.
        */
        .bg(ink.opacity(if chrome_uses_light_appearance() {
            0.04
        } else {
            0.06
        }))
        .when_some(icon, |this, icon| this.child(icon))
        .when_some(subtitle, |this, subtitle| {
            this.child(
                div()
                    .mt(px(10.0))
                    .max_w_full()
                    .overflow_hidden()
                    .whitespace_nowrap()
                    .text_ellipsis()
                    .text_size(px(12.0))
                    .text_color(ink.opacity(0.5))
                    .child(subtitle),
            )
        })
        .child(
            div()
                .mt(px(8.0))
                .max_w_full()
                .text_center()
                .text_size(px(15.0))
                .line_height(px(21.0))
                .font_weight(FontWeight::SEMIBOLD)
                .text_color(ink.opacity(0.9))
                .line_clamp(2)
                .child(title),
        )
        .when(click_to_wake, |this| {
            this.child(
                div()
                    .mt(px(20.0))
                    .flex()
                    .h(px(30.0))
                    .px(px(20.0))
                    .items_center()
                    .justify_center()
                    .rounded(px(8.0))
                    .bg(ink.opacity(0.08))
                    .text_size(px(12.5))
                    .font_weight(FontWeight::SEMIBOLD)
                    .text_color(ink.opacity(0.9))
                    .child("Resume"),
            )
        })
        .when(!click_to_wake, |this| {
            this.child(
                div()
                    .mt(px(16.0))
                    .text_size(px(12.0))
                    .text_color(ink.opacity(0.5))
                    .child("Press any key to resume"),
            )
        })
        .into_any_element()
}

/// Centres a sleeping card over the body it belongs to without taking any of the body's input.
pub(crate) fn sleeping_card_layer(card: AnyElement) -> AnyElement {
    div()
        .absolute()
        .inset_0()
        .flex()
        .items_center()
        .justify_center()
        .p(px(16.0))
        .child(card)
        .into_any_element()
}

impl GhostexGpuiApp {
    /// The sleeping Browser's card names the focused pane's tab: its favicon, domain and title.
    pub(crate) fn render_browser_sleeping_card(&self) -> AnyElement {
        let tab = self
            .browser_tabs
            .active_tab_for_pane(self.browser_tabs.focused_pane)
            .filter(|tab| tab.state == BrowserTabState::Loaded);
        let title = tab
            .map(BrowserTab::display_title)
            .filter(|title| !title.trim().is_empty())
            .unwrap_or_else(|| "Browser".to_string());
        let domain = tab.and_then(|tab| browser_url_host(&tab.url)).map(|host| {
            host.strip_prefix("www.")
                .map(str::to_string)
                .unwrap_or(host)
        });
        let favicon = browser_favicon_element(
            SLEEPING_CARD_FAVICON_SIZE,
            tab.and_then(|tab| tab.runtime_favicon_image.as_ref()),
            tab.and_then(|tab| tab.runtime_favicon_fetch.as_ref()),
        );
        sleeping_card(Some(favicon), domain, title, true)
    }
}
