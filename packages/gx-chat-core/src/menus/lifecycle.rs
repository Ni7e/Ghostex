//! The React effects of the option and account surfaces, collapsed into one pass.
//!
//! `native-options.ts`, `session-options.ts` and `native-controls.ts` do their work in
//! `useMemo` and `useEffect`: rebuild the option store when the catalog or the storage key
//! changes, fold a new detection in, read the accounts on mount and every 30 seconds, and advance
//! the switch card. None of that survives as a hook here, so it runs once per event, before the
//! document is assembled.
//!
//! [`observe`] is family e1's only entry point besides `document` and `handle`. It must be called
//! on every event the core handles, which is what `crate::dispatch::events::dispatch` does.

use crate::effect::Effect;
use crate::menus::controls::{
    accounts_poll_key, session_accounts_request, switch_progress, switch_ready, ACCOUNTS_POLL_MS,
};
use crate::menus::option_catalog::session_option_catalog;
use crate::menus::option_store::OptionStore;
use crate::menus::option_values::{option_state_from_value, DetectedOptions};
use crate::menus::options::option_storage_key;
use crate::state::{ChatContext, ChatState};
use crate::wire::ChatRpcMethod;

/// Advances family e1's own clocks and reads for this event.
///
/// Returns the effects the host must perform: the periodic accounts read, and the timer the grace
/// window and the switch card need.
pub fn observe(state: &mut ChatState, context: &ChatContext) -> Vec<Effect> {
    let now_ms = context.now_millis();
    let mut effects = Vec::new();
    rebuild_option_store(state, now_ms);
    apply_detection(state);
    state.menus.options.expire(now_ms);
    effects.extend(poll_accounts(state, now_ms));
    let progress = switch_progress(state);
    let ready = switch_ready(state);
    // The switch card's own clock starts when the controller first renders, which is the frame
    // after the composer boot read lands; before that there is nothing to draw a card from.
    let switch_wake = if state.menus.options_seeded {
        state
            .menus
            .account_switch
            .observe(progress.as_ref(), ready, now_ms)
    } else {
        None
    };
    arm(state, "menus.switchCard", switch_wake, context);
    let option_wake = state.menus.options.next_wake_ms();
    arm(state, "menus.optionGrace", option_wake, context);
    let accounts_wake = state
        .menus
        .accounts_polled_at_ms
        .map(|at| at + ACCOUNTS_POLL_MS);
    arm(state, "menus.accountsPoll", accounts_wake, context);
    effects
}

/// Moves one of family e1's rows in the core's timer table, or drops it.
fn arm(state: &mut ChatState, key: &str, due_at_ms: Option<i64>, context: &ChatContext) {
    match due_at_ms {
        Some(due_at_ms) => {
            let delay = (due_at_ms as f64 - context.now_ms).max(0.0);
            state.core.timers.arm(key, context.now_ms, delay);
        }
        None => {
            state.core.timers.cancel(key);
        }
    }
}

/// The `useMemo` on `[catalog, storageKey]`: a different agent, catalog document or storage key
/// builds a new store, seeded from what was persisted for that key.
fn rebuild_option_store(state: &mut ChatState, now_ms: i64) {
    let agent = state.session.agent.clone();
    let draft_agent_id = state
        .session
        .available_agents
        .as_ref()
        .and(state.session.session_agent_id.clone());
    let session_key = state.menus.session_key.clone();
    let mut latched = state.menus.latched_draft_agent.clone();
    let storage_key = option_storage_key(
        &mut latched,
        session_key.as_deref(),
        draft_agent_id.as_deref(),
    );
    state.menus.latched_draft_agent = latched;
    let catalog_version = state.menus.model_catalog.updated_at.clone();
    let unchanged = state.menus.options_agent == agent
        && state.menus.options_catalog_version == catalog_version
        && state.menus.options.storage_key == storage_key;
    if unchanged {
        return;
    }
    let catalog = session_option_catalog(&state.menus.model_catalog, agent.as_deref());
    let stored = option_state_from_value(&state.menus.stored_options);
    state.menus.options = OptionStore::seeded(catalog.as_ref(), storage_key, &stored, now_ms);
    state.menus.options_agent = agent;
    state.menus.options_catalog_version = catalog_version;
}

/// The `useLayoutEffect` on `[sessionOptions.applyDetected, chat.selectedOptions]`.
fn apply_detection(state: &mut ChatState) {
    let Some(selected) = state.session.selected_options.clone() else {
        return;
    };
    let Some(detected) = DetectedOptions::from_value(&selected) else {
        return;
    };
    let catalog = session_option_catalog(&state.menus.model_catalog, state.session.agent.as_deref());
    state
        .menus
        .options
        .apply_detected(catalog.as_ref(), Some(&detected));
}

/// The `useEffect` that reads the session's accounts on mount and every 30 seconds.
///
/// One request path for the periodic read and the panel's own requests: a newer request wins, and
/// polls skip while one is pending so an older read cannot land after a switch or policy change.
fn poll_accounts(state: &mut ChatState, now_ms: i64) -> Vec<Effect> {
    let key = accounts_poll_key(state);
    let Some(key) = key else {
        // `if (!provider && !panelProvider) { setAccounts(undefined); return; }`
        state.menus.accounts = None;
        state.menus.accounts_key = None;
        state.menus.accounts_polled_at_ms = None;
        return Vec::new();
    };
    let restarted = state.menus.accounts_key.as_deref() != Some(key.as_str());
    let due = match state.menus.accounts_polled_at_ms {
        None => true,
        Some(at) => now_ms - at >= ACCOUNTS_POLL_MS,
    };
    if restarted {
        // The cleanup bumps the generation, so an answer to the previous key is dropped.
        state.menus.accounts_generation += 1;
        state.menus.accounts_busy = false;
        state.menus.accounts_key = Some(key);
    } else if !due || state.menus.accounts_busy {
        return Vec::new();
    }
    state.menus.accounts_polled_at_ms = Some(now_ms);
    state.menus.accounts_generation += 1;
    state.menus.accounts_busy = true;
    state.menus.account_error = None;
    vec![Effect::SendRpc {
        request_id: state.menus.accounts_generation,
        method: ChatRpcMethod::AgentAccounts,
        params: Box::new(session_accounts_request()),
    }]
}
