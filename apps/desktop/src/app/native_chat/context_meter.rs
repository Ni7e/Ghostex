use super::{appearance::ChatAppearance, state::NativeChatView, transcript::text};
use gpui::prelude::FluentBuilder as _;
use gpui::{
    AnyElement, Bounds, Context, InteractiveElement as _, IntoElement, ParentElement as _,
    StatefulInteractiveElement as _, Styled as _, canvas, div, point, px,
};
use serde_json::{Value, json};
use std::{cell::Cell, rc::Rc};

pub(super) fn ring(percentage: f32, appearance: &ChatAppearance) -> AnyElement {
    let scale = appearance.scale;
    let mut muted = gpui::Rgba::from(appearance.muted);
    if appearance.light {
        muted.r *= 0.75;
        muted.g *= 0.75;
        muted.b *= 0.75;
    }
    let muted = gpui::Hsla::from(muted).opacity(0.24);
    let ink = gpui::rgb(if appearance.light { 0x8b8b8b } else { 0xb9b9b9 });
    canvas(
        |_, _, _| {},
        move |bounds, _, window, _| {
            let center = bounds.center();
            let radius = 6.5 * scale;
            for (fraction, color) in [
                (1.0, muted),
                ((percentage / 100.0).clamp(0.0, 1.0), ink.into()),
            ] {
                if fraction <= 0.0 {
                    continue;
                }
                let mut path = gpui::PathBuilder::stroke(px(2.0 * scale));
                let steps = (fraction * 96.0).ceil() as usize;
                for step in 0..=steps {
                    let angle = -std::f32::consts::FRAC_PI_2
                        + std::f32::consts::TAU * fraction * step as f32 / steps as f32;
                    let point = center + point(px(angle.cos() * radius), px(angle.sin() * radius));
                    if step == 0 {
                        path.move_to(point);
                    } else {
                        path.line_to(point);
                    }
                }
                if let Ok(path) = path.build() {
                    window.paint_path(path, color);
                }
                if fraction < 1.0 {
                    for angle in [
                        -std::f32::consts::FRAC_PI_2,
                        -std::f32::consts::FRAC_PI_2 + std::f32::consts::TAU * fraction,
                    ] {
                        let tip =
                            center + point(px(angle.cos() * radius), px(angle.sin() * radius));
                        window.paint_quad(
                            gpui::fill(
                                gpui::Bounds::new(
                                    tip - point(px(scale), px(scale)),
                                    gpui::size(px(2.0 * scale), px(2.0 * scale)),
                                ),
                                color,
                            )
                            .corner_radii(px(scale)),
                        );
                    }
                }
            }
        },
    )
    .size(px(16.0 * scale))
    .into_any_element()
}

impl NativeChatView {
    pub(super) fn context_menu_rows(&self) -> Vec<Value> {
        vec![json!({"context":self.snapshot["contextMeter"]})]
    }

    pub(super) fn render_context_meter(
        &self,
        appearance: &ChatAppearance,
        cx: &mut Context<Self>,
    ) -> AnyElement {
        let context = &self.snapshot["contextMeter"];
        let tooltip = text(context, "tooltip");
        let bounds = Rc::new(Cell::new(Bounds::default()));
        let measured = bounds.clone();
        let percentage = context["usedPercentage"].as_f64().unwrap_or(0.0) as f32;
        div()
            .id("chat-context-meter")
            .role(gpui::Role::Button)
            .aria_label(text(context, "label"))
            .relative()
            .ml(px(6.0 * appearance.scale))
            .size(px(24.0 * appearance.scale))
            .flex_shrink_0()
            .flex()
            .items_center()
            .justify_center()
            .rounded_full()
            .cursor_pointer()
            .hover(|style| style.bg(appearance.border))
            .tooltip(move |window, cx| {
                gpui_component::tooltip::Tooltip::new(tooltip.clone()).build(window, cx)
            })
            .child(ring(percentage, appearance))
            .on_click(cx.listener(move |chat, _, window, cx| {
                let width = if chat.snapshot["contextMeter"]["details"].is_array() {
                    320.0
                } else {
                    256.0
                };
                chat.show_chat_menu(chat.context_menu_rows(), bounds.get(), width, window, cx);
            }))
            .child(
                canvas(move |bounds, _, _| measured.set(bounds), |_, _, _, _| {})
                    .absolute()
                    .size_full(),
            )
            .into_any_element()
    }

