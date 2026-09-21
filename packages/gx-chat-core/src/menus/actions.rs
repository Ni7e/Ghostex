//! Family e's user actions: the option pills, the model menu and picker, accounts, the fork
//! branch picker and the context editor.
//!
//! The model picker, model menu and fork branch kinds go to `picker::handle`, the context kinds to
//! `context::handle`: both live in family e2's subdirectories. Everything else is family e1's.

use serde_json::Value;

use crate::action::{ActionKind, UserAction};
use crate::effect::Effect;
use crate::menus::option_dispatch::{
    descriptor_for, exit_plan_delivery, model_pick_scope, plan_dispatch, queue_session_chat_option,
    QueuedOption,
};
use crate::menus::options::{compute_native_chat_options, picker_supports_session_scope};
use crate::state::{ChatContext, ChatState};
use crate::wire::ChatRpcMethod;

/// Handles one action family e owns.
pub fn handle(state: &mut ChatState, action: &UserAction, context: &ChatContext) -> Vec<Effect> {
    match action.kind {
        ActionKind::ToggleModelPicker
        | ActionKind::ModelPickerMeasure
        | ActionKind::ModelPickerPane
        | ActionKind::ModelPickerKey
        | ActionKind::ModelPickerKeyUp
        | ActionKind::ModelPickerBlur
        | ActionKind::ModelPickerControl
        | ActionKind::ModelPickerScroll
        | ActionKind::ModelPickerModel
        | ActionKind::ModelPickerEffort
        | ActionKind::ModelPickerCancel
        | ActionKind::ModelMenuView
        | ActionKind::ModelMenuFavorite
        | ActionKind::ModelMenuPick
        | ActionKind::ModelMenuTrait
        | ActionKind::SelectForkBranch => crate::menus::picker::handle(state, action, context),

        ActionKind::ContextEdit
        | ActionKind::ContextCancel
        | ActionKind::ContextQuery
        | ActionKind::ContextShown
        | ActionKind::ContextStar
        | ActionKind::ContextReorder
        | ActionKind::ContextReset
        | ActionKind::ContextSave
        | ActionKind::ContextCompact
        | ActionKind::MeasureContextStatus => crate::menus::context::handle(state, action, context),

        ActionKind::Accounts => accounts(state, action),
        ActionKind::SwitchDraftAgent => switch_draft_agent(state, action),
        ActionKind::SelectOption => select_option(state, action, context),

        _ => Vec::new(),
    }
}

/// `case 'accounts'`: the Switch Account panel's own requests (select, refresh, policy, stop
/// recovery, retry). The panel hands the request through unchanged.
fn accounts(state: &mut ChatState, action: &UserAction) -> Vec<Effect> {
    let request = action.params.get("request").cloned().unwrap_or(Value::Null);
    if request.is_null() {
        return Vec::new();
    }
    state.menus.accounts_generation += 1;
    state.menus.accounts_busy = true;
    state.menus.account_error = None;
    state.menus.accounts_polled_at_ms = None;
    let request_id = state.core.allocate_request_id();
    state.menus.accounts_request = Some(request_id);
    vec![Effect::SendRpc {
        request_id,
        method: ChatRpcMethod::AgentAccounts,
        params: Box::new(request),
    }]
}

/// `case 'switchDraftAgent'`: a draft session changes which agent CLI it will start.
fn switch_draft_agent(state: &mut ChatState, action: &UserAction) -> Vec<Effect> {
    let Some(agent_id) = action.params.get("agentId").and_then(Value::as_str) else {
        return Vec::new();
    };
    let known =
        crate::menus::option_menus::DraftAgent::list(state.session.available_agents.as_ref())
            .is_some_and(|agents| agents.iter().any(|agent| agent.agent_id == agent_id));
    if !known || state.session.session_agent_id.as_deref() == Some(agent_id) {
        return Vec::new();
    }
    let request_id = state.core.allocate_request_id();
    vec![Effect::SendRpc {
        request_id,
        method: ChatRpcMethod::SwitchDraftAgent,
        params: Box::new(serde_json::json!({ "agentId": agent_id })),
    }]
}

