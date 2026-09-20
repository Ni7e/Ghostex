//! The four Quick Access row shapes, each a port of its React row:
//! Commands (`BuiltInCommandRow` / `ProjectCommandRow`), Projects (`RecentProjectRow`),
//! Sessions (`SessionHistoryCard` under the `.quick-access-surface.previous-sessions-modal` rules)
//! and Saved Prompts (`StashedPromptRow` / `RecoveredDraftRow`).
use super::chrome::{asset_icon_path, quick_access_icon, quick_access_tooltip};
use super::model::{QuickAccessPromptChip, QuickAccessRow};
use super::palette::{
    QUICK_ACCESS_META_FONT_SIZE, QUICK_ACCESS_RADIUS_MENU_ITEM, QUICK_ACCESS_ROW_FONT_SIZE,
    QUICK_ACCESS_ROW_HEIGHT, QUICK_ACCESS_ROW_PADDING_X, QuickAccessPalette, hsla, parse_css_color,
};
use gpui::prelude::FluentBuilder as _;
use gpui::{
    AnyElement, ClickEvent, Context, InteractiveElement as _, IntoElement, MouseButton,
    MouseDownEvent, ParentElement as _, SharedString, StatefulInteractiveElement as _, Styled as _,
    Window, div, px, svg,
};
use gpui_component::{h_flex, v_flex};

/// The trailing icon buttons a Saved Prompt row offers, in the React row's order.
pub(crate) fn prompt_action_icon(action: &str) -> &'static str {
    match action {
        "open" => "arrow-up-right",
        "favorite" => "star",
        "tag" => "tag",
        "copy" => "copy",
        "edit" => "pencil",
        "save" => "device-floppy",
        "dismiss" => "x",
        _ => "trash",
    }
}

pub(crate) struct RowCallbacks<V: 'static> {
    pub(crate) on_activate: std::rc::Rc<dyn Fn(&mut V, String, &mut Window, &mut Context<V>)>,
    pub(crate) on_hover: std::rc::Rc<dyn Fn(&mut V, String, &mut Window, &mut Context<V>)>,
    pub(crate) on_secondary: std::rc::Rc<
        dyn Fn(&mut V, String, gpui::Point<gpui::Pixels>, &mut Window, &mut Context<V>),
    >,
    pub(crate) on_row_action: std::rc::Rc<
        dyn Fn(&mut V, String, String, gpui::Point<gpui::Pixels>, &mut Window, &mut Context<V>),
    >,
}

impl<V: 'static> Clone for RowCallbacks<V> {
    fn clone(&self) -> Self {
        Self {
            on_activate: self.on_activate.clone(),
            on_hover: self.on_hover.clone(),
            on_secondary: self.on_secondary.clone(),
            on_row_action: self.on_row_action.clone(),
        }
    }
}

