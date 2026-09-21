//! The Browser view's own tabs, drawn in the view panel's tab strip beside the view tabs.

use gpui::AnyElement;
use gpui::InteractiveElement as _;
use gpui::IntoElement;
use gpui::MouseButton;
use gpui::MouseDownEvent;
use gpui::MouseUpEvent;
use gpui::ParentElement as _;
use gpui::StatefulInteractiveElement as _;
use gpui::Styled as _;
use gpui::Window;
use gpui::div;
use gpui::prelude::FluentBuilder as _;
use gpui::px;
use gpui_component::h_flex;
use gpui_component::tooltip::ManagedTooltipExt as _;
use gpui_component::tooltip::ManagedTooltipPlacement;
use gpui_component::tooltip::Tooltip;

use crate::app::consts::*;
use crate::app::helpers::*;
use crate::app::model::*;
use crate::*;

const VIEW_STRIP_BROWSER_TAB_GROUP: &str = "ghostex-gpui-view-strip-browser-tab";

/// One browser tab as the strip lists it: the pane that owns it and its place in that pane's own
/// tab order, which is the index every existing selection, reorder and drop helper takes.
#[derive(Clone, Copy, PartialEq, Eq)]
pub(crate) struct ViewStripBrowserTab {
    pub(crate) pane_id: BrowserPaneId,
    pub(crate) index_in_pane: usize,
    pub(crate) tab_id: BrowserTabId,
}

impl GhostexGpuiApp {
    /// CDXC:Browser 2026-09-20 DECISION:
    /// User: browser tabs are no longer sidebar rows. They live at the top of the view panel, in
    /// the same strip as the view tabs and after the `+`, so a browser tab reads as a peer of the
    /// Browser, Code and Docs tabs rather than as a session. They stay listed while another view is
    /// on screen, and clicking one brings the Browser view back with that tab selected. Docs is
    /// meant to list its open files the same way later, which is why the strip takes a second group
    /// rather than the Browser view owning a tab bar of its own.
    /// SEE-ALSO: apps/desktop/src/app/render/view_tab_strip.rs (the strip these join),
    /// apps/desktop/sidebar/gxserver-runtime/sidebar-groups.ts and
    /// apps/desktop/src/app/gx_store/sidebar_list_inputs.rs (the two sidebar projections that
    /// stopped listing them).
    pub(crate) fn view_strip_browser_tabs(&self) -> Vec<ViewStripBrowserTab> {
        if !self.open_view_tabs().contains(&TitlebarMode::Browser) {
            return Vec::new();
        }
        // A tab earns its place in the strip once it has a page, which is the rule the sidebar rows
        // followed. The address-only "New Tab" placeholder is the exception every project carries
        // even when it has never opened the Browser, so it is listed only while the Browser view is
        // the one on screen and the user is looking at it.
        let browser_is_open_view = self.active_mode == TitlebarMode::Browser;
        let mut tabs = Vec::new();
        for pane_id in self.browser_tabs.rendered_leaf_order() {
            let Some(leaf) = self.browser_tabs.find_leaf(pane_id) else {
                continue;
            };
            for (index_in_pane, pane_tab) in leaf.tab_group.tabs.iter().enumerate() {
                let Some(tab) = self.browser_tabs.tab(pane_tab.tab_id) else {
                    continue;
                };
                if browser_is_open_view || tab.state == BrowserTabState::Loaded {
                    tabs.push(ViewStripBrowserTab {
                        pane_id,
                        index_in_pane,
                        tab_id: tab.id,
                    });
                }
            }
        }
        tabs
    }

    /// Where a pane's tab sits in the one strip every pane's tabs share, so the reveal that scrolls
    /// a pane's own tab bar can scroll this one too.
    pub(crate) fn view_strip_browser_tab_position(
        &self,
        pane_id: BrowserPaneId,
        tab_id: BrowserTabId,
    ) -> Option<usize> {
        self.view_strip_browser_tabs()
            .iter()
            .position(|tab| tab.pane_id == pane_id && tab.tab_id == tab_id)
    }

