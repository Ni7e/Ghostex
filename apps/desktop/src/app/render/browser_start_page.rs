//! The Browser view's start page: the Dev servers list, in the body of a pane whose tab has no
//! address yet.

use gpui::AnyElement;
use gpui::IntoElement;
use gpui::ParentElement as _;
use gpui::Styled as _;
use gpui::div;

use crate::app::model::*;
use crate::app::window::*;
use crate::*;

impl GhostexGpuiApp {
    /// CDXC:Browser 2026-09-21 DECISION:
    /// User: the ⋯ menu's Dev servers row goes back to its dropdown overlay, and the Browser blank tab keeps showing the same list as its start page. A Browser pane whose tab has no address yet shows the per-machine list the dropdown shows, so opening a local server is one click from a new tab. This supersedes the 2026-09-20 ruling that the start page replaced the dropdown.
    pub(crate) fn browser_pane_shows_start_page(&self, pane_id: BrowserPaneId) -> bool {
        self.browser_tabs.find_leaf(pane_id).is_some_and(|leaf| {
            match leaf.tab_group.active_tab_id() {
                Some(tab_id) => self
                    .browser_tabs
                    .tab(tab_id)
                    .is_some_and(|tab| tab.state == BrowserTabState::AddressOnly),
                None => true,
            }
        })
    }

    /// Build a start page for every Browser pane showing a blank tab and drop the rest, so the list
    /// only probes the machine while a pane is actually showing it.
    pub(crate) fn sync_browser_start_pages(&mut self, cx: &mut gpui::Context<Self>) {
        let pane_ids = self
            .browser_tabs
            .rendered_leaf_order()
            .into_iter()
            .filter(|pane_id| self.browser_pane_shows_start_page(*pane_id))
            .collect::<Vec<_>>();
        self.browser_start_pages
            .retain(|pane_id, _| pane_ids.contains(pane_id));
        for pane_id in pane_ids {
            if self.browser_start_pages.contains_key(&pane_id) {
                continue;
            }
            let main_app = cx.weak_entity();
            let panel = cx.new(|cx| {
                crate::app::window::remote_sites::RemoteSitesPanel::new(
                    GpuiTitlebarPanelHost::ViewPanel,
                    main_app,
                    cx,
                )
            });
            self.browser_start_pages.insert(pane_id, panel);
        }
    }

    pub(crate) fn render_browser_start_page(&self, pane_id: BrowserPaneId) -> AnyElement {
        let Some(panel) = self.browser_start_pages.get(&pane_id).cloned() else {
            return div().size_full().into_any_element();
        };
        div()
            .id(format!("ghostex-gpui-browser-start-page-{}", pane_id.0))
            .size_full()
            .min_w_0()
            .min_h_0()
            .overflow_hidden()
            .child(panel)
            .into_any_element()
    }
}
