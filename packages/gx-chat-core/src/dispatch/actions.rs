//! Which family handles which user action.
//!
//! One arm per kind, so the owner of an action is a fact you can grep rather than a guess. The
//! table follows `docs/2026-09-21/rust-chat/SEAM.md` section 4: an action belongs to the family
//! that owns the TypeScript file handling it today.
//!
//! Adding a kind means adding it to [`crate::ActionKind`] and to the arm of its owner here. Nobody
//! edits another family's arm.

use crate::action::{ActionKind, UserAction};
use crate::effect::Effect;
use crate::state::{ChatContext, ChatState};
use crate::{composer, extras, menus, questions, session, transcript};

/// The family that owns an action kind.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Family {
    /// Family a: state, wire fold, merge, pagination, pending, persistence.
    Session,
    /// Family b: transcript rows.
    Transcript,
    /// Family c: questions, approvals, notices.
    Questions,
    /// Family d: composer.
    Composer,
    /// Family e: menus, pickers, options, accounts, context.
    Menus,
    /// Family f: minimap, search, subagents, panels, terminal tail, Save to Markdown.
    Extras,
}

/// Who handles this kind.
///
/// An unknown kind has no owner: the renderer is newer than this build, and the TypeScript threw
/// on one (`native-host.ts:1610`) while this drops it. That difference is deliberate; a renderer
/// must never be able to crash the brain.
pub fn owner(kind: &ActionKind) -> Option<Family> {
    Some(match kind {
        ActionKind::Retry | ActionKind::Refresh | ActionKind::LoadEarlier => Family::Session,

        ActionKind::RowDetails
        | ActionKind::ToggleSummary
        | ActionKind::SetVerbose
        | ActionKind::LoadWork
        | ActionKind::RewindOpen
        | ActionKind::RewindCancel
        | ActionKind::RewindSubmit
        | ActionKind::SavePrompt
        | ActionKind::OpenMarkdownLink
        | ActionKind::LoadImage => Family::Transcript,

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
        | ActionKind::NoticeSecondary => Family::Questions,

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
        | ActionKind::SaveNote => Family::Composer,

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
        | ActionKind::MeasureContextStatus => Family::Menus,

        ActionKind::ToggleAgentFleet
        | ActionKind::ToggleAgentTasks
        | ActionKind::ToggleAgentTasksCompleted
        | ActionKind::SearchOpen
        | ActionKind::SearchClose
        | ActionKind::SearchQuery
        | ActionKind::SearchNext
        | ActionKind::SearchPrevious
        | ActionKind::TerminalTailHover
        | ActionKind::TerminalTailToggle
        | ActionKind::OpenSubagent
        | ActionKind::SubagentBack
        | ActionKind::SubagentClose
        | ActionKind::SubagentRetry
        | ActionKind::SubagentLoadEarlier
        | ActionKind::MarkdownSaveOpen
        | ActionKind::MarkdownSaveFolder
        | ActionKind::MarkdownSaveName
        | ActionKind::MarkdownSaveCancel
        | ActionKind::MarkdownSaveSubmit => Family::Extras,

        ActionKind::Other(_) => return None,
    })
}

/// Routes one action to its owner.
pub fn dispatch(state: &mut ChatState, action: &UserAction, context: &ChatContext) -> Vec<Effect> {
    match owner(&action.kind) {
        Some(Family::Session) => session::handle(state, action, context),
        Some(Family::Transcript) => transcript::handle(state, action, context),
        Some(Family::Questions) => questions::handle(state, action, context),
        Some(Family::Composer) => composer::handle(state, action, context),
        Some(Family::Menus) => menus::handle(state, action, context),
        Some(Family::Extras) => extras::handle(state, action, context),
        None => Vec::new(),
    }
}
