use super::super::window::ChatOptionMenuPanel;
use super::style::{
    BAR_HEIGHT, BUTTON_GAP, CARD_RADIUS, ERROR_HEIGHT, ITEM_RADIUS, LIST_HEIGHT, Palette, ROW_GAP,
    TRAIT_ROW_HEIGHT, button_lines,
};
use crate::app::native_chat::appearance::ChatAppearance;
use gpui::prelude::FluentBuilder as _;
use gpui::{
    AnyElement, Context, InteractiveElement as _, IntoElement as _, ParentElement as _,
    StatefulInteractiveElement as _, Styled as _, div, px, svg, uniform_list,
};
use gpui_component::input::Input;
use serde_json::{Value, json};

/// An agent's logo in its brand tone; a white mark turns dark on the light surface.
fn agent_logo(icon: &str, appearance: &ChatAppearance) -> gpui::Svg {
    let color = crate::app::helpers::workspace_tab_agent_icon_accent_color(icon);
    let color = if appearance.light && matches!(color, 0xffffff | 0xedecec) {
        0x27272a
    } else {
        color
    };
    svg()
        .path(format!("agent-icons/{icon}.svg"))
        .flex_shrink_0()
        .text_color(gpui::rgb(color))
}

impl ChatOptionMenuPanel {
    fn render_model_tabs(
        &self,
        view: &Value,
        appearance: &ChatAppearance,
        palette: &Palette,
        cx: &mut Context<Self>,
    ) -> AnyElement {
        let scale = appearance.scale;
        let mut bar = div()
            .flex_shrink_0()
            .h(px(BAR_HEIGHT * scale))
            .px(px(4.0 * scale))
            .border_b_1()
            .border_color(palette.ink(0.08))
            .flex()
            .items_center()
            .gap(px(ROW_GAP * scale));
        for (index, tab) in view["tabs"].as_array().into_iter().flatten().enumerate() {
            let active = tab["active"] == true;
            let id = tab["id"].clone();
            let name = tab["name"].as_str().unwrap_or_default().to_owned();
            let tooltip = name.clone();
            let hover = palette.ink(0.06);
            let icon = match tab["icon"].as_str() {
                Some(icon) => agent_logo(icon, appearance).size(px(16.0 * scale)),
                None => svg()
                    .path("titlebar/star-filled.svg")
                    .size(px(15.0 * scale))
                    .text_color(if active { palette.text } else { palette.muted }),
            };
            bar = bar.child(
                div()
                    .id(("model-menu-tab", index))
                    .role(gpui::Role::Tab)
                    .aria_label(name)
                    .relative()
                    .size(px(32.0 * scale))
                    .rounded(px(ITEM_RADIUS * scale))
                    .flex()
                    .items_center()
                    .justify_center()
                    .when(!active, |tab| tab.hover(move |style| style.bg(hover)))
                    .tooltip(move |window, cx| {
                        gpui_component::tooltip::Tooltip::new(tooltip.clone()).build(window, cx)
                    })
                    .on_click(cx.listener(move |panel, _, _, cx| {
                        panel.model_menu_send(json!({"type":"modelMenuView","tab":id}), cx);
                    }))
                    .child(icon.opacity(if active { 1.0 } else { 0.72 }))
                    // The 32px tab sits centred in the 40px bar, so 4px below it is the bar's own hairline.
                    .when(active, |tab| {
                        tab.child(
                            div()
                                .absolute()
                                .bottom(px(-4.0 * scale))
                                .left(px(6.0 * scale))
                                .right(px(6.0 * scale))
                                .h(px(2.0 * scale))
                                .rounded(px(1.0 * scale))
                                .bg(palette.accent),
                        )
                    }),
            );
        }
        bar.into_any_element()
    }

