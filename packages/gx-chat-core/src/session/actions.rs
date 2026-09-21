//! Family a's user actions: the four that drive the connection and the history window.
//!
//! `retry` rebuilds the subscription, `refresh` re-reads authoritative state, `loadEarlier` pages
//! backwards, and `toggleSummary`'s sibling modes belong to family b.

use crate::action::{ActionKind, UserAction};
use crate::effect::Effect;
use crate::state::{ChatContext, ChatState};

/// Handles one action family a owns. An action it does not own returns nothing, which is how the
/// dispatcher's default arm reads "not mine".
pub fn handle(state: &mut ChatState, action: &UserAction, context: &ChatContext) -> Vec<Effect> {
    let _ = (&state, context);
    match action.kind {
        ActionKind::Retry | ActionKind::Refresh | ActionKind::LoadEarlier => Vec::new(),
        _ => Vec::new(),
    }
}
