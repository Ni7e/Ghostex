//! A click on a row that lives on another machine: the store performs all of it.
//!
//! CDXC:RemoteMachines 2026-09-21 WHY:
//! A remote row's click used to leave Rust for QuickJS, be routed there, and come straight back
//! over the fixed native project-path bridge as `openRemoteSessionTerminal`. Everything that round
//! trip resolved (which machine, which project, the agent's Default Agent View, whether the focus
//! changes project) is in the store, so the store builds the same payload and performs it, in the
//! click's own frame, through the same function the bridge message reaches.
//!
//! **The command no longer reaches the old runtime.** What its remote branch did besides the open
//! is performed here, each at its end:
//! - the attention acknowledgement goes to the runtime's attention subsystem as the one bridge
//!   message the store already uses for a local row, with machine-scoped ids, and BEFORE the
//!   open, as `focusSession` acknowledged first. The runtime keeps the minimum visible window,
//!   the optimistic clear and the machine's `/api/updateAgentActivity` call, so the timer stays
//!   one implementation;
//! - the remote focus marks (`setRemotePresentationSessionFocus`) and their patch publish are what
//!   the open's own tab-selected callback runs (`set_sidebar_gxserver_remote_attach_focus_state`,
//!   reached synchronously from `begin_gpui_remote_attach_terminal_open`), so they already moved
//!   once per click from the store's open and moved a SECOND time from the forwarded command;
//! - the page's half of a click (clear the multi-selection, close an open app modal) is the
//!   store's selection intent mirrored to the page, and the same close the bridge performs.
//!
//! So there is no runtime copy of the open any more, and nothing to drop: the echo marker, the
//! page-entry duplicate check and the three counters that measured the copy are gone together.
//!
//! **`keepView` is planned from the group the RUNTIME holds, not from the core's focus.** The
//! core's focus stays on this computer while a remote row has focus, and the runtime's
//! `activeGroupId` is still the one definition of the active project (a group header's attach and a
//! lifecycle replacement move it). The host tracks it (`RuntimeActiveGroup` in gx-core): every
//! remote tab selection it sends the runtime (the open's callback), every tell, and every focus
//! state the runtime publishes.
//!
//! SEE-ALSO: packages/gx-core/src/sidebar_actions/remote_focus.rs,
//! apps/desktop/src/app/native_sidebar/actions.rs, apps/desktop/src/app/remote_conn/native_action.rs
//! (`handle_gpui_remote_session_native_action`, which ends in `begin_gpui_remote_attach_terminal_open`),
//! apps/desktop/sidebar/gxserver-runtime/attention-tracking.ts
//! (`handleGpuiWorkspaceSessionAttentionAcknowledge`), tooling/gx-core/remote-focus-parity.ts (the gate).

use ghostex_gx_core::{
    PreferredInterfaceSettings, ProjectKey, RemoteFocusPlan, RuntimeActiveGroup, SessionKey,
    plan_remote_focus, remote_focus_group,
};
use serde_json::{Value, json};

use super::diagnostics::{record, routine_logging_enabled};
use super::host::now_ms;
use crate::GhostexGpuiApp;
use crate::app::helpers::{
    GpuiGxserverPresentationFocusEcho, gpui_preferred_agent_interface_from_settings,
    gpui_workspace_session_attention_acknowledge_script,
};
use crate::app::model::GpuiPreferredAgentInterface;
use crate::shared_settings;

/// Per-click lines one app run may write.
const MAX_REMOTE_FOCUS_RECORDS: u32 = 200;

