//! Family e2: the model picker, the model menu, model selection, model favorites and the fork
//! branch picker.
//!
//! This subdirectory is family e2's alone. Family e1 owns the rest of `src/menus/` and calls the
//! two entry points below from `menus/document.rs` and `menus/actions.rs`, so e2 never edits an
//! e1 file. Document keys: `modelMenuContext`, `modelMenu`, `modelPicker`, `modelProvider`,
//! `modelSelection`, `pendingModelSelection`, `forkBranches`. Actions: `toggleModelPicker`,
//! `modelPicker*`, `modelMenu*`, `selectForkBranch`.

use crate::action::UserAction;
use crate::document::Document;
use crate::effect::Effect;
use crate::state::{ChatContext, ChatState};

/// Writes family e2's picker and menu keys into `into`.
pub fn document(state: &ChatState, context: &ChatContext, into: &mut Document) {
    let _ = (state, context, into);
}

/// Handles one model picker, model menu or fork branch action.
pub fn handle(state: &mut ChatState, action: &UserAction, context: &ChatContext) -> Vec<Effect> {
    let _ = (state, action, context);
    Vec::new()
}
