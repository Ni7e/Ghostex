//! A click on a row that lives on another machine: the store opens the pane itself.
//!
//! CDXC:RemoteMachines 2026-09-21 WHY:
//! A remote row's click used to leave Rust for QuickJS, be routed there, and come straight back
//! over the fixed native project-path bridge as `openRemoteSessionTerminal`. Everything that round
//! trip resolved (which machine, which project, the agent's Default Agent View, whether the focus
//! changes project) is in the store, so the store builds the same payload and hands it to the SAME
//! entry point the bridge message lands on, in the click's own frame.
//!
//! **The command is still sent on to the old runtime**, which is why this returns nothing the
//! dispatcher acts on. The runtime owns three things this piece deliberately does not take: the
//! attention acknowledgement (a subsystem with its own timers and a minimum visible window), the
//! remote presentation focus marks a remote row still draws from (`remote_row_focus` in
//! sidebar_snapshot.rs, declared difference 16), and the patch publish that carries them. Taking
//! the payload and leaving those with the runtime is what keeps this reversible: with the store's
//! answer removed, the runtime's own post is the only one again.
//!
//! **So the duplicate has to be dropped, and it is dropped on the Rust side.** The runtime posts
//! its own `openRemoteSessionTerminal` for the same row a moment later; without a guard the machine
//! would be asked for the same session twice, an SSH attach plan prepared twice. The marker is
//! recorded AFTER the store's own call, so the store's call always goes through and only what
//! follows it is dropped, and it is honoured only while this row is still the newest remote row the
//! store opened and only for a short window, exactly like the local click's expected focus echo.
//!
//! SEE-ALSO: packages/gx-core/src/sidebar_actions/remote_focus.rs,
//! apps/desktop/src/app/remote_conn/native_action.rs
//! (`handle_gpui_remote_session_native_action`, which ends in
//! `begin_gpui_remote_attach_terminal_open`), tooling/gx-core/remote-focus-parity.ts (the gate).

use std::time::{Duration, Instant};

use ghostex_gx_core::{PreferredInterfaceSettings, RemoteFocusPlan, SessionKey, plan_remote_focus};
use serde_json::{Value, json};

use super::diagnostics::{record, routine_logging_enabled};
use crate::GhostexGpuiApp;
use crate::app::helpers::gpui_preferred_agent_interface_from_settings;
use crate::app::model::GpuiPreferredAgentInterface;
use crate::shared_settings;

/// How long the runtime has to send its own copy of an open the store already performed. Its route
/// is one service-thread turn plus one bridge hop; a second is three orders of magnitude more than
/// that and still bounds a marker whose echo never comes.
const REMOTE_OPEN_ECHO_EXPIRY: Duration = Duration::from_secs(2);
/// Markers held at once. One click adds one and its echo removes it, so more than a few only pile
/// up while the old runtime is far behind.
const MAX_EXPECTED_REMOTE_OPENS: usize = 8;
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
    /// The old runtime's own copy of an open the store had already performed, dropped here.
    pub(crate) duplicates_dropped: u64,
    /// A payload the store owns but did not answer because the renderer is not drawing its list.
    pub(crate) declined_source: u64,
    /// A remote row's click the planner refused, which the old runtime then performs whole.
    pub(crate) handed_back: u64,
}

/// The counters, the markers and the log budget.
#[derive(Default)]
pub(crate) struct SidebarRemoteFocusHost {
    pub(crate) counters: SidebarRemoteFocusCounters,
    /// Rows the store has opened and whose runtime copy is still expected.
    expected_opens: Vec<(SessionKey, Instant)>,
    records: u32,
}

impl SidebarRemoteFocusHost {
    fn expect(&mut self, session: SessionKey) {
        self.expected_opens.retain(|(held, _)| *held != session);
        if self.expected_opens.len() >= MAX_EXPECTED_REMOTE_OPENS {
            self.expected_opens.remove(0);
        }
        self.expected_opens.push((session, Instant::now()));
    }

