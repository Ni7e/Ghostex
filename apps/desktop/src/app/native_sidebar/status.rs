use gpui::prelude::FluentBuilder;
use gpui::{AnyElement, IntoElement, ParentElement, Styled, div, px, rgb};

/// CDXC:SessionStatus 2026-09-21 DECISION:
/// User: "I feel we have multiple degrees for the orange color status \"working\" in the sidebar pls unify all of them on this new one you picked", so every working dot, count, and badge in the sidebar uses this one orange (the Spaces badge orange, 20% darker than the old 0xf8ad07 so a white digit stays readable on it).
pub(crate) const WORKING_COLOR: u32 = 0xc68a06;

/// CDXC:SessionStatus 2026-09-19 DECISION:
/// User: "make the working indicator just the orange dot without animation. i dont mind. like the one we have in the SESSIONS header", so a working session shows the same static 8px orange dot the section headers draw.
/// This supersedes the 2026-09-17 decision that brought the animated working spinner back.
pub(crate) fn activity_indicator(activity: &str, scale: f32) -> Option<AnyElement> {
    let indicator = match activity {
        "working" => div()
            .size(px(8.0 * scale))
            .rounded_full()
            .bg(rgb(WORKING_COLOR))
            .into_any_element(),
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

pub(crate) fn question_indicator(working: bool, scale: f32) -> AnyElement {
    div()
        .h(px(16.0 * scale))
        .min_w(px(16.0 * scale))
        .flex_shrink_0()
        .flex()
        .items_center()
        .justify_center()
        .gap(px(4.0 * scale))
        .when(working, |indicator| {
            indicator.child(div().size(px(8.0 * scale)).rounded_full().bg(rgb(WORKING_COLOR)))
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