/// `case 'selectOption'`: one row of a pill's menu.
///
/// The decision tree is `option-dispatch.ts`'s `plan_dispatch`; the plan's steps are then walked
/// one answer at a time by `crate::menus::dispatch_run`, because the TypeScript awaits them in
/// order (a `command-confirm-picker` types the command and only then presses Enter).
fn select_option(state: &mut ChatState, action: &UserAction, context: &ChatContext) -> Vec<Effect> {
    let Some(descriptor_id) = action.params.get("descriptorId").and_then(Value::as_str) else {
        return Vec::new();
    };
    let value = action
        .params
        .get("value")
        .and_then(Value::as_str)
        .map(str::to_string);
    let options = compute_native_chat_options(state, context);
    let Some(descriptor) = descriptor_for(
        options.catalog.as_ref(),
        &options.option_descriptors,
        descriptor_id,
    ) else {
        return Vec::new();
    };
    let model_id = options
        .catalog
        .as_ref()
        .map(|catalog| catalog.model.id.clone());
    let scoped = (Some(descriptor.id.as_str()) == model_id.as_deref() || descriptor.id == "effort")
        && options
            .model_provider
            .is_some_and(picker_supports_session_scope);
    // Where the agent tells the two scopes apart, picking the running model again still moves it
    // between them.
    if !scoped {
        if let Some(value) = &value {
            if options
                .state
                .get(&descriptor.id)
                .map(|entry| entry.value.as_str())
                == Some(value.as_str())
            {
                return Vec::new();
            }
        }
    }
    let exit_plan = action
        .params
        .get("exitPlan")
        .and_then(Value::as_bool)
        .unwrap_or(false);
    let delivery = if exit_plan {
        exit_plan_delivery(&descriptor)
    } else {
        descriptor.clone()
    };
    let secondary = action
        .params
        .get("secondary")
        .and_then(Value::as_bool)
        .unwrap_or(false);
    let queued = queue_session_chat_option(
        &delivery,
        value.as_deref(),
        options.catalog.as_ref(),
        &options.state,
        options.queued_controls,
        options.model_provider.is_some(),
        Some(model_pick_scope(options.model_provider, secondary)),
    );
    if let Some(queued) = queued {
        return queue_effects(state, queued);
    }
    if state.menus.option_dispatch_id.is_some() || crate::session::working::is_working(state) {
        return Vec::new();
    }
    let now_ms = context.now_millis();
    let plan = plan_dispatch(
        &delivery,
        value.as_deref(),
        options.catalog.as_ref(),
        &options.state,
        options.can_pick_model,
    );
    if let Some(error) = plan.error {
        state.core.fail(error, None);
        return Vec::new();
    }
    // `beginDispatch` answers the receipt the run completes or rolls back; a model picker's real
    // values are only known once the pick resolves, so it takes the later of the two.
    let mut receipt = None;
    if !plan.optimistic.is_empty() {
        receipt = Some(state.menus.options.begin_dispatch(plan.optimistic, now_ms));
    }
    if !plan.picker_optimistic.is_empty() {
        receipt = Some(
            state
                .menus
                .options
                .begin_dispatch(plan.picker_optimistic, now_ms),
        );
    }
    state.menus.option_dispatch_id = Some(descriptor.id.clone());
    crate::menus::dispatch_run::begin(state, context, plan.steps, receipt)
}

/// A choice the daemon queues rather than the TUI accepting: family e2 owns the queue itself, so
/// the decision is recorded and handed on.
fn queue_effects(state: &mut ChatState, queued: QueuedOption) -> Vec<Effect> {
    match queued {
        QueuedOption::Swallowed => Vec::new(),
        QueuedOption::SelectOptions { mode, fast_mode } => {
            let mut params = serde_json::Map::new();
            if let Some(mode) = mode {
                params.insert("mode".to_string(), Value::String(mode));
            }
            if let Some(fast_mode) = fast_mode {
                params.insert("fastMode".to_string(), Value::String(fast_mode));
            }
            let request_id = state.core.allocate_request_id();
            vec![Effect::SendRpc {
                request_id,
                method: ChatRpcMethod::SelectSessionChatModel,
                params: Box::new(Value::Object(params)),
            }]
        }
        QueuedOption::SelectModel {
            model,
            effort,
            scope,
        } => {
            let mut params = serde_json::Map::new();
            params.insert("model".to_string(), Value::String(model));
            params.insert("effort".to_string(), Value::String(effort));
            if let Some(scope) = scope {
                params.insert("scope".to_string(), Value::String(scope));
            }
            let request_id = state.core.allocate_request_id();
            vec![Effect::SendRpc {
                request_id,
                method: ChatRpcMethod::SelectSessionChatModel,
                params: Box::new(Value::Object(params)),
            }]
        }
    }
}