    pub(super) fn render_context_status(
        &self,
        appearance: &ChatAppearance,
        window: &gpui::Window,
        cx: &Context<Self>,
    ) -> AnyElement {
        let scale = appearance.scale;
        let mut style = window.text_style();
        style.font_family = appearance.font.clone().into();
        let mut widths = Vec::new();
        let mut lines = Vec::new();
        let mut line = div()
            .flex()
            .items_center()
            .justify_center()
            .w_full()
            .min_w_0();
        let starts = self.snapshot["contextStatusRows"].as_array();
        for (index, item) in self.snapshot["contextMeter"]["starred"]
            .as_array()
            .into_iter()
            .flatten()
            .enumerate()
        {
            let row_start = index == 0
                || starts.is_some_and(|starts| {
                    starts
                        .iter()
                        .any(|value| value.as_u64() == Some(index as u64))
                });
            if row_start && index > 0 {
                lines.push(line.into_any_element());
                line = div()
                    .flex()
                    .items_center()
                    .justify_center()
                    .w_full()
                    .min_w_0();
            }
            if !row_start {
                line = line.child(
                    div()
                        .w(px(18.0 * scale))
                        .flex_shrink_0()
                        .text_center()
                        .text_size(px(7.0 * scale))
                        .text_color(appearance.muted.opacity(0.4))
                        .child("◆"),
                );
            }
            let value = text(item, "value");
            widths.push(
                window
                    .text_system()
                    .shape_line(
                        value.clone().into(),
                        px(11.0 * scale),
                        &[style.to_run(value.len())],
                        None,
                    )
                    .width
                    .as_f32(),
            );
            let copy = item["copy"]["text"].as_str().map(str::to_owned);
            let label = format!(
                "{}{}",
                text(item, "label"),
                if copy.is_some() {
                    " · Click to copy id"
                } else {
                    ""
                }
            );
            line = line.child(
                div()
                    .id(format!("context-status-{index}"))
                    .min_w_0()
                    .text_ellipsis()
                    .child(value)
                    .tooltip(move |window, cx| {
                        gpui_component::tooltip::Tooltip::new(label.clone()).build(window, cx)
                    })
                    .when_some(copy, |item, copy| {
                        item.cursor_pointer()
                            .on_click(cx.listener(move |_, _, _, cx| {
                                cx.write_to_clipboard(gpui::ClipboardItem::new_string(
                                    copy.clone(),
                                ));
                                crate::app::helpers::gpui_play_copy_sound();
                            }))
                    }),
            );
        }
        lines.push(line.into_any_element());
        let chat = cx.weak_entity();
        div().relative().flex().flex_col().w_full().min_w_0().min_h(px(16.0*scale)).px(px(4.0*scale))
            .text_size(px(11.0*scale)).line_height(px(16.0*scale)).text_color(appearance.muted.opacity(0.8)).children(lines)
            .child(canvas(move |bounds,window,cx| {
                let measurement=json!({"available":(bounds.size.width.as_f32()-8.0*scale).max(0.0),"widths":widths,"separator":18.0*scale});
                let chat=chat.clone();
                window.defer(cx,move |_,cx| {
                    let _=chat.update(cx,|chat,cx| {
                        if chat.context_status_measurements.as_ref()==Some(&measurement) {return;}
                        chat.context_status_measurements=Some(measurement.clone());
                        let mut command=measurement;
                        command["type"]="measureContextStatus".into();
                        chat.invoke(command,cx);
                    });
                });
            },|_,_,_,_|{}).absolute().size_full()).into_any_element()
    }
}
