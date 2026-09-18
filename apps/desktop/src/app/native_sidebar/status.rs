use crate::app::helpers::ThrottledAnimationExt;
use gpui::prelude::FluentBuilder;
use gpui::{AnyElement, IntoElement, ParentElement, Styled, div, px, rgb};
use std::time::Duration;

/// CDXC:SessionStatus 2026-09-17 DECISION:
/// User: bring back the session working spinner and attention dot in the native sidebar.
pub(crate) fn activity_indicator(activity: &str, scale: f32) -> Option<AnyElement> {
    let indicator = match activity {
        "working" => working_spinner(12.0, scale),
        "attention" => div()
            .size(px(7.0 * scale))
            .rounded_full()
            .bg(rgb(0x95d7f6))
            .into_any_element(),
        _ => return None,
    };
    Some(
        div()
            .w(px(19.0 * scale))
            .h(px(16.0 * scale))
            .flex_shrink_0()
            .flex()
            .items_center()
            .justify_center()
            .child(indicator)
            .into_any_element(),
    )
}

fn working_spinner(size: f32, scale: f32) -> AnyElement {
    div()
        .size(px(size * scale))
        .flex_shrink_0()
        .with_throttled_animation(
            "native-sidebar-working",
            Duration::from_millis(820),
            move |icon, delta| {
                icon.child(
                    gpui::canvas(
                        |_, _, _| (),
                        move |bounds, _, window, _| {
                            let radius = (size - 1.5) * scale / 2.0;
                            let center = bounds.center();
                            let start = std::f32::consts::TAU * delta + std::f32::consts::FRAC_PI_4;
                            let end = start + std::f32::consts::PI * 1.5;
                            let at = |angle: f32| {
                                center
                                    + gpui::point(
                                        px(radius * angle.cos()),
                                        px(radius * angle.sin()),
                                    )
                            };
                            let mut path = gpui::PathBuilder::stroke(px(1.5 * scale));
                            path.move_to(at(start));
                            path.arc_to(
                                gpui::point(px(radius), px(radius)),
                                px(0.0),
                                true,
                                true,
                                at(end),
                            );
                            if let Ok(path) = path.build() {
                                window.paint_path(path, rgb(0xd99a62));
                            }
                        },
                    )
                    .size_full(),
                )
            },
        )
        .into_any_element()
}

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
                div()
                    .absolute()
                    .size(px(16.0 * scale))
                    .child(working_spinner(16.0, scale)),
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
