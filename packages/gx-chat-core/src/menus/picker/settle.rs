//! What family e2 has to do before a document can be assembled.
//!
//! [`crate::menus::picker::document`] and [`crate::menus::context::document`] are pure, the way
//! `crate::document::assemble` needs them to be, but four things are carried rather than derived:
//! the open picker's two animations and its key highlights run on deadlines, the fork branch
//! family is read once and kept, the starred model list and the context preferences arrive from
//! storage, and the agent model catalog is pushed in. All of that is the mutating half of the
//! TypeScript's `publish` and of its timer queue, so it runs here, once per event.

use serde_json::Value;

use crate::effect::Effect;
use crate::event::Event;
use crate::menus::context::preferences::{context_preferences_key, parse_preferences};
use crate::menus::context::status::ContextDetailsAgent;
use crate::menus::picker::favorites::{parse_model_favorites, MODEL_FAVORITES_STORE};
use crate::menus::picker::fork_branches::ForkBranch;
use crate::menus::picker::model_picker::ModelPickerSelection;
use crate::menus::picker::selection::{model_selection_unchanged, MODEL_OUTBOX_RETRY_MS};
use crate::state::{ChatContext, ChatState};
use crate::wire::{ChatRpcMethod, RpcOutcome};

/// The picker's own deadline key in `state.core.timers`.
pub const MODEL_PICKER_TIMER: &str = "menus.picker.animation";
/// The model outbox's retry key.
pub const MODEL_OUTBOX_TIMER: &str = "menus.picker.outbox";

/// Settles family e2's carried state for this event and returns whatever it has to ask the host
/// for.
///
/// `next_request_id` hands out the ids the core's own counter allocates, so a replay reproduces
/// them exactly and a late answer to a retired read is dropped rather than misrouted.
pub fn settle(
    state: &mut ChatState,
    event: &Event,
    context: &ChatContext,
    mut next_request_id: impl FnMut() -> u64,
) -> Vec<Effect> {
    let mut effects = Vec::new();
    match event {
        Event::ContextPreferencesChanged {
            provider,
            preferences,
        } => {
            let agent = ContextDetailsAgent::from_icon(Some(provider.as_str()));
            *state.pickers.context.preferences.get_mut(agent) =
                crate::menus::context::preferences::normalize_preferences(Some(preferences), agent);
        }
        Event::StorageLoaded { key, value } => {
            if key.store == MODEL_FAVORITES_STORE {
                state.pickers.model_favorites = parse_model_favorites(value.as_deref());
                state.pickers.model_favorites_loaded = true;
            }
            for agent in [ContextDetailsAgent::Claude, ContextDetailsAgent::Codex] {
                if *key == context_preferences_key(agent) {
                    *state.pickers.context.preferences.get_mut(agent) =
                        parse_preferences(value.as_deref(), agent);
                }
            }
        }
        Event::StorageWritten { key, error } => {
            // `contextSave` closes the dialog when the write landed and keeps it open with the
            // message when it did not, which is the TypeScript's try/catch/finally exactly.
            if let Some(editor) = state.pickers.context.editor.as_mut() {
                if *key == context_preferences_key(editor.agent) && editor.saving {
                    editor.saving = false;
                    match error {
                        None => {
                            let agent = editor.agent;
                            let draft = editor.draft.clone();
                            *state.pickers.context.preferences.get_mut(agent) = draft;
                            state.pickers.context.editor = None;
                        }
                        Some(message) => editor.error = Some(message.clone()),
                    }
                }
            }
        }
        Event::RpcSettled {
            request_id,
            outcome,
        } => settle_fork_branches(state, *request_id, outcome),
        _ => {}
    }

    // `pendingModelSelection` is family a's fold; the outbox reads it on every frame.
    state
        .pickers
        .model_selection
        .adopt_pending(&state.session.pending_model_selection);

    // `forkBranches.ensure()` at the top of `publish`: once per chat, never again.
    if !state.pickers.fork_branches.asked {
        state.pickers.fork_branches.asked = true;
        state.pickers.fork_branches.request_id = Some(next_request_id());
        effects.push(Effect::SendRpc {
            request_id: state.pickers.fork_branches.request_id.unwrap_or_default(),
            method: ChatRpcMethod::SessionForkBranches,
            params: Box::new(Value::Object(Default::default())),
        });
    }

    effects.extend(settle_picker_timers(state, context));
    effects.extend(arm_timers(state, context));
    effects
}

