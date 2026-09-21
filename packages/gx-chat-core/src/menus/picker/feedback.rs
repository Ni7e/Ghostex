//! The footer keys' highlight, and the pane-resize dismissal.
//!
//! Ports of `packages/shared/session-chat-presentation/model-picker-feedback.ts` and
//! `model-picker-pane-resize.ts`. The TypeScript held a `setTimeout` per control; the core holds
//! no closures, so each pending release is a deadline and [`ModelPickerKeyFeedback::expire`]
//! drains the ones that are due. The host arms one timer from the earliest deadline, which is
//! what `nextWakeMs` already did.

use crate::menus::picker::input::PickerControl;

/// How long a tap stays lit after the key comes back up.
const RELEASE_MS: f64 = 160.0;

/// Keeps taps visible for 160 ms while held keys remain lit until release.
#[derive(Clone, Debug, Default, PartialEq)]
pub struct ModelPickerKeyFeedback {
    /// The lit controls, in the order they were added: `[...this.pressed]` is published verbatim.
    pressed: Vec<PickerControl>,
    /// Physical key to the control it is holding down, in insertion order.
    held: Vec<(String, PickerControl)>,
    /// Control to the moment its highlight is released.
    releases: Vec<(PickerControl, f64)>,
}

impl ModelPickerKeyFeedback {
    /// The lit controls, in publication order.
    pub fn pressed(&self) -> &[PickerControl] {
        &self.pressed
    }

    /// The earliest pending release, so the host can arm one timer for it.
    pub fn next_deadline(&self) -> Option<f64> {
        self.releases.iter().map(|(_, deadline)| *deadline).fold(
            None,
            |earliest: Option<f64>, deadline| {
                Some(match earliest {
                    Some(value) if value <= deadline => value,
                    _ => deadline,
                })
            },
        )
    }

    /// Runs every release that is due. Returns whether anything changed.
    pub fn expire(&mut self, now_ms: f64) -> bool {
        let mut changed = false;
        loop {
            let Some(index) = self
                .releases
                .iter()
                .position(|(_, deadline)| *deadline <= now_ms)
            else {
                return changed;
            };
            let (control, _) = self.releases.remove(index);
            let before = self.pressed.len();
            self.pressed.retain(|entry| *entry != control);
            changed |= self.pressed.len() != before;
        }
    }

    /// `press`: the key is down, so its control lights up and stays lit until it comes back up.
    pub fn press(&mut self, key: &str, control: PickerControl, now_ms: f64) {
        match self.held.iter_mut().find(|(held, _)| held == key) {
            Some(entry) => entry.1 = control,
            None => self.held.push((key.to_string(), control)),
        }
        self.pulse(control, now_ms);
    }

    /// `pulse`: light a control that no key is holding, and start its release countdown.
    pub fn pulse(&mut self, control: PickerControl, now_ms: f64) {
        self.releases.retain(|(entry, _)| *entry != control);
        if !self.pressed.contains(&control) {
            self.pressed.push(control);
        }
        if !self.held.iter().any(|(_, held)| *held == control) {
            self.release_after_delay(control, now_ms);
        }
    }

    /// `release`: the key came up. Its control fades only when no other held key wants it.
    pub fn release(&mut self, key: &str, now_ms: f64) {
        let Some(index) = self.held.iter().position(|(held, _)| held == key) else {
            return;
        };
        let (_, control) = self.held.remove(index);
        if !self.held.iter().any(|(_, held)| *held == control) {
            self.release_after_delay(control, now_ms);
        }
    }

    /// `blur`: a blur only releases the held-key highlights and leaves the picker open.
    pub fn blur(&mut self) -> bool {
        self.dispose();
        let changed = !self.pressed.is_empty();
        self.pressed.clear();
        changed
    }

    /// `dispose`: drop every held key and every pending release without touching what is lit.
    pub fn dispose(&mut self) {
        self.held.clear();
        self.releases.clear();
    }

    fn release_after_delay(&mut self, control: PickerControl, now_ms: f64) {
        self.releases.retain(|(entry, _)| *entry != control);
        self.releases.push((control, now_ms + RELEASE_MS));
    }
}

/// CDXC:SessionChat 2026-09-19 DECISION:
/// User: "when we show the quick picker then the user resizes the pane the quick picker is shown
/// in, then lets hide the quick picker (dismiss it)". Dismissal is the cancel path (no selection
/// is kept), the same one an outside click and Escape already use; a blur only releases the
/// held-key highlights and leaves the picker open. The pane size measured when the picker opened
/// is the baseline, and only a change of more than a pixel counts, so the first layout after
/// opening and sub-pixel jitter never dismiss it. Moving the pane without resizing it keeps the
/// existing behaviour.
#[derive(Clone, Copy, Debug, Default, PartialEq)]
pub struct ModelPickerPaneResize {
    baseline: Option<(f64, f64)>,
}

impl ModelPickerPaneResize {
    /// `resized`: whether this report is a resize rather than the baseline or jitter.
    pub fn resized(&mut self, width: f64, height: f64) -> bool {
        let Some((baseline_width, baseline_height)) = self.baseline else {
            self.baseline = Some((width, height));
            return false;
        };
        (width - baseline_width).abs() > 1.0 || (height - baseline_height).abs() > 1.0
    }
}
