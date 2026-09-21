//! The view panel's own header: one tab per open view, the `+` that opens another, and the pop-out
//! and expand controls on the trailing side.

use gpui::AnyElement;
use gpui::InteractiveElement as _;
use gpui::IntoElement;
use gpui::MouseButton;
use gpui::MouseDownEvent;
use gpui::MouseUpEvent;
use gpui::ParentElement as _;
use gpui::StatefulInteractiveElement as _;
use gpui::Styled as _;
use gpui::div;
use gpui::prelude::FluentBuilder as _;
use gpui::px;
use gpui_component::h_flex;
use gpui_component::tooltip::ManagedTooltipExt as _;
use gpui_component::tooltip::ManagedTooltipPlacement;

use crate::app::consts::*;
use crate::app::helpers::*;
use crate::app::model::*;
use crate::*;

const VIEW_TAB_GROUP: &str = "ghostex-gpui-view-tab";

impl GhostexGpuiApp {
    /// CDXC:Workarea 2026-09-20 DECISION:
    /// User (screens 03 to 05): a project can have several views open at once, and they live as a
    /// tab strip at the top of the view panel instead of as one mode selected in the work area
    /// header. Each tab is its view's icon and name with a close control, the tabs drag to reorder,
    /// `+` opens another view, and the trailing pair pops the view out or expands it over the
    /// sessions column. This supersedes the 2026-09-11 rule that the view buttons are centred mode
    /// tabs in the header strip: there is no mode switcher there any more.
    pub(crate) fn render_view_tab_strip(
        &self,
        active_mode: TitlebarMode,
        cx: &mut gpui::Context<Self>,
    ) -> AnyElement {
        let tabs = self.open_view_tabs();
        let scroll_handle = self.view_tab_scroll_handle.clone();
        let drag_insertion = self.view_tab_drag.map(|drag| drag.insertion_index);
        let tab_elements = tabs
            .iter()
            .enumerate()
            .map(|(index, mode)| {
                self.render_view_tab(*mode, index, active_mode, drag_insertion, cx)
            })
            .collect::<Vec<_>>();
        h_flex()
            .id("ghostex-gpui-view-tab-strip")
            .flex_shrink_0()
            .h(px(WORKAREA_VIEW_TAB_STRIP_HEIGHT))
            .w_full()
            .items_center()
            .gap(px(WORKAREA_VIEW_TAB_GAP))
            .px(px(6.0))
            .overflow_hidden()
            .bg(project_editor_shell_background_color())
            .text_color(titlebar_text_color())
            .font_family("Inter Variable")
            .child(
                h_flex()
                    .id("ghostex-gpui-view-tab-strip-tabs")
                    .flex_shrink_1()
                    .min_w_0()
                    .h_full()
                    .items_center()
                    .gap(px(WORKAREA_VIEW_TAB_GAP))
                    .overflow_x_scroll()
                    .track_scroll(&scroll_handle)
                    .children(tab_elements)
                    .child(self.render_view_tab_strip_end_drop_target(tabs.len(), cx)),
            )
            .child(self.render_view_tab_add_button(cx))
            // The Browser view's own tabs take the free space when it has any; otherwise the row
            // just leaves it empty before the trailing controls.
            .map(|strip| match self.render_view_tab_strip_browser_tabs(cx) {
                Some(browser_tabs) => strip.child(browser_tabs),
                None => strip.child(div().flex_1().min_w(px(8.0)).h_full()),
            })
            .child(self.render_view_tab_strip_pop_out_button(active_mode, cx))
            .child(self.render_view_tab_strip_expand_button(cx))
            .into_any_element()
    }