    fn render_model_row(
        &self,
        index: usize,
        row: &Value,
        active: bool,
        appearance: &ChatAppearance,
        palette: &Palette,
        cx: &mut Context<Self>,
    ) -> AnyElement {
        let scale = appearance.scale;
        let label = row["label"].as_str().unwrap_or_default().to_owned();
        let description = row["description"]
            .as_str()
            .map(str::trim)
            .filter(|text| !text.is_empty())
            .map(str::to_owned);
        let selected = row["selected"] == true;
        let favorite = row["favorite"] == true;
        let key = row["key"].clone();
        let name = div()
            .flex_shrink_0()
            .max_w_full()
            .truncate()
            .text_size(px(12.5 * scale))
            .font_weight(gpui::FontWeight::MEDIUM)
            .child(label.clone());
        let caption = |text: String| {
            div()
                .min_w_0()
                .truncate()
                .text_size(px(11.0 * scale))
                .text_color(palette.muted)
                .child(text)
        };
        let body = if row["showAgent"] == true {
            // Favorites mix agents, so each row names its own on a second line.
            let line = div()
                .flex()
                .items_center()
                .gap(px(6.0 * scale))
                .min_w_0()
                .child(
                    agent_logo(row["icon"].as_str().unwrap_or_default(), appearance)
                        .size(px(11.0 * scale)),
                )
                .child(caption(
                    row["agentName"].as_str().unwrap_or_default().to_owned(),
                ));
            div()
                .flex_1()
                .min_w_0()
                .flex()
                .flex_col()
                .gap(px(2.0 * scale))
                .child(name)
                .child(line)
        } else {
            div()
                .flex_1()
                .min_w_0()
                .flex()
                .items_center()
                .gap(px(6.0 * scale))
                .child(name)
        };
        // CDXC:SessionChat 2026-09-22 DECISION:
        // User: a model's description is not written next to it in the picker; an eye that appears when the row is hovered shows it on hover instead.
        let about = description.map(|description| {
            let about_hover = palette.ink(0.08);
            div()
                .id(("model-menu-about", index))
                .role(gpui::Role::Button)
                .aria_label(format!("About {label}"))
                .flex_shrink_0()
                .size(px(22.0 * scale))
                .rounded(px(ITEM_RADIUS * scale))
                .flex()
                .items_center()
                .justify_center()
                .opacity(if active { 1.0 } else { 0.0 })
                .hover(move |style| style.bg(about_hover))
                .on_mouse_down(gpui::MouseButton::Right, |_, _, cx| cx.stop_propagation())
                .on_click(|_, _, cx| cx.stop_propagation())
                .tooltip(move |window, cx| {
                    gpui_component::tooltip::Tooltip::new(description.clone()).build(window, cx)
                })
                .child(
                    svg()
                        .path("titlebar/eye.svg")
                        .size(px(13.0 * scale))
                        .text_color(palette.muted),
                )
        });
        let star_hover = palette.ink(0.08);
        let item = div()
            .id(("model-menu-row", index))
            .role(gpui::Role::MenuItemRadio)
            .aria_label(label)
            .px(px(8.0 * scale))
            .py(px(4.0 * scale))
            .rounded(px(ITEM_RADIUS * scale))
            .flex()
            .items_center()
            .gap(px(10.0 * scale))
            // The selected row's ring is a border every row reserves, so rows keep one height.
            .border_1()
            .border_color(if selected {
                palette.ink(0.09)
            } else {
                gpui::transparent_black()
            })
            .when(selected, |item| item.bg(palette.ink(0.11)))
            .when(active && !selected, |item| item.bg(palette.ink(0.05)))
            // Hover moves the keyboard cursor instead of painting its own wash, so two rows never look lit.
            .on_mouse_move(cx.listener(move |panel, _, _, cx| {
                if let Some(state) = panel.model_menu.as_mut()
                    && state.active != index
                {
                    state.active = index;
                    cx.notify();
                }
            }))
            .on_click(cx.listener(move |panel, _, _, cx| panel.model_menu_pick(index, false, cx)))
            // Right-click applies the model to this session only, where the agent can.
            .on_mouse_down(
                gpui::MouseButton::Right,
                cx.listener(move |panel, _, _, cx| panel.model_menu_pick(index, true, cx)),
            )
            .child(body)
            .children(about)
            .when_some(row["shortcut"].as_u64(), |item, slot| {
                item.child(
                    div()
                        .flex_shrink_0()
                        .px(px(5.0 * scale))
                        .py(px(1.0 * scale))
                        .rounded(px(5.0 * scale))
                        .bg(palette.ink(0.05))
                        .font_family("Menlo")
                        .text_size(px(10.0 * scale))
                        .text_color(palette.muted)
                        .child(format!("⌘{slot}")),
                )
            })
            .child(
                div()
                    .id(("model-menu-star", index))
                    .role(gpui::Role::Button)
                    .aria_label(if favorite { "Remove star" } else { "Star" })
                    .flex_shrink_0()
                    .size(px(22.0 * scale))
                    .rounded(px(ITEM_RADIUS * scale))
                    .flex()
                    .items_center()
                    .justify_center()
                    .hover(move |style| style.bg(star_hover))
                    .on_mouse_down(gpui::MouseButton::Right, |_, _, cx| cx.stop_propagation())
                    .on_click(cx.listener(move |panel, _, _, cx| {
                        cx.stop_propagation();
                        panel.model_menu_send(json!({"type":"modelMenuFavorite","key":key}), cx);
                    }))
                    .child(
                        svg()
                            .path(if favorite {
                                "titlebar/star-filled.svg"
                            } else {
                                "titlebar/star.svg"
                            })
                            .size(px(13.0 * scale))
                            .text_color(if favorite {
                                palette.star
                            } else {
                                palette.muted
                            }),
                    ),
            );
        // The list measures one item for all of them, so the gap between rows is each item's own padding.
        div().pb(px(ROW_GAP * scale)).child(item).into_any_element()
    }

