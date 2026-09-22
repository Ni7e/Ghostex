//! What the Browser view shows while it is asleep: the page the user left, so they know what a click brings back.

use gpui::AnyElement;
use gpui::FontWeight;
use gpui::InteractiveElement as _;
use gpui::IntoElement;
use gpui::ParentElement as _;
use gpui::Styled as _;
use gpui::div;
use gpui::prelude::FluentBuilder as _;
use gpui::px;
use gpui_component::h_flex;
use gpui_component::v_flex;

use crate::app::consts::*;
use crate::app::helpers::*;
use crate::app::model::*;
use crate::*;

pub(crate) const BROWSER_SLEEPING_PLACEHOLDER_GROUP: &str =
    "ghostex-gpui-browser-sleeping-placeholder";

const BROWSER_SLEEPING_FAVICON_SIZE: f32 = 40.0;

impl GhostexGpuiApp {
    /// CDXC:Browser 2026-09-22 DECISION:
    /// User: the sleeping Browser shows "the favicon + the title of the tab", like Sharp Tabs' suspended-tab page "but better". It shows the focused pane's tab: its favicon large and bare (no tile, per the favicon decision), its title, and the site's host, above a quiet "Asleep · Click anywhere to wake" hint that brightens while the pointer is over the view. Supersedes the 2026-06-28 detail-free sleeping copy for the Browser only; the other views keep it.
    pub(crate) fn render_browser_sleeping_placeholder_content(&self) -> AnyElement {
        let tab = self
            .browser_tabs
            .active_tab_for_pane(self.browser_tabs.focused_pane)
            .filter(|tab| tab.state == BrowserTabState::Loaded);
        let title = tab
            .map(BrowserTab::display_title)
            .filter(|title| !title.trim().is_empty())
            .unwrap_or_else(|| "Browser".to_string());
        let host = tab.and_then(|tab| browser_url_host(&tab.url)).map(|host| {
            host.strip_prefix("www.")
                .map(str::to_string)
                .unwrap_or(host)
        });
        let favicon = browser_favicon_element(
            BROWSER_SLEEPING_FAVICON_SIZE,
            tab.and_then(|tab| tab.runtime_favicon_image.as_ref()),
            tab.and_then(|tab| tab.runtime_favicon_fetch.as_ref()),
        );
        let ink = chrome_color(0xe5e8ec, 0x111111);

        v_flex()
            .max_w(px(460.0))
            .min_w_0()
            .items_center()
            .px(px(24.0))
            .child(favicon)
            .child(
                div()
                    .mt(px(16.0))
                    .max_w_full()
                    .text_center()
                    .text_size(px(17.0))
                    .line_height(px(23.0))
                    .font_weight(FontWeight::SEMIBOLD)
                    .text_color(ink.opacity(0.9))
                    .line_clamp(2)
                    .child(title),
            )
            .when_some(host, |this, host| {
                this.child(
                    div()
                        .mt(px(4.0))
                        .max_w_full()
                        .overflow_hidden()
                        .whitespace_nowrap()
                        .text_ellipsis()
                        .text_size(px(12.5))
                        .text_color(ink.opacity(0.5))
                        .child(host),
                )
            })
            .child(
                h_flex()
                    .mt(px(22.0))
                    .gap(px(6.0))
                    .items_center()
                    .opacity(0.5)
                    .group_hover(BROWSER_SLEEPING_PLACEHOLDER_GROUP, |this| this.opacity(0.9))
                    .child(titlebar_svg_icon(COMMAND_ICON_MOON, 12.0, ink.into()))
                    .child(
                        div()
                            .text_size(px(12.0))
                            .text_color(ink)
                            .child("Asleep · Click anywhere to wake"),
                    ),
            )
            .into_any_element()
    }
}
