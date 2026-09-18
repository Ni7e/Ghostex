use super::{
    appearance::ChatAppearance,
    state::NativeChatView,
    working_spark::{css_ease_in_out, spark},
};
use crate::app::helpers::ThrottledAnimationExt;
use crate::assets::chat_working::VISUAL;
use gpui::StatefulInteractiveElement as _;
use gpui::{
    AnyElement, FontFeatures, FontWeight, InteractiveElement, IntoElement, ParentElement, Styled,
    div, px, relative, svg,
};
use std::time::Duration;

impl NativeChatView {
    pub(crate) fn render_working_strip(&self, p: &ChatAppearance) -> Option<AnyElement> {
        let status = &self.snapshot["workingStrip"];
        let reduced_motion = crate::app::helpers::gpui_macos_reduce_motion_enabled();
        if status["presentation"].is_object() {
            return Some(self.render_working_activity(p, reduced_motion));
        }
        let label = status["label"].as_str()?;
        Some(
            div()
                .id("chat-working-strip")
                .role(gpui::Role::Status)
                .aria_label(label)
                .w_full()
                .min_w_0()
                .min_h(px(VISUAL.min_height * p.scale))
                .px(px(VISUAL.padding_x * p.scale))
                .flex()
                .items_center()
                .gap(px(VISUAL.gap * p.scale))
                .child(spark(p, reduced_motion))
                .child(
                    div()
                        .min_w_0()
                        .text_size(px(VISUAL.font_size * p.scale))
                        .line_height(relative(1.5))
                        .text_color(p.muted)
                        .truncate()
                        .child(label.to_owned()),
                )
                .into_any_element(),
        )
    }

    fn render_working_activity(&self, p: &ChatAppearance, reduced_motion: bool) -> AnyElement {
        let activity = &self.snapshot["workingStrip"]["presentation"];
        let s = p.scale;
        let lead = if activity["shellsRunning"] == true {
            let glyph = svg()
                .path("titlebar/loader2.svg")
                .size(px(14.0 * s))
                .text_color(p.control_primary);
            if reduced_motion {
                glyph.into_any_element()
            } else {
                glyph
                    .with_throttled_animation(
                        "chat-shells-running",
                        Duration::from_secs(1),
                        |glyph, progress| {
                            glyph.with_transformation(gpui::Transformation::rotate(
                                gpui::percentage(progress),
                            ))
                        },
                    )
                    .into_any_element()
            }
        } else {
            let dot = div().size(px(6.0 * s)).rounded_full().bg(p.control_primary);
            if reduced_motion {
                dot.into_any_element()
            } else {
                dot.with_throttled_animation(
                    "chat-activity-dot",
                    Duration::from_millis(1600),
                    |dot, phase| {
                        let progress = css_ease_in_out(if phase < 0.5 {
                            phase * 2.0
                        } else {
                            (1.0 - phase) * 2.0
                        });
                        dot.opacity(1.0 - 0.65 * progress)
                    },
                )
                .into_any_element()
            }
        };
        let mut title = div()
            .flex()
            .items_center()
            .flex_1()
            .min_w_0()
            .text_color(p.foreground)
            .child(activity["label"].as_str().unwrap_or_default().to_owned());
        if let Some(hint) = activity["hint"].as_str() {
            let hint = hint.to_owned();
            title = title.child(
                div()
                    .id("compaction-messaging-hint")
                    .role(gpui::Role::Button)
                    .aria_label("Messaging during compaction")
                    .ml(px(6.0 * s))
                    .size(px(20.0 * s))
                    .flex()
                    .items_center()
                    .justify_center()
                    .tooltip(move |window, cx| {
                        gpui_component::tooltip::Tooltip::new(hint.clone()).build(window, cx)
                    })
                    .child(
                        svg()
                            .path("titlebar/info-circle.svg")
                            .size(px(14.0 * s))
                            .text_color(p.muted),
                    ),
            );
        }
        let mut trailing = div()
            .h(px(22.75 * s))
            .flex()
            .items_center()
            .gap(px(8.0 * s))
            .flex_shrink_0()
            .text_size(px(14.0 * s))
            .text_color(p.muted)
            .font_features(FontFeatures(vec![("tnum".into(), 1)].into()));
        if let Some(elapsed) = activity["elapsedLabel"].as_str() {
            trailing = trailing.child(elapsed.to_owned());
        }
        let percent = activity["percent"].as_f64();
        if let Some(percent) = percent {
            trailing = trailing.child(
                div()
                    .font_weight(FontWeight::MEDIUM)
                    .text_color(p.foreground.opacity(0.8))
                    .child(format!("{percent}%")),
            );
        }
        let header = div()
            .flex()
            .items_start()
            .gap(px(8.0 * s))
            .text_size(px(14.0 * s))
            .line_height(relative(1.625))
            .child(
                div()
                    .h(px(22.75 * s))
                    .flex()
                    .items_center()
                    .flex_shrink_0()
                    .child(lead),
            )
            .child(title)
            .child(trailing)
            .into_any_element();
        let mut body = Vec::new();
        let primary = p.control_primary;
        if percent.is_some() || activity["indeterminate"] == true {
            let track = div()
                .relative()
                .h(px(4.0 * s))
                .w_full()
                .rounded_full()
                .overflow_hidden()
                .bg(p.foreground.opacity(0.1));
            let fill = div().h_full().rounded_full().bg(primary);
            let track = if let Some(percent) = percent {
                track
                    .child(fill.w(relative(percent as f32 / 100.0)))
                    .into_any_element()
            } else if reduced_motion {
                track
                    .flex()
                    .justify_center()
                    .child(fill.w(relative(0.35)))
                    .into_any_element()
            } else {
                track
                    .with_throttled_animation(
                        "chat-compaction-progress",
                        Duration::from_millis(1800),
                        move |track, phase| {
                            track.child(
                                div()
                                    .absolute()
                                    .h_full()
                                    .rounded_full()
                                    .bg(primary)
                                    .w(relative(0.35))
                                    .left(relative(-0.35 + 1.351 * css_ease_in_out(phase))),
                            )
                        },
                    )
                    .into_any_element()
            };
            body.push(track);
        }
        div()
            .id("chat-working-activity")
            .role(gpui::Role::Status)
            .w_full()
            .child(self.status_card_with_header(header, body, Vec::new(), p))
            .into_any_element()
    }
}
