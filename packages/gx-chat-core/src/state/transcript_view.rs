//! Family b's state: everything the transcript projection remembers between frames.
//!
//! **This file belongs to family b (transcript rows).** No other family edits it. Fill it with the
//! state `packages/shared/session-chat-controller/native-presentation.ts`,
//! `native-transcript-rows.ts` and `native-message-actions.ts` keep: the projection cache keyed by
//! message identity, the reused item list, the backfill cursor, the open-row set, the rewind sheet
//! and the saved-prompt marks.
//!
//! Read from, never write to: `ChatState::messages` (family a owns the composed list),
//! `ChatState::session`, `ChatState::pending`.
//!
//! The three caches in `native-presentation.ts` are load bearing and the port must keep them
//! (`docs/2026-09-21/rust-chat/SEAM.md` section 2c): projected messages cached by identity, items
//! that keep their identity when unchanged so a splice carries only the changed window, and older
//! items shipping as plain-text placeholders that backfill in batches of 24.

/// What the transcript projection remembers between frames.
#[derive(Clone, Debug, Default, PartialEq)]
pub struct TranscriptViewState {
    /// Whether the transcript is folded into one row per turn.
    pub summary_mode: bool,
    /// The user's verbose override, or `None` to follow the setting.
    pub verbose_override: Option<bool>,
}
