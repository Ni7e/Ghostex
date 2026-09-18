use super::{appearance::ChatAppearance, state::NativeChatView};
use gpui::prelude::FluentBuilder as _;
use gpui::{
    AnyElement, Context, InteractiveElement as _, IntoElement, ParentElement as _,
    StatefulInteractiveElement as _, Styled as _, canvas, div, px, svg,
};
use serde_json::Value;
use std::{cell::Cell, rc::Rc};

fn pill(
    kind: &'static str,
    label: &str,
    values: &Value,
    appearance: &ChatAppearance,
    cx: &mut Context<NativeChatView>,
) -> AnyElement {
    let bounds = Rc::new(Cell::new(gpui::Bounds::default()));
    let measured = bounds.clone();
    let scale = appearance.scale;
    let loading = label.is_empty();
    let icon_only = kind == "mode";
    let title = if loading {
        format!("Reading {}…", kind)
    } else {
        format!(
            "{}: {label}",
            match kind {
                "model" => "Model",
                "mode" => "Mode",
                _ => "Options",
            }
        )
    };
    let tooltip = if !loading && kind != "mode" {
        let shortcut = crate::app::hotkeys::gpui_configured_hotkey_label("openModelPicker");
        if kind == "model" {
            match shortcut.filter(|_| values["modelQuickPicker"] == true) {
                Some(shortcut) => format!("Model ({shortcut})"),
                None => "Model".to_owned(),
            }
        } else {
            let tooltip = values["optionsTooltip"].as_str().unwrap_or("Options");
            match shortcut {
                Some(shortcut) => tooltip.replace("{shortcut}", &shortcut),
                None => tooltip.replace(" ({shortcut})", ""),
            }
        }
    } else {
        title.clone()
    };
    let display = if kind == "model" {
        values["modelDisplay"].as_str().unwrap_or(label)
    } else {
        label
    };
    let mut item = div()
        .id(format!("chat-{kind}-picker"))
        .relative()
        .role(gpui::Role::Button)
        .aria_label(title.clone())
        .cursor_pointer()
        .min_w_0()
        .max_w(px(160.0 * scale))
        .h(px(24.0 * scale))
        .px(px(if icon_only { 6.0 } else { 10.0 } * scale))
        .flex()
        .items_center()
        .justify_center()
        .gap(px(4.0 * scale))
        .rounded_full()
        .hover(|style| style.bg(appearance.border))
        .tooltip(move |window, cx| {
            gpui_component::tooltip::Tooltip::new(tooltip.clone()).build(window, cx)
        });
    if kind == "model"
        && let Some(icon) = values["agentIcon"].as_str()
    {
        let color = crate::app::helpers::workspace_tab_agent_icon_accent_color(icon);
        let color = if appearance.light && matches!(color, 0xffffff | 0xedecec) {
            0x27272a
        } else {
            color
        };
        item = item.child(
            div().flex_shrink_0().mr(px(2.0 * scale)).child(
                svg()
                    .path(format!("agent-icons/{icon}.svg"))
                    .size(px(14.0 * scale))
                    .text_color(gpui::rgb(color)),
            ),
        );
    }
    if icon_only && let Some(mode) = values["modeValue"].as_str() {
        let (icon, color) = match mode {
            "accept-edits" => ("mode-advance", 0xd3bff8),
            "auto" => ("mode-advance", 0xf6daa0),
            "bypass" => ("mode-advance", 0xffb6c5),
            "manual" => ("mode-pause", 0xd2d4dc),
            "plan" => ("mode-pause", 0xa6ddd8),
            _ => ("mode-pause", 0xd2d4dc),
        };
        let mut color = gpui::rgb(color);
        if appearance.light {
            color.r *= 0.525;
            color.g *= 0.525;
            color.b *= 0.525;
        }
        item = item.child(
            svg()
                .path(format!("titlebar/{icon}.svg"))
                .w(px(16.0 * scale))
                .h(px(14.0 * scale))
                .text_color(color)
                .opacity(0.55),
        );
    } else if !icon_only {
        item = item
            .when(!loading, |item| {
                item.child(div().min_w_0().text_ellipsis().child(display.to_owned()))
            })
            .when(loading, |item| {
                item.child(
                    div()
                        .w(px(if kind == "model" { 52.0 } else { 36.0 } * scale))
                        .h(px(10.0 * scale))
                        .rounded_full()
                        .bg(appearance.primary.opacity(0.24)),
                )
            });
        if kind == "options" && !loading {
            for (key, icon) in [("fast", "bolt"), ("plan", "map")] {
                if values[key] == true {
                    item = item.child(
                        svg()
                            .path(format!("titlebar/{icon}.svg"))
                            .size(px(12.0 * scale))
                            .text_color(appearance.primary),
                    );
                }
            }
        }
        item = item.child(
            svg()
                .path("titlebar/chevron-down.svg")
                .size(px(12.0 * scale))
                .flex_shrink_0()
                .text_color(appearance.primary),
        );
    }
    item.on_click(cx.listener(move |chat, _, window, cx| {
        if kind == "model" || !loading {
            chat.show_option_menu(kind, bounds.get(), window, cx);
        }
    }))
    .child(
        canvas(
            move |bounds, _, _| {
                measured.set(bounds);
            },
            |_, _, _, _| {},
        )
        .absolute()
        .size_full(),
    )
    .into_any_element()
}

