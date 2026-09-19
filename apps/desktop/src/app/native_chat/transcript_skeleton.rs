/*!
The transcript skeleton a chat shows while its transcript is still being read.

CDXC:SessionChat 2026-09-19 SEE-ALSO:
The user's decision lives on React's `SessionChatLoadingState`
(packages/core-ui/chat/session-chat-loading-state.tsx, styled by the
`.ghostex-chat-transcript-skeleton*` rules in packages/core-ui/styles/chat.css);
both draw the geometry in packages/shared/session-chat-presentation/transcript-skeleton.json.
*/

use super::{appearance::ChatAppearance, state::NativeChatView, working_spark::css_ease_in_out};
use crate::app::helpers::ThrottledAnimationExt;
use gpui::prelude::FluentBuilder as _;
use gpui::{
    AnyElement, Context, InteractiveElement as _, IntoElement, ParentElement as _,
    StatefulInteractiveElement as _, Styled as _, div, px, relative,
};
use serde::Deserialize;
use serde_json::json;
use std::{sync::LazyLock, time::Duration};

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct TranscriptSkeleton {
    top_padding: f32,
    row_gap: f32,
    bar_height: f32,
    bar_gap: f32,
    bubble_height: f32,
    bubble_radius: f32,
    tint: f32,
    pulse_ms: u64,
    pulse_min_opacity: f32,
    rows: Vec<SkeletonRow>,
}

#[derive(Deserialize)]
struct SkeletonRow {
    role: String,
    widths: Vec<f32>,
}

static SKELETON: LazyLock<TranscriptSkeleton> = LazyLock::new(|| {
    serde_json::from_str(include_str!(
        "../../../../../packages/shared/session-chat-presentation/transcript-skeleton.json"
    ))
    .expect("shared transcript skeleton")
});

impl NativeChatView {
    /// The loading hold: blank at first, then the skeleton, then the skeleton under a Retry row.
    pub(super) fn render_transcript_skeleton(
        &self,
        stage: &str,
        p: &ChatAppearance,
        cx: &mut Context<Self>,
    ) -> AnyElement {
        let s = p.scale;
        let region = div()
            .flex_1()
            .min_h_0()
            .w_full()
            .flex()
            .justify_center()
            .overflow_hidden();
        if stage == "blank" {
            return region.into_any_element();
        }
        region
            .child(
                // The same column the transcript rows sit in (transcript.rs).
                div()
                    .id("chat-transcript-skeleton")
                    .role(gpui::Role::Status)
                    .aria_label("Loading conversation…")
                    .w_full()
                    .max_w(px(768.0 * s))
                    .when_some(p.transcript_width, |this, width| {
                        this.max_w(relative(1.0)).w(relative(width))
                    })
                    .px(px(16.0 * s))
                    .pt(px(SKELETON.top_padding * s))
                    .flex()
                    .flex_col()
                    .gap(px(SKELETON.row_gap * s))
                    .when(stage == "retry", |this| {
                        this.child(
                            div()
                                .flex()
                                .items_center()
                                .justify_center()
                                .gap(px(12.0 * s))
                                .text_color(p.muted)
                                .child("Still loading this conversation.")
                                .child(self.chat_button(
                                    "retry-chat".into(),
                                    "Retry".into(),
                                    json!({"type":"retry"}),
                                    p,
                                    cx,
                                )),
                        )
                    })
                    .child(skeleton_rows(p)),
            )
            .into_any_element()
    }
}

/// A right-hand prompt bubble, then a few lines of reply, repeated, pulsing like React's.
fn skeleton_rows(p: &ChatAppearance) -> AnyElement {
    let s = p.scale;
    let fill = p.foreground.opacity(SKELETON.tint);
    let rows = div()
        .w_full()
        .flex()
        .flex_col()
        .gap(px(SKELETON.row_gap * s))
        .children(SKELETON.rows.iter().map(|row| {
            if row.role == "user" {
                div().w_full().flex().justify_end().child(
                    div()
                        .w(relative(row.widths.first().copied().unwrap_or(0.4)))
                        .h(px(SKELETON.bubble_height * s))
                        .rounded(px(SKELETON.bubble_radius * s))
                        .bg(fill),
                )
            } else {
                div()
                    .w_full()
                    .flex()
                    .flex_col()
                    .gap(px(SKELETON.bar_gap * s))
                    .children(row.widths.iter().map(|width| {
                        div()
                            .w(relative(*width))
                            .h(px(SKELETON.bar_height * s))
                            .rounded_full()
                            .bg(fill)
                    }))
            }
        }));
    if crate::app::helpers::gpui_macos_reduce_motion_enabled() {
        return rows.into_any_element();
    }
    // `ghostex-chat-transcript-skeleton-pulse`: full opacity at the ends, the minimum halfway, ease-in-out each way.
    let min = SKELETON.pulse_min_opacity;
    rows.with_throttled_animation(
        "chat-transcript-skeleton-pulse",
        Duration::from_millis(SKELETON.pulse_ms),
        move |rows, frame| {
            let dip = css_ease_in_out(if frame < 0.5 {
                frame * 2.0
            } else {
                (1.0 - frame) * 2.0
            });
            rows.opacity(1.0 - (1.0 - min) * dip)
        },
    )
    .into_any_element()
}
