//! The last hop of a sidebar command the store did not perform itself: straight to the runtime.
//!
//! CDXC:Sidebar 2026-09-21 WHY:
//! The fall-through of `dispatch_native_sidebar_ui` used to post `onNativeSidebarCommand`, the
//! sidebar PAGE's entry, which routed the command and forwarded the `{type:'command'}` family to
//! the runtime as `message`. That page is being deleted, so the store unwraps the envelope itself
//! and posts the runtime's own message on `onSidebarCommand`. Every OTHER shape the page's entry
//! answered has a Rust owner that returns before this point (the menus, the accounts, the row
//! click, the project and session actions, the moves, the bulk sets, the Space switch and the
//! Space editor), and the sidebar's own state (collapse, filters, hidden items, selection) is the
//! store's and needs no runtime at all, which is what `uiOnly` counts.
//!
//! An `unroutable` above zero is the one thing to watch: it means a command reached the end of the
//! dispatch in a shape `handleSidebarMessage` has no arm for, which before this step the page
//! would have answered.
//!
//! SEE-ALSO: apps/desktop/sidebar/gxserver-runtime/core.ts (`onSidebarCommand`),
//! apps/desktop/src/app/native_sidebar/actions.rs.

use serde_json::Value;

use crate::GhostexGpuiApp;

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub(crate) struct SidebarRuntimeRouteCounters {
    /// `{type:'command'}` payloads unwrapped and handed to the runtime.
    pub(super) routed: u64,
    /// Commands whose whole answer is the sidebar's own state, which the store already applied.
    pub(super) ui_only: u64,
    /// Anything else: nothing owns it on either side any more.
    pub(super) unroutable: u64,
}

impl GhostexGpuiApp {
    /// Sends a command the store did not answer to the runtime, or counts why it did not.
    pub(crate) fn gx_store_route_sidebar_command_to_runtime(
        &mut self,
        command: &Value,
        ui_only: bool,
        cx: &mut gpui::Context<Self>,
    ) {
        if command.get("type").and_then(Value::as_str) == Some("command") {
            if let Some(message) = command.get("message") {
                self.gx_store.runtime_route.routed += 1;
                self.gx_store_send_sidebar_runtime_command(message.clone(), cx);
                return;
            }
        }
        if ui_only {
            self.gx_store.runtime_route.ui_only += 1;
            return;
        }
        self.gx_store.runtime_route.unroutable += 1;
        self.gx_store
            .diagnostics
            .sidebar_command_unroutable(command.get("type").and_then(Value::as_str));
    }
}
