//! The Quick Access shell controls that every tab shares: the raised tab rail, the search field,
//! the filter shelf's segmented controls and select pickers, and the portaled menus those pickers
//! open. Ported from packages/core-ui/quick-access-tabs.tsx, quick-access-search-input.tsx and the
//! `.quick-access-*` rules in packages/core-ui/styles.css.
use super::model::{QuickAccessIcon, QuickAccessOption, QuickAccessSegment, QuickAccessSelect};
use super::palette::{
    QUICK_ACCESS_CONTROL_HEIGHT, QUICK_ACCESS_ITEM_FONT_SIZE, QUICK_ACCESS_RADIUS_CONTROL,
    QUICK_ACCESS_RADIUS_MENU_ITEM, QUICK_ACCESS_TAB_RAIL_HEIGHT, QuickAccessPalette, hsla,
    parse_css_color,
};
use gpui::prelude::FluentBuilder as _;
use gpui::{
    AnyElement, App, Bounds, ClickEvent, Context, Div, FontWeight, InteractiveElement as _,
    IntoElement, MouseDownEvent, ParentElement as _, Pixels, Rgba, ScrollHandle, SharedString,
    StatefulInteractiveElement as _, Styled as _, Window, anchored, deferred, div, img, point, px,
    svg,
};
use gpui_component::input::{Input, InputState};
use gpui_component::{Sizable as _, Size as ComponentSize, h_flex, v_flex};
use std::cell::Cell;
use std::rc::Rc;

pub(crate) const ICON_SEARCH: &str = "modals/kit/search.svg";
pub(crate) const ICON_CLEAR: &str = "modals/kit/x.svg";
pub(crate) const ICON_SELECTOR: &str = "modals/kit/selector.svg";

/// `titlebar/<kebab-name>.svg`, the same bundle the sidebar's action icons use.
pub(crate) fn asset_icon_path(name: &str) -> SharedString {
    crate::app::helpers::gpui_sidebar_command_icon_asset_path(Some(name))
}

/// One row/menu glyph. The slot keeps its size when the row has no icon so
/// titles stay on the same left edge, exactly like the React `size-4` slot.
pub(crate) fn quick_access_icon(icon: &QuickAccessIcon, size: f32, color: Rgba) -> AnyElement {
    match icon {
        QuickAccessIcon::Asset { name, color: tint } => svg()
            .path(asset_icon_path(name))
            .size(px(size))
            .flex_shrink_0()
            .text_color(hsla(
                tint.as_deref()
                    .map(|tint| parse_css_color(tint, color))
                    .unwrap_or(color),
            ))
            .into_any_element(),
        QuickAccessIcon::Image { url } => {
            match crate::app::native_sidebar::images::sidebar_image(url) {
                Some(image) => img(image)
                    .size(px(size))
                    .flex_shrink_0()
                    .rounded(px(3.0))
                    .into_any_element(),
                None => div().size(px(size)).flex_shrink_0().into_any_element(),
            }
        }
        QuickAccessIcon::None => div().size(px(size)).flex_shrink_0().into_any_element(),
    }
}