    fn render_view_tab(
        &self,
        mode: TitlebarMode,
        index: usize,
        active_mode: TitlebarMode,
        drag_insertion: Option<usize>,
        cx: &mut gpui::Context<Self>,
    ) -> AnyElement {
        let is_active = mode == active_mode;
        let label = mode.tab_label();
        let slug = mode.element_slug();
        // A Ghostex page has no lifecycle, so it is never the dimmed "this is asleep" tab.
        let sleeping =
            mode.is_project_editor_mode() && !self.project_editor_shell.is_mode_awake(mode);
        let view = cx.entity().clone();
        let drag_payload = DraggedViewTab { mode };
        let preview_icon = mode.tab_icon();
        let preview_label = label.clone();
        // CDXC:Hotkeys 2026-09-09 DECISION:
        // User: hovering a titlebar view shows only its shortcut at its current position, including after reordering.
        // The strip is that position now, so the shortcut follows the tab's place in it.
        let shortcut = gpui_configured_hotkey_label(&format!("switchTitlebarView{}", index + 1));
        div()
            .id(format!("ghostex-gpui-view-tab-{slug}"))
            .group(VIEW_TAB_GROUP)
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
            .when(is_active, |this| {
                this.bg(titlebar_active_segment_color())
                    .text_color(titlebar_active_text_color())
            })
            .when(!is_active, |this| {
                this.text_color(titlebar_inactive_text_color())
                    .hover(|this| {
                        this.bg(titlebar_button_hover_color())
                            .text_color(titlebar_active_text_color())
                    })
            })
            // A tab whose page is asleep still says so, so "why is this blank until I click it" has
            // an answer in the strip rather than only in the body.
            .when(sleeping && !is_active, |this| this.opacity(0.72))
            .when(drag_insertion == Some(index), |this| {
                this.border_l_2()
                    .border_color(workspace_drop_feedback_border_color())
            })
            .on_mouse_down(
                MouseButton::Left,
                cx.listener(move |this, _event: &MouseDownEvent, window, cx| {
                    window.prevent_default();
                    cx.stop_propagation();
                    this.open_view_tab(mode, window, cx);
                }),
            )
            .on_mouse_down(
                MouseButton::Right,
                cx.listener(move |this, event: &MouseDownEvent, window, cx| {
                    window.prevent_default();
                    cx.stop_propagation();
                    this.show_view_tab_context_menu(mode, event.position, window, cx);
                }),
            )
            .on_mouse_up(
                MouseButton::Middle,
                cx.listener(move |this, _event: &MouseUpEvent, window, cx| {
                    window.prevent_default();
                    cx.stop_propagation();
                    this.close_view_tab(mode, window, cx);
                }),
            )
            .on_drag(drag_payload, move |_dragged, _offset, _window, cx| {
                let _ = view.update(cx, |this, cx| {
                    this.begin_view_tab_drag(mode, index, cx);
                });
                cx.new(|_| ViewTabDragPreview {
                    icon: preview_icon,
                    label: preview_label.clone(),
                })
            })
            .on_drag_move::<DraggedViewTab>(cx.listener(
                move |this, event: &gpui::DragMoveEvent<DraggedViewTab>, _window, cx| {
                    this.update_view_tab_drag_feedback(event, index, cx);
                },
            ))
            .can_drop(|value, _window, _cx| value.downcast_ref::<DraggedViewTab>().is_some())
            .on_drop(
                cx.listener(move |this, dragged: &DraggedViewTab, _window, cx| {
                    this.handle_view_tab_drop(dragged.mode, index, cx);
                }),
            )
            .when_some(shortcut, |this, shortcut| {
                this.managed_tooltip_with_placement(
                    ManagedTooltipPlacement::Below,
                    move |window, cx| titlebar_tooltip(shortcut.clone(), window, cx),
                )
            })
            .child(titlebar_svg_icon(
                mode.tab_icon(),
                WORKAREA_VIEW_TAB_ICON_SIZE,
                if is_active {
                    titlebar_active_text_color()
                } else {
                    titlebar_icon_color()
                },
            ))
            .child(
                div()
                    .flex_1()
                    .min_w_0()
                    .overflow_hidden()
                    .whitespace_nowrap()
                    .text_ellipsis()
                    .child(label),
            )
            .child(self.render_view_tab_close_button(mode, is_active, cx))
            .into_any_element()
    }

    /// The close control. It is always drawn on the active tab, as the mockup does, and appears on
    /// the others while the pointer is over them, so a tab never changes width when it is hovered.
    fn render_view_tab_close_button(
        &self,
        mode: TitlebarMode,
        is_active: bool,
        cx: &mut gpui::Context<Self>,
    ) -> impl IntoElement {
        div()
            .id(format!(
                "ghostex-gpui-view-tab-close-{}",
                mode.element_slug()
            ))
            .flex()
            .flex_shrink_0()
            .size(px(WORKAREA_VIEW_TAB_CLOSE_SIZE))
            .items_center()
            .justify_center()
            .rounded(px(4.0))
            .cursor_default()
            .when(!is_active, |this| {
                this.opacity(0.0)
                    .group_hover(VIEW_TAB_GROUP, |this| this.opacity(1.0))
            })
            .hover(|this| this.bg(titlebar_button_hover_color()))
            .on_mouse_down(
                MouseButton::Left,
                cx.listener(move |this, _event: &MouseDownEvent, window, cx| {
                    window.prevent_default();
                    cx.stop_propagation();
                    this.close_view_tab(mode, window, cx);
                }),
            )
            .child(titlebar_svg_icon(
                TITLEBAR_ICON_X,
                11.0,
                titlebar_icon_color(),
            ))
    }

