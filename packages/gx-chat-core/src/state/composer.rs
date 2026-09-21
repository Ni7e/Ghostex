//! Family d's state: the composer, its drafts, the queue controls, suggestions and references.
//!
//! **This file belongs to family d (composer).** No other family edits it. Fill it with what
//! `packages/shared/session-chat-controller/queue.ts`, `submission.ts`, `native-suggestions.ts`,
//! `native-composer-chrome.ts`, `skills.ts`, `files.ts`, `note.ts`, `draft-handoff.ts`,
//! `save-markdown.ts` and the plumbing's `native-composer.ts` keep: the draft text the core tracks
//! (the host owns the text field itself), the suggestion popup, the reference pills, the stash,
//! the session note, the attachment count and what is in flight.
//!
//! Read from, never write to: `ChatState::session::queue_prompts` (family a folds it; `None` is
//! the "daemon has no queue" capability probe), `ChatState::session::synced_draft`,
//! `ChatState::session::returned_prompt`, `ChatState::pending::sends` (family a owns the
//! optimistic echoes; a send adds one through family a's helper rather than by pushing here).

/// What the composer remembers between frames.
#[derive(Clone, Debug, Default, PartialEq)]
pub struct ComposerState {}
