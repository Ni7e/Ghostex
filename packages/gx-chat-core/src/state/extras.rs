//! Family f's state: the minimap, transcript search, the subagent viewer, the agent fleet and task
//! panels, the working strip and the terminal tail.
//!
//! **This file belongs to family f (extras).** No other family edits it. Fill it with what
//! `packages/shared/session-chat-presentation/minimap.ts`, `transcript-search.ts`, `subagent.ts`,
//! `agent-fleet.ts`, `agent-tasks.ts`, `working-words.ts`, `working-hold.ts`, `terminal-tail.ts`,
//! `new-session-welcome.ts` and the controller's `native-minimap.ts`, `native-search.ts`,
//! `native-panels.ts`, `native-subagent.ts`, `native-terminal-tail.ts`, `activity.ts` keep: the
//! search query and its hit cursor, the open subagent and its own transcript, which panels are
//! expanded, the settle hold, the tail excerpt and the loading stage.
//!
//! Read from, never write to: `ChatState::session::agent_fleet`,
//! `ChatState::session::agent_tasks`, `ChatState::session::terminal_activity` (family a folds all
//! three; an omission on a frame that can carry them means CLEARED),
//! `ChatState::session::working_started_at_ms` and the derived working flags.

/// What the panels, the minimap, search and the subagent viewer remember between frames.
#[derive(Clone, Debug, Default, PartialEq)]
pub struct ExtrasState {}
