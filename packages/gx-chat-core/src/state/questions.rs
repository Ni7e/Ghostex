//! Family c's state: the blocking question card, the async question strip, and the notices.
//!
//! **This file belongs to family c (questions, approvals, notices).** No other family edits it.
//! Fill it with what `packages/shared/session-chat-presentation/questions.ts`,
//! `async-questions.ts`, `terminal-prompts.ts`, `notice-choices.ts` and the controller's
//! `question-drafts.ts`, `notice-state.ts`, `async-question-storage.ts` keep: the current question
//! index, the per-question drafts, which notices are dismissed, and what is in flight.
//!
//! Read from, never write to: `ChatState::session::prompt` and
//! `ChatState::session::terminal_notice` (family a folds both; an omission on a frame that can
//! carry them means CLEARED), `ChatState::session::retired_async_question_ids` and
//! `ChatState::session::async_questions_since`.

/// What the question and notice surfaces remember between frames.
#[derive(Clone, Debug, Default, PartialEq)]
pub struct QuestionsState {}
