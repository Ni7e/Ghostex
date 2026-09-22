//! The open quick picker: what it remembers and what it draws.
//!
//! Port of `packages/shared/session-chat-controller/native-model-picker.ts`. The class held two
//! `setTimeout`s (the pointer rail's 350 ms release and the 190 ms close animation) and a
//! `changed()` callback; the core holds neither, so both are deadlines drained by
//! [`ModelPickerState::expire`] and the host republishes on the tick that drains them.

use serde_json::{json, Map, Value};

use crate::menus::picker::agents::picker_agent;
use crate::menus::picker::artwork::{model_picker_artwork_key, model_picker_effort_artwork_key};
use crate::menus::picker::feedback::{ModelPickerKeyFeedback, ModelPickerPaneResize};
use crate::menus::picker::input::{
    model_picker_control_for_key, ModelPickerWheelInput, ModelPickerWheelNavigation, PickerControl,
    PickerKeyInput,
};
use crate::menus::picker::model_picker::{
    model_picker_choose_effort, model_picker_choose_model, model_picker_layout,
    model_picker_next_effort_index, model_picker_supports_session_scope, ModelPickerProvider,
    ModelPickerRequest, ModelPickerSelection, ModelSelectionScope, PaneSize,
    MODEL_PICKER_DEFAULT_SCOPE_ONLY_REASON,
};

/// How long the rail stays pinned after a pointer pick.
const POINTER_RAIL_MS: f64 = 350.0;
/// How long the close animation runs before the choice is applied.
const CLOSE_MS: f64 = 190.0;
/// The controls strip's height until the renderer measures it.
const DEFAULT_CONTROLS_HEIGHT: f64 = 56.0;

/// What the picker does when its close animation ends.
#[derive(Clone, Debug, PartialEq)]
pub struct ModelPickerOutcome {
    /// The selection to apply, or `None` when the picker was cancelled.
    pub selection: Option<ModelPickerSelection>,
    pub scope: ModelSelectionScope,
    /// The request the picker was opened with, which `modelSelectionUnchanged` compares against.
    pub request: ModelPickerRequest,
    /// The session the picker was opened for; a selection is dropped when the session changed.
    pub session_key: String,
}

/// One open quick picker.
#[derive(Clone, Debug, PartialEq)]
pub struct ModelPickerState {
    pub request: ModelPickerRequest,
    pub selection: ModelPickerSelection,
    pub closing: bool,
    pub saving: bool,
    /// `this.sessionScope`: Claude's `/model` list can commit without saving a default.
    pub session_scope: bool,
    /// The option key the picker was opened for, checked again when it finishes.
    pub session_key: String,
    pointer_rail_start: Option<f64>,
    pointer_deadline: Option<f64>,
    close_deadline: Option<f64>,
    close_scope: ModelSelectionScope,
    feedback: ModelPickerKeyFeedback,
    wheel: ModelPickerWheelNavigation,
    pane_resize: ModelPickerPaneResize,
    size: PaneSize,
    controls_height: f64,
}

impl ModelPickerState {
    /// `new NativeModelPicker(request, …)`.
    pub fn open(request: ModelPickerRequest, session_key: String) -> Self {
        let selection = ModelPickerSelection {
            model: request.model.clone(),
            effort: request.effort.clone(),
        };
        let session_scope = model_picker_supports_session_scope(request.provider);
        Self {
            request,
            selection,
            closing: false,
            saving: false,
            session_scope,
            session_key,
            pointer_rail_start: None,
            pointer_deadline: None,
            close_deadline: None,
            close_scope: ModelSelectionScope::Default,
            feedback: ModelPickerKeyFeedback::default(),
            wheel: ModelPickerWheelNavigation::default(),
            pane_resize: ModelPickerPaneResize::default(),
            size: PaneSize {
                width: 1.0,
                height: 1.0,
            },
            controls_height: DEFAULT_CONTROLS_HEIGHT,
        }
    }

    /// `this.defaultScope`, which is a constant since the 2026-09-21 decision removed the
    /// per-session switch.
    fn default_scope(&self) -> ModelSelectionScope {
        ModelSelectionScope::Default
    }

    /// The earliest moment the picker needs waking, so the host can arm one timer.
    pub fn next_deadline(&self) -> Option<f64> {
        [
            self.pointer_deadline,
            self.close_deadline,
            self.feedback.next_deadline(),
        ]
        .into_iter()
        .flatten()
        .fold(None, |earliest: Option<f64>, deadline| {
            Some(match earliest {
                Some(value) if value <= deadline => value,
                _ => deadline,
            })
        })
    }

