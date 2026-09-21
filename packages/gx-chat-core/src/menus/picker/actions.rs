//! Family e2's picker actions: opening and driving the quick picker, the model menu's tab,
//! search, stars and picks, and the fork branch switch.
//!
//! Port of the `toggleModelPicker`, `modelPicker*`, `modelMenu*` and `selectForkBranch` arms of
//! `packages/shared/session-chat-controller/native-host.ts`.

use serde_json::{json, Map, Value};

use crate::action::{ActionKind, UserAction};
use crate::effect::Effect;
use crate::menus::picker::favorites::{
    model_favorites_key, serialize_model_favorites, toggle_model_favorite,
};
use crate::menus::picker::input::{ModelPickerWheelInput, PickerControl, PickerKeyInput};
use crate::menus::picker::model_menu::ModelMenuTabId;
use crate::menus::picker::model_picker::PaneSize;
use crate::menus::picker::native::ModelPickerState;
use crate::menus::picker::projection::{model_menu_pick, ModelMenuPick};
use crate::menus::picker::request::create_model_picker_request;
use crate::state::{ChatContext, ChatState};

/// Handles one model picker, model menu or fork branch action.
pub fn handle(state: &mut ChatState, action: &UserAction, context: &ChatContext) -> Vec<Effect> {
    let now = context.now_ms;
    match action.kind {
        ActionKind::ToggleModelPicker => toggle_model_picker(state, action, now),
        ActionKind::ModelPickerMeasure => {
            if let (Some(picker), Some(size)) = (picker_mut(state), pane_size(action, "size")) {
                picker.measure(size, controls_height(action));
            }
            Vec::new()
        }
        ActionKind::ModelPickerPane => {
            if let (Some(picker), Some(size)) = (picker_mut(state), pane_size(action, "size")) {
                picker.pane(size, now);
            }
            Vec::new()
        }
        ActionKind::ModelPickerKey => {
            let input = action
                .param("key")
                .and_then(|value| serde_json::from_value::<PickerKeyInput>(value.clone()).ok());
            if let (Some(picker), Some(input)) = (picker_mut(state), input) {
                picker.key(&input, now);
            }
            Vec::new()
        }
        ActionKind::ModelPickerKeyUp => {
            let key = action
                .param("key")
                .and_then(Value::as_str)
                .unwrap_or_default()
                .to_string();
            if let Some(picker) = picker_mut(state) {
                picker.release(&key, now);
            }
            Vec::new()
        }
        ActionKind::ModelPickerBlur => {
            if let Some(picker) = picker_mut(state) {
                picker.blur();
            }
            Vec::new()
        }
        ActionKind::ModelPickerControl => {
            let control = action
                .param("control")
                .and_then(Value::as_str)
                .and_then(PickerControl::from_wire);
            if let (Some(picker), Some(control)) = (picker_mut(state), control) {
                picker.navigate(control, now);
            }
            Vec::new()
        }
        ActionKind::ModelPickerScroll => {
            let input = action.param("input").and_then(|value| {
                serde_json::from_value::<ModelPickerWheelInput>(value.clone()).ok()
            });
            if let (Some(picker), Some(input)) = (picker_mut(state), input) {
                picker.scroll(&input, now);
            }
            Vec::new()
        }
        ActionKind::ModelPickerModel => {
            let index = action.param("index").and_then(Value::as_i64);
            let save = action.param("save") == Some(&Value::Bool(true));
            let pointer = action.param("pointer") == Some(&Value::Bool(true));
            if let (Some(picker), Some(index)) = (picker_mut(state), index) {
                picker.choose_model(index, save, pointer, now);
            }
            Vec::new()
        }
        ActionKind::ModelPickerEffort => {
            let index = action.param("index").and_then(Value::as_i64);
            let save = action.param("save") == Some(&Value::Bool(true));
            if let (Some(picker), Some(index)) = (picker_mut(state), index) {
                picker.choose_effort(index, save, now);
            }
            Vec::new()
        }
        ActionKind::ModelPickerCancel => {
            if let Some(picker) = picker_mut(state) {
                picker.finish(false, None, now);
            }
            Vec::new()
        }
        ActionKind::ModelMenuView => model_menu_view(state, action),
        ActionKind::ModelMenuFavorite => model_menu_favorite(state, action),
        ActionKind::ModelMenuPick => model_menu_pick_action(state, action),
        ActionKind::ModelMenuTrait => model_menu_trait(state, action),
        ActionKind::SelectForkBranch => vec![Effect::HostAction {
            action: "selectForkBranch".to_string(),
            params: Box::new(Value::Object(action.params.clone())),
        }],
        _ => Vec::new(),
    }
}

