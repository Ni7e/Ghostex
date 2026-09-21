//! The one state every family reads and exactly one family writes.
//!
//! Six sub-states, six owners. Family a owns `identity`, `session`, `messages`, `pending` and
//! `core`; the other five each own the field named after their surface. A family writes its own
//! field and reads the rest, which is what lets six agents port in parallel without touching the
//! same file. `docs/2026-09-21/rust-chat/FAMILIES.md` is the full ownership table.

use crate::state::{
    ComposerState, ExtrasState, MenusState, MessagesState, PendingState, QuestionsState,
    SessionIdentity, SessionState, TranscriptViewState,
};

/// One chat's whole state.
#[derive(Clone, Debug, Default, PartialEq)]
pub struct ChatState {
    /// Who this chat is. Family a.
    pub identity: SessionIdentity,
    /// The session facts the wire carries. Family a.
    pub session: SessionState,
    /// The authoritative transcript and its pagination. Family a.
    pub messages: MessagesState,
    /// The optimistic echoes and terminal lines. Family a.
    pub pending: PendingState,
    /// Errors and settings that belong to no single surface. Family a.
    pub core: CoreState,
    /// The transcript projection's own state. Family b.
    pub transcript_view: TranscriptViewState,
    /// Questions, approvals and notices. Family c.
    pub questions: QuestionsState,
    /// The composer. Family d.
    pub composer: ComposerState,
    /// Menus, pickers, options, accounts and context. Family e.
    pub menus: MenusState,
    /// The model picker, the model menu, model selection and the context surfaces. Family e2.
    pub pickers: crate::state::PickersState,
    /// The minimap, search, subagents, panels and the terminal tail. Family f.
    pub extras: ExtrasState,
}

/// The few things that belong to the seam rather than to a surface.
///
/// Family a owns this. The other families set `operation_error` through
/// [`CoreState::fail`] when an action of theirs is refused, because the refusal is drawn in one
/// place for all of them.
#[derive(Clone, Debug, Default, PartialEq)]
pub struct CoreState {
    /// The last action refusal, shown above the composer.
    pub operation_error: Option<String>,
    /// The refusal's own code, so the composer can draw `composerNotReady` instead of an error
    /// line.
    pub operation_error_code: Option<String>,
    /// Masks account text everywhere the chat shows it.
    pub hide_account_emails: bool,
    /// The session's display title, or `None` when it has none.
    pub title: Option<String>,
    /// The Chat Lab's display settings, present only under a preview backend.
    pub preview_settings: Option<serde_json::Value>,
}

impl CoreState {
    /// Records a refusal, replacing whatever was shown before.
    pub fn fail(&mut self, message: impl Into<String>, code: Option<String>) {
        self.operation_error = Some(message.into());
        self.operation_error_code = code;
    }

    /// Clears the refusal, which every successful action does.
    pub fn clear_error(&mut self) {
        self.operation_error = None;
        self.operation_error_code = None;
    }
}
