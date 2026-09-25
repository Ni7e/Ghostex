//! Workspace terminal events and lifecycle requests the app used to hand to the QuickJS runtime
//! (`terminal-lifecycle-queue.ts`), performed in Rust. Per-concern files; this barrel stays thin.

pub(crate) mod terminal_events;
mod desktop;
mod runtime_actions;
pub(crate) mod session_calls;
mod lifecycle_requests;
