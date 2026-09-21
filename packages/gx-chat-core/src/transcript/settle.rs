//! Family b's uniform settle hook: the projection refresh, the backfill timer, and the answers to
//! the three calls the transcript's own row actions make.
//!
//! [`crate::transcript::document`] and [`crate::transcript::rows`] are pure, so everything that is
//! carried rather than derived runs here, once per event, before `crate::document::assemble`:
//! `NativeChatPresentation.update` stores the item list and the placeholder queue
//! (`packages/shared/session-chat-controller/native-presentation.ts`), `scheduleBackfill` walks
//! that queue on a zero-delay timer, and `NativeChatMessageActions` and `loadWork` finish on the
//! request they issued.

use crate::effect::Effect;
use crate::event::Event;
use crate::state::{ChatContext, ChatState};

/// The backfill timer's key in `state.core.timers`. Zero delay, exactly as `setTimeout(…, 0)`.
pub const BACKFILL_TIMER: &str = "b:backfill";

/// Settles family b's carried state for this event.
pub fn settle(state: &mut ChatState, event: &Event, context: &ChatContext) -> Vec<Effect> {
    let mut effects = Vec::new();
    if let Event::RpcSettled {
        request_id,
        outcome,
    } = event
    {
        effects.extend(crate::transcript::actions::settle_rpc(
            state,
            *request_id,
            outcome.as_ref(),
        ));
    }
    // `presentation.update(...)` runs once per turn, inside `publish`, and is what fills the item
    // list and the queue of rows still drawn as plain text.
    crate::transcript::rows::refresh(state, context);
    // `scheduleBackfill` is a zero-delay timer that promotes 24 placeholders per pass, newest
    // first, and re-arms itself while any are left.
    if matches!(event, Event::Tick) && state.core.timer_fired(BACKFILL_TIMER) {
        crate::transcript::rows::advance(state, context);
        // The TypeScript's `onBackfill` publishes without a state change of its own.
        state.core.request_publish();
    }
    if state.transcript_view.has_pending_backfill() {
        state
            .core
            .timers
            .arm_once(BACKFILL_TIMER, context.now_ms, 0.0);
    } else {
        state.core.timers.cancel(BACKFILL_TIMER);
    }
    effects
}
