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
    match event {
        Event::Action(action) => actions::dispatch(state, action, context),
        Event::Start(_)
        | Event::Frame(_)
        | Event::Connection(_)
        | Event::RpcSettled { .. }
        | Event::Tick
        | Event::StorageLoaded { .. }
        | Event::StorageWritten { .. }
        | Event::SettingsChanged(_)
        | Event::ContextPreferencesChanged { .. }
        | Event::ModelCatalogChanged { .. }
        | Event::Measured(_)
        | Event::DraftChanged { .. } => Vec::new(),
    }
}
