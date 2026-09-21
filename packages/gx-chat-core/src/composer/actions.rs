//! Family d's user actions: everything the composer does, from a keystroke to a send.

use crate::action::{ActionKind, UserAction};
use crate::effect::Effect;
use crate::state::{ChatContext, ChatState};

/// Handles one action family d owns.
pub fn handle(state: &mut ChatState, action: &UserAction, context: &ChatContext) -> Vec<Effect> {
    let _ = (&state, context);
    match action.kind {
        ActionKind::ComposerScroll
        | ActionKind::ComposerExpand
        | ActionKind::CompleteComposerCommand
        | ActionKind::ComposerSelection
        | ActionKind::SuggestionKey
        | ActionKind::SuggestionPick
        | ActionKind::SuggestionHighlight
        | ActionKind::SuggestionRetry
        | ActionKind::SuggestionDismiss
        | ActionKind::MeasureComposer
        | ActionKind::AppendToDraft
        | ActionKind::EditDraft
        | ActionKind::SaveDraft
        | ActionKind::RecallHistory
        | ActionKind::OpenComposerReference
        | ActionKind::RefreshComposerChrome
        | ActionKind::Stash
        | ActionKind::RestoreReturned
        | ActionKind::ApplyReturned
        | ActionKind::RestoreSubmission
        | ActionKind::AttachmentsStarted
        | ActionKind::AttachmentsFinished
        | ActionKind::AttachPaths
        | ActionKind::InsertAttachments
        | ActionKind::RemoveAttachment
        | ActionKind::Send
        | ActionKind::Queue
        | ActionKind::Compact
        | ActionKind::SendKey
        | ActionKind::Interrupt
        | ActionKind::Handoff
        | ActionKind::ReceiveHandoff
        | ActionKind::DismissIncomingDraft
        | ActionKind::UseIncomingDraft
        | ActionKind::RetryQueue
        | ActionKind::RemoveQueue
        | ActionKind::SendQueue
        | ActionKind::ReorderQueue
        | ActionKind::MoveQueue
        | ActionKind::ToggleNote
        | ActionKind::EditNote
        | ActionKind::ClearNote
        | ActionKind::SaveNote => Vec::new(),
        _ => Vec::new(),
    }
}
