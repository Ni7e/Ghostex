//! How a finished turn moves into its "Worked for Xs" fold, and how that fold opens and closes: the
//! native form of `packages/core-ui/chat/session-chat-worked-fold.tsx`.
//!
//! A turn folds the moment the transcript settles, so the rows the reader was just watching turn
//! into the heading above the final reply instead of vanishing: they dim, their block eases shut
//! while the reply stays where it is, and the heading, its divider and the files line grow in.
//! Pressing the heading or the rail plays the same height ease forwards or back. The timing is
//! `packages/shared/session-chat-presentation/worked-fold-animation.json`, which React reads too.
//! This file only keeps time; `completed_work_row.rs` paints what it reports.

use serde::Deserialize;
use std::{
    cell::Cell,
    collections::{HashMap, HashSet},
    rc::Rc,
    sync::LazyLock,
};
use web_time::Instant;

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct WorkedFoldMetrics {
    dim_ms: f32,
    dim_opacity: f32,
    collapse_delay_ms: f32,
    collapse_ms: f32,
    heading_delay_ms: f32,
    heading_ms: f32,
    heading_offset_px: f32,
    toggle_ms: f32,
    easing: [f32; 4],
}

static METRICS: LazyLock<WorkedFoldMetrics> = LazyLock::new(|| {
    serde_json::from_str(include_str!(
        "../../../../../packages/shared/session-chat-presentation/worked-fold-animation.json"
    ))
    .expect("shared worked-fold animation metrics")
});

/// Which movement a fold is making.
#[derive(Clone, Copy, PartialEq, Eq)]
pub(super) enum FoldMotionKind {
    /// The turn's live rows are folding under a heading that did not exist a moment ago.
    Fold,
    /// The reader opened the log.
    Open,
    /// The reader closed the log.
    Close,
}

/// What one frame of a moving fold paints. Factors run from 0 (nothing showing) to 1 (full height).
#[derive(Clone, Copy)]
pub(super) struct FoldFrame {
    pub kind: FoldMotionKind,
    /// The heading, its divider and the files line growing in; 1 outside a fold.
    pub heading: f32,
    /// The heading's upward offset while it arrives, in unscaled pixels.
    pub heading_offset: f32,
    /// The work log's height.
    pub log: f32,
    /// The work rows' opacity.
    pub rows_opacity: f32,
}

struct FoldMotion {
    kind: FoldMotionKind,
    started: Instant,
    /// The log height the motion starts from, so a reversal continues from what is on screen.
    from: f32,
}

/// Every fold on screen that is moving, and the turns the transcript last drew as live rows.
#[derive(Default)]
pub(crate) struct WorkedFoldMotions {
    live: HashSet<String>,
    motions: HashMap<String, FoldMotion>,
    heights: HashMap<String, Rc<Cell<f32>>>,
}

fn progress(elapsed_ms: f32, delay_ms: f32, span_ms: f32) -> f32 {
    ((elapsed_ms - delay_ms) / span_ms.max(1.0)).clamp(0.0, 1.0)
}

fn eased(t: f32) -> f32 {
    super::composer_animation::eased(&METRICS.easing, t)
}

impl WorkedFoldMotions {
    /// The transcript drew this turn's rows unfolded (`work:<user id>`).
    pub(super) fn saw_live(&mut self, key: &str) {
        if !self.live.contains(key) {
            self.live.insert(key.to_string());
        }
    }

    /// A folded turn is being drawn. When the same turn was drawn live before, it has just folded:
    /// start the fold, unless the log stays open (verbose mode) or motion is reduced.
    pub(super) fn arrived(&mut self, key: &str, folds_shut: bool, reduce_motion: bool) {
        if self.live.remove(key) && folds_shut && !reduce_motion {
            self.motions.insert(
                key.to_string(),
                FoldMotion {
                    kind: FoldMotionKind::Fold,
                    started: Instant::now(),
                    from: 1.0,
                },
            );
        }
    }

    /// The reader opened or closed the log.
    pub(super) fn toggled(&mut self, key: &str, open: bool, reduce_motion: bool) {
        if !key.starts_with("work:") {
            return;
        }
        if reduce_motion {
            self.settle(key);
            return;
        }
        let from = self
            .frame(key)
            .map(|frame| frame.log)
            .unwrap_or(if open { 0.0 } else { 1.0 });
        self.motions.insert(
            key.to_string(),
            FoldMotion {
                kind: if open {
                    FoldMotionKind::Open
                } else {
                    FoldMotionKind::Close
                },
                started: Instant::now(),
                from,
            },
        );
    }

    /// This frame of the fold, or `None` once it is at rest (the row then paints its settled form).
    pub(super) fn frame(&mut self, key: &str) -> Option<FoldFrame> {
        let motion = self.motions.get(key)?;
        let metrics = &*METRICS;
        let elapsed = motion.started.elapsed().as_secs_f32() * 1000.0;
        let (frame, end) = match motion.kind {
            FoldMotionKind::Fold => {
                let dim = eased(progress(elapsed, 0.0, metrics.dim_ms));
                let collapse = eased(progress(
                    elapsed,
                    metrics.collapse_delay_ms,
                    metrics.collapse_ms,
                ));
                let heading = eased(progress(
                    elapsed,
                    metrics.heading_delay_ms,
                    metrics.heading_ms,
                ));
                (
                    FoldFrame {
                        kind: motion.kind,
                        heading,
                        heading_offset: metrics.heading_offset_px * (1.0 - heading),
                        log: 1.0 - collapse,
                        rows_opacity: 1.0 - (1.0 - metrics.dim_opacity) * dim,
                    },
                    (metrics.collapse_delay_ms + metrics.collapse_ms)
                        .max(metrics.heading_delay_ms + metrics.heading_ms),
                )
            }
            FoldMotionKind::Open | FoldMotionKind::Close => {
                let target = if motion.kind == FoldMotionKind::Open {
                    1.0
                } else {
                    0.0
                };
                // A reversal part of the way through covers only the distance left.
                let span = metrics.toggle_ms * (target - motion.from).abs().max(0.2);
                let log =
                    motion.from + (target - motion.from) * eased(progress(elapsed, 0.0, span));
                (
                    FoldFrame {
                        kind: motion.kind,
                        heading: 1.0,
                        heading_offset: 0.0,
                        log,
                        rows_opacity: metrics.dim_opacity + (1.0 - metrics.dim_opacity) * log,
                    },
                    span,
                )
            }
        };
        if elapsed >= end {
            self.settle(key);
            return None;
        }
        Some(frame)
    }

    /// The natural height one part of a moving fold measured on its last paint.
    pub(super) fn height(&mut self, key: &str, part: &str) -> Rc<Cell<f32>> {
        self.heights
            .entry(format!("{key}#{part}"))
            .or_default()
            .clone()
    }

    fn settle(&mut self, key: &str) {
        self.motions.remove(key);
        let prefix = format!("{key}#");
        self.heights.retain(|part, _| !part.starts_with(&prefix));
    }
}