/// `.quick-access-tabs.raised-tab-rail`: a 40px inset track, 6px from the window
/// edges, whose four equal segments carry the label and its accelerator.
pub(crate) fn quick_access_tab_rail<V: 'static>(
    p: &QuickAccessPalette,
    tabs: &[(SharedString, SharedString, bool)],
    on_select: impl Fn(&mut V, usize, &mut Window, &mut Context<V>) + Clone + 'static,
    cx: &mut Context<V>,
) -> AnyElement {
    let p = *p;
    let segments = tabs
        .iter()
        .enumerate()
        .map(|(index, (label, hotkey, active))| {
            let active = *active;
            let on_select = on_select.clone();
            h_flex()
                .id(("quick-access-tab", index))
                .flex_1()
                .flex_basis(px(0.0))
                .min_w_0()
                .h_full()
                .items_center()
                .justify_center()
                .gap(px(8.0))
                .px(px(10.0))
                .rounded(px(5.0))
                .text_size(px(QUICK_ACCESS_ITEM_FONT_SIZE))
                .line_height(px(QUICK_ACCESS_ITEM_FONT_SIZE))
                .whitespace_nowrap()
                .text_color(hsla(if active {
                    p.rail_active_text
                } else {
                    p.rail_text
                }))
                .cursor_pointer()
                .when(active, |this| {
                    this.bg(hsla(p.rail_active)).shadow(vec![
                        gpui::BoxShadow {
                            color: hsla(Rgba {
                                r: 0.0,
                                g: 0.0,
                                b: 0.0,
                                a: 0.14,
                            }),
                            offset: point(px(0.0), px(1.0)),
                            blur_radius: px(3.0),
                            spread_radius: px(0.0),
                            inset: false,
                        },
                        gpui::BoxShadow {
                            color: hsla(p.rail_active_ring),
                            offset: point(px(0.0), px(0.0)),
                            blur_radius: px(0.0),
                            spread_radius: px(1.0),
                            inset: false,
                        },
                    ])
                })
                .when(!active, |this| {
                    this.hover(move |this| {
                        this.bg(hsla(p.rail_hover))
                            .text_color(hsla(p.rail_active_text))
                    })
                })
                .on_click(cx.listener(move |this, _: &ClickEvent, window, cx| {
                    on_select(this, index, window, cx);
                }))
                .child(label.clone())
                .child(
                    div()
                        .flex_shrink_0()
                        .text_size(px(11.0))
                        .font_weight(FontWeight::MEDIUM)
                        .text_color(hsla(if active {
                            p.rail_active_hotkey
                        } else {
                            p.rail_hotkey
                        }))
                        .child(hotkey.clone()),
                )
        });
    h_flex()
        .id("quick-access-tabs")
        .flex_shrink_0()
        .mx(px(6.0))
        .mt(px(6.0))
        .mb(px(2.0))
        .h(px(QUICK_ACCESS_TAB_RAIL_HEIGHT))
        .items_stretch()
        .gap(px(3.0))
        .p(px(3.0))
        .rounded(px(QUICK_ACCESS_RADIUS_CONTROL))
        .border_1()
        .border_color(hsla(p.rail_border))
        .bg(hsla(p.rail_track))
        .overflow_hidden()
        .children(segments)
        .into_any_element()
}

/// `QuickAccessSearchInput` / `CommandInput`: one 32px raised field with a 12px
/// text inset, the magnifier at rest and an X once there is a query.
pub(crate) fn quick_access_search_field<V: 'static>(
    p: &QuickAccessPalette,
    state: &gpui::Entity<InputState>,
    has_query: bool,
    on_clear: impl Fn(&mut V, &mut Window, &mut Context<V>) + 'static,
    window: &Window,
    cx: &mut Context<V>,
) -> AnyElement {
    use gpui::Focusable as _;
    let p = *p;
    let focused = state.read(cx).focus_handle(cx).is_focused(window);
    div()
        .flex_shrink_0()
        .w_full()
        .px(px(6.0))
        .pt(px(6.0))
        .pb(px(2.0))
        .child(
            h_flex()
                .w_full()
                .min_w_0()
                .h(px(QUICK_ACCESS_CONTROL_HEIGHT))
                .items_center()
                .rounded(px(QUICK_ACCESS_RADIUS_CONTROL))
                .border_1()
                .border_color(hsla(if focused { p.focus_border } else { p.hairline }))
                .bg(hsla(p.raised))
                .child(
                    div().flex_1().min_w_0().pl(px(12.0)).child(
                        Input::new(state)
                            .with_size(ComponentSize::Small)
                            .appearance(false)
                            .bordered(false)
                            .focus_bordered(false)
                            .w_full()
                            .px(px(0.0))
                            .py(px(0.0))
                            .text_size(px(QUICK_ACCESS_ITEM_FONT_SIZE))
                            .text_color(hsla(p.item)),
                    ),
                )
                .child(
                    div()
                        .flex_shrink_0()
                        .pr(px(6.0))
                        .flex()
                        .items_center()
                        .child(if has_query {
                            div()
                                .id("quick-access-search-clear")
                                .size(px(24.0))
                                .flex()
                                .items_center()
                                .justify_center()
                                .cursor_pointer()
                                .text_color(hsla(p.muted))
                                .hover(move |this| this.text_color(hsla(p.foreground)))
                                .on_click(cx.listener(move |this, _: &ClickEvent, window, cx| {
                                    on_clear(this, window, cx);
                                }))
                                .child(
                                    svg()
                                        .path(ICON_CLEAR)
                                        .size(px(16.0))
                                        .text_color(hsla(p.muted)),
                                )
                                .into_any_element()
                        } else {
                            div()
                                .size(px(24.0))
                                .flex()
                                .items_center()
                                .justify_center()
                                .child(
                                    svg()
                                        .path(ICON_SEARCH)
                                        .size(px(16.0))
                                        .opacity(0.5)
                                        .text_color(hsla(p.item)),
                                )
                                .into_any_element()
                        }),
                ),
        )
        .into_any_element()
}

