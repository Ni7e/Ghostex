//! Clicks outside the sidebar that land on a session or a group: the status item and the pet, a
//! menu bar session row, a Quick Access or command palette session row, a palette Action run, and
//! a Back or Forward stop.
//!
//! CDXC:StatusPet 2026-09-25 WHY:
//! Each of these used to reach the app runtime through a callback of its own
//! (`onStatusPetActivation`, `onMenuBarSessionActivation`, `onCommandPaletteSessionFocus`,
//! `onCommandPaletteRunSidebarCommand`), and every one of those only re-entered the runtime's
//! `focusSession` or `runSidebarCommand`. The ids are shaped here and the message goes on the
//! runtime's ONE command entry, the same one a sidebar row click takes (`sidebar_focus_route.rs`),
//! so the focus and the Action run have a single owner to port instead of five doors into it. The
//! bounded-id rules the callbacks enforced (StatusPet 2026-06-26) are enforced before this point
//! by `status_pet.rs` and here.
//!
//! SEE-ALSO: apps/desktop/src/app/status_pet.rs (the dispatchers),
//! apps/desktop/sidebar/gxserver-runtime/core.ts (`focusSession` and `runSidebarCommand` arms).

use ghostex_gx_core::{ProjectKey, SessionKey};
use serde_json::json;

use crate::GhostexGpuiApp;

impl GhostexGpuiApp {
    /// Focuses one session the way a sidebar row click does. Returns whether a runtime took it.
    pub(crate) fn gx_store_focus_activated_session(
        &mut self,
        session_id: &str,
        cx: &mut gpui::Context<Self>,
    ) -> bool {
        if session_id.is_empty() {
            return false;
        }
        // The runtime can answer this with a focus change, so it must hear the newest local
        // selection first (gx_store/burst.rs).
        self.gx_store_flush_old_runtime_tell(cx);
        self.gx_store_send_sidebar_runtime_command(
            json!({ "type": "focusSession", "sessionId": session_id }),
            cx,
        )
    }

    /// Focuses one sidebar group (a project, or a user-made group in one) the way a header click
    /// does. Returns whether a runtime took it.
    pub(crate) fn gx_store_focus_activated_group(
        &mut self,
        group_id: &str,
        cx: &mut gpui::Context<Self>,
    ) -> bool {
        if group_id.is_empty() {
            return false;
        }
        self.gx_store_flush_old_runtime_tell(cx);
        self.gx_store_send_sidebar_runtime_command(
            json!({ "type": "focusGroup", "groupId": group_id }),
            cx,
        )
    }

    /// The Back/Forward stop the sidebar is on (navigation_history/controller.rs).
    pub(crate) fn gx_store_navigation_entry(
        &self,
    ) -> Option<ghostex_gx_core::navigation_history::NavigationHistoryEntry> {
        ghostex_gx_core::navigation_history::sidebar_navigation_entry(
            self.gx_store.sidebar_list.model(),
            self.gx_store.core.focus(),
        )
    }

    /// Runs one saved Action by id, with the scope that picks its list. Returns whether a runtime
    /// took it.
    pub(crate) fn gx_store_run_activated_sidebar_command(
        &mut self,
        command_id: &str,
        run_mode: Option<&str>,
        scope: Option<&str>,
        cx: &mut gpui::Context<Self>,
    ) -> bool {
        let mut message = json!({ "type": "runSidebarCommand", "commandId": command_id.trim() });
        if let Some(run_mode) = run_mode {
            message["runMode"] = json!(run_mode);
        }
        if let Some(scope) = scope {
            message["scope"] = json!(scope);
        }
        // A sidebar command can change focus in the runtime: it must hear the newest local
        // selection first (gx_store/burst.rs).
        self.gx_store_flush_old_runtime_tell(cx);
        self.gx_store_send_sidebar_runtime_command(message, cx)
    }
}

/// The sidebar id a menu bar session row focuses. A row carries its project id and either a
/// sidebar id already or the daemon's raw session id, which is scoped to its project here.
pub(crate) fn menu_bar_session_focus_id(project_id: &str, session_id: &str) -> String {
    if SessionKey::parse_sidebar_session_id(session_id).is_some() {
        return session_id.to_string();
    }
    match ProjectKey::parse_workspace_project_id(project_id) {
        Some(ProjectKey {
            machine: ghostex_gx_core::MachineId::Remote(machine_id),
            project_id,
        }) => SessionKey::remote(machine_id, project_id, session_id).to_sidebar_session_id(),
        _ => SessionKey::local(project_id, session_id).to_sidebar_session_id(),
    }
}

/// A palette session row names a projected sidebar id: a local `combined-session:` id or a remote
/// one. A raw daemon id is not routable from the palette and is refused.
pub(crate) fn palette_session_focus_id(session_id: &str) -> Option<&str> {
    let session_id = session_id.trim();
    SessionKey::parse_sidebar_session_id(session_id).map(|_| session_id)
}