fn picker_mut(state: &mut ChatState) -> Option<&mut ModelPickerState> {
    state.pickers.model_picker.as_mut()
}

fn pane_size(action: &UserAction, field: &str) -> Option<PaneSize> {
    let size = action.param(field)?;
    Some(PaneSize {
        width: size.get("width").and_then(Value::as_f64)?,
        height: size.get("height").and_then(Value::as_f64)?,
    })
}

fn controls_height(action: &UserAction) -> Option<f64> {
    action
        .param("size")?
        .get("controlsHeight")
        .and_then(Value::as_f64)
}

/// `toggleModelPicker`: a second press closes the open picker, the first one opens it on the
/// selection this session is heading for.
///
/// The request id is the host's, because the core has no random source: the renderer sends
/// `requestId` with the action.
fn toggle_model_picker(state: &mut ChatState, action: &UserAction, now: f64) -> Vec<Effect> {
    if let Some(picker) = state.pickers.model_picker.as_mut() {
        picker.finish(false, None, now);
        return Vec::new();
    }
    let Some(menu) = state.pickers.model_menu_context.clone() else {
        return Vec::new();
    };
    let Some(provider) = menu.provider else {
        return Vec::new();
    };
    let desired = state.pickers.desired_selection().cloned();
    let model = desired
        .as_ref()
        .map(|intent| intent.model.clone())
        .filter(|model| !model.is_empty())
        .or_else(|| menu.model_value.clone());
    let effort = desired
        .as_ref()
        .map(|intent| intent.effort.clone())
        .filter(|effort| !effort.is_empty())
        .or_else(|| menu.effort_value.clone());
    let request_id = action
        .param("requestId")
        .and_then(Value::as_str)
        .unwrap_or_default()
        .to_string();
    let Some(request) = create_model_picker_request(
        &state.menus.model_catalog,
        provider,
        model.as_deref(),
        effort.as_deref(),
        request_id,
    ) else {
        return Vec::new();
    };
    let session_key = action
        .param("sessionKey")
        .and_then(Value::as_str)
        .unwrap_or_default()
        .to_string();
    let mut picker = ModelPickerState::open(request, session_key);
    if let Some(size) = pane_size(action, "size") {
        picker.measure(size, controls_height(action));
    }
    state.pickers.model_picker = Some(picker);
    Vec::new()
}

/// `modelMenuView`. A null tab is the picker opening: stars set in other sessions since the last
/// open arrive here, which is the one read of the favorites record.
fn model_menu_view(state: &mut ChatState, action: &UserAction) -> Vec<Effect> {
    let tab = action.param("tab");
    let mut effects = Vec::new();
    match tab {
        Some(Value::Null) => {
            state.pickers.model_menu_view.tab = None;
            effects.push(Effect::ReadStorage {
                key: model_favorites_key(),
            });
        }
        Some(Value::String(tab)) => {
            state.pickers.model_menu_view.tab = Some(ModelMenuTabId::from_wire(tab));
        }
        // `command.tab === undefined` leaves the tab alone.
        _ => {}
    }
    if let Some(query) = action.param("query").and_then(Value::as_str) {
        state.pickers.model_menu_view.query = query.to_string();
    }
    effects
}

/// `modelMenuFavorite`: the star is written through the shared list, not a per-session copy.
fn model_menu_favorite(state: &mut ChatState, action: &UserAction) -> Vec<Effect> {
    let Some(key) = action.param("key").and_then(Value::as_str) else {
        return Vec::new();
    };
    let next = toggle_model_favorite(&state.pickers.model_favorites, key);
    state.pickers.model_favorites = next.clone();
    vec![Effect::WriteStorage {
        key: model_favorites_key(),
        value: Some(serialize_model_favorites(&next)),
        durable: false,
    }]
}