pub(crate) fn quick_access_row<V: 'static>(
    p: &QuickAccessPalette,
    row: &QuickAccessRow,
    index: usize,
    selected: bool,
    hovered: bool,
    callbacks: &RowCallbacks<V>,
    cx: &mut Context<V>,
) -> AnyElement {
    match row {
        QuickAccessRow::Command {
            key,
            title,
            icon,
            hotkey,
        } => {
            let p = *p;
            let key = key.clone();
            let activate = callbacks.on_activate.clone();
            let hover = callbacks.on_hover.clone();
            let hover_key = key.clone();
            h_flex()
                .id(("quick-access-command", index))
                .w_full()
                .h(px(QUICK_ACCESS_ROW_HEIGHT))
                .min_h(px(QUICK_ACCESS_ROW_HEIGHT))
                .px(px(QUICK_ACCESS_ROW_PADDING_X))
                .gap(px(8.0))
                .items_center()
                .rounded(px(QUICK_ACCESS_RADIUS_MENU_ITEM))
                .cursor_default()
                .when(selected || hovered, |this| this.bg(hsla(p.raised)))
                .on_mouse_move(cx.listener(move |this, _, window, cx| {
                    hover(this, hover_key.clone(), window, cx);
                }))
                .on_click(cx.listener(move |this, _: &ClickEvent, window, cx| {
                    activate(this, key.clone(), window, cx);
                }))
                .child(quick_access_icon(icon, 16.0, p.item))
                .child(
                    div()
                        .flex_1()
                        .min_w_0()
                        .overflow_hidden()
                        .whitespace_nowrap()
                        .text_ellipsis()
                        .text_size(px(QUICK_ACCESS_ROW_FONT_SIZE))
                        .line_height(px(20.0))
                        .text_color(hsla(p.item))
                        .child(SharedString::from(title.clone())),
                )
                .children((!hotkey.is_empty()).then(|| {
                    div()
                        .flex_shrink_0()
                        .text_size(px(QUICK_ACCESS_META_FONT_SIZE))
                        .line_height(px(20.0))
                        .text_color(hsla(p.muted))
                        .child(SharedString::from(hotkey.clone()))
                }))
                .into_any_element()
        }
        QuickAccessRow::Project {
            key,
            title,
            icon,
            tooltip,
            session_count,
            is_open,
            is_hidden,
        } => {
            let p = *p;
            let key = key.clone();
            let activate = callbacks.on_activate.clone();
            let hover = callbacks.on_hover.clone();
            let secondary = callbacks.on_secondary.clone();
            let remove = callbacks.on_row_action.clone();
            let hover_key = key.clone();
            let secondary_key = key.clone();
            let remove_key = key.clone();
            let activate_key = key.clone();
            h_flex()
                .id(("quick-access-project", index))
                .w_full()
                .h(px(QUICK_ACCESS_ROW_HEIGHT))
                .min_h(px(QUICK_ACCESS_ROW_HEIGHT))
                .px(px(QUICK_ACCESS_ROW_PADDING_X))
                .items_center()
                .rounded(px(QUICK_ACCESS_RADIUS_MENU_ITEM))
                .cursor_default()
                .when(selected || hovered, |this| this.bg(hsla(p.raised)))
                .on_mouse_move(cx.listener(move |this, _, window, cx| {
                    hover(this, hover_key.clone(), window, cx);
                }))
                .on_mouse_down(
                    MouseButton::Right,
                    cx.listener(move |this, event: &MouseDownEvent, window, cx| {
                        secondary(this, secondary_key.clone(), event.position, window, cx);
                    }),
                )
                .child(
                    h_flex()
                        .id(("quick-access-project-main", index))
                        .flex_1()
                        .min_w_0()
                        .h_full()
                        .gap(px(8.0))
                        .items_center()
                        .cursor_default()
                        .tooltip({
                            let tooltip = tooltip.clone();
                            move |window, cx| quick_access_tooltip(tooltip.clone(), window, cx)
                        })
                        .on_click(cx.listener(move |this, _: &ClickEvent, window, cx| {
                            activate(this, activate_key.clone(), window, cx);
                        }))
                        .child(quick_access_icon(icon, 16.0, p.muted))
                        .child(
                            div()
                                .flex_1()
                                .min_w_0()
                                .overflow_hidden()
                                .whitespace_nowrap()
                                .text_ellipsis()
                                .text_size(px(QUICK_ACCESS_ROW_FONT_SIZE))
                                .line_height(px(20.0))
                                .text_color(hsla(p.item))
                                .child(SharedString::from(title.clone())),
                        )
                        .children(is_hidden.then(|| {
                            svg()
                                .path(asset_icon_path("eye-off"))
                                .size(px(14.0))
                                .flex_shrink_0()
                                .text_color(hsla(p.muted))
                        }))
                        .child(
                            div()
                                .flex_shrink_0()
                                .text_size(px(QUICK_ACCESS_META_FONT_SIZE))
                                .line_height(px(20.0))
                                .text_color(hsla(p.muted))
                                .child(SharedString::from(session_count.to_string())),
                        ),
                )
                .child(trailing_status_slot(
                    &p,
                    ("quick-access-project-remove", index),
                    *is_open,
                    false,
                    selected || hovered,
                    move |this, position, window, cx| {
                        remove(
                            this,
                            remove_key.clone(),
                            "remove".to_string(),
                            position,
                            window,
                            cx,
                        );
                    },
                    cx,
                ))
                .into_any_element()
        }
        QuickAccessRow::Session {
            key,
            title,
            icon,
            project_label,
            file_size,
            file_size_loading,
            time,
            in_sidebar,
            sleeping,
            can_activate,
            can_delete,
        } => {
            let p = *p;
            let key = key.clone();
            let activate = callbacks.on_activate.clone();
            let hover = callbacks.on_hover.clone();
            let remove = callbacks.on_row_action.clone();
            let hover_key = key.clone();
            let remove_key = key.clone();
            let can_activate = *can_activate;
            let meta = |text: &str, width: Option<f32>| {
                div()
                    .flex_shrink_0()
                    .when_some(width, |this, width| this.w(px(width)))
                    .overflow_hidden()
                    .whitespace_nowrap()
                    .text_ellipsis()
                    .text_size(px(QUICK_ACCESS_META_FONT_SIZE))
                    .line_height(px(20.0))
                    .text_color(hsla(p.muted))
                    .child(SharedString::from(text.to_string()))
            };
            h_flex()
                .id(("quick-access-session", index))
                .w_full()
                .h(px(QUICK_ACCESS_ROW_HEIGHT))
                .min_h(px(QUICK_ACCESS_ROW_HEIGHT))
                .pl(px(12.0))
                .pr(px(QUICK_ACCESS_ROW_PADDING_X))
                .gap(px(8.0))
                .items_center()
                .rounded(px(QUICK_ACCESS_RADIUS_MENU_ITEM))
                .cursor_default()
                .when(selected || hovered, |this| this.bg(hsla(p.raised)))
                .on_mouse_move(cx.listener(move |this, _, window, cx| {
                    hover(this, hover_key.clone(), window, cx);
                }))
                .on_click(cx.listener(move |this, _: &ClickEvent, window, cx| {
                    if can_activate {
                        activate(this, key.clone(), window, cx);
                    }
                }))
                .child(
                    div()
                        .flex_shrink_0()
                        .w(px(16.0))
                        .opacity(0.5)
                        .child(quick_access_icon(icon, 15.0, p.item)),
                )
                .child(
                    div()
                        .flex_1()
                        .min_w_0()
                        .overflow_hidden()
                        .whitespace_nowrap()
                        .text_ellipsis()
                        .text_size(px(QUICK_ACCESS_ROW_FONT_SIZE))
                        .line_height(px(20.0))
                        .text_color(hsla(p.item))
                        .child(SharedString::from(title.clone())),
                )
                .child(
                    div()
                        .flex_shrink_0()
                        .max_w(px(220.0))
                        .overflow_hidden()
                        .whitespace_nowrap()
                        .text_ellipsis()
                        .text_size(px(QUICK_ACCESS_META_FONT_SIZE))
                        .line_height(px(20.0))
                        .text_color(hsla(p.muted))
                        .child(SharedString::from(project_label.clone())),
                )
                .child(
                    div()
                        .flex_shrink_0()
                        .w(px(62.0))
                        .flex()
                        .justify_end()
                        .when(*file_size_loading, |this| this.opacity(0.35))
                        .child(meta(file_size, None)),
                )
                .child(
                    div()
                        .flex_shrink_0()
                        .w(px(42.0))
                        .flex()
                        .justify_end()
                        .child(meta(time, None)),
                )
                .child(trailing_status_slot(
                    &p,
                    ("quick-access-session-delete", index),
                    *in_sidebar && !*sleeping,
                    !*can_delete,
                    (selected || hovered) && *can_delete,
                    move |this, position, window, cx| {
                        remove(
                            this,
                            remove_key.clone(),
                            "remove".to_string(),
                            position,
                            window,
                            cx,
                        );
                    },
                    cx,
                ))
                .into_any_element()
        }
        QuickAccessRow::Prompt {
            key,
            title,
            tooltip,
            project_name,
            project_icon,
            session_title,
            tags,
            time,
            is_favorite,
            stripe_color,
            actions,
        } => {
            let p = *p;
            let key = key.clone();
            let activate = callbacks.on_activate.clone();
            let hover = callbacks.on_hover.clone();
            let row_action = callbacks.on_row_action.clone();
            let hover_key = key.clone();
            let activate_key = key.clone();
            let active = selected || hovered;
            let stripe = if stripe_color.is_empty() {
                gpui::Rgba {
                    a: 0.16,
                    ..p.foreground
                }
            } else {
                parse_css_color(stripe_color, p.foreground)
            };
            h_flex()
                .id(("quick-access-prompt", index))
                .w_full()
                .h(px(56.0))
                .min_h(px(56.0))
                .mb(px(2.0))
                .gap(px(10.0))
                .items_center()
                .rounded(px(QUICK_ACCESS_RADIUS_MENU_ITEM))
                .cursor_default()
                .when(active, |this| this.bg(hsla(p.raised)))
                .on_mouse_move(cx.listener(move |this, _, window, cx| {
                    hover(this, hover_key.clone(), window, cx);
                }))
                .child(
                    div()
                        .flex_shrink_0()
                        .w(px(3.0))
                        .h_full()
                        .rounded_full()
                        .opacity(if active { 1.0 } else { 0.65 })
                        .bg(hsla(stripe)),
                )
                .child(
                    v_flex()
                        .flex_1()
                        .min_w_0()
                        .pr(px(10.0))
                        .gap(px(2.0))
                        .justify_center()
                        .child(
                            h_flex()
                                .w_full()
                                .min_w_0()
                                .h(px(24.0))
                                .items_center()
                                .child(
                                    div()
                                        .id(("quick-access-prompt-title", index))
                                        .flex_1()
                                        .min_w_0()
                                        .overflow_hidden()
                                        .whitespace_nowrap()
                                        .text_ellipsis()
                                        .text_size(px(QUICK_ACCESS_ROW_FONT_SIZE))
                                        .line_height(px(20.0))
                                        .text_color(hsla(p.item))
                                        .tooltip({
                                            let tooltip = tooltip.clone();
                                            move |window, cx| {
                                                quick_access_tooltip(tooltip.clone(), window, cx)
                                            }
                                        })
                                        .on_click(cx.listener(
                                            move |this, _: &ClickEvent, window, cx| {
                                                activate(this, activate_key.clone(), window, cx);
                                            },
                                        ))
                                        .child(SharedString::from(title.clone())),
                                )
                                .children((*is_favorite && !active).then(|| {
                                    div().flex_shrink_0().ml(px(8.0)).child(
                                        svg()
                                            .path(asset_icon_path("star-filled"))
                                            .size(px(16.0))
                                            .text_color(hsla(p.favorite)),
                                    )
                                }))
                                .children(active.then(|| {
                                    prompt_actions(
                                        &p,
                                        index,
                                        &key,
                                        actions,
                                        *is_favorite,
                                        row_action.clone(),
                                        cx,
                                    )
                                })),
                        )
                        .child(
                            h_flex()
                                .w_full()
                                .min_w_0()
                                .gap(px(12.0))
                                .items_center()
                                .justify_between()
                                .text_size(px(QUICK_ACCESS_META_FONT_SIZE))
                                .line_height(px(20.0))
                                .text_color(hsla(p.muted))
                                .child(
                                    h_flex()
                                        .flex_1()
                                        .min_w_0()
                                        .gap(px(5.0))
                                        .items_center()
                                        .child(quick_access_icon(project_icon, 13.0, p.muted))
                                        .child(
                                            div()
                                                .min_w_0()
                                                .overflow_hidden()
                                                .whitespace_nowrap()
                                                .text_ellipsis()
                                                .child(SharedString::from(project_name.clone())),
                                        )
                                        .children(
                                            (!session_title.is_empty())
                                                .then(|| neutral_chip(&p, session_title)),
                                        )
                                        .children(tags.iter().map(|tag| tag_chip(&p, tag))),
                                )
                                .child(
                                    div()
                                        .flex_shrink_0()
                                        .whitespace_nowrap()
                                        .child(SharedString::from(time.clone())),
                                ),
                        ),
                )
                .into_any_element()
        }
    }
}