    /// Runs every deadline that is due. Returns the outcome when the close animation ended.
    pub fn expire(&mut self, now_ms: f64) -> Option<ModelPickerOutcome> {
        self.feedback.expire(now_ms);
        if self
            .pointer_deadline
            .is_some_and(|deadline| deadline <= now_ms)
        {
            self.pointer_deadline = None;
            self.pointer_rail_start = None;
        }
        if self
            .close_deadline
            .is_some_and(|deadline| deadline <= now_ms)
        {
            self.close_deadline = None;
            return Some(ModelPickerOutcome {
                selection: self.saving.then(|| self.selection.clone()),
                scope: self.close_scope,
                request: self.request.clone(),
                session_key: self.session_key.clone(),
            });
        }
        None
    }

    /// `pane`: the host reports the owning chat pane's size, starting with the one it had when
    /// the picker opened. A real resize dismisses the picker.
    pub fn pane(&mut self, size: PaneSize, now_ms: f64) {
        if self.closing {
            return;
        }
        if self.pane_resize.resized(size.width, size.height) {
            self.finish(false, None, now_ms);
        }
    }

    /// `measure`.
    pub fn measure(&mut self, size: PaneSize, controls_height: Option<f64>) {
        self.size = size;
        self.controls_height = controls_height.unwrap_or(DEFAULT_CONTROLS_HEIGHT);
    }

    /// `chooseModel`.
    pub fn choose_model(&mut self, index: i64, save: bool, pointer: bool, now_ms: f64) {
        if self.closing {
            return;
        }
        let Some(choice) = model_picker_choose_model(&self.request, &self.selection, index) else {
            return;
        };
        let first_visible = self.layout().first_visible;
        self.pointer_deadline = None;
        self.pointer_rail_start = pointer.then_some(first_visible);
        if pointer {
            self.pointer_deadline = Some(now_ms + POINTER_RAIL_MS);
        }
        self.selection = choice;
        if save {
            self.finish(true, None, now_ms);
        }
    }

    /// `chooseEffort`.
    pub fn choose_effort(&mut self, index: i64, save: bool, now_ms: f64) {
        if self.closing {
            return;
        }
        let Some(choice) = model_picker_choose_effort(&self.request, &self.selection, index) else {
            return;
        };
        self.selection = choice;
        if save {
            self.finish(true, None, now_ms);
        }
    }

    /// `navigate`.
    pub fn navigate(&mut self, control: PickerControl, now_ms: f64) {
        if self.closing {
            return;
        }
        self.feedback.pulse(control, now_ms);
        let model_index = self
            .request
            .models
            .iter()
            .position(|entry| entry.value == self.selection.model)
            .map(|index| index as i64)
            .unwrap_or(-1);
        if control == PickerControl::ArrowUp {
            self.choose_model(model_index - 1, false, false, now_ms);
        }
        if control == PickerControl::ArrowDown {
            self.choose_model(model_index + 1, false, false, now_ms);
        }
        if control == PickerControl::ArrowLeft || control == PickerControl::ArrowRight {
            let direction = if control == PickerControl::ArrowLeft {
                -1
            } else {
                1
            };
            if let Some(next) =
                model_picker_next_effort_index(&self.request, &self.selection, direction)
            {
                self.choose_effort(next, false, now_ms);
            }
        }
        if control == PickerControl::EnterAlternate && self.session_scope {
            // `defaultScope` is always `default`, so the alternate is always `session`.
            self.finish(true, Some(ModelSelectionScope::Session), now_ms);
        }
        if control == PickerControl::Enter || control == PickerControl::Escape {
            self.finish(control == PickerControl::Enter, None, now_ms);
        }
    }

    /// `key`.
    pub fn key(&mut self, input: &PickerKeyInput, now_ms: f64) {
        let Some(control) = model_picker_control_for_key(input) else {
            return;
        };
        let held = match input.code.as_deref() {
            Some(code) if !code.is_empty() => code,
            _ => input.key.as_str(),
        };
        self.feedback.press(held, control, now_ms);
        self.navigate(control, now_ms);
    }

    /// `release`.
    pub fn release(&mut self, key: &str, now_ms: f64) {
        self.feedback.release(key, now_ms);
    }

    /// `blur`.
    pub fn blur(&mut self) {
        self.feedback.blur();
    }

    /// `scroll`.
    pub fn scroll(&mut self, input: &ModelPickerWheelInput, now_ms: f64) {
        if let Some(direction) = self.wheel.update(input) {
            self.navigate(direction.into(), now_ms);
        }
    }

    /// `finish`: start the close animation, which only a save plays; a cancel closes on the next
    /// tick (native-model-picker.ts). `scope` of `None` means the default scope.
    pub fn finish(&mut self, save: bool, scope: Option<ModelSelectionScope>, now_ms: f64) {
        if self.closing {
            return;
        }
        self.closing = true;
        self.saving = save;
        self.close_scope = scope.unwrap_or_else(|| self.default_scope());
        self.close_deadline = Some(now_ms + if save { CLOSE_MS } else { 0.0 });
    }

