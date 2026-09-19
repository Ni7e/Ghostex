use crate::*;
use std::time::{Duration, Instant};

/// How long a click's in-process focus is recognised when the runtime's own focus message for the same session arrives.
const IN_PROCESS_FOCUS_ECHO_WINDOW: Duration = Duration::from_secs(3);

impl GhostexGpuiApp {
    /// CDXC:Sidebar 2026-09-19 WHY:
    /// A row click reached the workspace only after the service thread ran the sidebar command, the runtime routed the focus, and the bridge message came back, so the pane switched one service-thread turn after the row highlight even when the session already had a tab; Waku switches in the click's own frame.
    /// A local, awake session of the active project whose tab already has a live terminal is selected here, synchronously, through the same tab selection the bridge path ends in. The runtime still receives the command so presentation focus, attention acknowledgement and the sidebar snapshot follow, and its echoed focus message is dropped by `sidebar_focus_message_echoes_in_process_focus`. Other projects, sleeping, remote, browser and unattached sessions keep the bridge path, which owns project switches and gxserver attach plans.
    pub(crate) fn focus_native_sidebar_session_in_process(
        &mut self,
        sidebar_session_id: &str,
        cx: &mut gpui::Context<Self>,
    ) -> bool {
        let Some(key) = gpui_combined_presentation_session_key(sidebar_session_id) else {
            return false;
        };
        if self.agents_workspace_project_id.as_deref() != Some(key.project_id.as_str()) {
            return false;
        }
        let Some(shell_session_id) = self.local_workspace_session_mappings.get(&key).copied()
        else {
            return false;
        };
        let Some(pane_id) = self.agents_workspace.pane_id_for_session(shell_session_id) else {
            return false;
        };
        if !self.local_workspace_terminal_can_focus_existing(pane_id, shell_session_id) {
            return false;
        }
        // The same preamble `focus_local_workspace_terminal_from_message` runs before selecting an existing tab.
        self.begin_sidebar_focus_border_handoff(cx);
        self.local_workspace_latest_focus_key = Some(key.clone());
        self.refresh_sidebar_gxserver_bootstrap_if_changed(cx);
        if !self.focus_existing_gpui_local_workspace_terminal(&key, cx) {
            return false;
        }
        self.reconcile_preferred_agents_chat_launch_intents(cx);
        support_logs::append_temporary(
            support_logs::GpuiSupportLog::TerminalFocus,
            "TEMP.gpui.sessionSwitchLatency.inProcessFocusCompleted",
            serde_json::json!({
                "epochMs": support_logs::temporary_epoch_ms(),
                "projectId": key.project_id,
                "sessionId": key.session_id,
            }),
        );
        self.sidebar_in_process_focus = Some((key, Instant::now()));
        true
    }

    /// Whether a plain focus message from the runtime only repeats a click that was already applied in process, so the tab is not selected a second time.
    pub(crate) fn sidebar_focus_message_echoes_in_process_focus(
        &mut self,
        message: &GpuiSidebarWorkspaceTerminalFocusMessage,
    ) -> bool {
        let plain = message.placement == GpuiWorkspaceTerminalFocusPlacement::Tab
            && message.placement_target_session_id.is_none()
            && !message.force_remount
            && !message.startup_restore
            && message.preferred_interface == GpuiPreferredAgentInterface::Terminal;
        if !plain {
            return false;
        }
        let Some((key, applied_at)) = self.sidebar_in_process_focus.as_ref() else {
            return false;
        };
        if key.project_id != message.project_id
            || key.session_id != message.session_id
            || applied_at.elapsed() > IN_PROCESS_FOCUS_ECHO_WINDOW
        {
            return false;
        }
        let still_selected = self
            .local_workspace_session_mappings
            .get(key)
            .copied()
            .and_then(|shell_session_id| {
                self.agents_workspace
                    .pane_id_for_session(shell_session_id)
                    .map(|pane_id| {
                        self.agents_workspace.active_session_in_pane(pane_id)
                            == Some(shell_session_id)
                    })
            })
            .unwrap_or(false);
        if still_selected {
            self.sidebar_in_process_focus = None;
        }
        still_selected
    }
}
