//! Family e's user actions: the option pills, the model menu and picker, accounts, the fork
//! branch picker and the context editor.

use crate::action::{ActionKind, UserAction};
use crate::effect::Effect;
use crate::state::{ChatContext, ChatState};

/// Handles one action family e owns.
pub fn handle(state: &mut ChatState, action: &UserAction, context: &ChatContext) -> Vec<Effect> {
    let _ = (&state, context);
    match action.kind {
        ActionKind::SelectOption
        | ActionKind::ToggleModelPicker
        | ActionKind::ModelPickerMeasure
        | ActionKind::ModelPickerPane
        | ActionKind::ModelPickerKey
        | ActionKind::ModelPickerKeyUp
        | ActionKind::ModelPickerBlur
        | ActionKind::ModelPickerControl
        | ActionKind::ModelPickerScroll
        | ActionKind::ModelPickerModel
        | ActionKind::ModelPickerEffort
        | ActionKind::ModelPickerCancel
        | ActionKind::ModelMenuView
        | ActionKind::ModelMenuFavorite
        | ActionKind::ModelMenuPick
        | ActionKind::ModelMenuTrait
        | ActionKind::Accounts
        | ActionKind::SwitchDraftAgent
        | ActionKind::SelectForkBranch
        | ActionKind::ContextEdit
        | ActionKind::ContextCancel
        | ActionKind::ContextQuery
        | ActionKind::ContextShown
        | ActionKind::ContextStar
        | ActionKind::ContextReorder
        | ActionKind::ContextReset
        | ActionKind::ContextSave
        | ActionKind::ContextCompact
        | ActionKind::MeasureContextStatus => Vec::new(),
        _ => Vec::new(),
    }
}