/// `.ghostex-stashed-prompt-chip`: an 18px pill tinted by the tag color.
fn tag_chip(p: &QuickAccessPalette, chip: &QuickAccessPromptChip) -> AnyElement {
    let color = chip
        .color
        .as_deref()
        .map(|color| parse_css_color(color, p.foreground))
        .unwrap_or(p.foreground);
    h_flex()
        .flex_shrink_0()
        .h(px(18.0))
        .pl(px(6.0))
        .pr(px(7.0))
        .gap(px(5.0))
        .items_center()
        .rounded_full()
        .border_1()
        .border_color(hsla(p.chip_border(color)))
        .bg(hsla(p.chip_background(color)))
        .text_size(px(11.0))
        .line_height(px(11.0))
        .text_color(hsla(p.chip_text(color)))
        .whitespace_nowrap()
        .child(
            div()
                .flex_shrink_0()
                .size(px(5.0))
                .rounded_full()
                .bg(hsla(color)),
        )
        .child(SharedString::from(chip.label.clone()))
        .into_any_element()
}

/// `.ghostex-stashed-prompt-session-chip`: the tag chip's geometry with no tag
/// color, capped so a long session title cannot push the tags or the time off.
fn neutral_chip(p: &QuickAccessPalette, label: &str) -> AnyElement {
    h_flex()
        .flex_shrink(1.0)
        .min_w_0()
        .max_w(px(180.0))
        .h(px(18.0))
        .px(px(7.0))
        .items_center()
        .rounded_full()
        .border_1()
        .border_color(hsla(p.hairline))
        .bg(hsla(p.raised))
        .text_size(px(11.0))
        .line_height(px(11.0))
        .text_color(hsla(p.muted))
        .child(
            div()
                .min_w_0()
                .overflow_hidden()
                .whitespace_nowrap()
                .text_ellipsis()
                .child(SharedString::from(label.to_string())),
        )
        .into_any_element()
}

