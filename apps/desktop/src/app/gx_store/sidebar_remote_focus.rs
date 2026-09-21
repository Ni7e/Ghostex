//! A click on a row that lives on another machine: the store opens the pane itself.
//!
//! CDXC:RemoteMachines 2026-09-21 WHY:
//! A remote row's click used to leave Rust for QuickJS, be routed there, and come straight back
//! over the fixed native project-path bridge as `openRemoteSessionTerminal`. Everything that round
//! trip resolved (which machine, which project, the agent's Default Agent View, whether the focus
//! changes project) is in the store, so the store builds the same payload and performs it, in the
//! click's own frame, through the same function the bridge message reaches.
//!
//! **The command is still sent on to the old runtime.** The runtime owns three things this piece
//! deliberately does not take: the attention acknowledgement (a subsystem with its own timers and a
//! minimum visible window), the remote presentation focus marks a remote row still draws from
//! (`remote_row_focus` in sidebar_snapshot.rs, declared difference 16), and the patch publish that
//! carries them. Leaving those with the runtime is what keeps this reversible: with the store's
//! answer removed, the runtime's own post is the only one again.
//!
//! **The command is sent on FIRST and the store opens SECOND.** The store's open ends in
//! `set_sidebar_gxserver_remote_attach_focus_state`, whose tab-selected callback moves the
//! runtime's `activeGroupId` to the destination. Sent before the command, that callback made the
//! runtime's `focusChangesActiveProject` answer "same project", so its copy of the open lost
//! `keepView` and, whenever it was not dropped, undid the `CDXC:Navigation 2026-09-11` decision.
//! Both scripts go down the one ordered queue of the same service runtime, and the remote branch of
//! `focusSession` runs to its post with no `await`, so sending the command first makes the runtime
//! read the group the store read. Its copy is then byte for byte the store's payload, a copy that
//! is not dropped can only repeat the store's open and never change its view, and no timing can
//! reorder the two. The open still happens in the click's frame: queueing a script does not wait.
//!
//! **So the runtime's copy is dropped on the Rust side, and only that copy.** The marker is
//! recorded before the command is sent on and holds the whole payload the store sent (session,
//! placement, `keepView`, `preferredInterface`), and only a page message equal to it is dropped,
//! once per marker, within a short window. The guard is on the page's bridge entry alone
//! (`gx_store_receive_page_native_project_path_action`); the store's own open calls the unguarded
//! entry, so it can never be the one that is dropped. Any other open of the same row (a group
//! header's attach, a Space restore, a slot hotkey, the page's own restores) differs in at least one
//! field or arrives with no marker, and goes through.
//!
//! SEE-ALSO: packages/gx-core/src/sidebar_actions/remote_focus.rs,
//! apps/desktop/src/app/native_sidebar/actions.rs (the order: plan, mark, send on, open),
//! apps/desktop/src/app/remote_conn/native_action.rs
//! (`handle_gpui_remote_session_native_action`, which ends in
//! `begin_gpui_remote_attach_terminal_open`), tooling/gx-core/remote-focus-parity.ts (the gate).

use std::time::{Duration, Instant};

use ghostex_gx_core::{PreferredInterfaceSettings, RemoteFocusPlan, SessionKey, plan_remote_focus};
use serde_json::{Value, json};

use super::diagnostics::{record, routine_logging_enabled};
use crate::GhostexGpuiApp;
use crate::app::helpers::{
    GpuiSidebarNativeProjectPathAction, gpui_preferred_agent_interface_from_settings,
};
use crate::app::model::GpuiPreferredAgentInterface;
use crate::shared_settings;

/// How long the runtime has to send its own copy of an open the store already performed. Its route
/// is one service-runtime turn plus one bridge hop; two seconds is three orders of magnitude more
/// than that and still bounds a marker whose copy never comes.
const REMOTE_OPEN_ECHO_EXPIRY: Duration = Duration::from_secs(2);
/// How long a lapsed marker still names its row, so a copy that arrives after it is counted as the
/// machine being asked twice rather than as an open of the runtime's own.
const REMOTE_OPEN_LAPSED_ATTRIBUTION: Duration = Duration::from_secs(30);
/// Markers held at once. One click adds one and its copy removes it, so more than a few only pile
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
    /// The runtime's copy of an open the store performed, equal to it and dropped. The expected
    /// case: one per click while the old runtime still receives the command.
    pub(crate) echoes_dropped: u64,
    /// A marker whose copy never came within the window, or that was pushed out by newer ones.
    pub(crate) markers_expired: u64,
    /// A page open of a row the store had just opened that matched no marker: the copy came late
    /// or in another shape, and the machine was asked a second time.
    pub(crate) unmatched_opens: u64,
    /// A payload the store owns but did not answer because the renderer is not drawing its list.
    pub(crate) declined_source: u64,
    /// A remote row's click the planner refused, which the old runtime then performs whole.
    pub(crate) handed_back: u64,
}