/// `.quick-access-filter-toolbar` / `.ghostex-stashed-prompt-toolbar`: the one
/// control shelf under the search field, hairlined off the list below it.
pub(crate) fn quick_access_filter_shelf(p: &QuickAccessPalette) -> Div {
    h_flex()
        .flex_shrink_0()
        .w_full()
        .min_w_0()
        .items_center()
        .gap(px(6.0))
        .p(px(6.0))
        .border_b_1()
        .border_color(hsla(p.hairline))
}

/// The shelf's segmented control, the shared raised rail at the 32px control height.
pub(crate) fn quick_access_segmented<V: 'static>(
    p: &QuickAccessPalette,
    id: &'static str,
    items: &[QuickAccessSegment],
    selected: &str,
    width: Option<f32>,
    on_select: impl Fn(&mut V, String, &mut Window, &mut Context<V>) + Clone + 'static,
    cx: &mut Context<V>,
) -> AnyElement {
    let p = *p;
    let segments = items.iter().enumerate().map(|(index, item)| {
        let pressed = item.value == selected;
        let value = item.value.clone();
        let on_select = on_select.clone();
        h_flex()
            .id((id, index))
            .flex_1()
            .flex_basis(px(0.0))
            .min_w_0()
            .h_full()
            .items_center()
            .justify_center()
            .px(px(10.0))
            .rounded(px(5.0))
            .text_size(px(QUICK_ACCESS_ITEM_FONT_SIZE))
            .line_height(px(20.0))
            .whitespace_nowrap()
            .text_color(hsla(if pressed {
                p.rail_active_text
            } else {
                p.rail_text
            }))
            .cursor_pointer()
            .when(pressed, |this| {
                this.bg(hsla(p.rail_active)).shadow(vec![
                    gpui::BoxShadow {
                        color: hsla(Rgba {
                            r: 0.0,
                            g: 0.0,
                            b: 0.0,
                            a: 0.14,
                        }),
                        offset: point(px(0.0), px(1.0)),
                        blur_radius: px(3.0),
                        spread_radius: px(0.0),
                        inset: false,
                    },
                    gpui::BoxShadow {
                        color: hsla(p.rail_active_ring),
                        offset: point(px(0.0), px(0.0)),
                        blur_radius: px(0.0),
                        spread_radius: px(1.0),
                        inset: false,
                    },
                ])
            })
            .when(!pressed, |this| {
                this.hover(move |this| {
                    this.bg(hsla(p.rail_hover))
                        .text_color(hsla(p.rail_active_text))
                })
            })
            .on_click(cx.listener(move |this, _: &ClickEvent, window, cx| {
                on_select(this, value.clone(), window, cx);
            }))
            .child(item.label.clone())
    });
    h_flex()
        .id(id)
        .flex_shrink_0()
        .when_some(width, |this, width| this.w(px(width)))
        .when(width.is_none(), |this| this.flex_1().min_w_0())
        .h(px(QUICK_ACCESS_CONTROL_HEIGHT))
        .items_stretch()
        .gap(px(3.0))
        .p(px(3.0))
        .rounded(px(QUICK_ACCESS_RADIUS_CONTROL))
        .border_1()
        .border_color(hsla(p.rail_border))
        .bg(hsla(p.rail_track))
        .overflow_hidden()
        .children(segments)
        .into_any_element()
}