/// `.ghostex-stashed-prompt-actions`: the hover-revealed 24px ghost buttons.
fn prompt_actions<V: 'static>(
    p: &QuickAccessPalette,
    index: usize,
    key: &str,
    actions: &[String],
    is_favorite: bool,
    on_action: std::rc::Rc<
        dyn Fn(&mut V, String, String, gpui::Point<gpui::Pixels>, &mut Window, &mut Context<V>),
    >,
    cx: &mut Context<V>,
) -> AnyElement {
    let p = *p;
    let buttons = actions
        .iter()
        .enumerate()
        .map(|(action_index, action)| {
            let action = action.clone();
            let key = key.to_string();
            let on_action = on_action.clone();
            let active = action == "favorite" && is_favorite;
            div()
                .id(("quick-access-prompt-action", index * 16 + action_index))
                .size(px(24.0))
                .flex()
                .items_center()
                .justify_center()
                .rounded(px(QUICK_ACCESS_RADIUS_MENU_ITEM))
                .cursor_pointer()
                .hover(move |this| this.bg(hsla(p.raised_hover)))
                .on_click(cx.listener(move |this, event: &ClickEvent, window, cx| {
                    on_action(
                        this,
                        key.clone(),
                        action.clone(),
                        event.position(),
                        window,
                        cx,
                    );
                }))
                .child(
                    svg()
                        .path(asset_icon_path(if active {
                            "star-filled"
                        } else {
                            prompt_action_icon(actions[action_index].as_str())
                        }))
                        .size(px(16.0))
                        .text_color(hsla(if active { p.favorite } else { p.muted })),
                )
        })
        .collect::<Vec<_>>();
    h_flex()
        .flex_shrink_0()
        .ml(px(8.0))
        .gap(px(2.0))
        .items_center()
        .justify_end()
        .children(buttons)
        .into_any_element()
}

