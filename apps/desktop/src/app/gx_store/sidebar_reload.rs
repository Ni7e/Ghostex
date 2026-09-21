//! Full Reload and Split Right, performed by the store.
//!
//! CDXC:Sessions 2026-09-21 WHY:
//! Neither of these calls the daemon itself. Full Reload is the sleep and the wake the store
//! already owns, run ONE AT A TIME because the TypeScript awaits the first before it starts the
//! second and because a wake that overtakes its own sleep reloads nothing; Split Right is a
//! selection that carries where the pane goes, and for a sleeping row it is the same wake with a
//! placement on it. So this file waits and it selects, and every decision it acts on is gx-core's.
//!
//! **The counters that prove this path fires in the app** are `reloads`, `reloadLegs`, `remounts`,
//! `splits`, `splitsWoken` and `splitsPlaced` on `gxStore.sidebarLifecycle`. A run where the user
//! used Advanced > Full Reload or Advanced > Split Right and any of them is zero means the command
//! never reached here, which is the failure the envelope bug of piece 3d was.
//!
//! SEE-ALSO: packages/gx-core/src/sidebar_actions/reload.rs,
//! packages/gx-core/src/sidebar_actions/split.rs,
//! apps/desktop/sidebar/gxserver-runtime/sessions-and-focus.ts.

use ghostex_gx_core::{
    FocusOptions, SplitAction, owns_reload_message, owns_split_message, plan_full_reload,
    plan_split_right, reload_continues_after,
};
use serde_json::Value;

use crate::GhostexGpuiApp;
use crate::app::model::GpuiLocalWorkspaceSessionKey;

impl GhostexGpuiApp {
    /// Answers `fullReloadSession` and `restartSession` when the store owns the row.
    pub(crate) fn gx_store_run_sidebar_reload(
        &mut self,
        command: &Value,
        cx: &mut gpui::Context<Self>,
    ) -> bool {
        let Some(message) = wrapped_message(command) else {
            return false;
        };
        if !owns_reload_message(message) {
            return false;
        }
        if !self.gx_store_sidebar_draws_store_list() {
            self.gx_store.sidebar_lifecycle.declined_source += 1;
            return false;
        }
        // A remote row, a browser row and an id that does not parse are refused inside the
        // planner, each one for a reason written down there.
        let Some(plan) = plan_full_reload(&self.gx_store.core, message) else {
            return false;
        };
        self.gx_store.sidebar_lifecycle.reloads += 1;
        self.gx_store.sidebar_lifecycle.reload_legs += plan.legs.len() as u64;
        self.gx_store
            .diagnostics
            .sidebar_reload_ran(&plan, self.gx_store.sidebar_lifecycle);
        let legs = plan.legs;
        cx.spawn(async move |this, cx| {
            for leg in legs {
                // Each leg goes through the single-session path, which owns the call, the declined
                // leg, the replacement focus and the echo guard. The wait is for the ANSWER and not
                // for a timer: the provider has to be dead before it is asked to come back, and a
                // sleep whose call failed stops the reload, as the TypeScript's first `await`
                // rejecting does.
                let started = this.update(cx, |this, cx| this.gx_store_start_lifecycle(&leg, cx));
                let Ok(Some(task)) = started else {
                    return;
                };
                if !reload_continues_after(task.await) {
                    let _ = this.update(cx, |this, _| {
                        this.gx_store.sidebar_lifecycle.reloads_stopped += 1;
                    });
                    return;
                }
            }
        })
        .detach();
        true
    }

    /// Answers `splitSessionRight` when the store owns the row.
    pub(crate) fn gx_store_run_sidebar_split(
        &mut self,
        command: &Value,
        cx: &mut gpui::Context<Self>,
    ) -> bool {
        let Some(message) = wrapped_message(command) else {
            return false;
        };
        if !owns_split_message(message) {
            return false;
        }
        if !self.gx_store_sidebar_draws_store_list() {
            self.gx_store.sidebar_lifecycle.declined_source += 1;
            return false;
        }
        let Some(plan) = plan_split_right(&self.gx_store.core, message) else {
            return false;
        };
        self.gx_store.sidebar_lifecycle.splits += 1;
        if plan.acknowledge_attention {
            // The old runtime owns the attention timers and the minimum visible window, so the
            // acknowledgement is queued for the next tell exactly as a local selection's is, rather
            // than reimplemented here (gx_store/burst.rs).
            self.gx_store_queue_attention_acknowledge(
                GpuiLocalWorkspaceSessionKey {
                    project_id: plan.session.project_id.clone(),
                    session_id: plan.session.session_id.clone(),
                },
                cx,
            );
        }
        self.gx_store
            .diagnostics
            .sidebar_split_ran(&plan, self.gx_store.sidebar_lifecycle);
        match &plan.action {
            // The Quick Automations row, where the TypeScript returns before it does anything.
            SplitAction::Nothing => {}
            SplitAction::Wake(wake) => {
                self.gx_store.sidebar_lifecycle.splits_woken += 1;
                let wake = wake.clone();
                if let Some(task) = self.gx_store_start_lifecycle(&wake, cx) {
                    task.detach();
                }
            }
            SplitAction::Focus => {
                self.gx_store.sidebar_lifecycle.splits_placed += 1;
                let session = plan.session.clone();
                self.gx_store_select_local_workspace_session(
                    &session,
                    None,
                    FocusOptions {
                        force_remount: false,
                        split_right: true,
                    },
                    cx,
                );
            }
        }
        true
    }
}

/// The inner message of a gxserver command envelope. Both of these payloads are wrapped ones, not
/// renderer commands: they reach the runtime through `controller.ts:131`, unlike `sessionAction`
/// and `batch`, which arrive at the top level.
fn wrapped_message(command: &Value) -> Option<&Value> {
    if command.get("type").and_then(Value::as_str) != Some("command") {
        return None;
    }
    command.get("message")
}
