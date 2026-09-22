//! What the Browser view shows while it is asleep: a card naming the page the user left, with the button that brings it back.

use gpui::AnyElement;
use gpui::FontWeight;
use gpui::InteractiveElement as _;
use gpui::IntoElement;
use gpui::MouseButton;
use gpui::MouseDownEvent;
use gpui::ParentElement as _;
use gpui::StatefulInteractiveElement as _;
use gpui::Styled as _;
use gpui::div;
use gpui::prelude::FluentBuilder as _;
use gpui::px;
use gpui_component::v_flex;

use crate::app::helpers::*;
use crate::app::model::*;
use crate::*;

const BROWSER_SLEEPING_FAVICON_SIZE: f32 = 40.0;
const BROWSER_SLEEPING_CARD_WIDTH: f32 = 340.0;

impl GhostexGpuiApp {
    /// CDXC:Browser 2026-09-23 DECISION:
    /// User: the sleeping Browser shows "the favicon + the title of the tab", like Sharp Tabs' suspended-tab page "but better", as "a card in the middle" with "the domain below the icon" and "just ... a button says Resume". The card shows the focused pane's tab: its favicon large and bare (no tile, per the favicon decision), the site's domain, the title, and a Resume button, which is the only thing that wakes the view; clicking elsewhere does nothing. Supersedes the 2026-06-28 detail-free sleeping copy for the Browser only; the other views keep it.
    pub(crate) fn render_browser_sleeping_placeholder_card(
        &self,
        cx: &mut gpui::Context<Self>,
    ) -> AnyElement {
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
            BROWSER_SLEEPING_FAVICON_SIZE,
            tab.and_then(|tab| tab.runtime_favicon_image.as_ref()),
            tab.and_then(|tab| tab.runtime_favicon_fetch.as_ref()),
        );
        let ink = chrome_ink();

        v_flex()
            .w(px(BROWSER_SLEEPING_CARD_WIDTH))
            .max_w_full()
            .min_w_0()
            .items_center()
            .px(px(28.0))
            .pt(px(28.0))
            .pb(px(24.0))
            .rounded(px(12.0))
            .border_1()
            .border_color(ink.opacity(0.09))
            .bg(chrome_color(0x161616, 0xf7f7f7))
            .child(favicon)
            .when_some(domain, |this, domain| {
                this.child(
                    div()
                        .mt(px(10.0))
                        .max_w_full()
                        .overflow_hidden()
                        .whitespace_nowrap()
                        .text_ellipsis()
                        .text_size(px(12.0))
                        .text_color(ink.opacity(0.5))
                        .child(domain),
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
            .child(
                div()
                    .id("ghostex-gpui-browser-sleeping-resume")
                    .mt(px(20.0))
                    .flex()
                    .h(px(30.0))
                    .px(px(20.0))
                    .items_center()
                    .justify_center()
                    .rounded(px(6.0))
                    .border_1()
                    .border_color(ink.opacity(0.18))
                    .bg(ink.opacity(0.1))
                    .text_size(px(12.5))
                    .font_weight(FontWeight::SEMIBOLD)
                    .text_color(ink.opacity(0.9))
                    .cursor_pointer()
                    .hover(|this| this.bg(ink.opacity(0.16)))
                    .active(|this| this.bg(ink.opacity(0.22)))
                    .on_mouse_down(
                        MouseButton::Left,
                        cx.listener(|this, _event: &MouseDownEvent, window, cx| {
                            window.prevent_default();
                            cx.stop_propagation();
                            this.focus_project_editor_surface(TitlebarMode::Browser, window, cx);
                            cx.notify();
                        }),
                    )
                    .child("Resume"),
            )
            .into_any_element()
    }
}