    /// The gap after the last tab, so a tab dragged past the end lands at the end.
    fn render_view_tab_strip_end_drop_target(
        &self,
        tab_count: usize,
        cx: &mut gpui::Context<Self>,
    ) -> impl IntoElement {
        div()
            .id("ghostex-gpui-view-tab-strip-end")
            .flex_shrink_0()
            .w(px(16.0))
            .h_full()
            .on_drag_move::<DraggedViewTab>(cx.listener(
                move |this, event: &gpui::DragMoveEvent<DraggedViewTab>, _window, cx| {
                    if event.bounds.contains(&event.event.position) {
                        this.set_view_tab_drop_index(tab_count, cx);
                    }
                },
            ))
            .can_drop(|value, _window, _cx| value.downcast_ref::<DraggedViewTab>().is_some())
            .on_drop(
                cx.listener(move |this, dragged: &DraggedViewTab, _window, cx| {
                    this.handle_view_tab_drop(dragged.mode, tab_count, cx);
                }),
            )
    }

    fn render_view_tab_strip_icon_button(
        id: &'static str,
        icon: &'static str,
        enabled: bool,
        active: bool,
    ) -> gpui::Stateful<gpui::Div> {
        div()
            .id(id)
            .flex()
            .flex_shrink_0()
            .size(px(WORKAREA_VIEW_TAB_HEIGHT))
            .items_center()
            .justify_center()
            .rounded(px(WORKAREA_VIEW_TAB_RADIUS))
            .cursor_default()
            .when(active, |this| this.bg(titlebar_active_segment_color()))
            .when(enabled, |this| {
                this.hover(|this| this.bg(titlebar_button_hover_color()))
            })
            .child(titlebar_svg_icon(
                icon,
                14.0,
                if enabled {
                    titlebar_icon_color()
                } else {
                    titlebar_disabled_text_color()
                },
            ))
    }

    fn render_view_tab_add_button(&self, cx: &mut gpui::Context<Self>) -> impl IntoElement {
        Self::render_view_tab_strip_icon_button(
            "ghostex-gpui-view-tab-add",
            TITLEBAR_ICON_PLUS,
            true,
            false,
        )
        .on_mouse_down(
            MouseButton::Left,
            cx.listener(|this, event: &MouseDownEvent, window, cx| {
                window.prevent_default();
                cx.stop_propagation();
                this.show_view_tab_add_menu(event.position, window, cx);
            }),
        )
        .managed_tooltip_with_placement(ManagedTooltipPlacement::Below, move |window, cx| {
            titlebar_tooltip("Open a view", window, cx)
        })
    }

    fn render_view_tab_strip_pop_out_button(
        &self,
        active_mode: TitlebarMode,
        cx: &mut gpui::Context<Self>,
    ) -> impl IntoElement {
        let enabled = self.view_pop_out_url(active_mode).is_some();
        Self::render_view_tab_strip_icon_button(
            "ghostex-gpui-view-tab-pop-out",
            TITLEBAR_ICON_EXTERNAL_LINK,
            enabled,
            false,
        )
        .when(enabled, |this| {
            this.on_mouse_down(
                MouseButton::Left,
                cx.listener(move |this, _event: &MouseDownEvent, window, cx| {
                    window.prevent_default();
                    cx.stop_propagation();
                    this.pop_out_view(active_mode, cx);
                }),
            )
        })
        .managed_tooltip_with_placement(
            ManagedTooltipPlacement::Below,
            move |window, cx| {
                titlebar_tooltip(
                    if enabled {
                        "Open Externally"
                    } else {
                        "This view has no page to pop out yet"
                    },
                    window,
                    cx,
                )
            },
        )
    }

    fn render_view_tab_strip_expand_button(
        &self,
        cx: &mut gpui::Context<Self>,
    ) -> impl IntoElement {
        let maximized = self.view_panel_maximized();
        // With the picker on screen there is no view to give the window to, so the control says so
        // rather than looking live and doing nothing.
        let enabled = self.open_view_mode().is_some();
        let tooltip = if !enabled {
            "Open a view to expand it"
        } else if maximized {
            "Show the sessions column"
        } else {
            "Expand over the sessions column"
        };
        Self::render_view_tab_strip_icon_button(
            "ghostex-gpui-view-tab-expand",
            if maximized {
                TITLEBAR_ICON_ARROWS_DIAGONAL_MINIMIZE
            } else {
                TITLEBAR_ICON_ARROWS_DIAGONAL
            },
            enabled,
            maximized,
        )
        .when(enabled, |this| {
            this.on_mouse_down(
                MouseButton::Left,
                cx.listener(|this, _event: &MouseDownEvent, window, cx| {
                    window.prevent_default();
                    cx.stop_propagation();
                    this.toggle_view_panel_maximized(cx);
                }),
            )
        })
        .managed_tooltip_with_placement(ManagedTooltipPlacement::Below, move |window, cx| {
            titlebar_tooltip(tooltip, window, cx)
        })
    }
}