/// The open state of one Quick Access picker. The window owns one per shelf control.
pub(crate) struct QuickAccessMenuState {
    pub(crate) open: bool,
    pub(crate) query: String,
    pub(crate) highlight: usize,
    pub(crate) trigger_bounds: Rc<Cell<Option<Bounds<Pixels>>>>,
    pub(crate) scroll: ScrollHandle,
}

impl Default for QuickAccessMenuState {
    fn default() -> Self {
        Self {
            open: false,
            query: String::new(),
            highlight: 0,
            trigger_bounds: Rc::new(Cell::new(None)),
            scroll: ScrollHandle::new(),
        }
    }
}

impl QuickAccessMenuState {
    pub(crate) fn toggle(&mut self) {
        self.open = !self.open;
        self.query.clear();
        self.highlight = 0;
    }

    pub(crate) fn close(&mut self) {
        self.open = false;
        self.query.clear();
    }
}

/// Captures a control's bounds during prepaint so its menu can be anchored to it.
pub(crate) fn capture_bounds(
    cell: Rc<Cell<Option<Bounds<Pixels>>>>,
    index: usize,
) -> impl Fn(Vec<Bounds<Pixels>>, &mut Window, &mut App) + 'static {
    move |bounds, _window, _cx| cell.set(bounds.get(index).copied())
}

/// The shelf's select trigger: a 32px raised pill with the current label, an
/// optional colored dot, and the selector chevrons.
pub(crate) fn quick_access_select_trigger<V: 'static>(
    p: &QuickAccessPalette,
    select: &QuickAccessSelect,
    menu: &QuickAccessMenuState,
    id: &'static str,
    width: Option<f32>,
    on_toggle: impl Fn(&mut V, &mut Window, &mut Context<V>) + 'static,
    cx: &mut Context<V>,
) -> AnyElement {
    let p = *p;
    let open = menu.open;
    let dot = (!select.color.is_empty()).then(|| parse_css_color(&select.color, p.muted));
    h_flex()
        .id(id)
        .flex_shrink_0()
        .when_some(width, |this, width| this.w(px(width)))
        .when(width.is_none(), |this| this.flex_1().min_w_0())
        .min_w_0()
        .h(px(QUICK_ACCESS_CONTROL_HEIGHT))
        .px(px(10.0))
        .gap(px(6.0))
        .items_center()
        .justify_between()
        .rounded(px(QUICK_ACCESS_RADIUS_CONTROL))
        .border_1()
        .border_color(hsla(if open { p.focus_border } else { p.hairline }))
        .bg(hsla(p.raised))
        .text_size(px(QUICK_ACCESS_ITEM_FONT_SIZE))
        .line_height(px(20.0))
        .text_color(hsla(p.item))
        .cursor_pointer()
        .when(!open, |this| {
            this.hover(move |this| this.bg(hsla(p.raised_hover)))
        })
        .on_click(cx.listener(move |this, _: &ClickEvent, window, cx| {
            on_toggle(this, window, cx);
        }))
        .child(
            h_flex()
                .flex_1()
                .min_w_0()
                .gap(px(6.0))
                .items_center()
                .children(dot.map(|dot| {
                    div()
                        .flex_shrink_0()
                        .size(px(7.0))
                        .rounded_full()
                        .bg(hsla(dot))
                }))
                .child(
                    v_flex()
                        .flex_1()
                        .min_w_0()
                        .child(
                            div()
                                .min_w_0()
                                .overflow_hidden()
                                .whitespace_nowrap()
                                .text_ellipsis()
                                .child(select.label.clone()),
                        )
                        .children((!select.detail.is_empty()).then(|| {
                            div()
                                .min_w_0()
                                .overflow_hidden()
                                .whitespace_nowrap()
                                .text_ellipsis()
                                .text_size(px(11.0))
                                .line_height(px(16.0))
                                .text_color(hsla(p.muted))
                                .child(select.detail.clone())
                        })),
                ),
        )
        .child(
            div().flex_shrink_0().child(
                svg()
                    .path(ICON_SELECTOR)
                    .size(px(16.0))
                    .text_color(hsla(p.muted)),
            ),
        )
        .into_any_element()
}

