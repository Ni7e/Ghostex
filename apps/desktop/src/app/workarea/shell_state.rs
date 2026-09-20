//! Shell-layout persistence and the project-scoped availability read the rest of this
//! directory starts from. Moved verbatim out of `app/workarea.rs` on 2026-09-20.

use crate::app::helpers::*;
use crate::app::model::*;
use crate::*;

impl GhostexGpuiApp {
    /// Marks the shell layout dirty; one task serializes it at most every 250 ms while it is (gx_store/layout_persist.rs).
    pub(crate) fn persist_shell_layout_state(&self) {
        self.gx_store.layout_persist.mark_dirty();
    }

    /// Synchronous variant for the quit path; see `flush_gpui_workspace_shell_state`. It serializes the current state itself, so it never depends on the dirty mark, and it writes the focus state file a local selection may not have reached yet.
    pub(crate) fn flush_shell_layout_state(&self) {
        flush_gpui_workspace_shell_state(self);
        persist_gpui_gxserver_presentation_focus_state(
            &self.sidebar_gxserver_presentation_focus_state,
        );
    }

    pub(crate) fn project_scoped_workarea_availability(&self) -> ProjectScopedWorkareaAvailability {
        project_scoped_workarea_availability_from_latest_sidebar_snapshot(
            self.latest_sidebar_project_snapshot.as_ref(),
            ProjectScopedWorkareaAvailability::from_env_bridge(),
        )
    }

    pub(crate) fn refresh_project_workarea_runtime_cef_surfaces_from_runtime_state(
        &mut self,
        cx: &mut gpui::Context<Self>,
    ) -> bool {
        /*
        CDXC:Workarea 2026-06-24-10:12:
        The real CEF surface map is active app-level ownership, not proof-only evidence. Refresh may prune already-owned Source/Kanban/Automate/Manage CefSurface entities when their safe gate disappears, but it still cannot create a surface, issue or store a URL, synthesize fallback navigation, mount hidden/offscreen views, use WKWebView/WebKit, or persist/log private runtime data.

        CDXC:Workarea 2026-06-28-17:09:
        The old slot, URL-issuance, startup-readiness, and owner-gate proof maps are removed from runtime state. Refresh now only prunes already-owned project workarea CefSurface entities whose current explicit project context can no longer provide a direct runtime URL.

        CDXC:Workarea 2026-06-29-00:15:
        Refresh must also prune already-owned surfaces whose stored runtime URL identity differs from the current direct runtime URL so a valid new project cannot inherit the previous project's slot-owned CEF view.
        */
        self.prune_project_workarea_runtime_cef_surfaces_for_current_gates(cx)
    }
}
