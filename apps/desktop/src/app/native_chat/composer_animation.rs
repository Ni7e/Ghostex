//! The chat box's transition: the native form of React's
//! `packages/core-ui/chat/use-session-chat-composer-transition.ts`.
//!
//! React tweens the composer's painted height whenever its content changes shape (a scroll
//! collapse, an expansion, the editor auto-growing a line, a queue strip or an attachment strip
//! arriving) and fades the option pills and toolbar in over the second half of an expansion. The
//! same thing happens here: the box measures its natural content height every frame, and while the
//! measured height differs from the one it is painting the box is pinned to an eased value that
//! walks to the new one. Interrupting a tween restarts it from the value on screen, never from the
//! value it started at, so a reversal continues instead of snapping.
//!
//! Timing, easing and the collapsed/expanded metrics come from the file both renderers read,
//! `packages/shared/session-chat-presentation/composer-animation.json`.

use serde::Deserialize;
use std::{cell::Cell, rc::Rc, sync::LazyLock, time::Instant};

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct ComposerAnimationMetrics {
    pub duration_ms: f32,
    pub easing: [f32; 4],
    pub min_delta_px: f32,
    pub arrival_delay_fraction: f32,
    pub arrival_duration_fraction: f32,
    pub arrival_translate_y_px: f32,
    pub collapsed_height_px: f32,
    pub collapsed_line_height_px: f32,
    pub collapsed_padding_block_px: f32,
    pub collapsed_row_gap_px: f32,
    pub expanded_line_height_px: f32,
    pub expanded_padding_block_px: f32,
    pub expanded_max_height_px: f32,
    pub expanded_row_gap_px: f32,
}

pub(super) static METRICS: LazyLock<ComposerAnimationMetrics> = LazyLock::new(|| {
    serde_json::from_str(include_str!(
        "../../../../../packages/shared/session-chat-presentation/composer-animation.json"
    ))
    .expect("shared composer animation metrics")
});

/// CSS `cubic-bezier(x1, y1, x2, y2)` at `t`: solve x(u) = t, then read y(u).
fn eased(easing: &[f32; 4], t: f32) -> f32 {
    let curve = |a: f32, b: f32, u: f32| {
        let v = 1.0 - u;
        3.0 * a * v * v * u + 3.0 * b * v * u * u + u * u * u
    };
    let slope = |a: f32, b: f32, u: f32| {
        let v = 1.0 - u;
        3.0 * a * (v * v - 2.0 * v * u) + 3.0 * b * (2.0 * v * u - u * u) + 3.0 * u * u
    };
    let mut u = t.clamp(0.0, 1.0);
    for _ in 0..6 {
        let derivative = slope(easing[0], easing[2], u);
        if derivative.abs() < 1e-5 {
            break;
        }
        u = (u - (curve(easing[0], easing[2], u) - t) / derivative).clamp(0.0, 1.0);
    }
    curve(easing[1], easing[3], u)
}

/// What the composer paints this frame.
pub(super) struct ComposerFrame {
    /// The pinned box height while a tween runs; `None` paints the box at its natural height.
    pub height: Option<f32>,
    /// The expanded controls' arrival fade (React's delayed opacity keyframes).
    pub controls_opacity: f32,
    /// The arrival fade's downward offset, in unscaled pixels.
    pub controls_offset: f32,
    /// True while the view still needs frames.
    pub running: bool,
}

#[derive(Default)]
pub(crate) struct ComposerAnimation {
    /// The height the last frame painted, and the value an interruption continues from.
    current: Option<f32>,
    from: f32,
    target: f32,
    started: Option<Instant>,
    /// When the controls that an expansion brings back began their fade.
    arrival: Option<Instant>,
    collapsed: bool,
    /// The natural height the last painted frame reported, so a frame that measures the same value
    /// costs nothing. The chat paints far more often than the box changes shape.
    reported: Rc<Cell<f32>>,
}

impl ComposerAnimation {
    fn duration(&self) -> f32 {
        METRICS.duration_ms / 1000.0
    }

    /// The cell a painting frame writes its measured natural height into.
    pub(super) fn reported(&self) -> Rc<Cell<f32>> {
        self.reported.clone()
    }

    /// Note the collapse state this frame renders in; leaving the collapsed shape fades the option
    /// pills and the toolbar back in, the way React animates its `CONTROLS` selector on expansion.
    pub(super) fn set_collapsed(&mut self, collapsed: bool, reduce_motion: bool) {
        if collapsed == self.collapsed {
            return;
        }
        self.collapsed = collapsed;
        self.arrival = (!collapsed && !reduce_motion).then(Instant::now);
    }

    /// Advance the tween and report what to paint.
    pub(super) fn advance(&mut self, reduce_motion: bool) -> ComposerFrame {
        if reduce_motion {
            self.started = None;
            self.arrival = None;
            if self.current.is_some() {
                self.current = Some(self.target);
            }
            return ComposerFrame {
                height: None,
                controls_opacity: 1.0,
                controls_offset: 0.0,
                running: false,
            };
        }
        let duration = self.duration();
        let mut height = None;
        if let Some(started) = self.started {
            let progress = started.elapsed().as_secs_f32() / duration;
            if progress >= 1.0 {
                self.started = None;
                self.current = Some(self.target);
            } else {
                let value =
                    self.from + (self.target - self.from) * eased(&METRICS.easing, progress);
                self.current = Some(value);
                height = Some(value);
            }
        }
        let mut controls_opacity = 1.0;
        let mut controls_offset = 0.0;
        if let Some(arrival) = self.arrival {
            let delay = duration * METRICS.arrival_delay_fraction;
            let span = (duration * METRICS.arrival_duration_fraction).max(0.001);
            let progress = (arrival.elapsed().as_secs_f32() - delay) / span;
            if progress >= 1.0 {
                self.arrival = None;
            } else {
                let fade = eased(&METRICS.easing, progress.max(0.0));
                controls_opacity = fade;
                controls_offset = METRICS.arrival_translate_y_px * (1.0 - fade);
            }
        }
        ComposerFrame {
            height,
            controls_opacity,
            controls_offset,
            running: self.started.is_some() || self.arrival.is_some(),
        }
    }

    /// Adopt the natural height the frame just measured. Returns true when a redraw is owed.
    pub(super) fn measured(&mut self, natural: f32, reduce_motion: bool) -> bool {
        if !natural.is_finite() || natural <= 0.0 {
            return false;
        }
        let Some(current) = self.current else {
            // The first paint of a chat has nothing to move from, so it starts at rest.
            self.current = Some(natural);
            self.target = natural;
            return false;
        };
        if (natural - self.target).abs() < METRICS.min_delta_px {
            return false;
        }
        self.target = natural;
        if reduce_motion || (natural - current).abs() < METRICS.min_delta_px {
            self.current = Some(natural);
            self.started = None;
            return false;
        }
        self.from = current;
        self.started = Some(Instant::now());
        true
    }
}