impl NativeChatView {
    pub(super) fn option_pills_width(
        &self,
        appearance: &ChatAppearance,
        window: &gpui::Window,
    ) -> f32 {
        let values = &self.snapshot["optionLabels"];
        let scale = appearance.scale;
        let mut style = window.text_style();
        style.font_family = appearance.font.clone().into();
        let measure = |kind: &str| {
            let label = values[if kind == "model" {
                "modelDisplay"
            } else {
                "options"
            }]
            .as_str()
            .unwrap_or_default();
            let text_width = if label.is_empty() {
                (if kind == "model" { 52.0 } else { 36.0 }) * scale
            } else {
                window
                    .text_system()
                    .shape_line(
                        label.to_owned().into(),
                        px(13.0 * scale),
                        &[style.to_run(label.len())],
                        None,
                    )
                    .width
                    .as_f32()
            };
            let agent = if kind == "model" && values["agentIcon"].is_string() {
                20.0
            } else {
                0.0
            };
            let badges = if kind == "options" && !label.is_empty() {
                ["fast", "plan"]
                    .iter()
                    .filter(|key| values[**key] == true)
                    .count() as f32
                    * 16.0
            } else {
                0.0
            };
            (text_width + (36.0 + agent + badges) * scale).min(160.0 * scale)
        };
        if values["showModel"] != true {
            return 0.0;
        }
        let mut width = measure("model");
        if self.snapshot["contextMeter"].is_object() {
            width += 32.0 * scale;
        }
        if values["showOptions"] == true {
            width += measure("options") + 2.0 * scale;
        }
        if self.snapshot["optionMenus"]["mode"]
            .as_array()
            .is_some_and(|rows| !rows.is_empty())
        {
            width += 30.0 * scale;
        }
        width
    }

    pub(super) fn render_option_pills(
        &self,
        model: &str,
        options: &str,
        appearance: &ChatAppearance,
        cx: &mut Context<Self>,
    ) -> AnyElement {
        let values = &self.snapshot["optionLabels"];
        div()
            .flex()
            .min_w_0()
            .overflow_hidden()
            .items_center()
            .gap(px(2.0 * appearance.scale))
            .text_size(px(13.0 * appearance.scale))
            .text_color(appearance.primary)
            .when(values["showModel"] == true, |item| {
                item.child(pill("model", model, values, appearance, cx))
            })
            .when(
                values["showOptions"] == true
                    && self.snapshot["composerOverflow"]["optionsOverflowed"] != true,
                |item| item.child(pill("options", options, values, appearance, cx)),
            )
            .when(
                self.snapshot["optionMenus"]["mode"]
                    .as_array()
                    .is_some_and(|rows| !rows.is_empty()),
                |item| {
                    item.child(pill(
                        "mode",
                        values["mode"].as_str().unwrap_or_default(),
                        values,
                        appearance,
                        cx,
                    ))
                },
            )
            .when(
                self.snapshot["contextMeter"].is_object()
                    && self.snapshot["composerOverflow"]["optionsOverflowed"] != true,
                |item| item.child(self.render_context_meter(appearance, cx)),
            )
            .into_any_element()
    }
}
