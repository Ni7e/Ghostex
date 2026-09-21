//! Family e's user actions: the option pills, the model menu and picker, accounts, the fork
//! branch picker and the context editor.
//!
//! The model picker, model menu and fork branch kinds go to `picker::handle`, the context kinds to
//! `context::handle`: both live in family e2's subdirectories. Everything else is family e1's.

use crate::action::{ActionKind, UserAction};
use crate::effect::Effect;
use crate::state::{ChatContext, ChatState};

/// Handles one action family e owns.
pub fn handle(state: &mut ChatState, action: &UserAction, context: &ChatContext) -> Vec<Effect> {
    match action.kind {
        ActionKind::ToggleModelPicker
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
        | ActionKind::SelectForkBranch => crate::menus::picker::handle(state, action, context),

        ActionKind::ContextEdit
        | ActionKind::ContextCancel
        | ActionKind::ContextQuery
        | ActionKind::ContextShown
        | ActionKind::ContextStar
        | ActionKind::ContextReorder
        | ActionKind::ContextReset
        | ActionKind::ContextSave
        | ActionKind::ContextCompact
        | ActionKind::MeasureContextStatus => {
            crate::menus::context::handle(state, action, context)
        }

        ActionKind::SelectOption | ActionKind::Accounts | ActionKind::SwitchDraftAgent => {
            Vec::new()
        }

        _ => Vec::new(),
    }
}