/// An open the store performed whose copy from the old runtime has not arrived yet.
struct ExpectedRemoteOpen {
    session: SessionKey,
    /// The payload exactly as the store sent it; the copy must equal it to be dropped.
    payload: Value,
    at: Instant,
}

/// The counters, the markers and the log budget.
#[derive(Default)]
pub(crate) struct SidebarRemoteFocusHost {
    pub(crate) counters: SidebarRemoteFocusCounters,
    /// One per open the store performed, oldest first. Two clicks on one row are two markers.
    expected_opens: Vec<ExpectedRemoteOpen>,
    /// Rows whose marker lapsed unused, kept only to attribute a late copy.
    lapsed_opens: Vec<(SessionKey, Instant)>,
    records: u32,
}

impl SidebarRemoteFocusHost {
    fn expect(&mut self, plan: &RemoteFocusPlan) {
        self.prune();
        if self.expected_opens.len() >= MAX_EXPECTED_REMOTE_OPENS {
            let pushed_out = self.expected_opens.remove(0);
            self.lapse(pushed_out.session);
        }
        self.expected_opens.push(ExpectedRemoteOpen {
            session: plan.session.clone(),
            payload: plan.native_action.clone(),
            at: Instant::now(),
        });
    }

    /// Lapses every marker older than the window and forgets rows lapsed long ago.
    fn prune(&mut self) {
        let mut index = 0;
        while index < self.expected_opens.len() {
            if self.expected_opens[index].at.elapsed() < REMOTE_OPEN_ECHO_EXPIRY {
                index += 1;
                continue;
            }
            let lapsed = self.expected_opens.remove(index);
            self.lapse(lapsed.session);
        }
        self.lapsed_opens
            .retain(|(_, at)| at.elapsed() < REMOTE_OPEN_LAPSED_ATTRIBUTION);
    }

    fn lapse(&mut self, session: SessionKey) {
        self.counters.markers_expired += 1;
        if self.lapsed_opens.len() >= MAX_EXPECTED_REMOTE_OPENS {
            self.lapsed_opens.remove(0);
        }
        self.lapsed_opens.push((session, Instant::now()));
    }

    /// Whether an `openRemoteSessionTerminal` from the page is the runtime's copy of an open the
    /// store performed, and must be dropped.
    ///
    /// CDXC:RemoteMachines 2026-09-21 WHY:
    /// The copy is matched on the WHOLE payload, `keepView` included, and not on the row alone.
    /// Keyed on the row, the marker ate the next open of that row from any sender, and a Split
    /// Right right after a click replaced the click's marker so the click's copy took the split's
    /// and the split ran twice. `keepView` can be compared because the command reaches the runtime
    /// before the store's open moves its active group, so both sides read the same one. Where they
    /// still disagree, which is a second click on a row landing before the runtime's focus publish
    /// has reached the store, the runtime's answer is the fresher one: its copy goes through and
    /// repeats the open with it, and `unmatched_opens` counts it. A different open is never eaten.
    fn take_page_open(&mut self, session: &SessionKey, payload: &Value) -> bool {
        self.prune();
        if let Some(index) = self
            .expected_opens
            .iter()
            .position(|expected| expected.payload == *payload)
        {
            self.expected_opens.remove(index);
            self.counters.echoes_dropped += 1;
            return true;
        }
        // Not the store's payload. For a row the store just opened this is that open's copy in
        // another shape, or after its marker lapsed: the runtime answers in order, so it answers
        // the OLDEST marker of the row, which is retired rather than left to eat a later open.
        if let Some(index) = self
            .expected_opens
            .iter()
            .position(|expected| expected.session == *session)
        {
            self.expected_opens.remove(index);
            self.counters.unmatched_opens += 1;
        } else if let Some(index) = self
            .lapsed_opens
            .iter()
            .position(|(lapsed, _)| lapsed == session)
        {
            self.lapsed_opens.remove(index);
            self.counters.unmatched_opens += 1;
        }
        false
    }
}

