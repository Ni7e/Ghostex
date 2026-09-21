//! The project slot hotkeys (cmd+1 to cmd+9), performed by the store when its list is drawn.
//!
//! CDXC:Hotkeys 2026-09-21 WHY:
//! The jump used to be the old sidebar page's: `gpuiProjectSlotHotkey` went to QuickJS, which
//! resolved the slot against its own projection, posted the row's `focusSession` and asked for a
//! reveal that came back one publish later. With the store's list drawn, the whole jump is planned
//! by gx-core (`project_slot_plan`, then `reveal_plan` against the list the plan's own changes
//! rebuilt) and performed here in the key's frame, and the message is no longer sent. With the
//! switch off it still is, because the old page is then the list the user sees.
//!
//! **Where each effect ends, read rather than assumed.** The FOCUS ends where a row click's ends,
//! because it is one: the row click's `selectSession` (which the old page turns into the runtime's
//! `focusSession`, the call `runNativeProjectSlotHotkey` itself made through the same
//! `selectNativeSidebarSession`) and the click's in-process reaction
//! (`react_to_native_sidebar_session_click`: the project swap, the tab selection or staged tab, and
//! `gx_store_select_local_session`). The REVEAL ends in `gx_store_apply_sidebar_reveal`, the one
//! function a published reveal request also ends in, and the scroll is the walk's
//! (`gx_store_reveal_walk_row`). A slot never names a remote project (gx-core
//! `sidebar_view/slot_hotkey.rs`), so the remote focus path is never reached from here.
//!
//! **A held key costs no QuickJS turn.** A key repeat that lands on the row the store already
//! focuses sends nothing: the press before it asked for everything that row needs. What a repeat
//! still pays is the planner (one pass over the drawn groups) and a reveal plan that finds the row
//! already drawn, and it changes no state, so the list is not rebuilt.
//!
//! **The old page's copy of the collapse state** is not drawn with the switch on and not written,
//! but the sidebar shadow compares it. When the reveal changed something, the page is sent the same
//! `revealSidebarSession` the titlebar's Reveal Active Session sends, under a request id this file
//! marks handled on both Rust readers, so the page applies the reveal to its copy and nothing here
//! runs or scrolls twice.
//!
//! **Counters** ride `gxStore.sidebarActions.summary` as `slotJump`, whose first line is written at
//! zero: `presses`, `nothing`, `emptyProjects`, `focuses`, `inProcess`, `staged`, `handedToRuntime`,
//! `heldRepeats`, `reveals`, `revealChanges`, `pageTold`, `declinedSource`, `planMaxUs`. A run in
//! which the user pressed cmd+1 with the store's list drawn and `presses` is zero means the key never
//! reached this file; `declinedSource` moving means the old page drew the list and did the jump.
//!
//! SEE-ALSO: packages/gx-core/src/sidebar_view/slot_hotkey.rs,
//! apps/desktop/sidebar/native-sidebar/hotkeys.ts (`runNativeProjectSlotHotkey`),
//! apps/desktop/src/app/gx_store/sidebar_ui_paths.rs, tooling/gx-core/slot-jump-parity.ts.

use std::time::Instant;

use serde_json::{Value, json};

use super::diagnostics::{MAX_SIDEBAR_ACTION_RECORDS, record, routine_logging_enabled};
use crate::GhostexGpuiApp;
use crate::app::sidebar_direct_focus::NativeSidebarClickReaction;

/// What this app run did with the slot hotkeys. Rides `gxStore.sidebarActions.summary`.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub(crate) struct SlotJumpCounters {
    pub(crate) presses: u64,
    /// A slot outside 1 to 9, past the last project, or on a group that is not a project.
    pub(crate) nothing: u64,
    /// A project with no row: its collapse state moved and nothing was selected.
    pub(crate) empty_projects: u64,
    pub(crate) focuses: u64,
    pub(crate) in_process: u64,
    pub(crate) staged: u64,
    /// The click reaction did not apply (a row the drawn snapshot does not hold): the runtime's
    /// `focusSession`, reached through the same `selectSession`, owns the whole selection.
    pub(crate) handed_to_runtime: u64,
    pub(crate) held_repeats: u64,
    pub(crate) reveals: u64,
    /// Changes the reveals made to the sidebar's own state.
    pub(crate) reveal_changes: u64,
    pub(crate) page_told: u64,
    pub(crate) declined_source: u64,
    pub(crate) plan_max_us: u64,
}

#[derive(Default)]
pub(crate) struct SlotJumpHost {
    pub(crate) counters: SlotJumpCounters,
    records: u32,
}