    /// The strip's browser group: a divider, then the tabs, scrolling on their own once they run
    /// past the space the view tabs left them.
    pub(crate) fn render_view_tab_strip_browser_tabs(
        &self,
        cx: &mut gpui::Context<Self>,
    ) -> Option<AnyElement> {
        let tabs = self.view_strip_browser_tabs();
        if tabs.is_empty() {
            return None;
        }
        // Exactly one tab in the row is filled: the one the panel is showing. While another view is
        // open the browser has nothing on screen, so none of its tabs claim that fill.
        let showing_tab_id = (self.active_mode == TitlebarMode::Browser)
            .then(|| {
                self.browser_tabs
                    .active_tab_id_for_pane(self.browser_tabs.focused_pane)
            })
            .flatten();
        let scroll_handle = self.view_browser_tab_scroll_handle.clone();
        Some(
            h_flex()
                .id("ghostex-gpui-view-tab-strip-browser-group")
                .flex_1()
                .min_w(px(WORKAREA_VIEW_TAB_BROWSER_GROUP_MIN_WIDTH))
                .h_full()
                .items_center()
                .gap(px(6.0))
                .mr(px(6.0))
                .child(
                    div()
                        .flex_shrink_0()
                        .w(px(1.0))
                        .h(px(16.0))
                        .bg(titlebar_button_border_color()),
                )
                .child(
                    h_flex()
                        .id("ghostex-gpui-view-tab-strip-browser-tabs")
                        .flex_1()
                        .min_w_0()
                        .h_full()
                        .items_center()
                        .gap(px(WORKAREA_VIEW_TAB_GAP))
                        .overflow_x_scroll()
                        .track_scroll(&scroll_handle)
                        .children(tabs.iter().map(|tab| {
                            self.render_view_strip_browser_tab(*tab, showing_tab_id, cx)
                        })),
                )
                .into_any_element(),
        )
    }

    fn render_view_strip_browser_tab(
        &self,
        entry: ViewStripBrowserTab,
        showing_tab_id: Option<BrowserTabId>,
        cx: &mut gpui::Context<Self>,
    ) -> AnyElement {
        let ViewStripBrowserTab {
            pane_id,
            index_in_pane,
            tab_id,
        } = entry;
        let tab = self.browser_tabs.tab(tab_id);
        let state = tab
            .map(|tab| tab.state)
            .unwrap_or(BrowserTabState::AddressOnly);
        let has_cef_surface = self.browser_surfaces.contains_key(&tab_id);
        let chrome_status = BrowserTabChromeStatus::from_state(state, has_cef_surface);
        let is_showing = showing_tab_id == Some(tab_id);
        // A loaded tab with no page of its own is the dimmed "this is asleep" tab, the same reading
        // a sleeping view tab gets.
        let asleep = chrome_status == BrowserTabChromeStatus::RestoredPlaceholder;
        let title = tab
            .map(BrowserTab::display_title)
            .unwrap_or_else(|| "New Tab".to_string());
        let can_close = state != BrowserTabState::AddressOnly
            || self
                .browser_tabs
                .pane_tab_count(pane_id)
                .unwrap_or_default()
                > 1;
        let profile_id = tab
            .map(|tab| tab.profile_id)
            .unwrap_or_else(BrowserProfileId::default_profile);
        let runtime_favicon_url = tab.and_then(|tab| tab.runtime_favicon_url.as_deref());
        let runtime_favicon_image = tab.and_then(|tab| tab.runtime_favicon_image.clone());
        let runtime_favicon_fetch = tab.and_then(|tab| tab.runtime_favicon_fetch.clone());
        let dragged_tab = DraggedBrowserTab {
            source_pane_id: pane_id,
            tab_id,
            profile_id,
            title: title.clone(),
            runtime_favicon_url: runtime_favicon_url.map(str::to_string),
            runtime_favicon_image: runtime_favicon_image.clone(),
            runtime_favicon_fetch: runtime_favicon_fetch.clone(),
            state,
            chrome_status,
        };
        let show_insertion_marker = self.browser_tab_drop_feedback
            == Some(BrowserDropFeedback {
                pane_id,
                target: BrowserTabDropTarget::TabStrip(index_in_pane),
            });
        let view = cx.entity().clone();
        let tooltip_title = title.clone();
        div()
            .id(format!(
                "ghostex-gpui-view-strip-browser-tab-{}-{}",
                pane_id.0, tab_id.0
            ))
            .group(VIEW_STRIP_BROWSER_TAB_GROUP)
            .relative()
            .flex()
            .flex_shrink_0()
            .h(px(WORKAREA_VIEW_TAB_HEIGHT))
            .min_w(px(WORKAREA_VIEW_TAB_MIN_WIDTH))
            .max_w(px(WORKAREA_VIEW_TAB_MAX_WIDTH))
            .items_center()
            .gap(px(6.0))
            .rounded(px(WORKAREA_VIEW_TAB_RADIUS))
            .px(px(WORKAREA_VIEW_TAB_HORIZONTAL_PADDING))
            .text_size(px(12.5))
            .line_height(px(WORKAREA_VIEW_TAB_HEIGHT))
            .cursor_default()
            .when(is_showing, |this| {
                this.bg(titlebar_active_segment_color())
                    .text_color(titlebar_active_text_color())
            })
            .when(!is_showing, |this| {
                this.text_color(titlebar_inactive_text_color())
                    .hover(|this| {
                        this.bg(titlebar_button_hover_color())
                            .text_color(titlebar_active_text_color())
                    })
            })
            .when(asleep && !is_showing, |this| this.opacity(0.72))
            .when(show_insertion_marker, |this| {
                this.border_l_2()
                    .border_color(workspace_drop_feedback_border_color())
            })
            .managed_tooltip_with_placement(ManagedTooltipPlacement::Below, move |window, cx| {
                Tooltip::new(tooltip_title.clone()).build(window, cx)
            })
            .on_mouse_down(
                MouseButton::Left,
                cx.listener(move |this, _event: &MouseDownEvent, window, cx| {
                    window.prevent_default();
                    cx.stop_propagation();
                    this.open_browser_tab_from_view_strip(pane_id, tab_id, window, cx);
                }),
            )
            .on_mouse_down(
                MouseButton::Right,
                cx.listener(move |this, event: &MouseDownEvent, window, cx| {
                    window.prevent_default();
                    cx.stop_propagation();
                    this.show_browser_tab_context_menu(pane_id, tab_id, event.position, window, cx);
                }),
            )
            .on_mouse_up(
                MouseButton::Middle,
                cx.listener(move |this, _event: &MouseUpEvent, window, cx| {
                    window.prevent_default();
                    cx.stop_propagation();
                    if can_close {
                        this.close_browser_tab(tab_id, window, cx);
                    }
                }),
            )
            .on_drag(dragged_tab, move |dragged, _offset, _window, cx| {
                let _ = view.update(cx, |this, cx| {
                    this.begin_browser_tab_drag(cx);
                });
                cx.new(|_| BrowserTabDragPreview {
                    profile_id: dragged.profile_id,
                    title: dragged.title.clone(),
                    runtime_favicon_url: dragged.runtime_favicon_url.clone(),
                    runtime_favicon_image: dragged.runtime_favicon_image.clone(),
                    runtime_favicon_fetch: dragged.runtime_favicon_fetch.clone(),
                    state: dragged.state,
                    chrome_status: dragged.chrome_status,
                })
            })
            .on_drag_move::<DraggedBrowserTab>(cx.listener(
                move |this, event: &gpui::DragMoveEvent<DraggedBrowserTab>, _window, cx| {
                    this.update_browser_tab_drag_feedback(event, pane_id, index_in_pane, cx);
                },
            ))
            .can_drop(move |value, _window, _cx| {
                value
                    .downcast_ref::<DraggedBrowserTab>()
                    .is_some_and(|dragged| dragged.source_pane_id == pane_id)
            })
            .on_drop(
                cx.listener(move |this, dragged: &DraggedBrowserTab, window, cx| {
                    this.handle_browser_tab_strip_drop(pane_id, index_in_pane, dragged, window, cx);
                }),
            )
            .child(self.render_browser_tab_icon(
                profile_id,
                chrome_status,
                runtime_favicon_url,
                runtime_favicon_image.as_ref(),
                runtime_favicon_fetch.as_ref(),
            ))
            .child(
                div()
                    .flex_1()
                    .min_w_0()
                    .overflow_hidden()
                    .whitespace_nowrap()
                    .text_ellipsis()
                    .child(title),
            )
            .when(can_close, |this| {
                this.child(self.render_view_strip_browser_tab_close_button(tab_id, is_showing, cx))
            })
            .into_any_element()
    }

