use crate::app::helpers::ThrottledAnimationExt as _;
use crate::app::native_chat::{appearance::ChatAppearance, state::NativeChatView};
use crate::*;
use gpui::{
    AnyElement, InteractiveElement as _, IntoElement, ParentElement as _, Styled as _, div, px,
    relative,
};
use serde::Deserialize;
use std::cell::RefCell;
use std::collections::HashMap;
use std::sync::LazyLock;
use std::time::{Duration, Instant};

/// The longest the pane-level skeleton stays over a booting chat before the view's own loading and retry states show through.
const CHAT_SKELETON_OVERLAY_MAX: Duration = Duration::from_millis(2500);

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

/// CDXC:SessionChat 2026-09-19 SEE-ALSO:
/// The geometry is the shared packages/shared/session-chat-presentation/transcript-skeleton.json that React's
/// SessionChatLoadingState and the chat view's own transcript skeleton draw; the pane draws it here while there is
/// no chat view yet or the view has nothing to show.
static SKELETON: LazyLock<TranscriptSkeleton> = LazyLock::new(|| {
    serde_json::from_str(include_str!(
        "../../../../packages/shared/session-chat-presentation/transcript-skeleton.json"
    ))
    .expect("shared transcript skeleton")
});

/// The shared skeleton tint, for skeletons drawn outside the chat.
pub(crate) fn skeleton_tint() -> f32 {
    SKELETON.tint
}

/// The shared skeleton pulse: its period and the opacity it dips to.
pub(crate) fn skeleton_pulse() -> (Duration, f32) {
    (
        Duration::from_millis(SKELETON.pulse_ms),
        SKELETON.pulse_min_opacity,
    )
}

#[derive(Default)]
pub(crate) struct SessionChatSkeletons {
    waiting_since: RefCell<HashMap<TerminalSessionId, Instant>>,
}

impl GhostexGpuiApp {
    /// The same readiness the chat view's own paint marker uses: rows on screen, or a status that says there are none.
    pub(crate) fn native_chat_content_ready(
        &self,
        view: &Entity<NativeChatView>,
        cx: &gpui::App,
    ) -> bool {
        let view = view.read(cx);
        view.error.is_none()
            && (view.list.item_count() > 0
                || matches!(
                    view.snapshot["status"].as_str(),
                    Some("ready" | "working" | "empty")
                ))
    }

    /// CDXC:SessionChat 2026-09-19 DECISION:
    /// User: the pane must react to the click at once and show the newly clicked session, with a skeleton until its chat transcript is ready, never keep showing the current session while the next one loads. This supersedes the same-day holdover that kept the previous conversation on screen for up to 1.2s.
    /// The incoming chat view paints underneath a skeleton until it has rows or a status, so the pane swaps in the click's frame and a boot never shows a blank pane; the overlay lets go after a moment so the view's own loading and retry states stay reachable.
    pub(crate) fn render_native_chat_with_skeleton(
        &self,
        session_id: TerminalSessionId,
        view: &Entity<NativeChatView>,
        cx: &mut gpui::Context<Self>,
    ) -> AnyElement {
        let chat = div()
            .id(format!("native-chat-{}", session_id.0))
            .size_full()
            .min_w_0()
            .min_h_0()
            .overflow_hidden()
            .child(view.clone());
        let mut waiting = self.session_chat_skeletons.waiting_since.borrow_mut();
        if self.native_chat_content_ready(view, cx) {
            waiting.remove(&session_id);
            return chat.into_any_element();
        }
        let since = *waiting.entry(session_id).or_insert_with(Instant::now);
        if since.elapsed() >= CHAT_SKELETON_OVERLAY_MAX {
            return chat.into_any_element();
        }
        let appearance = ChatAppearance::current(&view.read(cx).snapshot);
        div()
            .id(format!("native-chat-skeleton-{}", session_id.0))
            .relative()
            .size_full()
            .min_w_0()
            .min_h_0()
            .overflow_hidden()
            .child(div().absolute().inset_0().child(chat))
            .child(
                div()
                    .absolute()
                    .inset_0()
                    .occlude()
                    .child(session_chat_skeleton(&appearance)),
            )
            .into_any_element()
    }

    /// The skeleton for a chat-mode tab that has no chat view yet (a staged session or a placeholder awaiting its created session).
    pub(crate) fn render_session_chat_skeleton(&self) -> AnyElement {
        session_chat_skeleton(&ChatAppearance::current(&serde_json::Value::Null))
    }
}

/// A full chat pane drawn as the transcript skeleton on the chat background.
fn session_chat_skeleton(p: &ChatAppearance) -> AnyElement {
    let s = p.scale;
    div()
        .size_full()
        .min_w_0()
        .min_h_0()
        .flex()
        .justify_center()
        .overflow_hidden()
        .bg(p.background)
        .child(
            div()
                .id("session-chat-pane-skeleton")
                .role(gpui::Role::Status)
                .aria_label("Loading conversation…")
                .w_full()
                .max_w(px(768.0 * s))
                .px(px(16.0 * s))
                .pt(px(SKELETON.top_padding * s))
                .child(skeleton_rows(p)),
        )
        .into_any_element()
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
    let min = SKELETON.pulse_min_opacity;
    rows.with_throttled_animation(
        "session-chat-pane-skeleton-pulse",
        Duration::from_millis(SKELETON.pulse_ms),
        move |rows, frame| {
            let dip = ease_in_out(if frame < 0.5 {
                frame * 2.0
            } else {
                (1.0 - frame) * 2.0
            });
            rows.opacity(1.0 - (1.0 - min) * dip)
        },
    )
    .into_any_element()
}

/// CSS `ease-in-out` over a unit interval.
fn ease_in_out(t: f32) -> f32 {
    if t < 0.5 {
        2.0 * t * t
    } else {
        1.0 - (-2.0 * t + 2.0).powi(2) / 2.0
    }
}
