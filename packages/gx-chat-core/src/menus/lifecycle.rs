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
use crate::menus::option_storage::{
    option_state_to_value, remember_option_state, session_options_key, stored_option_state,
};
use crate::menus::option_store::OptionStore;
use crate::menus::option_values::DetectedOptions;
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
    // `persistence.write` runs inside the store's own `publish`, which the layout effect above
    // reaches before any passive effect, so the write goes out ahead of the accounts poll.
    effects.extend(persist_options(state));
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
    // CDXC:SessionChat 2026-09-22 WHY:
    // `setInterval(() => setNow(Date.now()), 30_000)` on a `useEffect` with no dependencies
    // (`native-context.ts:63`): the meter's countdown labels (five-hour reset, seven-day reset,
    // cache time left) have no other reason to redraw. `CONTEXT_METER_REFRESH_MS` was written and
    // never read, so they froze at whatever clock the last unrelated event carried. `arm_once`,
    // because re-arming on every event would push the deadline forward for ever.
    // `observe` runs on every event, and the drain removes a one-shot before any family sees it,
    // so re-arming here is the interval's next period.
    if state.core.controller_started {
        // `useState(Date.now)` on the first render; `setNow(Date.now())` when the interval fires.
        // The setter is a state change, so the live brain publishes on it even when no label
        // moved, which is what `request_publish` reproduces.
        if state.menus.meter_now_ms.is_none() {
            state.menus.meter_now_ms = Some(context.now_ms);
        }
        if state.core.timer_fired("menus.contextMeter") {
            state.menus.meter_now_ms = Some(context.now_ms);
            state.core.request_publish();
        }
        state.core.timers.arm_once(
            "menus.contextMeter",
            context.now_ms,
            crate::menus::context::meter::CONTEXT_METER_REFRESH_MS,
        );
    }
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
    let catalog_generation = state.menus.model_catalog_generation;
    let unchanged = state.menus.options_agent == agent
        && state.menus.options_catalog_generation == catalog_generation
        && state.menus.options.storage_key == storage_key;
    if unchanged {
        return;
    }
    let catalog = session_option_catalog(&state.menus.model_catalog, agent.as_deref());
    let stored = stored_option_state(&state.menus.stored_options, storage_key.as_deref());
    state.menus.options = OptionStore::seeded(catalog.as_ref(), storage_key, &stored, now_ms);
    state.menus.options_agent = agent;
    state.menus.options_catalog_generation = catalog_generation;
    state.menus.options_store_generation = state.menus.options_store_generation.wrapping_add(1);
}

/// The `useLayoutEffect` on `[sessionOptions.applyDetected, chat.selectedOptions]`.
///
/// Both deps are IDENTITIES in the TypeScript: `applyDetected` is new whenever the store was
/// rebuilt, and `chat.selectedOptions` is new whenever `applySelectedOptions` built a fresh
/// object. Running the fold on every event instead would be harmless for the pill values, which
/// settle, but not for the `optionWrite` it makes: the store's `publish` compares object identity
/// rather than contents, so every run persists.
fn apply_detection(state: &mut ChatState) {
    let deps = (
        state.session.selected_options_generation,
        state.menus.options_store_generation,
    );
    if state.menus.applied_detection == Some(deps) {
        return;
    }
    state.menus.applied_detection = Some(deps);
    let Some(selected) = state.session.selected_options.clone() else {
        return;
    };
    let Some(detected) = DetectedOptions::from_value(&selected) else {
        return;
    };
    let catalog =
        session_option_catalog(&state.menus.model_catalog, state.session.agent.as_deref());
    state
        .menus
        .options
        .apply_detected(catalog.as_ref(), Some(&detected));
}

/// `persistence.write(key, state)`: one `composer('optionWrite', …)` per publish of the store.
fn persist_options(state: &mut ChatState) -> Vec<Effect> {
    let Some(next) = state.menus.options.take_dirty() else {
        return Vec::new();
    };
    // `write: (key, state) => { if (!key) return; … }`.
    let Some(option_key) = state.menus.options.storage_key.clone() else {
        return Vec::new();
    };
    remember_option_state(&mut state.menus.stored_options, &option_key, &next);
    vec![Effect::WriteStorage {
        key: session_options_key(&option_key),
        value: Some(option_state_to_value(&next).to_string()),
        durable: true,
    }]
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
    let request_id = state.core.allocate_request_id();
    state.menus.accounts_request = Some(request_id);
    vec![Effect::SendRpc {
        request_id,
        method: ChatRpcMethod::AgentAccounts,
        params: Box::new(session_accounts_request()),
    }]
}

/// The composer boot read, as `start`'s `.then(...)` in `native-host.ts` adopts it.
///
/// `adoptAgentModelCatalog(result.modelCatalog)`, then `nativeOptionPersistence(result, …)`, which
/// is what seeds the option store from the records already on disk for this session key. Family e2
/// takes the context preferences and the model outboxes out of the same object.
pub fn boot_read(state: &mut ChatState, read: &crate::event::ComposerBootRead) -> Vec<Effect> {
    if let Some(parsed) = crate::menus::catalog::parse_agent_model_catalog(&read.model_catalog) {
        let current = std::mem::take(&mut state.menus.model_catalog);
        state.menus.model_catalog = current.newer(parsed);
        state.menus.model_catalog_generation = state.menus.model_catalog_generation.wrapping_add(1);
    }
    state.menus.session_key = Some(read.session_key.clone());
    state.menus.stored_options = read.option_states.clone();
    state.menus.options_seeded = true;
    crate::menus::picker::settle::adopt_boot_read(state, read);
    Vec::new()
}