    fn render_model_traits(
        &self,
        view: &Value,
        active: usize,
        appearance: &ChatAppearance,
        palette: &Palette,
        cx: &mut Context<Self>,
    ) -> Option<AnyElement> {
        let scale = appearance.scale;
        let traits = view["traits"]
            .as_array()
            .filter(|traits| !traits.is_empty())?;
        let rows = view["rows"].as_array().map_or(0, Vec::len);
        let open = self
            .model_menu
            .as_ref()
            .and_then(|state| state.flyout)
            .filter(|_| self.menu.read(cx).windows.len() > self.depth + 1);
        let mut tray = div()
            .flex_shrink_0()
            .border_t_1()
            .border_color(palette.ink(0.08))
            .p(px(4.0 * scale))
            .flex()
            .flex_col()
            .gap(px(BUTTON_GAP * scale));
        let per_line = button_lines(traits.len()).1.max(1);
        for (line, settings) in traits.chunks(per_line).enumerate() {
            let mut buttons = div().flex().gap(px(BUTTON_GAP * scale));
            for (offset, setting) in settings.iter().enumerate() {
                let index = line * per_line + offset;
                let disabled = setting["disabled"] == true || view["disabled"] == true;
                let label = setting["label"].as_str().unwrap_or_default().to_owned();
                let value = setting["valueLabel"]
                    .as_str()
                    .unwrap_or_default()
                    .to_owned();
                let icon = match setting["icon"].as_str() {
                    Some("reasoning") => Some("titlebar/brain.svg"),
                    Some("context") => Some("titlebar/chart-bar.svg"),
                    Some("fast") => Some("titlebar/bolt.svg"),
                    _ => None,
                };
                // Fast mode reads as a switch: lit in the pill's marker tone when on, dimmed when off.
                let fast = setting["icon"] == "fast";
                let on = fast
                    && setting["choices"].as_array().is_some_and(|choices| {
                        choices
                            .iter()
                            .any(|choice| choice["selected"] == true && choice["label"] == "On")
                    });
                let tone = if on {
                    palette.on
                } else if fast {
                    palette.muted
                } else {
                    palette.text
                };
                let lit = open == Some(index) || active == rows + index;
                let tooltip = if value.is_empty() {
                    label.clone()
                } else {
                    format!("{label}: {value}")
                };
                buttons = buttons.child(
                    div()
                        .id(("model-menu-setting", index))
                        .role(gpui::Role::MenuItem)
                        .aria_label(tooltip.clone())
                        .aria_expanded(open == Some(index))
                        .flex_1()
                        .min_w_0()
                        .h(px(TRAIT_ROW_HEIGHT * scale))
                        .px(px(6.0 * scale))
                        .flex()
                        .items_center()
                        .justify_center()
                        .gap(px(6.0 * scale))
                        .rounded(px(ITEM_RADIUS * scale))
                        .text_size(px(12.0 * scale))
                        .opacity(if disabled { 0.42 } else { 1.0 })
                        .when(lit, |button| button.bg(palette.ink(0.11)))
                        .tooltip(move |window, cx| {
                            gpui_component::tooltip::Tooltip::new(tooltip.clone()).build(window, cx)
                        })
                        .on_mouse_move(cx.listener(move |panel, _, _, cx| {
                            if let Some(state) = panel.model_menu.as_mut()
                                && state.active != rows + index
                            {
                                state.active = rows + index;
                                cx.notify();
                            }
                        }))
                        .on_click(cx.listener(move |panel, _, window, cx| {
                            panel.activate_model_button(index, false, window, cx)
                        }))
                        // Right-click applies the change to this session only, where the agent can.
                        .on_mouse_down(
                            gpui::MouseButton::Right,
                            cx.listener(move |panel, _, window, cx| {
                                panel.activate_model_button(index, true, window, cx)
                            }),
                        )
                        .map(|button| match icon {
                            Some(path) => button.child(
                                svg()
                                    .path(path)
                                    .flex_shrink_0()
                                    .size(px(14.0 * scale))
                                    .text_color(if on { palette.on } else { palette.muted })
                                    .when(fast && !on, |icon| icon.opacity(0.6)),
                            ),
                            None => button.child(
                                div()
                                    .flex_shrink_0()
                                    .text_color(palette.muted)
                                    .child(label.clone()),
                            ),
                        })
                        .child(div().min_w_0().truncate().text_color(tone).child(value)),
                );
            }
            tray = tray.child(buttons);
        }
        Some(tray.into_any_element())
    }

