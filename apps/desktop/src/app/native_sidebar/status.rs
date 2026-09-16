use gpui::prelude::FluentBuilder;
use gpui::{
    Animation, AnimationExt, AnyElement, IntoElement, ParentElement, Styled, Transformation, div,
    percentage, px, rgb, svg,
};
use std::time::Duration;

pub(crate) fn question_indicator(working: bool, scale: f32) -> AnyElement {
    div()
        .relative()
        .size(px(16.0 * scale))
        .flex_shrink_0()
        .flex()
        .items_center()
        .justify_center()
        .when(working, |indicator| {
            indicator.child(
                svg()
                    .absolute()
                    .size(px(16.0 * scale))
                    .path("titlebar/loader2.svg")
                    .text_color(rgb(0xd99a62))
                    .with_animation(
                        "native-sidebar-question-working",
                        Animation::new(Duration::from_millis(820)).repeat(),
                        |icon, delta| {
                            icon.with_transformation(Transformation::rotate(percentage(delta)))
                        },
                    ),
            )
        })
        .child(div().size(px(6.0 * scale)).rounded_full().bg(rgb(0xf472b6)))
        .into_any_element()
}

pub(crate) fn completion_opacity(start: std::time::Instant) -> f32 {
    let progress = (start.elapsed().as_secs_f32() / 3.0).min(1.0);
    let stops = [
        (0.0, 1.0),
        (0.08, 0.9),
        (0.16, 0.58),
        (0.24, 1.0),
        (0.36, 0.9),
        (0.44, 0.58),
        (0.52, 1.0),
        (0.64, 0.9),
        (0.72, 0.58),
        (0.80, 1.0),
        (1.0, 1.0),
    ];
    for pair in stops.windows(2) {
        if progress <= pair[1].0 {
            let t = (progress - pair[0].0) / (pair[1].0 - pair[0].0);
            return pair[0].1 + (pair[1].1 - pair[0].1) * t;
        }
    }
    1.0
}