/// The shared 6px trailing column: the lifecycle dot at rest, replaced by the
/// centered remove control while the row is hovered.
fn trailing_status_slot<V: 'static>(
    p: &QuickAccessPalette,
    id: (&'static str, usize),
    lit: bool,
    hide_dot: bool,
    show_remove: bool,
    on_remove: impl Fn(&mut V, gpui::Point<gpui::Pixels>, &mut Window, &mut Context<V>) + 'static,
    cx: &mut Context<V>,
) -> AnyElement {
    let p = *p;
    div()
        .flex_shrink_0()
        .ml(px(6.0))
        .w(px(6.0))
        .h(px(6.0))
        .relative()
        .children((!show_remove && !hide_dot).then(|| {
            div().size(px(6.0)).rounded_full().bg(hsla(if lit {
                p.status_dot_open
            } else {
                p.status_dot
            }))
        }))
        .children(show_remove.then(|| {
            div()
                .id(id)
                .absolute()
                .left(px(-6.0))
                .top(px(-6.0))
                .size(px(18.0))
                .flex()
                .items_center()
                .justify_center()
                .rounded(px(4.0))
                .cursor_pointer()
                .text_color(hsla(p.muted))
                .hover(move |this| {
                    this.bg(hsla(gpui::Rgba {
                        a: 0.12,
                        ..p.destructive
                    }))
                })
                .on_click(cx.listener(move |this, event: &ClickEvent, window, cx| {
                    on_remove(this, event.position(), window, cx);
                }))
                .child(
                    svg()
                        .path(asset_icon_path("trash"))
                        .size(px(14.0))
                        .text_color(hsla(p.muted)),
                )
        }))
        .into_any_element()
}