/// `modelMenuPick`.
///
/// A pick on the session's own agent becomes a `selectOption`, which is family e1's; a pick on
/// another agent's model hands the conversation over, or switches a draft's agent.
fn model_menu_pick_action(state: &mut ChatState, action: &UserAction) -> Vec<Effect> {
    let Some(menu) = state.pickers.model_menu_context.clone() else {
        return Vec::new();
    };
    let Some(key) = action.param("key").and_then(Value::as_str) else {
        return Vec::new();
    };
    let rows = state.pickers.model_menu_rows(&menu);
    let Some(row) = rows.into_iter().find(|row| row.key == key) else {
        return Vec::new();
    };
    // `modelMenuEffortFor` needs the other agent's option catalog, which is family e1's. Until
    // it is wired the hand-off starts the model on no effort, which is what an agent without one
    // already gets.
    let pick = model_menu_pick(&row, &menu, |_, _, _| String::new());
    match pick {
        ModelMenuPick::Select { value } => {
            let mut params = Map::new();
            params.insert("type".into(), json!("selectOption"));
            params.insert("descriptorId".into(), json!(menu.model_id));
            params.insert("value".into(), json!(value));
            if let Some(secondary) = action.param("secondary") {
                params.insert("secondary".into(), secondary.clone());
            }
            vec![Effect::HostAction {
                action: "selectOption".to_string(),
                params: Box::new(Value::Object(params)),
            }]
        }
        ModelMenuPick::Handoff {
            provider,
            model,
            effort,
        } => {
            // A draft has no conversation to hand over, so another agent's model switches the
            // draft to that agent.
            //
            // CDXC:SessionChat 2026-09-22 WHY:
            // The agent is looked up HERE rather than handed to the host as a
            // `switchDraftAgentForProvider` action nobody performs: `native-host.ts:1058` does the
            // same `availableAgents.find(...)` before it dispatches `switchDraftAgent`, and the
            // core already holds the list.
            if state.session.available_agents.is_some() {
                state.pickers.model_menu_view = Default::default();
                let agent_id = crate::menus::option_menus::DraftAgent::list(
                    state.session.available_agents.as_ref(),
                )
                .and_then(|agents| {
                    agents
                        .iter()
                        .find(|agent| {
                            crate::menus::picker::request::model_picker_provider(
                                agent.icon.as_deref(),
                            ) == Some(provider)
                        })
                        .map(|agent| agent.agent_id.clone())
                });
                return match agent_id {
                    Some(agent_id) => {
                        crate::menus::actions::switch_draft_agent_to(state, &agent_id)
                    }
                    None => Vec::new(),
                };
            }
            vec![Effect::HostAction {
                action: "handoffToModel".to_string(),
                params: Box::new(json!({
                    "provider": provider.as_str(),
                    "model": model,
                    "effort": effort,
                })),
            }]
        }
    }
}

/// `modelMenuTrait`: a footer button becomes a `selectOption` on the descriptor it names, except
/// the context window, which picks a model variant.
fn model_menu_trait(state: &mut ChatState, action: &UserAction) -> Vec<Effect> {
    let Some(menu) = state.pickers.model_menu_context.as_ref() else {
        return Vec::new();
    };
    let id = action
        .param("id")
        .and_then(Value::as_str)
        .unwrap_or_default();
    let descriptor_id = if id == "context" {
        json!(menu.model_id)
    } else {
        json!(id)
    };
    let mut params = Map::new();
    params.insert("type".into(), json!("selectOption"));
    params.insert("descriptorId".into(), descriptor_id);
    if let Some(value) = action.param("value") {
        params.insert("value".into(), value.clone());
    }
    if let Some(exit_plan) = action.param("exitPlan") {
        params.insert("exitPlan".into(), exit_plan.clone());
    }
    if let Some(secondary) = action.param("secondary") {
        params.insert("secondary".into(), secondary.clone());
    }
    vec![Effect::HostAction {
        action: "selectOption".to_string(),
        params: Box::new(Value::Object(params)),
    }]
}
