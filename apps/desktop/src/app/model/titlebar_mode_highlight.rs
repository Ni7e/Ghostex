use std::rc::Rc;

use gpui::Bounds;
use gpui::Pixels;

use crate::app::model::titlebar_mode::TitlebarMode;

/// One tab's horizontal span (left edge, width) relative to the mode
/// switcher's left edge, captured at prepaint from the previous frame.
#[derive(Clone, Copy, Debug, PartialEq)]
pub(crate) struct TitlebarModeTabSpan {
    pub(crate) left: f32,
    pub(crate) width: f32,
}

impl TitlebarModeTabSpan {
    pub(crate) fn lerp(self, to: TitlebarModeTabSpan, delta: f32) -> TitlebarModeTabSpan {
        TitlebarModeTabSpan {
            left: self.left + (to.left - self.left) * delta,
            width: self.width + (to.width - self.width) * delta,
        }
    }
}

/// CDXC:Titlebar 2026-09-19 DECISION:
/// User: the active mode-tab fill slides behind the newly selected view instead of jumping.
/// The fill is one absolute layer under the tabs, so the tabs stay static elements and only the
/// layer's left/width animate; a switch mid-slide starts from the layer's current interpolated
/// span, not from the previous tab's resting span.
#[derive(Debug, Default)]
pub(crate) struct TitlebarModeHighlightState {
    spans: Vec<(TitlebarMode, TitlebarModeTabSpan)>,
    shown_mode: Option<TitlebarMode>,
    /// Where the current slide started; `None` until the first switch, which
    /// keeps the initial frame static instead of sliding in from nowhere.
    from: Option<TitlebarModeTabSpan>,
    /// Last span the animator painted, so an interrupted slide continues from it.
    current: Option<TitlebarModeTabSpan>,
    /// Bumps per switch so the animation element restarts under a fresh id.
    generation: u64,
}

pub(crate) type SharedTitlebarModeHighlightState =
    Rc<std::cell::RefCell<TitlebarModeHighlightState>>;

impl TitlebarModeHighlightState {
    pub(crate) fn span_for(&self, mode: TitlebarMode) -> Option<TitlebarModeTabSpan> {
        self.spans
            .iter()
            .find(|(candidate, _)| *candidate == mode)
            .map(|(_, span)| *span)
    }

    /// Called once per render with the tab the fill should sit under. Returns
    /// the slide origin (if a slide is in progress or just started) and the
    /// generation to key the animation element by.
    pub(crate) fn begin_frame(
        &mut self,
        active: Option<TitlebarMode>,
    ) -> (Option<TitlebarModeTabSpan>, u64) {
        if self.shown_mode != active {
            let previous = self.shown_mode;
            self.shown_mode = active;
            let from = self
                .current
                .or_else(|| previous.and_then(|mode| self.span_for(mode)));
            if from.is_some() && active.is_some() {
                self.from = from;
                self.generation += 1;
            } else {
                self.from = None;
                self.current = None;
            }
        }
        (self.from, self.generation)
    }

    pub(crate) fn note_painted(&mut self, span: TitlebarModeTabSpan) {
        self.current = Some(span);
    }

    /// `children` is the switcher's prepainted child list: index 0 is the
    /// highlight layer, the rest are the tabs in `modes` order.
    pub(crate) fn record_spans(&mut self, modes: &[TitlebarMode], children: &[Bounds<Pixels>]) {
        let Some(first_tab) = children.get(1) else {
            self.spans.clear();
            return;
        };
        let origin = first_tab.origin.x.as_f32();
        self.spans = modes
            .iter()
            .zip(children.iter().skip(1))
            .map(|(mode, bounds)| {
                (
                    *mode,
                    TitlebarModeTabSpan {
                        left: bounds.origin.x.as_f32() - origin,
                        width: bounds.size.width.as_f32(),
                    },
                )
            })
            .collect();
    }
}
