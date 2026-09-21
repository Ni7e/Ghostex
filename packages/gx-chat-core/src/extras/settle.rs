//! What family f has to do before a document can be assembled.
//!
//! [`crate::extras::document`] is pure, the way `crate::document::assemble` needs it to be, but
//! several of family f's values are carried rather than derived: the stint word only changes when
//! a stint begins, the loading stage only advances on a timer, the task fold resets when the plan
//! changes, the search cursor re-anchors against the rows it can still see, and the terminal tail
//! sheet retires with the refusal that opened it. All of that is the mutating half of the
//! TypeScript's `publish`, so it runs here, once per event, before the document is built.

use serde_json::Value;

use crate::effect::Effect;
use crate::event::Event;
use crate::extras::{panels, save_markdown, search, subagent, terminal_tail, working_strip};
use crate::state::{
    ChatContext, ChatState, LOADING_STAGE_BLANK, LOADING_STAGE_INDICATOR, LOADING_STAGE_RETRY,
};
use crate::wire::RpcOutcome;

/// Settles family f's carried state for this event and returns whatever it has to ask the host
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
        Event::RpcSettled {
            request_id,
            outcome,
        } => {
            let answer = match outcome.as_ref() {
                RpcOutcome::Ok { result } => Ok(result),
                RpcOutcome::Err { message, .. } => Err(message.clone()),
            };
            if let Some(more) = subagent::settle_rpc(
                &mut state.extras.subagent,
                *request_id,
                answer.clone(),
                context,
                next_request_id(),
            ) {
                effects.extend(more);
            } else if let Some(more) = save_markdown::settle_rpc(
                &mut state.extras.save_markdown,
                *request_id,
                answer.clone(),
                next_request_id(),
            ) {
                effects.extend(more);
            } else if let Some(more) = settle_terminal_tail_rpc(state, *request_id, answer) {
                effects.extend(more);
            }
        }
        Event::Tick => {
            advance_loading_stage(state, context);
            effects.extend(subagent::settle_tick(
                &mut state.extras.subagent,
                context,
                next_request_id(),
            ));
        }
        _ => {}
    }
    track_transcript_loading(state, context);
    let working = working(state);
    let tasks = state.session.agent_tasks.clone();
    let items = transcript_items(state, context);
    working_strip::settle_working_word(&mut state.extras.working_word, working, context);
    panels::settle_task_signature(&mut state.extras.panels, tasks.as_ref());
    if state.core.operation_error_code.as_deref() != Some("composerNotReady") {
        terminal_tail::retire(&mut state.extras.terminal_tail);
    }
    search::settle(&mut state.extras.search, &items);
    state.extras.next_wake_at_ms = next_wake(state, context);
    effects
}

/// The one live-work flag the strip keys off, which family a folds.
fn working(state: &ChatState) -> bool {
    state.session.server_working || state.session.external_working
}

/// `trackTranscriptLoading`: the stage restarts whenever a read starts, and clears when it ends.
fn track_transcript_loading(state: &mut ChatState, context: &ChatContext) {
    let loading = state.session.server_status.as_str() == "loading";
    if loading == state.extras.loading_started_at_ms.is_some() {
        return;
    }
    state.extras.loading_stage = LOADING_STAGE_BLANK.to_string();
    state.extras.loading_started_at_ms = loading.then_some(context.now_ms);
}

/// The two stage timers, which the host drives with a tick the way `tick()` drains the queue.
fn advance_loading_stage(state: &mut ChatState, context: &ChatContext) {
    let Some(started) = state.extras.loading_started_at_ms else {
        return;
    };
    let elapsed = context.now_ms - started;
    if elapsed >= crate::extras::welcome::LOADING_RETRY_DELAY_MS as f64 {
        state.extras.loading_stage = LOADING_STAGE_RETRY.to_string();
    } else if elapsed >= crate::extras::welcome::LOADING_INDICATOR_DELAY_MS as f64 {
        state.extras.loading_stage = LOADING_STAGE_INDICATOR.to_string();
    }
}

/// The hover read and the expanded sheet's read, both of which land on the same method.
fn settle_terminal_tail_rpc(
    state: &mut ChatState,
    request_id: u64,
    outcome: Result<&Value, String>,
) -> Option<Vec<Effect>> {
    let tail = &mut state.extras.terminal_tail;
    if tail.hover_request == Some(request_id) {
        tail.hover_request = None;
        // Keep the last verdict; a failed read is "unknown", never "not ready".
        if let Ok(result) = outcome {
            tail.tail = Some(result.clone());
        }
        return Some(Vec::new());
    }
    if tail.notice_request == Some(request_id) {
        tail.notice_request = None;
        match outcome {
            Ok(result) => tail.notice_tail = Some(result.clone()),
            Err(message) => {
                tail.notice_tail = None;
                tail.notice_error = Some(if message.is_empty() {
                    "The terminal screen could not be read.".to_string()
                } else {
                    message
                });
            }
        }
        tail.notice_loading = false;
        return Some(Vec::new());
    }
    None
}

/// The rows transcript search runs over, as the values its matcher reads.
fn transcript_items(state: &ChatState, context: &ChatContext) -> Vec<Value> {
    crate::transcript::rows(state, context)
        .into_iter()
        .map(|item| serde_json::to_value(item).unwrap_or(Value::Null))
        .collect()
}

/// The soonest moment family f wants to be re-published.
///
/// Family a owns the single [`crate::Effect::SetTimer`], so this is family f's contribution to it
/// rather than a timer of its own.
fn next_wake(state: &ChatState, context: &ChatContext) -> Option<f64> {
    let mut soonest: Option<f64> = None;
    let mut consider = |at: f64| {
        soonest = Some(soonest.map_or(at, |current: f64| current.min(at)));
    };
    // The fleet clock re-publishes once a second while any row's clock is still moving.
    let (_, _, ticking) = panels::project(state, context);
    if ticking {
        consider(context.now_ms + panels::FLEET_CLOCK_TICK_MS);
    }
    if state.session.terminal_activity.is_some() {
        consider(context.now_ms + crate::extras::activity::ACTIVITY_CLOCK_TICK_MS as f64);
    }
    if let Some(started) = state.extras.loading_started_at_ms {
        for delay in [
            crate::extras::welcome::LOADING_INDICATOR_DELAY_MS as f64,
            crate::extras::welcome::LOADING_RETRY_DELAY_MS as f64,
        ] {
            if context.now_ms < started + delay {
                consider(started + delay);
            }
        }
    }
    if let Some(due) = state.extras.subagent.poll_at_ms {
        consider(due);
    }
    if let Some(until) = state.extras.subagent.hold_until_ms {
        consider(until);
    }
    soonest
}
