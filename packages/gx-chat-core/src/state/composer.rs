//! Family d's state: the composer, its drafts, the queue controls, suggestions and references.
//!
//! **This file belongs to family d (composer).** No other family edits it. It holds what
//! `packages/shared/session-chat-controller/queue.ts`, `submission.ts`, `native-suggestions.ts`,
//! `native-composer-chrome.ts`, `skills.ts`, `files.ts`, `note.ts`, `draft-handoff.ts` and the
//! plumbing's `native-composer.ts` keep: the draft text the core tracks (the host owns the text
//! field itself), the suggestion popup, the reference pills, the stash, the session note, the
//! attachment count and what is in flight.
//!
//! Read from, never write to: `ChatState::session::queue_prompts` (family a folds it; `None` is
//! the "daemon has no queue" capability probe), `ChatState::session::synced_draft`,
//! `ChatState::session::returned_prompt`, `ChatState::pending::sends` (family a owns the
//! optimistic echoes; a send adds one through family a's helper rather than by pushing here).

use crate::composer::history::ComposerHistory;
use crate::composer::keys::KeyPlatform;
use crate::composer::layout::ComposerScrollGesture;
use crate::composer::note::{ComposerChromeState, NoteState};
use crate::composer::queue::{DraftVersion, TransportQueueMethods};
use crate::composer::storage::StoredDraftRecord;
use crate::composer::suggestions::{SuggestionDismissals, SuggestionSources};
use crate::composer::trigger::Skill;
use crate::document::{ComposerOverflow, IncomingDraft};

/// What the composer remembers between frames.
#[derive(Clone, Debug, Default, PartialEq)]
pub struct ComposerState {
    /// The draft text the host's field holds, mirrored here so every rule reads one value.
    pub text: String,
    /// The caret, in UTF-16 code units, which is what a JavaScript string index is.
    pub caret: usize,
    /// The draft revision the next save carries, `None` before the boot read answers.
    pub version: Option<DraftVersion>,
    /// The stored draft this session booted with, so a handoff can tell a stale transfer apart.
    pub stored_draft: Option<StoredDraftRecord>,
    /// The `/`, `$` and `@` popup's own state.
    pub suggestions: ComposerSuggestionState,
    /// The two catalogs the popup filters.
    pub sources: SuggestionSources,
    /// Up-arrow recall of what this composer sent.
    pub history: ComposerHistory,
    /// The session note sheet.
    pub note: NoteState,
    /// The stash badge and the note dot.
    pub chrome: ComposerChromeState,
    /// Which toolbar controls the renderer could not fit.
    pub overflow: ComposerOverflow,
    /// The box is drawn one line high.
    pub collapsed: bool,
    /// The in-flight wheel gesture over the composer.
    pub scroll: ComposerScrollGesture,
    /// Attachment reads the host has started but not finished.
    pub pending_attachments: u32,
    /// How many image references the draft currently holds, which is what the thumbnails draw.
    pub draft_attachment_count: u32,
    /// A draft offered from another client, or `None`.
    pub incoming_draft: Option<IncomingDraft>,
    /// The newest draft stamp this client already applied or dismissed.
    pub last_handled_draft_at: Option<String>,
    /// Which queue and draft endpoints this host can actually call.
    pub transport: TransportQueueMethods,
    /// Whether this host can offer the session note, the stash, attachments and the terminal.
    pub actions: ComposerActionAvailability,
    /// The renderer's platform, for the editing chords.
    pub platform: KeyPlatform,
    /// A send is in flight and the composer is holding its text.
    pub submitting: Option<Submission>,
}

/// The `/`, `$` and `@` popup's own state.
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct ComposerSuggestionState {
    /// Which lists Escape closed, per trigger.
    pub dismissed: SuggestionDismissals,
    /// The highlighted row.
    pub index: usize,
    /// Whether the `$` list was active last frame, so a skills read is asked for once.
    pub skill_active: bool,
    /// The draft and caret the dismissals were judged against.
    pub text: String,
    pub caret: usize,
}

/// Which composer controls the host can actually serve.
///
/// React gates these by only passing the handler it has; the native renderer needs the same answer
/// so a control that would do nothing stays out of the toolbar.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct ComposerActionAvailability {
    pub summary: bool,
    pub note: bool,
    pub stash: bool,
    pub attach: bool,
    pub terminal: bool,
}

impl Default for ComposerActionAvailability {
    fn default() -> Self {
        Self {
            summary: true,
            note: false,
            stash: true,
            attach: true,
            terminal: true,
        }
    }
}

/// A submission the composer is holding text for.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Submission {
    pub text: String,
    pub version: Option<DraftVersion>,
    pub mode: crate::composer::submission::SubmissionMode,
    /// Set by an interrupt that arrived before the send left, so the recovered draft is not
    /// delivered after it.
    pub cancelled: bool,
}

impl ComposerState {
    /// The skills the `$` list offers, or an empty slice before the read answers.
    pub fn skills(&self) -> &[Skill] {
        self.sources.skills.as_deref().unwrap_or(&[])
    }
}
