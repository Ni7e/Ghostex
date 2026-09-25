//! Creating things from the sidebar and its hosts: which project a create names, and what a
//! browser open, a terminal create or an agent launch does, as data the host performs.
//!
//! Per-concern files: `target` resolves the sidebar group id a create names into a project on this
//! computer or on a remote machine, exactly as the old runtime's `session-create.ts` did, and
//! `browser` plans the two browser opens (a project header's New Browser Tab and the Quick
//! Browser Tab).

mod browser;
mod target;

pub use browser::{plan_browser_pane_open, BrowserPaneOpen, DEFAULT_BROWSER_LAUNCH_URL};
pub use target::{group_project, terminal_create_target, CreateTarget};
