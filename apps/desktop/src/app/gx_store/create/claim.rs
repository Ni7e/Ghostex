//! The doors F4's commands arrive through, answered in Rust before they reach the old runtime.
//!
//! CDXC:AgentLauncher 2026-09-25 WHY:
//! Every create and open the sidebar, the New Thread picker, Quick Access and Settings ask for used
//! to go to the QuickJS runtime through one of three doors: a wrapped `{type:'command', message}`
//! at the end of `dispatch_native_sidebar_ui`, the `onSidebarHostMessage` allowlist behind
//! `dispatch_gpui_sidebar_host_message`, or an app modal's `sidebarCommand`. A command answered here
//! returns `true` and must go no further, because the runtime would perform it a second time. Each
//! type is answered at every door it can arrive through, since a port that closed one door and
//! left another would run the action twice or not at all.
//!
//! SEE-ALSO: apps/desktop/src/app/native_sidebar/actions.rs (`dispatch_native_sidebar_ui`),
//! apps/desktop/src/app/sidebar_dispatch.rs (`dispatch_gpui_sidebar_host_message`),
//! apps/desktop/src/app/delayed_send.rs (`handle_gpui_app_modal_sidebar_command`),
//! docs/2026-09-25/app-runtime-port/LEDGER.md (the F4 rows).

use serde_json::Value;

use crate::GhostexGpuiApp;

/// What this app run did with F4's commands. Memory only.
#[derive(Default)]
pub(crate) struct CreateHost {
    pub(super) counters: CreateCounters,
    /// A browser open waiting for the project switch it has to follow (browser.rs).
    pub(super) pending_browser_open: Option<super::browser::PendingBrowserOpen>,
}

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub(crate) struct CreateCounters {
    pub(super) browser_pane_opens: u64,
    pub(super) quick_browser_opens: u64,
    pub(super) find_prompts: u64,
}

impl GhostexGpuiApp {
    /// A wrapped sidebar command at the end of `dispatch_native_sidebar_ui`. Returns whether it was
    /// answered here.
    pub(crate) fn gx_store_run_sidebar_create(
        &mut self,
        command: &Value,
        cx: &mut gpui::Context<Self>,
    ) -> bool {
        if command.get("type").and_then(Value::as_str) != Some("command") {
            return false;
        }
        let Some(message) = command.get("message") else {
            return false;
        };
        // New Group, Rename and Close Group (gx_store/workspace_groups/group_commands.rs).
        if self.gx_store_run_group_command(command, message, cx) {
            return true;
        }
        self.gx_store_answer_create_message(message, cx)
    }

    /// A message on the `onSidebarHostMessage` allowlist (`dispatch_gpui_sidebar_host_message`).
    /// Returns whether it was answered here.
    pub(crate) fn gx_store_claim_sidebar_host_message(
        &mut self,
        message: &Value,
        cx: &mut gpui::Context<Self>,
    ) -> bool {
        self.gx_store_answer_create_message(message, cx)
    }

    /// An app modal's `sidebarCommand` whose type `handle_gpui_app_modal_sidebar_command` has no
    /// arm of its own for. Returns whether it was answered here.
    ///
    /// Quick Access "Quick Browser Tab" and the command palette post `openBrowserChat` here, and the
    /// handler used to drop it at `_ => {}`: the row did nothing (ledger H010).
    pub(crate) fn gx_store_run_app_modal_create_command(
        &mut self,
        command_type: &str,
        cx: &mut gpui::Context<Self>,
    ) -> bool {
        match command_type {
            "openBrowserChat" => {
                self.gx_store_open_quick_browser_tab(cx);
                true
            }
            _ => false,
        }
    }

    /// The one switch every door shares, on the runtime's own message shape.
    fn gx_store_answer_create_message(
        &mut self,
        message: &Value,
        cx: &mut gpui::Context<Self>,
    ) -> bool {
        match message.get("type").and_then(Value::as_str) {
            Some("openBrowserPaneInGroup") => {
                let group_id = message.get("groupId").and_then(Value::as_str);
                self.gx_store_open_browser_pane_in_group(group_id, cx);
                true
            }
            Some("openBrowserChat") => {
                self.gx_store_open_quick_browser_tab(cx);
                true
            }
            Some("searchPreviousSessionsByText") => {
                self.gx_store_open_find_prompts(cx);
                true
            }
            Some("updateCustomSessionTags") => {
                self.gx_store_update_custom_session_tags(message, cx);
                true
            }
            _ => false,
        }
    }
}