    fn layout(&self) -> crate::menus::picker::model_picker::ModelPickerLayout {
        let index = self
            .request
            .models
            .iter()
            .position(|entry| entry.value == self.selection.model)
            .map(|index| index as f64)
            .unwrap_or(-1.0);
        model_picker_layout(
            &self.request,
            index,
            self.size,
            self.controls_height,
            self.pointer_rail_start,
        )
    }

    /// `projection()`: the whole `modelPicker` document key.
    pub fn projection(&self) -> Value {
        let index = self
            .request
            .models
            .iter()
            .position(|entry| entry.value == self.selection.model)
            .map(|index| index as i64)
            .unwrap_or(-1);
        let model = usize::try_from(index)
            .ok()
            .and_then(|index| self.request.models.get(index));
        let layout = self.layout();
        let standard = self.request.provider != ModelPickerProvider::Claude
            && self.request.provider != ModelPickerProvider::Codex;
        let agent = picker_agent(self.request.provider);
        let models: Vec<Value> = self
            .request
            .models
            .iter()
            .enumerate()
            .map(|(position, entry)| {
                let mut row = serde_json::to_value(entry).unwrap_or(Value::Null);
                if let Some(object) = row.as_object_mut() {
                    object.insert("index".into(), json!(position));
                    object.insert("selected".into(), json!(position as i64 == index));
                    object.insert(
                        "artwork".into(),
                        json!(model_picker_artwork_key(&entry.value, standard)),
                    );
                    object.insert(
                        "y".into(),
                        json!(71.0 + layout.rail_offset + position as f64 * 142.0),
                    );
                }
                row
            })
            .filter(|row| {
                !layout.short || row.get("selected").and_then(Value::as_bool) == Some(true)
            })
            .collect();
        let efforts: Vec<Value> = self
            .request
            .efforts
            .iter()
            .enumerate()
            .map(|(position, entry)| {
                let position_f = position as f64;
                json!({
                    "value": entry.value,
                    "label": entry.label,
                    "index": position,
                    "selected": entry.value == self.selection.effort,
                    "available": model
                        .is_some_and(|model| model.efforts.iter().any(|effort| effort.value == entry.value)),
                    "artwork": model_picker_effort_artwork_key(&entry.value),
                    "x": (if position_f < layout.effort_split {
                        position_f - layout.effort_split
                    } else {
                        position_f - layout.effort_split + 1.0
                    }) * 142.0,
                })
            })
            .collect();
        let mut object: Map<String, Value> = match serde_json::to_value(layout) {
            Ok(Value::Object(map)) => map,
            _ => Map::new(),
        };
        object.insert("requestId".into(), json!(self.request.request_id));
        object.insert("provider".into(), json!(self.request.provider.as_str()));
        object.insert(
            "selection".into(),
            serde_json::to_value(&self.selection).unwrap_or(Value::Null),
        );
        object.insert(
            "agent".into(),
            json!({ "name": agent.name, "icon": agent.icon }),
        );
        object.insert("closing".into(), json!(self.closing));
        object.insert("saving".into(), json!(self.saving));
        object.insert("sessionScope".into(), json!(self.session_scope));
        object.insert("primaryScope".into(), json!(self.default_scope().as_str()));
        // `scopeReason: undefined` is a key `JSON.stringify` leaves out.
        if !self.session_scope {
            object.insert(
                "scopeReason".into(),
                json!(MODEL_PICKER_DEFAULT_SCOPE_ONLY_REASON),
            );
        }
        object.insert(
            "pressed".into(),
            Value::Array(
                self.feedback
                    .pressed()
                    .iter()
                    .map(|control| json!(control.as_str()))
                    .collect(),
            ),
        );
        object.insert("compactControls".into(), json!(self.size.width < 560.0));
        object.insert("canUp".into(), json!(index > 0));
        object.insert(
            "canDown".into(),
            json!(index < self.request.models.len() as i64 - 1),
        );
        object.insert(
            "canLeft".into(),
            json!(model_picker_next_effort_index(&self.request, &self.selection, -1).is_some()),
        );
        object.insert(
            "canRight".into(),
            json!(model_picker_next_effort_index(&self.request, &self.selection, 1).is_some()),
        );
        object.insert("models".into(), Value::Array(models));
        object.insert("efforts".into(), Value::Array(efforts));
        // A model without effort levels (Cursor's Auto) shows only its name.
        object.insert(
            "effortLabel".into(),
            self.request
                .efforts
                .iter()
                .find(|entry| entry.value == self.selection.effort)
                .map(|entry| json!(entry.label))
                .unwrap_or(Value::Null),
        );
        Value::Object(object)
    }
}