    pub(in crate::app::native_chat::option_menu) fn render_model_menu(
        &mut self,
        cx: &mut Context<Self>,
    ) -> AnyElement {
        let appearance = self.menu.read(cx).appearance.clone();
        let scale = appearance.scale;
        let palette = Palette::new(&appearance);
        let Some(state) = self.model_menu.as_ref() else {
            return div().into_any_element();
        };
        let view = state.view.clone();
        let active = state.active;
        let input = state.input.clone();
        let scroll = state.scroll.clone();
        let count = state.rows().len();
        let list = if count == 0 {
            div()
                .px(px(8.0 * scale))
                .py(px(24.0 * scale))
                .text_size(px(12.0 * scale))
                .text_color(palette.muted)
                .text_center()
                .child(view["emptyText"].as_str().unwrap_or_default().to_owned())
                .into_any_element()
        } else {
            uniform_list(
                "model-menu-rows",
                count,
                cx.processor(move |panel, range: std::ops::Range<usize>, _, cx| {
                    let appearance = panel.menu.read(cx).appearance.clone();
                    let palette = Palette::new(&appearance);
                    let Some(state) = panel.model_menu.as_ref() else {
                        return Vec::new();
                    };
                    let active = state.active;
                    let rows: Vec<(usize, Value)> = range
                        .filter_map(|index| Some((index, state.rows().get(index)?.clone())))
                        .collect();
                    rows.iter()
                        .map(|(index, row)| {
                            panel.render_model_row(
                                *index,
                                row,
                                *index == active,
                                &appearance,
                                &palette,
                                cx,
                            )
                        })
                        .collect()
                }),
            )
            .size_full()
            .px(px(4.0 * scale))
            .track_scroll(&scroll)
            .into_any_element()
        };
        div()
            .id("chat-model-menu")
            .key_context(super::keys::KEY_CONTEXT)
            .role(gpui::Role::Menu)
            .capture_action(cx.listener(Self::model_menu_key_action))
            .size_full()
            .flex()
            .flex_col()
            .rounded(px(CARD_RADIUS * scale))
            .border_1()
            .border_color(palette.border)
            .bg(palette.surface)
            .overflow_hidden()
            .font_family(appearance.font.clone())
            .text_color(palette.text)
            .text_size(px(13.0 * scale))
            .child(self.render_model_tabs(&view, &appearance, &palette, cx))
            .child(
                div()
                    .flex_shrink_0()
                    .h(px(BAR_HEIGHT * scale))
                    .px(px(10.0 * scale))
                    .border_b_1()
                    .border_color(palette.ink(0.08))
                    .flex()
                    .items_center()
                    .gap(px(8.0 * scale))
                    .child(
                        svg()
                            .path("titlebar/search.svg")
                            .flex_shrink_0()
                            .size(px(14.0 * scale))
                            .text_color(palette.muted),
                    )
                    .child(
                        div().flex_1().min_w_0().child(
                            Input::new(&input)
                                .appearance(false)
                                .bordered(false)
                                .focus_bordered(false)
                                .w_full()
                                .p_0()
                                .text_size(px(13.0 * scale))
                                .text_color(palette.text)
                                .placeholder_color(palette.muted),
                        ),
                    ),
            )
            .when_some(view["error"].as_str(), |card, error| {
                // A choice the agent's own list could not offer is said here, where it was made.
                card.child(
                    div()
                        .flex_shrink_0()
                        .h(px(ERROR_HEIGHT * scale))
                        .px(px(12.0 * scale))
                        .py(px(8.0 * scale))
                        .border_b_1()
                        .border_color(palette.ink(0.08))
                        .overflow_hidden()
                        .text_size(px(11.0 * scale))
                        .text_color(palette.muted)
                        .child("Not applied")
                        .child(
                            div()
                                .mt(px(2.0 * scale))
                                .text_size(px(12.0 * scale))
                                .line_height(px(16.0 * scale))
                                .line_clamp(2)
                                .text_color(palette.text)
                                .child(error.to_owned()),
                        ),
                )
            })
            .child(
                div()
                    .flex_shrink_0()
                    .h(px(LIST_HEIGHT * scale))
                    .py(px(4.0 * scale))
                    .bg(palette.ink(0.02))
                    // Picks wait while the agent cannot take one; the rows say so by dimming.
                    .opacity(if view["disabled"] == true { 0.5 } else { 1.0 })
                    .child(list),
            )
            .children(self.render_model_traits(&view, active, &appearance, &palette, cx))
            .into_any_element()
    }
}