/// The portaled picker: the Codex popup surface with 28px rows, restated here
/// the way `.previous-sessions-tag-filter-menu` restates it outside the modal.
#[allow(clippy::too_many_arguments)]
pub(crate) fn quick_access_select_menu<V: 'static>(
    p: &QuickAccessPalette,
    select: &QuickAccessSelect,
    menu: &QuickAccessMenuState,
    id: &'static str,
    min_width: f32,
    on_choose: impl Fn(&mut V, String, &mut Window, &mut Context<V>) + Clone + 'static,
    on_dismiss: impl Fn(&mut V, &mut Window, &mut Context<V>) + 'static,
    window: &Window,
    cx: &mut Context<V>,
) -> Option<AnyElement> {
    if !menu.open {
        return None;
    }
    let trigger = menu.trigger_bounds.get()?;
    let p = *p;
    let max_height = px(288.0).min((window.viewport_size().height - px(16.0)).max(px(0.0)));
    let position = point(
        trigger.origin.x,
        trigger.origin.y + trigger.size.height + px(6.0),
    );
    let visible = visible_options(select, &menu.query);
    let highlight = menu.highlight.min(visible.len().saturating_sub(1));
    let rows = visible
        .iter()
        .enumerate()
        .map(|(index, option)| {
            let option = (*option).clone();
            let on_choose = on_choose.clone();
            let highlighted = index == highlight;
            let value = option.value.clone();
            let dot = (!option.color.is_empty()).then(|| parse_css_color(&option.color, p.muted));
            v_flex()
                .id((id, index))
                .w_full()
                .flex_shrink_0()
                .children(option.separated.then(|| {
                    div()
                        .my(px(3.0))
                        .h(px(1.0))
                        .w_full()
                        .bg(hsla(p.menu_border))
                }))
                .child(
                    h_flex()
                        .id(("quick-access-select-row", index))
                        .w_full()
                        .min_h(px(28.0))
                        .px(px(8.0))
                        .gap(px(8.0))
                        .items_center()
                        .rounded(px(QUICK_ACCESS_RADIUS_MENU_ITEM))
                        .text_size(px(QUICK_ACCESS_ITEM_FONT_SIZE))
                        .line_height(px(20.0))
                        .text_color(hsla(if option.selected { p.accent } else { p.item }))
                        .when(option.disabled, |this| this.opacity(0.5))
                        .when(!option.disabled, |this| {
                            this.cursor_pointer().when(highlighted, |this| {
                                this.bg(hsla(p.menu_hover))
                                    .text_color(hsla(if option.selected {
                                        p.accent
                                    } else {
                                        p.foreground
                                    }))
                            })
                        })
                        .when(!option.disabled, |this| {
                            this.hover(move |this| this.bg(hsla(p.menu_hover)))
                        })
                        .children(dot.map(|dot| {
                            div()
                                .flex_shrink_0()
                                .size(px(8.0))
                                .rounded_full()
                                .bg(hsla(dot))
                        }))
                        .children(
                            (!matches!(option.icon, QuickAccessIcon::None))
                                .then(|| quick_access_icon(&option.icon, 14.0, p.item)),
                        )
                        .child(
                            v_flex()
                                .flex_1()
                                .min_w_0()
                                .child(
                                    div()
                                        .min_w_0()
                                        .overflow_hidden()
                                        .whitespace_nowrap()
                                        .text_ellipsis()
                                        .child(option.label.clone()),
                                )
                                .children((!option.detail.is_empty()).then(|| {
                                    div()
                                        .min_w_0()
                                        .overflow_hidden()
                                        .whitespace_nowrap()
                                        .text_ellipsis()
                                        .text_size(px(11.0))
                                        .line_height(px(16.0))
                                        .text_color(hsla(p.muted))
                                        .child(option.detail.clone())
                                })),
                        )
                        .on_click(cx.listener(move |this, _: &ClickEvent, window, cx| {
                            if option.disabled {
                                return;
                            }
                            on_choose(this, value.clone(), window, cx);
                        })),
                )
        })
        .collect::<Vec<_>>();
    Some(
        deferred(
            anchored()
                .position(position)
                .snap_to_window_with_margin(px(8.0))
                .child(
                    v_flex()
                        .id(id)
                        .occlude()
                        .min_w(px(min_width.max(f32::from(trigger.size.width))))
                        .max_h(max_height)
                        .p(px(4.0))
                        .gap(px(1.0))
                        .rounded(px(QUICK_ACCESS_RADIUS_CONTROL))
                        .border_1()
                        .border_color(hsla(p.menu_border))
                        .bg(hsla(p.menu_background))
                        .shadow_lg()
                        .on_mouse_down_out(cx.listener(
                            move |this, event: &MouseDownEvent, window, cx| {
                                if trigger.contains(&event.position) {
                                    return;
                                }
                                on_dismiss(this, window, cx);
                            },
                        ))
                        .children(select.searchable.then(|| {
                            h_flex()
                                .w_full()
                                .h(px(28.0))
                                .px(px(8.0))
                                .mb(px(4.0))
                                .items_center()
                                .border_b_1()
                                .border_color(hsla(p.menu_border))
                                .text_size(px(QUICK_ACCESS_ITEM_FONT_SIZE))
                                .text_color(hsla(if menu.query.is_empty() {
                                    p.muted
                                } else {
                                    p.foreground
                                }))
                                .child(if menu.query.is_empty() {
                                    select.search_placeholder.clone()
                                } else {
                                    menu.query.clone()
                                })
                        }))
                        .child(
                            v_flex()
                                .id((id, 0usize))
                                .w_full()
                                .min_h_0()
                                .overflow_y_scroll()
                                .track_scroll(&menu.scroll)
                                .gap(px(1.0))
                                .children(rows),
                        ),
                ),
        )
        .with_priority(1)
        .into_any_element(),
    )
}

/// The rows a searchable picker shows for `query`; every row when it has none.
pub(crate) fn visible_options<'a>(
    select: &'a QuickAccessSelect,
    query: &str,
) -> Vec<&'a QuickAccessOption> {
    let query = query.trim();
    select
        .options
        .iter()
        .filter(|option| {
            query.is_empty() || {
                let text = format!("{} {}", option.label, option.detail).to_lowercase();
                query
                    .split_whitespace()
                    .all(|term| text.contains(&term.to_lowercase()))
            }
        })
        .collect()
}

/// The shared app tooltip: up to 30 lines of the row's full text, matching the
/// React `AppTooltip` the project path and prompt preview rows use.
pub(crate) fn quick_access_tooltip(
    text: String,
    window: &mut Window,
    cx: &mut App,
) -> gpui::AnyView {
    gpui_component::tooltip::Tooltip::element(move |_, _| {
        v_flex().max_w(px(420.0)).gap(px(2.0)).children(
            text.lines()
                .take(30)
                .map(|line| div().text_size(px(12.0)).child(line.to_owned())),
        )
    })
    .py(px(6.0))
    .px(px(8.0))
    .build(window, cx)
}
