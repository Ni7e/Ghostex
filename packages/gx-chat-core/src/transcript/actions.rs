//! Family b's user actions: the row details, the transcript modes, the rewind sheet, saved
//! prompts, deferred work and the links and images a row opens.

use crate::action::{ActionKind, UserAction};
use crate::effect::Effect;
use crate::state::{ChatContext, ChatState};

/// Handles one action family b owns.
pub fn handle(state: &mut ChatState, action: &UserAction, context: &ChatContext) -> Vec<Effect> {
    let _ = (&state, context);
    match action.kind {
        ActionKind::RowDetails
        | ActionKind::ToggleSummary
        | ActionKind::SetVerbose
        | ActionKind::LoadWork
        | ActionKind::RewindOpen
        | ActionKind::RewindCancel
        | ActionKind::RewindSubmit
        | ActionKind::SavePrompt
        | ActionKind::OpenMarkdownLink
        | ActionKind::LoadImage => Vec::new(),
        _ => Vec::new(),
    }
}
