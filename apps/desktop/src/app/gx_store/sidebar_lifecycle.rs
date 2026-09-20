//! Sleep and wake, performed by the store instead of by the old runtime.
//!
//! CDXC:SessionSleep 2026-09-20 WHY:
//! The decision is gx-core's (`sidebar_actions/lifecycle.rs`) and this file is only the two edges
//! it cannot have: the daemon call and the workspace selection. The order is the whole point and
//! it is the TypeScript's order, not a convenience: the call goes first, the answer is read, and
//! only an ACCEPTED answer is allowed to change what the row shows. An optimistic value applied
//! before the call would show a session asleep that the daemon declined to sleep, which is the
//! bug the KeepAwake fix of 2026-08-19 removed from the TypeScript and which this port must not
//! reintroduce.
//!
//! The echo guard is the store's own overlay, not a timer and not a stamp: the patch records the
//! value it predicted FROM, so a daemon row that merely repeats that value leaves the prediction
//! in place, one that agrees retires it, and one that says anything else replaces it at once
//! (`StoredPatch::verdict`).
//!
//! SEE-ALSO: packages/gx-core/src/sidebar_actions/lifecycle.rs,
//! apps/desktop/sidebar/gxserver-runtime/auto-sleep.ts (`setSessionSleeping`),
//! tooling/gx-core/lifecycle-parity-typescript.ts (the gate that drives both sides through all
//! three answers and all three echoes).

use std::time::Duration;

use ghostex_gx_core::{
    CloseAnswer, CloseFollowUp, CloseRequest, Event, Intent, LifecycleAnswer, LifecycleCall,
    LifecycleFollowUp, LifecycleRequest, SessionKey, apply_close_answer, apply_lifecycle_answer,
    close_optimistic_follow_ups, owns_close_message, owns_lifecycle_message, plan_close_request,
    plan_lifecycle_request,
};
use serde_json::Value;

use super::host::now_ms;
use crate::GhostexGpuiApp;
use crate::app::helpers::gpui_gxserver_rpc_result;
use crate::app::model::{
    GpuiPreferredAgentInterface, GpuiSidebarWorkspaceTerminalFocusMessage,
    GpuiWorkspaceTerminalFocusPlacement,
};

/// The same bound the app's other wake uses (`session_chat_fork_branches.rs`): a wake starts a
/// provider and can take a while, and a call that times out must read as "no answer" rather than
/// as a refusal.
const LIFECYCLE_RPC_TIMEOUT: Duration = Duration::from_secs(60);

/// What this app run did with the lifecycle actions the store owns.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub(crate) struct SidebarLifecycleCounters {
    pub(crate) sleeps: u64,
    pub(crate) wakes: u64,
    pub(crate) accepted: u64,
    pub(crate) declined: u64,
    pub(crate) failed: u64,
    /// An accepted answer whose optimistic value the store had nothing to overlay, because the
    /// daemon row already said it.
    pub(crate) already_agreed: u64,
    pub(crate) focus_follow_ups: u64,
    /// Payloads the store owns but did not answer because the renderer is not drawing its list.
    pub(crate) declined_source: u64,
    pub(crate) closes: u64,
    /// Closes the daemon confirmed.
    pub(crate) closes_accepted: u64,
    /// Closes whose row came back because the daemon never confirmed. Every one of these is a row
    /// the TypeScript would have left missing for the rest of the run.
    pub(crate) closes_restored: u64,
}