    /// The close control, drawn on the showing tab and on whichever tab the pointer is over, so a
    /// tab never changes width when it is hovered. The same rule the view tabs beside it follow.
    fn render_view_strip_browser_tab_close_button(
        &self,
        tab_id: BrowserTabId,
        is_showing: bool,
        cx: &mut gpui::Context<Self>,
    ) -> impl IntoElement {
        div()
            .id(format!(
                "ghostex-gpui-view-strip-browser-tab-close-{}",
                tab_id.0
            ))
            .flex()
            .flex_shrink_0()
            .size(px(WORKAREA_VIEW_TAB_CLOSE_SIZE))
            .items_center()
            .justify_center()
            .rounded(px(4.0))
            .cursor_default()
            .when(!is_showing, |this| {
                this.opacity(0.0)
                    .group_hover(VIEW_STRIP_BROWSER_TAB_GROUP, |this| this.opacity(1.0))
            })
            .hover(|this| this.bg(titlebar_button_hover_color()))
            .on_mouse_down(
                MouseButton::Left,
                cx.listener(move |this, _event: &MouseDownEvent, window, cx| {
                    window.prevent_default();
                    cx.stop_propagation();
                    this.close_browser_tab(tab_id, window, cx);
                }),
            )
            .child(titlebar_svg_icon(
                TITLEBAR_ICON_X,
                11.0,
                titlebar_icon_color(),
            ))
    }

    /// Clicking a browser tab in the strip. The Browser view comes back first when another view is
    /// on screen, because the tab the user just clicked has to be the thing they end up looking at.
    pub(crate) fn open_browser_tab_from_view_strip(
        &mut self,
        pane_id: BrowserPaneId,
        tab_id: BrowserTabId,
        window: &mut Window,
        cx: &mut gpui::Context<Self>,
    ) {
        if !self.titlebar_mode_available(TitlebarMode::Browser) {
            return;
        }
        if self.active_mode != TitlebarMode::Browser {
            self.open_view_tab(TitlebarMode::Browser, window, cx);
        }
        self.select_browser_tab_in_pane(pane_id, tab_id, window, cx);
    }
}