    /// Whether this open is the old runtime's copy of one the store already performed. Takes the
    /// marker: a second request for the same row is the user asking again.
    fn take_expected(&mut self, session: &SessionKey) -> bool {
        self.expected_opens
            .retain(|(_, at)| at.elapsed() < REMOTE_OPEN_ECHO_EXPIRY);
        match self
            .expected_opens
            .iter()
            .position(|(held, _)| held == session)
        {
            Some(index) => {
                self.expected_opens.remove(index);
                true
            }
            None => false,
        }
    }
}

impl GhostexGpuiApp {
    /// A sidebar command that selects a remote row: opens it here, in this frame. The command is
    /// still sent on, so this returns nothing the dispatcher branches on.
    ///
    /// Two shapes arrive. `selectSession` with `mode: focus` is the RENDERER command a row click
    /// sends, which `selectNativeSidebarSession` turns into `{ type: 'focusSession', sessionId }`
    /// before it posts it, and that translation is reproduced here rather than a second reading of
    /// the click. `splitSessionRight` is a gxserver message and arrives WRAPPED.
    pub(crate) fn gx_store_note_remote_row_focus(
        &mut self,
        command: &Value,
        cx: &mut gpui::Context<Self>,
    ) {
        let Some(message) = remote_focus_message(command) else {
            return;
        };
        // The store's answer is only the right one while the store's list is the one on screen:
        // with the old projection drawn, its own state is what the row was built from.
        if !self.gx_store_sidebar_draws_store_list() {
            self.gx_store.sidebar_remote_focus.counters.declined_source += 1;
            return;
        }
        let settings = self.gx_store_preferred_interface_settings();
        let plan = plan_remote_focus(&self.gx_store.core, &message, &settings);
        let Some(plan) = plan else {
            self.gx_store.sidebar_remote_focus.counters.handed_back += 1;
            return;
        };
        self.gx_store_run_remote_focus_plan(&plan, cx);
    }

    /// The plan's one effect, and the marker that keeps the old runtime from repeating it.
    fn gx_store_run_remote_focus_plan(
        &mut self,
        plan: &RemoteFocusPlan,
        cx: &mut gpui::Context<Self>,
    ) {
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
        // The same entry point the bridge message reaches, with the same payload the old runtime
        // would have posted, so the machine lookup, the SSH configuration and the tunnel target are
        // the one implementation that already exists.
        self.receive_sidebar_native_project_path_action_payload(
            &plan.native_action.to_string(),
            cx,
        );
        // AFTER the call: the store's own open must never be the one that is dropped.
        self.gx_store
            .sidebar_remote_focus
            .expect(plan.session.clone());
        self.gx_store_record_remote_focus(plan);
    }

    /// Whether this remote open is the old runtime's copy of one the store already performed.
    pub(crate) fn gx_store_remote_open_is_duplicate(&mut self, scoped_session_id: &str) -> bool {
        let Some(session) = SessionKey::parse_remote_scoped_session_id(scoped_session_id) else {
            return false;
        };
        let host = &mut self.gx_store.sidebar_remote_focus;
        if !host.take_expected(&session) {
            return false;
        }
        host.counters.duplicates_dropped += 1;
        true
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
    pub(super) fn gx_store_remote_focus_counters(&self) -> SidebarRemoteFocusCounters {
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

/// The seven keys both records carry, well under the sanitizer's 32-entry cap at depth 2.
pub(super) fn remote_focus_counters_json(counters: &SidebarRemoteFocusCounters) -> Value {
    json!({
        "opens": counters.opens,
        "splits": counters.splits,
        "keepView": counters.keep_view,
        "chatInterface": counters.chat_interface,
        "duplicatesDropped": counters.duplicates_dropped,
        "declinedSource": counters.declined_source,
        "handedBack": counters.handed_back,
    })
}
