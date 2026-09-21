//! Which family handles which event.
//!
//! Almost everything that arrives from outside is family a's: the frames, the connection, the
//! seed and resync reads, the clock. The exceptions are the answers to requests another family
//! asked for, which come back with the request id that family allocated, and the measurements the
//! renderer reports.

use crate::dispatch::actions;
use crate::effect::Effect;
use crate::event::Event;
use crate::state::{ChatContext, ChatState};

/// Routes one event to its owner and returns what the host must do.
///
/// `RpcSettled` and `StorageLoaded`/`StorageWritten` are deliberately not routed by kind: the
/// family that asked owns the answer, and the request id is what says which family that is. Family
/// a keeps that table in [`crate::ChatCore`], so those arms land there rather than here.
pub fn dispatch(state: &mut ChatState, event: &Event, context: &ChatContext) -> Vec<Effect> {
    // The core owns no threads, so a due timer is a key on the state rather than a callback. The
    // table is drained once here, before any family runs, and the keys stay readable for the whole
    // dispatch: a family answers its own timer inside its ordinary handler
    // (`state.core.timer_fired(KEY)`), which is why the drain cannot live in one family's arm.
    state.core.fired_timers = if matches!(event, Event::Tick) {
        state.core.timers.due(context.now_ms)
    } else {
        Vec::new()
    };
    let mut effects = route(state, event, context);
    // Family f carries state a pure `document` cannot derive (the stint word, the loading stage,
    // the task fold, the search cursor, the tail sheet), so the mutating half of the TypeScript's
    // `publish` runs here, once per event, before `crate::document::assemble`. Other families
    // will want the same hook; see `docs/2026-09-21/rust-chat/PROGRESS.md`.
    let mut next = state.extras.next_request_id;
    effects.extend(crate::extras::settle(state, event, context, || {
        next += 1;
        next
    }));
    state.extras.next_request_id = next;
    effects
}

/// The event's own owner, before any family settles.
fn route(state: &mut ChatState, event: &Event, context: &ChatContext) -> Vec<Effect> {
    match event {
        Event::Action(action) => actions::dispatch(state, action, context),
        Event::Start(_)
        | Event::Frame(_)
        | Event::Connection(_)
        | Event::RpcSettled { .. }
        | Event::SettingsChanged(_) => crate::session::handle_event(state, event, context),
        Event::Tick
        | Event::StorageLoaded { .. }
        | Event::StorageWritten { .. }
        | Event::ContextPreferencesChanged { .. }
        | Event::ModelCatalogChanged { .. }
        | Event::Measured(_)
        | Event::DraftChanged { .. } => Vec::new(),
    }
}
