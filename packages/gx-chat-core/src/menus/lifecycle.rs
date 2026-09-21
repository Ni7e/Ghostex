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
pub fn observe(state: &mut ChatState, context: &ChatContext, next_request_id: &mut u64) -> Vec<Effect> {
    let now_ms = context.now_millis();
    let mut effects = Vec::new();
    rebuild_option_store(state, now_ms);
    apply_detection(state);
    state.menus.options.expire(now_ms);
    effects.extend(poll_accounts(state, now_ms, next_request_id));
    let progress = switch_progress(state);
    let ready = switch_ready(state);
    let switch_wake = state
        .menus
        .account_switch
        .observe(progress.as_ref(), ready, now_ms);
    let option_wake = state.menus.options.next_wake_ms();
    let wake = [switch_wake, option_wake]
        .into_iter()
        .flatten()
        .min()
        .map(|due| (due - now_ms).max(0) as u64);
    if let Some(delay_ms) = wake {
        effects.push(Effect::SetTimer {
            delay_ms: Some(delay_ms),
        });
    }
    effects
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
fn poll_accounts(state: &mut ChatState, now_ms: i64, next_request_id: &mut u64) -> Vec<Effect> {
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
    *next_request_id += 1;
    vec![Effect::SendRpc {
        request_id: *next_request_id,
        method: ChatRpcMethod::AgentAccounts,
        params: Box::new(session_accounts_request()),
    }]
}