impl GhostexGpuiApp {
    /// Answers a `setSessionSleeping` command in Rust when the store owns it. Returns whether it
    /// did, in which case the command must NOT also be sent to the old runtime, which would call
    /// the daemon a second time.
    pub(crate) fn gx_store_run_sidebar_lifecycle(
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
        if !owns_lifecycle_message(message) {
            return false;
        }
        if !self.gx_store_sidebar_draws_store_list() {
            self.gx_store.sidebar_lifecycle.declined_source += 1;
            return false;
        }
        // A browser row, a remote row and the bulk payloads are refused inside the planner and
        // stay the old runtime's, each one for a reason written down there.
        let Some(request) = plan_lifecycle_request(&self.gx_store.core, message) else {
            return false;
        };
        match request.call {
            LifecycleCall::Sleep => self.gx_store.sidebar_lifecycle.sleeps += 1,
            LifecycleCall::Wake => self.gx_store.sidebar_lifecycle.wakes += 1,
        }
        // The Quick Automations row: both sides return before the call, so this is answered and
        // nothing happens.
        if request.rpc_path.is_empty() {
            self.gx_store.diagnostics.sidebar_lifecycle_ran(
                &request,
                "quick",
                0,
                self.gx_store.sidebar_lifecycle,
            );
            return true;
        }
        let path = request.rpc_path;
        let params = request.rpc_params.clone();
        let background = cx.background_executor().clone();
        cx.spawn(async move |this, cx| {
            let started = std::time::Instant::now();
            let result = background
                .spawn(
                    async move { gpui_gxserver_rpc_result(path, &params, LIFECYCLE_RPC_TIMEOUT) },
                )
                .await;
            let round_trip_ms = started.elapsed().as_millis() as u64;
            let _ = this.update(cx, |this, cx| {
                this.gx_store_apply_lifecycle_answer(&request, result, round_trip_ms, cx);
            });
        })
        .detach();
        true
    }

    /// Answers a `closeSession` command in Rust when the store owns it.
    ///
    /// The row goes at once, before the call, which is the TypeScript's order and the reason the
    /// click feels instant. What is NOT the TypeScript's is the answer: a call that does not come
    /// home puts the row back instead of leaving it missing (packages/gx-core/src/sidebar_actions/close.rs).
    pub(crate) fn gx_store_run_sidebar_close(
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
        if !owns_close_message(message) {
            return false;
        }
        if !self.gx_store_sidebar_draws_store_list() {
            self.gx_store.sidebar_lifecycle.declined_source += 1;
            return false;
        }
        let Some(request) = plan_close_request(&self.gx_store.core, message) else {
            return false;
        };
        self.gx_store.sidebar_lifecycle.closes += 1;
        self.gx_store_run_close_follow_ups(close_optimistic_follow_ups(&request), cx);
        let path = request.rpc_path;
        let params = request.rpc_params.clone();
        let background = cx.background_executor().clone();
        cx.spawn(async move |this, cx| {
            let started = std::time::Instant::now();
            let result = background
                .spawn(
                    async move { gpui_gxserver_rpc_result(path, &params, LIFECYCLE_RPC_TIMEOUT) },
                )
                .await;
            let elapsed = started.elapsed();
            // A call that spent the whole timeout and came back with an error never answered; the
            // distinction changes no follow-up and is kept because it is the one case the two
            // clients cannot both reach (the TypeScript's `fetch` has no timeout at all).
            let answer = match (
                CloseAnswer::read(result.as_ref().map_err(String::as_str)),
                elapsed >= LIFECYCLE_RPC_TIMEOUT,
            ) {
                (CloseAnswer::Failed, true) => CloseAnswer::NeverAnswered,
                (answer, _) => answer,
            };
            let _ = this.update(cx, |this, cx| {
                this.gx_store_apply_close_answer(&request, answer, elapsed.as_millis() as u64, cx);
            });
        })
        .detach();
        true
    }

    fn gx_store_apply_close_answer(
        &mut self,
        request: &CloseRequest,
        answer: CloseAnswer,
        round_trip_ms: u64,
        cx: &mut gpui::Context<Self>,
    ) {
        match answer {
            CloseAnswer::Accepted => self.gx_store.sidebar_lifecycle.closes_accepted += 1,
            _ => self.gx_store.sidebar_lifecycle.closes_restored += 1,
        }
        self.gx_store_run_close_follow_ups(apply_close_answer(request, answer), cx);
        self.gx_store.diagnostics.sidebar_close_ran(
            answer.as_str(),
            round_trip_ms,
            self.gx_store.sidebar_lifecycle,
        );
    }