impl GhostexGpuiApp {
    /// The store's answer to a sidebar command that selects a remote row, or `None` when the old
    /// runtime answers it alone. Performs nothing: the caller marks, sends the command on, and only
    /// then opens (see the module comment for why that order).
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
        // The store's answer is only the right one while the store's list is the one on screen:
        // with the old projection drawn, its own state is what the row was built from.
        if !self.gx_store_sidebar_draws_store_list() {
            self.gx_store.sidebar_remote_focus.counters.declined_source += 1;
            return None;
        }
        let settings = self.gx_store_preferred_interface_settings();
        let plan = plan_remote_focus(&self.gx_store.core, &message, &settings);
        if plan.is_none() {
            self.gx_store.sidebar_remote_focus.counters.handed_back += 1;
        }
        plan
    }

    /// Records that the runtime will send its own copy of this open. Called BEFORE the command is
    /// sent on, so no copy can arrive unexpected, and only when there is a runtime to send it.
    pub(crate) fn gx_store_expect_remote_open_copy(&mut self, plan: &RemoteFocusPlan) {
        self.gx_store.sidebar_remote_focus.expect(plan);
    }

    /// The plan's one effect: the open, through the UNGUARDED entry, so the marker recorded for
    /// this very open cannot drop it.
    pub(crate) fn gx_store_open_remote_row(
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
        // The same function the bridge message reaches, with the same payload the old runtime
        // would have posted, so the machine lookup, the SSH configuration and the tunnel target are
        // the one implementation that already exists.
        self.receive_sidebar_native_project_path_action_payload(
            &plan.native_action.to_string(),
            cx,
        );
        self.gx_store_record_remote_focus(plan);
    }

    /// The page's native project-path message. The one place the runtime's copy of an open the
    /// store already performed is dropped; every other payload goes on unchanged.
    pub(crate) fn gx_store_receive_page_native_project_path_action(
        &mut self,
        payload: &str,
        cx: &mut gpui::Context<Self>,
    ) {
        if self.gx_store_page_remote_open_is_copy(payload) {
            return;
        }
        self.receive_sidebar_native_project_path_action_payload(payload, cx);
    }

    fn gx_store_page_remote_open_is_copy(&mut self, payload: &str) -> bool {
        let Ok(message) = serde_json::from_str::<Value>(payload) else {
            return false;
        };
        let action = message
            .get("action")
            .and_then(Value::as_str)
            .and_then(GpuiSidebarNativeProjectPathAction::from_str);
        if action != Some(GpuiSidebarNativeProjectPathAction::OpenRemoteSessionTerminal) {
            return false;
        }
        let Some(session) = message
            .get("projectId")
            .and_then(Value::as_str)
            .and_then(SessionKey::parse_remote_scoped_session_id)
        else {
            return false;
        };
        self.gx_store
            .sidebar_remote_focus
            .take_page_open(&session, &message)
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

    /// The remote focus counters, for the periodic summary in `sidebar_remote.rs`. Lapses the
    /// markers first, so a copy that never came is counted even when no click follows it.
    pub(super) fn gx_store_remote_focus_counters(&mut self) -> SidebarRemoteFocusCounters {
        let host = &mut self.gx_store.sidebar_remote_focus;
        host.prune();
        host.counters
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

/// The nine keys both records carry, well under the sanitizer's 32-entry cap at depth 2. Counts
/// only: no id, title or path.
pub(super) fn remote_focus_counters_json(counters: &SidebarRemoteFocusCounters) -> Value {
    json!({
        "opens": counters.opens,
        "splits": counters.splits,
        "keepView": counters.keep_view,
        "chatInterface": counters.chat_interface,
        "echoesDropped": counters.echoes_dropped,
        "markersExpired": counters.markers_expired,
        "unmatchedOpens": counters.unmatched_opens,
        "declinedSource": counters.declined_source,
        "handedBack": counters.handed_back,
    })
}