impl GhostexGpuiApp {
    /// A project slot hotkey. Returns whether it was answered here, in which case the message must
    /// NOT also reach the old page, which would select and reveal the row a second time.
    pub(crate) fn gx_store_run_project_slot_hotkey(
        &mut self,
        slot_number: u8,
        cx: &mut gpui::Context<Self>,
    ) -> bool {
        let started = Instant::now();
        // The state half runs in either position of the switch: this app is the only writer of the
        // collapse key.
        let plan = self.gx_store_note_project_slot_hotkey(slot_number, cx);
        let plan_us = started.elapsed().as_micros() as u64;
        if !self.gx_store_sidebar_draws_store_list() {
            self.gx_store.slot_jump.counters.declined_source += 1;
            return false;
        }
        let counters = &mut self.gx_store.slot_jump.counters;
        counters.presses += 1;
        counters.plan_max_us = counters.plan_max_us.max(plan_us);
        let Some(plan) = plan else {
            counters.nothing += 1;
            self.gx_store_slot_jump_ran("nothing", plan_us, 0);
            return true;
        };
        let Some(target) = plan.target_session_id.clone() else {
            counters.empty_projects += 1;
            self.gx_store_slot_jump_ran("emptyProject", plan_us, 0);
            return true;
        };
        let held = self.gx_store_key_is_held();
        let focused = self
            .native_sidebar
            .snapshot
            .clone()
            .and_then(|snapshot| self.gx_store_focused_sidebar_row_id(&snapshot));
        let route = if held && focused.as_deref() == Some(target.as_str()) {
            self.gx_store.slot_jump.counters.held_repeats += 1;
            "heldRepeat"
        } else {
            // Exactly what a row click does, in the click's order.
            self.dispatch_native_sidebar_ui(
                json!({"type": "selectSession", "sessionId": target, "mode": "focus"}),
                cx,
            );
            let reaction = self.react_to_native_sidebar_session_click(&target, cx);
            let counters = &mut self.gx_store.slot_jump.counters;
            counters.focuses += 1;
            match reaction {
                NativeSidebarClickReaction::InProcess => {
                    counters.in_process += 1;
                    "inProcess"
                }
                NativeSidebarClickReaction::Staged => {
                    counters.staged += 1;
                    "staged"
                }
                NativeSidebarClickReaction::NotApplied => {
                    counters.handed_to_runtime += 1;
                    "runtime"
                }
            }
        };
        let mut reveal_us = 0;
        if plan.reveal {
            let started = Instant::now();
            let changes = self.gx_store_apply_sidebar_reveal(&target, cx).unwrap_or(0);
            reveal_us = started.elapsed().as_micros() as u64;
            let counters = &mut self.gx_store.slot_jump.counters;
            counters.reveals += 1;
            counters.reveal_changes += changes as u64;
            if changes > 0 || plan.expand_group {
                self.gx_store_tell_page_slot_reveal(&target, cx);
            }
            self.gx_store_reveal_walk_row(&target);
        }
        cx.notify();
        self.gx_store_slot_jump_ran(route, plan_us, reveal_us);
        true
    }

    /// Hands the old page the reveal it no longer requests itself, so its copy of the collapse
    /// state follows (see the module note). The request id is marked handled first on both Rust
    /// readers of a published reveal request, so the publish that echoes it neither plans the
    /// reveal again nor scrolls a second time.
    fn gx_store_tell_page_slot_reveal(&mut self, target: &str, cx: &mut gpui::Context<Self>) {
        let request_id = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map_or(0, |elapsed| elapsed.as_micros() as u64);
        self.gx_store.sidebar_ui.take_reveal_request(request_id);
        self.native_sidebar.handled_reveal = Some(request_id);
        if self.dispatch_gpui_sidebar_host_message(
            json!({"type": "revealSidebarSession", "sessionId": target, "requestId": request_id}),
            cx,
        ) {
            self.gx_store.slot_jump.counters.page_told += 1;
        }
    }

    /// One line per answered press, while the budget lasts: the route and the two timings, never
    /// a row or project id.
    fn gx_store_slot_jump_ran(&mut self, route: &'static str, plan_us: u64, reveal_us: u64) {
        let host = &mut self.gx_store.slot_jump;
        if host.records >= MAX_SIDEBAR_ACTION_RECORDS || !routine_logging_enabled() {
            return;
        }
        host.records += 1;
        record(
            "gxStore.sidebarSlotJump",
            json!({
                "route": route,
                "planUs": plan_us,
                "revealUs": reveal_us,
                "totals": slot_jump_counters_json(&host.counters),
            }),
        );
    }
}

/// The counters as both records carry them: 13 keys at depth 2.
pub(super) fn slot_jump_counters_json(counters: &SlotJumpCounters) -> Value {
    json!({
        "presses": counters.presses,
        "nothing": counters.nothing,
        "emptyProjects": counters.empty_projects,
        "focuses": counters.focuses,
        "inProcess": counters.in_process,
        "staged": counters.staged,
        "handedToRuntime": counters.handed_to_runtime,
        "heldRepeats": counters.held_repeats,
        "reveals": counters.reveals,
        "revealChanges": counters.reveal_changes,
        "pageTold": counters.page_told,
        "declinedSource": counters.declined_source,
        "planMaxUs": counters.plan_max_us,
    })
}