    fn gx_store_run_close_follow_ups(
        &mut self,
        follow_ups: Vec<CloseFollowUp>,
        cx: &mut gpui::Context<Self>,
    ) {
        let now = now_ms();
        let mut moved = false;
        let mut focus_target: Option<SessionKey> = None;
        for follow_up in follow_ups {
            match follow_up {
                CloseFollowUp::Hide { session } => {
                    let output = self
                        .gx_store
                        .core
                        .handle(Event::Intent(Intent::HideSession { session }), now);
                    if !output.changes.is_empty() {
                        moved = true;
                        self.gx_store.sidebar_list.note_changes(&output.changes);
                    }
                }
                CloseFollowUp::Unhide { session } => {
                    let output = self
                        .gx_store
                        .core
                        .handle(Event::Intent(Intent::UnhideSession { session }), now);
                    if !output.changes.is_empty() {
                        moved = true;
                        self.gx_store.sidebar_list.note_changes(&output.changes);
                    }
                }
                CloseFollowUp::Focus { session } => {
                    self.gx_store.sidebar_lifecycle.focus_follow_ups += 1;
                    focus_target = Some(session);
                }
            }
        }
        if moved {
            self.gx_store_update_sidebar_list(cx);
        }
        if let Some(session) = focus_target {
            self.gx_store_focus_local_workspace_session(&session, cx);
        }
    }

    /// The half after the round trip. Runs on the UI thread, so the focus it reads is the focus
    /// the user has now and not the one the call left with.
    fn gx_store_apply_lifecycle_answer(
        &mut self,
        request: &LifecycleRequest,
        result: Result<Value, String>,
        round_trip_ms: u64,
        cx: &mut gpui::Context<Self>,
    ) {
        let answer = LifecycleAnswer::read(result.as_ref().map_err(String::as_str));
        match answer {
            LifecycleAnswer::Accepted => self.gx_store.sidebar_lifecycle.accepted += 1,
            LifecycleAnswer::Declined => self.gx_store.sidebar_lifecycle.declined += 1,
            LifecycleAnswer::Failed => self.gx_store.sidebar_lifecycle.failed += 1,
        }
        let now = now_ms();
        let focused_now = self.gx_store.core.focus().focused_session.clone();
        let follow_ups = apply_lifecycle_answer(request, answer, focused_now.as_ref(), now);
        let mut moved = false;
        let mut focus_target: Option<SessionKey> = None;
        for follow_up in follow_ups {
            match follow_up {
                LifecycleFollowUp::Patch { session, patch } => {
                    let output = self.gx_store.core.handle(
                        Event::Intent(Intent::PatchSession {
                            session: session.clone(),
                            patch,
                        }),
                        now,
                    );
                    if output.changes.is_empty() {
                        // The daemon row already says what the call asked for, so the overlay had
                        // nothing to do and was not stored. Not an error, and worth counting: a
                        // run where every accepted answer lands here means the daemon is ahead of
                        // us and the optimistic value is never on screen at all.
                        self.gx_store.sidebar_lifecycle.already_agreed += 1;
                    } else {
                        moved = true;
                        self.gx_store.sidebar_list.note_changes(&output.changes);
                    }
                }
                LifecycleFollowUp::Focus { session } => {
                    self.gx_store.sidebar_lifecycle.focus_follow_ups += 1;
                    focus_target = Some(session);
                }
            }
        }
        if moved {
            self.gx_store_update_sidebar_list(cx);
        }
        if let Some(session) = focus_target {
            self.gx_store_focus_local_workspace_session(&session, cx);
        }
        self.gx_store.diagnostics.sidebar_lifecycle_ran(
            request,
            answer.as_str(),
            round_trip_ms,
            self.gx_store.sidebar_lifecycle,
        );
    }

    /// `focusLocalWorkspaceSession` with no options, which is what the TypeScript sends from every
    /// one of these paths: the ordinary selection, never a remount and never a wake intent,
    /// because whatever wake was needed has already happened.
    fn gx_store_focus_local_workspace_session(
        &mut self,
        session: &SessionKey,
        cx: &mut gpui::Context<Self>,
    ) {
        self.focus_local_workspace_terminal_from_message(
            &GpuiSidebarWorkspaceTerminalFocusMessage {
                force_remount: false,
                placement: GpuiWorkspaceTerminalFocusPlacement::Tab,
                placement_target_session_id: None,
                preferred_interface: GpuiPreferredAgentInterface::Terminal,
                project_id: session.project_id.clone(),
                session_id: session.session_id.clone(),
                startup_restore: false,
                keep_view: false,
                wake_sleeping: false,
            },
            cx,
        );
    }
}
