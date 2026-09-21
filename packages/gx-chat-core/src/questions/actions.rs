//! Family c's user actions: answering, moving between questions, the async question strip, and
//! the notices.

use crate::action::{ActionKind, UserAction};
use crate::effect::Effect;
use crate::state::{ChatContext, ChatState};

/// Handles one action family c owns.
pub fn handle(state: &mut ChatState, action: &UserAction, context: &ChatContext) -> Vec<Effect> {
    let _ = (&state, context);
    match action.kind {
        ActionKind::Answer
        | ActionKind::QuestionText
        | ActionKind::QuestionBack
        | ActionKind::QuestionOption
        | ActionKind::QuestionNext
        | ActionKind::QuestionCancel
        | ActionKind::AsyncQuestionToggle
        | ActionKind::AsyncQuestionNavigate
        | ActionKind::AsyncQuestionText
        | ActionKind::AsyncQuestionOption
        | ActionKind::AsyncQuestionSend
        | ActionKind::AsyncQuestionSkip
        | ActionKind::DismissNotice
        | ActionKind::NoticePrimary
        | ActionKind::NoticeSecondary => Vec::new(),
        _ => Vec::new(),
    }
}