/// What this app run did with remote row clicks. Memory only; the log lines are built from it.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub(crate) struct SidebarRemoteFocusCounters {
    /// Clicks the store answered, and each kind of them.
    pub(crate) opens: u64,
    pub(crate) splits: u64,
    /// Of those, the ones that carried each option.
    pub(crate) keep_view: u64,
    pub(crate) chat_interface: u64,
    /// Attention acknowledgements sent to the old runtime, one per answered click while it runs.
    pub(crate) acknowledgements: u64,
    /// Remote tab selections sent to the old runtime, from any sender (the store's opens and a
    /// slow attach landing). Each one moves the remote focus marks.
    pub(crate) tab_selections: u64,
    /// An answered click whose open sent no tab selection: the open was refused (no tunnel, no SSH
    /// settings, a toast said so) or no runtime runs, and the marks did not move.
    pub(crate) marks_missed: u64,
    /// The multi-selection a click cleared, mirrored to the old page.
    pub(crate) page_told: u64,
    /// A remote row's click the store did not answer because the renderer is not drawing its list.
    /// Local rows are not counted: they were never this path's.
    pub(crate) declined_source: u64,
    /// A remote row's click the planner refused, which the old runtime then performs whole: in
    /// practice a machine that is offline or has not streamed yet. Local and browser rows, and ids
    /// that do not parse as remote, are not counted.
    pub(crate) handed_back: u64,
}

/// The counters, the tracked runtime group and the log budget.
#[derive(Default)]
pub(crate) struct SidebarRemoteFocusHost {
    pub(crate) counters: SidebarRemoteFocusCounters,
    /// The old runtime's `activeGroupId` as a click finds it, which is what `keepView` is planned
    /// from.
    runtime_group: RuntimeActiveGroup,
    records: u32,
}

impl SidebarRemoteFocusHost {
    /// The old runtime published its focus state. Every parsed publish comes through here.
    pub(super) fn observe_runtime_publish(&mut self, echo: &GpuiGxserverPresentationFocusEcho) {
        self.runtime_group.observe_publish(
            echo.active_group_id.as_deref(),
            echo.focus_stamp.unwrap_or(0),
        );
    }
}

impl GhostexGpuiApp {
    /// The store's answer to a sidebar command that selects a remote row, or `None` when the old
    /// runtime answers it alone (the command is then sent on as before). Performs nothing: the
    /// caller hands the plan to [`Self::gx_store_focus_remote_row`].
    ///
    /// Two shapes arrive. `selectSession` with `mode: focus` is the RENDERER command a row click
    /// sends, which `selectNativeSidebarSession` turns into `{ type: 'focusSession', sessionId }`
    /// before it posts it, and that translation is reproduced here rather than a second reading of
    /// the click. `splitSessionRight` is a gxserver message and arrives WRAPPED.
    pub(crate) fn gx_store_plan_remote_row_focus(
        &mut self,
        command: &Value,
    ) -> Option<RemoteFocusPlan> {
        let message = remote_focus_message(command)?;
        // Only a remote row is this path's, so only a remote row is counted when it is not
        // answered; a local click here is the store's own focus path and says nothing.
        let remote_row = message
            .get("sessionId")
            .and_then(Value::as_str)
            .and_then(SessionKey::parse_remote_scoped_session_id)
            .is_some();
        // The store's answer is only the right one while the store's list is the one on screen:
        // with the old projection drawn, its own state is what the row was built from.
        if !self.gx_store_sidebar_draws_store_list() {
            if remote_row {
                self.gx_store.sidebar_remote_focus.counters.declined_source += 1;
            }
            return None;
        }
        let settings = self.gx_store_preferred_interface_settings();
        // Planned BEFORE the pending tell is flushed, so a pending tell is one the runtime will
        // have handled by the time the open's tab selection reaches it.
        let told_stamp = self.gx_store_told_stamp();
        let tell_pending = self.gx_store.local_focus.pending_tell.is_some();
        let runtime_group = self.gx_store.sidebar_remote_focus.runtime_group.current(
            told_stamp,
            tell_pending,
            now_ms(),
        );
        let plan = plan_remote_focus(&self.gx_store.core, &message, &settings, runtime_group);
        if plan.is_none() && remote_row {
            self.gx_store.sidebar_remote_focus.counters.handed_back += 1;
        }
        plan
    }

