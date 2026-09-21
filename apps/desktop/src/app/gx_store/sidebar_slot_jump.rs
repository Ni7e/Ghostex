//! The project slot hotkeys (Jump to Project 1 to 9, cmd+ctrl+1 to cmd+ctrl+9 by default), performed by the store when its list is drawn.
//!
//! CDXC:Hotkeys 2026-09-21 WHY:
//! The jump used to be the old sidebar page's: `gpuiProjectSlotHotkey` went to QuickJS, which
//! resolved the slot against its own projection, posted the row's `focusSession` and asked for a
//! reveal that came back one publish later. With the store's list drawn, the whole jump is planned
//! by gx-core (`project_slot_plan`, then `reveal_plan` against the list the plan's own changes
//! rebuilt) and performed here in the key's frame, and the message is no longer sent at all: the
//! store's list is the only list since M4d part 2 step 6.
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
//! **The old page's copy of the sidebar state** is not drawn any more, but it is still
//! read: the page resolves cmd+1..9 (`focusSessionSlot`) against the list it builds from it. So
//! every intent the jump and its reveal applied is handed to it as a `sidebarUiMirror` message,
//! the value each touched key now holds (gx-core `sidebar_ui_mirror_changes`), which the page sets
//! without revealing, scrolling or focusing.
//!
//! CDXC:Sidebar 2026-09-21 WHY:
//! The first port told the page a `revealSidebarSession` instead, under a request id it marked
//! handled on both Rust readers. That missed the jump's own two deletions (an empty collapsed
//! project, the show-less list flag), and it overwrote the handled id: the page never clears its
//! reveal request, so the PREVIOUS request stayed in every projection, no longer matched the handled
//! id, and ran again (scroll, Space and machine tab, a group the user had collapsed since). The slot
//! path must never write a handled-reveal id and never ask the page to reveal.
//!
//! **Counters** ride `gxStore.sidebarActions.summary` as `slotJump`, whose first line is written at
//! zero: `presses`, `nothing`, `emptyProjects`, `focuses`, `inProcess`, `staged`, `handedToRuntime`,
//! `reveals`, `revealChanges`, `pageTold`, `declinedSource`, `planMaxUs`. `pageTold` counts mirror
//! messages, one per press that changed the sidebar's state. A run in
//! which the user pressed cmd+ctrl+1 with the store's list drawn and `presses` is zero means the key never
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
        let draws_store_list = self.gx_store_sidebar_list_ready();
        // Nothing is mirrored while the list is not ready: the jump is not performed either.
        if draws_store_list {
            self.gx_store.sidebar_ui.mirror = Some(Vec::new());
        }
        // The state half runs even then: this app is the only writer of the collapse key, so a
        // jump whose focus and reveal are dropped must still store what it moved.
        let plan = self.gx_store_note_project_slot_hotkey(slot_number, cx);
        let plan_us = started.elapsed().as_micros() as u64;
        if !draws_store_list {
            self.gx_store.slot_jump.counters.declined_source += 1;
            return false;
        }
        let (route, reveal_us) = self.gx_store_perform_project_slot_jump(plan, cx);
        let counters = &mut self.gx_store.slot_jump.counters;
        counters.presses += 1;
        counters.plan_max_us = counters.plan_max_us.max(plan_us);
        self.gx_store_mirror_slot_jump_to_page(cx);
        cx.notify();
        self.gx_store_slot_jump_ran(route, plan_us, reveal_us);
        true
    }

    /// The focus and the reveal of a planned jump, whose state intents are already applied.
    /// Returns the route and the reveal's time.
    fn gx_store_perform_project_slot_jump(
        &mut self,
        plan: Option<ghostex_gx_core::ProjectSlotPlan>,
        cx: &mut gpui::Context<Self>,
    ) -> (&'static str, u64) {
        let Some(plan) = plan else {
            self.gx_store.slot_jump.counters.nothing += 1;
            return ("nothing", 0);
        };
        let Some(target) = plan.target_session_id.clone() else {
            self.gx_store.slot_jump.counters.empty_projects += 1;
            return ("emptyProject", 0);
        };
        let (reaction, reveal) = self.gx_store_focus_and_reveal_slot_row(&target, plan.reveal, cx);
        let counters = &mut self.gx_store.slot_jump.counters;
        counters.focuses += 1;
        let route = match reaction {
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
        };
        let mut reveal_us = 0;
        if let Some((changes, us)) = reveal {
            reveal_us = us;
            counters.reveals += 1;
            counters.reveal_changes += changes as u64;
        }
        (route, reveal_us)
    }

    /// Focuses a row exactly as a click on it does, in the click's order, and reveals it when asked.
    /// Shared by both slot hotkeys (this file and `sidebar_session_slot.rs`). Returns the click's
    /// reaction and, for a reveal, the changes it made to the sidebar's own state and its time.
    ///
    /// The focus is the row click's `selectSession` (which also reaches the remote row machinery of
    /// `gx_store/sidebar_remote_focus.rs` for a row on another machine) and then the click's own
    /// reaction. The reveal is `gx_store_apply_sidebar_reveal`, the one a published request ends in,
    /// and the walk's scroll.
    pub(super) fn gx_store_focus_and_reveal_slot_row(
        &mut self,
        target: &str,
        reveal: bool,
        cx: &mut gpui::Context<Self>,
    ) -> (NativeSidebarClickReaction, Option<(usize, u64)>) {
        self.dispatch_native_sidebar_ui(
            json!({"type": "selectSession", "sessionId": target, "mode": "focus"}),
            cx,
        );
        let reaction = self.react_to_native_sidebar_session_click(target, cx);
        if !reveal {
            return (reaction, None);
        }
        let started = Instant::now();
        let changes = self.gx_store_apply_sidebar_reveal(target, cx).unwrap_or(0);
        let reveal_us = started.elapsed().as_micros() as u64;
        self.gx_store_reveal_walk_row(target);
        (reaction, Some((changes, reveal_us)))
    }

    /// Hands the old page what the jump and its reveal changed (see the module note), and stops
    /// collecting. Sends nothing when nothing changed.
    fn gx_store_mirror_slot_jump_to_page(&mut self, cx: &mut gpui::Context<Self>) {
        if self.gx_store_mirror_sidebar_ui_to_page(cx) {
            self.gx_store.slot_jump.counters.page_told += 1;
        }
    }

    /// Sends the old page the collected mirror changes and stops collecting. Returns whether a
    /// message went out; nothing is sent when nothing changed.
    pub(super) fn gx_store_mirror_sidebar_ui_to_page(
        &mut self,
        cx: &mut gpui::Context<Self>,
    ) -> bool {
        let changes = self.gx_store.sidebar_ui.mirror.take().unwrap_or_default();
        !changes.is_empty()
            && self.dispatch_gpui_sidebar_host_message(
                json!({"type": "sidebarUiMirror", "changes": changes}),
                cx,
            )
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

/// The counters as both records carry them: 12 keys at depth 2.
pub(super) fn slot_jump_counters_json(counters: &SlotJumpCounters) -> Value {
    json!({
        "presses": counters.presses,
        "nothing": counters.nothing,
        "emptyProjects": counters.empty_projects,
        "focuses": counters.focuses,
        "inProcess": counters.in_process,
        "staged": counters.staged,
        "handedToRuntime": counters.handed_to_runtime,
        "reveals": counters.reveals,
        "revealChanges": counters.reveal_changes,
        "pageTold": counters.page_told,
        "declinedSource": counters.declined_source,
        "planMaxUs": counters.plan_max_us,
    })
}