/// The one read of the branch family. An empty answer, an error, or a daemon that predates the
/// route all leave the strip unrendered rather than showing an empty menu.
fn settle_fork_branches(state: &mut ChatState, request_id: u64, outcome: &RpcOutcome) {
    if state.pickers.fork_branches.request_id != Some(request_id) {
        return;
    }
    state.pickers.fork_branches.request_id = None;
    let RpcOutcome::Ok { result } = outcome else {
        return;
    };
    let branches: Vec<ForkBranch> = result
        .get("branches")
        .and_then(|branches| serde_json::from_value(branches.clone()).ok())
        .unwrap_or_default();
    if branches.is_empty() {
        return;
    }
    state.pickers.fork_branches.branches = branches;
}

/// Runs the open picker's deadlines, and applies the choice when its close animation ends.
fn settle_picker_timers(state: &mut ChatState, context: &ChatContext) -> Vec<Effect> {
    let Some(picker) = state.pickers.model_picker.as_mut() else {
        return Vec::new();
    };
    let Some(outcome) = picker.expire(context.now_ms) else {
        return Vec::new();
    };
    state.pickers.model_picker = None;
    let Some(selection) = outcome.selection else {
        return Vec::new();
    };
    // The session may have changed under the picker while it was closing.
    let session_key = state
        .pickers
        .model_menu_context
        .as_ref()
        .and_then(|menu| menu.session_key.clone())
        .unwrap_or_default();
    if session_key != outcome.session_key {
        return Vec::new();
    }
    let current_model = state
        .pickers
        .model_menu_context
        .as_ref()
        .and_then(|menu| menu.model_value.clone());
    let current_effort = state
        .pickers
        .model_menu_context
        .as_ref()
        .and_then(|menu| menu.effort_value.clone());
    if model_selection_unchanged(
        &selection,
        state.pickers.desired_selection(),
        current_model.as_deref(),
        current_effort.as_deref(),
        Some(&outcome.request),
        Some(outcome.scope),
    ) {
        return Vec::new();
    }
    // The intent's id is the host's, so the core asks for one rather than inventing it.
    vec![Effect::HostAction {
        action: "selectModel".to_string(),
        params: Box::new(serde_json::json!({
            "model": selection.model,
            "effort": selection.effort,
            "scope": outcome.scope.as_str(),
        })),
    }]
}

/// Arms the one timer the picker's animations and the outbox retry share.
fn arm_timers(state: &mut ChatState, context: &ChatContext) -> Vec<Effect> {
    match state
        .pickers
        .model_picker
        .as_ref()
        .and_then(|picker| picker.next_deadline())
    {
        Some(deadline) => state.core.timers.arm(
            MODEL_PICKER_TIMER,
            context.now_ms,
            deadline - context.now_ms,
        ),
        None => {
            state.core.timers.cancel(MODEL_PICKER_TIMER);
        }
    }
    match state.pickers.model_selection.retry_at_ms {
        Some(deadline) => state.core.timers.arm(
            MODEL_OUTBOX_TIMER,
            context.now_ms,
            deadline - context.now_ms,
        ),
        None => {
            state.core.timers.cancel(MODEL_OUTBOX_TIMER);
        }
    }
    Vec::new()
}

/// The selection an outbox retry would deliver again, after [`MODEL_OUTBOX_RETRY_MS`].
pub fn outbox_retry_selection(state: &ChatState) -> Option<ModelPickerSelection> {
    let _ = MODEL_OUTBOX_RETRY_MS;
    state
        .pickers
        .model_selection
        .outbox
        .as_ref()
        .map(|intent| intent.selection())
}