    /// The whole click on a remote row, in the old path's order: the page's half (the
    /// multi-selection cleared, an open app modal closed), then the runtime's (the attention
    /// acknowledged, then the open, whose tab-selected callback moves the remote focus marks and
    /// publishes them). `command` is the sidebar command the plan was made from; it is NOT sent on.
    pub(crate) fn gx_store_focus_remote_row(
        &mut self,
        command: &Value,
        plan: &RemoteFocusPlan,
        cx: &mut gpui::Context<Self>,
    ) {
        // `selectNativeSidebarSession` cleared the page's multi-selection and closed an open app
        // modal before it posted the click. The store's own selection intent already follows the
        // command; the page's copy is told the resulting value, unless a caller (the slot hotkeys)
        // is already collecting the changes to tell it once.
        let collect = self.gx_store.sidebar_ui.mirror.is_none();
        if collect {
            self.gx_store.sidebar_ui.mirror = Some(Vec::new());
        }
        self.gx_store_note_sidebar_command(command, cx);
        if collect && self.gx_store_mirror_sidebar_ui_to_page(cx) {
            self.gx_store.sidebar_remote_focus.counters.page_told += 1;
        }
        if !plan.split_right {
            // Closed BEFORE the open, so a keep-view open that leaves the keyboard where it is
            // cannot have it taken back by the modal's return focus a moment later.
            self.close_app_modal_from_bridge(cx);
        }
        // The runtime handles scripts in order, so a local selection it has not heard of yet goes
        // before the acknowledgement, as it went before the forwarded command.
        self.gx_store_flush_old_runtime_tell(cx);
        if let Some(sidebar) = self.sidebar.clone() {
            let script = gpui_workspace_session_attention_acknowledge_script(
                &plan.attention_acknowledgement,
            );
            sidebar.update(cx, |surface, _| surface.execute_app_owned_script(&script));
            self.gx_store.sidebar_remote_focus.counters.acknowledgements += 1;
        }
        let tab_selections = self.gx_store.sidebar_remote_focus.counters.tab_selections;
        {
            let counters = &mut self.gx_store.sidebar_remote_focus.counters;
            match plan.split_right {
                true => counters.splits += 1,
                false => counters.opens += 1,
            }
            if plan.keep_view {
                counters.keep_view += 1;
            }
            if plan.preferred_interface.as_deref() == Some("chat") {
                counters.chat_interface += 1;
            }
        }
        // The same function the bridge message reaches, with the same payload the old runtime
        // would have posted, so the machine lookup, the SSH configuration and the tunnel target are
        // the one implementation that already exists.
        self.receive_sidebar_native_project_path_action_payload(
            &plan.native_action.to_string(),
            cx,
        );
        let counters = &mut self.gx_store.sidebar_remote_focus.counters;
        if counters.tab_selections == tab_selections {
            counters.marks_missed += 1;
        }
        self.gx_store_record_remote_focus(plan);
    }

    /// The host is sending the runtime the tab-selected callback for a REMOTE tab, which runs
    /// `setRemotePresentationSessionFocus` when the session and the project name the same machine
    /// and project. The store's own open sends one, and so does an attach that completes later, so
    /// this is what keeps the tracked group right when a slow attach lands after a newer click.
    pub(crate) fn gx_store_note_remote_tab_selection_sent(
        &mut self,
        scoped_project_id: &str,
        scoped_session_id: &str,
    ) {
        let Some(session) = SessionKey::parse_remote_scoped_session_id(scoped_session_id) else {
            return;
        };
        if ProjectKey::parse_workspace_project_id(scoped_project_id) != Some(session.project_key())
        {
            return;
        }
        let group = remote_focus_group(&self.gx_store.core, &session);
        let told_stamp = self.gx_store_told_stamp();
        let host = &mut self.gx_store.sidebar_remote_focus;
        host.counters.tab_selections += 1;
        host.runtime_group
            .sent_remote_focus(group, told_stamp, now_ms());
    }

    fn gx_store_told_stamp(&self) -> u64 {
        self.gx_store
            .local_focus
            .last_tell
            .as_ref()
            .map_or(0, |told| told.stamp)
    }

    /// `resolveEffectivePreferredAgentInterface`'s inputs, read off the shared settings document
    /// the same way every other reader of the Default Agent View reads them.
    fn gx_store_preferred_interface_settings(&self) -> PreferredInterfaceSettings {
        let snapshot = shared_settings::shared_sidebar_settings_snapshot();
        let settings = snapshot.object();
        // The whole override map rather than one lookup: which agent the row has is the planner's
        // to read, and it reads it from the machine's own presentation. The value filter is the one
        // `gpui_preferred_agent_interface_override_from_settings` applies, so an unknown string is
        // an absent override on both paths.
        let overrides = settings
            .get("preferredAgentInterfaceOverrides")
            .and_then(serde_json::Value::as_object)
            .map(|overrides| {
                overrides
                    .iter()
                    .filter_map(|(agent_id, value)| {
                        let value = value.as_str()?;
                        GpuiPreferredAgentInterface::from_str(value)?;
                        Some((agent_id.clone(), value.to_string()))
                    })
                    .collect()
            })
            .unwrap_or_default();
        PreferredInterfaceSettings {
            default_interface: match gpui_preferred_agent_interface_from_settings(settings) {
                GpuiPreferredAgentInterface::Chat => "chat".to_string(),
                GpuiPreferredAgentInterface::Terminal => "terminal".to_string(),
            },
            overrides,
        }
    }

    /// One line per remote row click: which kind, and the two options that decide what the user
    /// sees. Nothing about the row itself, so no machine, project or session id is written.
    fn gx_store_record_remote_focus(&mut self, plan: &RemoteFocusPlan) {
        let host = &mut self.gx_store.sidebar_remote_focus;
        if host.records >= MAX_REMOTE_FOCUS_RECORDS || !routine_logging_enabled() {
            return;
        }
        host.records += 1;
        let counters = host.counters;
        record(
            "gxStore.sidebarRemoteFocus",
            json!({
                "splitRight": plan.split_right,
                "keepView": plan.keep_view,
                "chatInterface": plan.preferred_interface.as_deref() == Some("chat"),
                "totals": remote_focus_counters_json(&counters),
            }),
        );
    }

    /// The remote focus counters, for the periodic summary in `sidebar_remote.rs`.
    pub(super) fn gx_store_remote_focus_counters(&mut self) -> SidebarRemoteFocusCounters {
        self.gx_store.sidebar_remote_focus.counters
    }
}

/// The message a remote row's click means, in the shape the planner answers. `selectSession` is a
/// renderer command at the TOP level; `splitSessionRight` is a gxserver message and is wrapped.
fn remote_focus_message(command: &Value) -> Option<Value> {
    let kind = command.get("type").and_then(Value::as_str)?;
    if kind == "selectSession" {
        if command.get("mode").and_then(Value::as_str) != Some("focus") {
            return None;
        }
        let session_id = command.get("sessionId").and_then(Value::as_str)?;
        return Some(json!({ "type": "focusSession", "sessionId": session_id }));
    }
    if kind != "command" {
        return None;
    }
    let message = command.get("message")?;
    match message.get("type").and_then(Value::as_str) {
        Some("splitSessionRight") => Some(message.clone()),
        _ => None,
    }
}

/// The ten keys both records carry, well under the sanitizer's 32-entry cap at depth 2. Counts
/// only: no id, title or path.
pub(super) fn remote_focus_counters_json(counters: &SidebarRemoteFocusCounters) -> Value {
    json!({
        "opens": counters.opens,
        "splits": counters.splits,
        "keepView": counters.keep_view,
        "chatInterface": counters.chat_interface,
        "acknowledgements": counters.acknowledgements,
        "tabSelections": counters.tab_selections,
        "marksMissed": counters.marks_missed,
        "pageTold": counters.page_told,
        "declinedSource": counters.declined_source,
        "handedBack": counters.handed_back,
    })
}
