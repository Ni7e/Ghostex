//! What follows a local selection once the user stops moving: the old runtime is told once, and
//! the heavy work of showing a tab runs for the tab the user landed on.

use std::time::{Duration, Instant};

use futures::channel::mpsc;
use futures::{FutureExt as _, StreamExt as _};

use super::local_focus::{FocusEchoKind, PendingTell, ToldSelection};
use crate::GhostexGpuiApp;
use crate::app::consts::{
    GPUI_SIDEBAR_WORKSPACE_SESSION_ATTENTION_ACKNOWLEDGE_MESSAGE_TYPE,
    GPUI_SIDEBAR_WORKSPACE_SESSION_ATTENTION_ACKNOWLEDGE_MESSAGE_VERSION,
    GPUI_SIDEBAR_WORKSPACE_TAB_SESSION_SELECTED_MESSAGE_TYPE,
    GPUI_SIDEBAR_WORKSPACE_TAB_SESSION_SELECTED_MESSAGE_VERSION,
};
use crate::app::helpers::{
    gpui_status_bridge_id_allowed, gpui_workspace_session_attention_acknowledge_script,
    gpui_workspace_tab_session_selected_script,
};
use crate::app::model::GpuiLocalWorkspaceSessionKey;
use crate::support_logs;

/// The old runtime is told this long after the last local selection or attention acknowledge.
const TELL_DELAY: Duration = Duration::from_millis(120);
/// Heavy work waits until the selection has not moved for this long.
const SETTLE_DELAY: Duration = Duration::from_millis(80);
/// A selection this long after the previous one starts a new gesture and is shown in full at
/// once. Key repeat runs at 30 to 60 milliseconds, far inside it; a click or a single key press
/// is outside it.
const BURST_GAP: Duration = Duration::from_millis(250);
/// How long the old runtime has to echo the stamp of a tell before the tell is sent again, and
/// how often that is tried.
const RETELL_DELAY: Duration = Duration::from_millis(1500);
const MAX_RETELLS: u8 = 3;
/// Most remembered sessions one tell carries.
const MAX_REMEMBERED_PER_TELL: usize = 16;

impl GhostexGpuiApp {
    /// Whether heavy per-selection work is held back right now: mounting and attaching a terminal
    /// viewer, releasing the viewers of tabs that went out of view, creating or reconciling chat
    /// surfaces, and reporting the displayed sessions. Terminals that are already mounted and chat
    /// views that already exist are drawn regardless.
    pub(crate) fn gx_store_selection_is_settling(&self) -> bool {
        self.gx_store.local_focus.settle_due.is_some()
    }

    /// Books a local selection into the burst clock and makes sure the task that ends the burst
    /// runs. `moved` is false when the same session was selected again (an attach completion
    /// repeating the click's selection), which never starts or prolongs a settle.
    pub(super) fn gx_store_note_local_selection(
        &mut self,
        moved: bool,
        cx: &mut gpui::Context<Self>,
    ) {
        let now = Instant::now();
        let local_focus = &mut self.gx_store.local_focus;
        if moved {
            // A key repeat is inside a burst by definition: only the first press of a hold is an
            // isolated selection, whatever the platform's delay before the first repeat.
            let in_burst = local_focus.key_held
                || local_focus
                    .last_selection_at
                    .is_some_and(|previous| now.duration_since(previous) < BURST_GAP);
            local_focus.last_selection_at = Some(now);
            if in_burst {
                local_focus.burst_steps += 1;
                local_focus.settle_due = Some(now + SETTLE_DELAY);
            } else if local_focus.settle_due.is_none() {
                local_focus.burst_steps = 1;
            }
        }
        local_focus.tell_due = Some(now + TELL_DELAY);
        self.gx_store_burst_deadline_booked(cx);
    }

    /// The attention of a session the user is looking at is acknowledged with the next tell.
    pub(crate) fn gx_store_queue_attention_acknowledge(
        &mut self,
        key: GpuiLocalWorkspaceSessionKey,
        cx: &mut gpui::Context<Self>,
    ) {
        let local_focus = &mut self.gx_store.local_focus;
        if !local_focus.pending_attention.contains(&key) {
            local_focus.pending_attention.push(key);
        }
        if local_focus.tell_due.is_none() {
            local_focus.tell_due = Some(Instant::now() + TELL_DELAY);
        }
        self.gx_store_burst_deadline_booked(cx);
    }

    /// The Browser tab a held key landed on gets its CEF surface when the selection settles.
    pub(crate) fn gx_store_defer_browser_surface(&mut self, cx: &mut gpui::Context<Self>) {
        let local_focus = &mut self.gx_store.local_focus;
        local_focus.browser_surface_wanted = true;
        local_focus.settle_due = Some(Instant::now() + SETTLE_DELAY);
        self.gx_store_burst_deadline_booked(cx);
    }

    /// Chat surfaces are reconciled when the selection settles.
    pub(crate) fn gx_store_defer_chat_reconcile(&mut self) {
        self.gx_store.local_focus.chat_reconcile_wanted = true;
    }

    /// A deadline (settle, tell, or the check that the tell was heard) was booked or moved: make
    /// sure the one task that serves them runs, and that it is not asleep past the new deadline.
    /// Every place that sets one of the three deadlines calls this afterwards.
    ///
    /// CDXC:FocusRouting 2026-09-19 WHY:
    /// The task used to sleep until the nearest deadline it knew when it went to sleep. Once every tell booked a check 1.5 s ahead, a settle (80 ms) or tell (120 ms) booked while the task slept towards that check was served only when the check woke it: a landing tab stayed unmounted and its terminal parked for up to 1.2 s after a short hold.
    /// Why every booking is now served on time. The task records the instant it sleeps towards (`burst_sleeping_until`, `None` while it is awake or not running) and sleeps on "timer or wake message, whichever comes first". (1) When it goes to sleep, that instant is the minimum of all three deadlines, so none is earlier. (2) A booking made while it sleeps runs this function: a deadline earlier than the recorded instant sends a wake message, the task wakes on its next executor turn, runs what is due and recomputes the minimum; a deadline at or after the recorded instant needs nothing, because the task wakes at the recorded instant, before it, and recomputes then. (3) A deadline that is only pushed later or cleared never needs a wake: waking early is harmless, the turn finds nothing due and sleeps again. (4) A booking made while the task is awake can only happen inside the task's own turn (one UI thread), before that turn computes the minimum, so it is included; a wake message it may have sent costs one empty turn. (5) With no task running, this function starts one, whose first turn computes the minimum immediately. So a deadline `D` booked at any moment is served at `D` plus executor latency and the 1 ms floor below.
    /// It cannot spin: a turn either clears a due deadline or sleeps, a wake message is sent at most once per booking, and bookings come from user input, a tell, or a bounded retell. It ends when all three deadlines are clear or the app entity is gone.
    fn gx_store_burst_deadline_booked(&mut self, cx: &mut gpui::Context<Self>) {
        let local_focus = &mut self.gx_store.local_focus;
        if local_focus.burst_task_running {
            let earliest = [
                local_focus.settle_due,
                local_focus.tell_due,
                local_focus.retell_due,
            ]
            .into_iter()
            .flatten()
            .min();
            if let (Some(earliest), Some(sleeping_until), Some(wake)) = (
                earliest,
                local_focus.burst_sleeping_until,
                local_focus.burst_wake.as_ref(),
            ) && earliest < sleeping_until
            {
                // The turn this wakes records a new instant; until then further bookings need no
                // second message.
                local_focus.burst_sleeping_until = None;
                let _ = wake.unbounded_send(());
            }
            return;
        }
        local_focus.burst_task_running = true;
        let (wake, mut wakes) = mpsc::unbounded::<()>();
        local_focus.burst_wake = Some(wake);
        cx.spawn(async move |this, cx| {
            loop {
                let wait = this.update(cx, |this, cx| this.gx_store_run_due_burst_work(cx));
                let Ok(Some(wait)) = wait else {
                    return;
                };
                let mut timer = cx.background_executor().timer(wait).fuse();
                let mut woken = wakes.next().fuse();
                futures::select_biased! {
                    _ = woken => {}
                    _ = timer => {}
                }
            }
        })
        .detach();
    }

    /// Performs what is due and returns how long to sleep, or `None` when nothing is pending.
    fn gx_store_run_due_burst_work(&mut self, cx: &mut gpui::Context<Self>) -> Option<Duration> {
        // Awake: bookings made during this turn are seen by the minimum computed at its end.
        self.gx_store.local_focus.burst_sleeping_until = None;
        let now = Instant::now();
        if self
            .gx_store
            .local_focus
            .settle_due
            .is_some_and(|due| due <= now)
        {
            self.gx_store_selection_settled(cx);
        }
        if self
            .gx_store
            .local_focus
            .tell_due
            .is_some_and(|due| due <= now)
        {
            self.gx_store_flush_old_runtime_tell(cx);
        }
        if self
            .gx_store
            .local_focus
            .retell_due
            .is_some_and(|due| due <= now)
        {
            self.gx_store_retell_old_runtime(cx);
        }
        let local_focus = &mut self.gx_store.local_focus;
        let next_due = [
            local_focus.settle_due,
            local_focus.tell_due,
            local_focus.retell_due,
        ]
        .into_iter()
        .flatten()
        .min();
        let Some(next_due) = next_due else {
            local_focus.burst_task_running = false;
            local_focus.burst_wake = None;
            return None;
        };
        // Never zero, so a deadline that is due "now" cannot turn the loop into a busy wait.
        let wait = next_due
            .saturating_duration_since(Instant::now())
            .max(Duration::from_millis(1));
        local_focus.burst_sleeping_until = Some(Instant::now() + wait);
        Some(wait)
    }

    /// The selection has been stable: do the work that was held back, for the tab in front now.
    fn gx_store_selection_settled(&mut self, cx: &mut gpui::Context<Self>) {
        let local_focus = &mut self.gx_store.local_focus;
        local_focus.settle_due = None;
        local_focus.counters.settles += 1;
        let steps = std::mem::take(&mut local_focus.burst_steps);
        let chat_reconcile = std::mem::take(&mut local_focus.chat_reconcile_wanted);
        if chat_reconcile {
            self.reconcile_agents_chat_surfaces(cx);
        }
        self.gx_store_attach_surfaced_terminals(cx);
        if std::mem::take(&mut self.gx_store.local_focus.browser_surface_wanted)
            && self.active_mode == crate::app::model::TitlebarMode::Browser
        {
            // What a single press does at once (`sync_active_browser_tab_to_surface`), for the
            // tab in front now.
            self.ensure_browser_surface_for_pane(self.browser_tabs.focused_pane, cx);
            self.update_active_mode_cef_child_visibility(cx);
        }
        let (walk_reveal, walk_ask) = self.gx_store_take_walk_landing();
        if let Some(row_id) = walk_reveal {
            self.native_sidebar.pending_reveal = Some(
                crate::app::native_sidebar::model::NativeSidebarRevealRequest {
                    session_id: row_id,
                    request_id: 0,
                },
            );
        }
        if let Some(row_id) = walk_ask {
            // The row the held key landed on has a staged tab and no terminal. The runtime still
            // owns wake and attach, and is asked for this one row, as a click would have.
            if let Some(key) = crate::app::helpers::gpui_combined_presentation_session_key(&row_id)
            {
                self.gx_store_expect_request_after_tell(&key);
            }
            self.dispatch_native_sidebar_ui(
                serde_json::json!({"type": "selectSession", "sessionId": row_id, "mode": "focus"}),
                cx,
            );
        }
        let counters = self.gx_store.local_focus.counters;
        support_logs::append(
            support_logs::GpuiSupportLog::TerminalFocus,
            "gpui.terminalFocus.tabBurstSettled",
            serde_json::json!({
                "steps": steps,
                "chatReconciled": chat_reconcile,
                "localStamp": self.gx_store.core.focus().local_stamp,
                "confirmedStamp": self.gx_store.local_focus.confirmed_stamp,
                "localSelections": counters.local_selections,
                "unplacedSelections": counters.unplaced_selections,
                "tells": counters.tells,
                "attentionAcknowledges": counters.attention_acknowledges,
                "stalePayloads": counters.stale_payloads,
                "staleProjectContexts": counters.stale_project_contexts,
                "staleFocusRequestsDropped": counters.stale_focus_requests_dropped,
                "settles": counters.settles,
            }),
        );
        // The render that follows mounts the terminal viewer of the active tab, releases the
        // viewers that went out of view, and reports the displayed sessions.
        cx.notify();
    }

    /// A restored Running tab with no terminal behind it is attached once it is in front.
    ///
    /// CDXC:FocusRouting 2026-09-19 WHY:
    /// The old runtime used to answer a `localRuntimeMissing` tab selection with a focus request that re-entered the attach path (2026-07-11), one bridge round trip per selected tab. The surfaced-restore attach already attaches exactly the tabs that are active in a rendered pane, Running, and without a terminal, and it re-checks all three when its plan returns, so a tab the user only passed through is never attached. The tell still carries the flags, because the old runtime's reply also covers a tab that is sleeping locally while the daemon reports it running.
    pub(super) fn gx_store_attach_surfaced_terminals(&mut self, cx: &mut gpui::Context<Self>) {
        // Before the old runtime's first tab list the restored tabs have not been checked against
        // the daemon, and that first payload runs this same pass itself.
        if self
            .sidebar_gxserver_presentation_focus_state
            .active_project_tab_sessions
            .is_none()
        {
            return;
        }
        let focus_state = self.sidebar_gxserver_presentation_focus_state.clone();
        self.attach_surfaced_local_workspace_terminals(&focus_state, cx);
    }

    /// Tells the old runtime the newest local selection and the pending attention acknowledges,
    /// now. Runs when the tell deadline passes, and before anything else is sent to the old
    /// runtime that it could answer with a focus change (a sidebar command, a remote selection),
    /// so it never handles such a message while holding an older stamp.
    pub(crate) fn gx_store_flush_old_runtime_tell(&mut self, cx: &mut gpui::Context<Self>) {
        self.gx_store_send_old_runtime_tell(false, cx);
    }

    /// The old runtime has not echoed the stamp of the last tell.
    ///
    /// CDXC:FocusRouting 2026-09-19 WHY:
    /// Every focus payload of the old runtime is judged by the stamp it echoes, so a tell that never took effect (rejected by the runtime's contract check, or lost) would leave all of them stale until the next selection, and with them every project switch and focus change the runtime originates. The tell is sent again, with the stamp current at that moment, at most `MAX_RETELLS` times `RETELL_DELAY` apart; after that the divergence is logged and the next selection's tell is the next attempt. A newer tell that is already pending takes over instead.
    fn gx_store_retell_old_runtime(&mut self, cx: &mut gpui::Context<Self>) {
        let local_focus = &mut self.gx_store.local_focus;
        local_focus.retell_due = None;
        let Some(told) = local_focus.last_tell.clone() else {
            return;
        };
        // While a remote session (or another row the store does not hold) has focus, telling the
        // runtime the last local selection again would pull its focus back to it.
        if local_focus.confirmed_stamp >= told.stamp
            || local_focus.pending_tell.is_some()
            || local_focus.foreign_focus
        {
            return;
        }
        let attempt = local_focus.retell_attempts + 1;
        let confirmed_stamp = local_focus.confirmed_stamp;
        if attempt > MAX_RETELLS {
            support_logs::append(
                support_logs::GpuiSupportLog::TerminalFocus,
                "gpui.terminalFocus.oldRuntimeTellUnconfirmed",
                serde_json::json!({
                    "toldStamp": told.stamp,
                    "confirmedStamp": confirmed_stamp,
                    "attempts": MAX_RETELLS,
                }),
            );
            return;
        }
        local_focus.retell_attempts = attempt;
        local_focus.pending_tell = Some(PendingTell {
            key: told.key,
            local_was_sleeping: false,
            local_runtime_missing: false,
        });
        support_logs::append(
            support_logs::GpuiSupportLog::TerminalFocus,
            "gpui.terminalFocus.oldRuntimeRetold",
            serde_json::json!({
                "attempt": attempt,
                "toldStamp": told.stamp,
                "confirmedStamp": confirmed_stamp,
            }),
        );
        self.gx_store_send_old_runtime_tell(true, cx);
    }

    fn gx_store_send_old_runtime_tell(&mut self, retell: bool, cx: &mut gpui::Context<Self>) {
        let local_focus = &mut self.gx_store.local_focus;
        local_focus.tell_due = None;
        if local_focus.pending_tell.is_none() && local_focus.pending_attention.is_empty() {
            // Called before every message to the old runtime; usually there is nothing to say.
            return;
        }
        self.gx_store_persist_focus_state_file();
        // Without the service nothing is taken: the selection stays pending and goes out with the
        // next flush, so the runtime is never left without the newest stamp.
        let Some(sidebar) = self.sidebar.clone() else {
            return;
        };
        let local_focus = &mut self.gx_store.local_focus;
        let pending_tell = local_focus.pending_tell.take();
        let pending_attention = std::mem::take(&mut local_focus.pending_attention);
        let visible_session_ids = self.gpui_sidebar_visible_local_session_ids();
        let mut scripts = Vec::new();
        for key in pending_attention {
            // A tab the user only passed through is not acknowledged: acknowledging means the
            // user saw it, and what the user sees is what is in front of a pane now.
            if !self.gx_store_session_is_in_front(&key) {
                continue;
            }
            scripts.push(gpui_workspace_session_attention_acknowledge_script(
                &serde_json::json!({
                    "projectId": key.project_id,
                    "sessionId": key.session_id,
                    "type": GPUI_SIDEBAR_WORKSPACE_SESSION_ATTENTION_ACKNOWLEDGE_MESSAGE_TYPE,
                    "version": GPUI_SIDEBAR_WORKSPACE_SESSION_ATTENTION_ACKNOWLEDGE_MESSAGE_VERSION,
                }),
            ));
            self.gx_store.local_focus.counters.attention_acknowledges += 1;
        }
        let told = pending_tell.is_some();
        if let Some(tell) = pending_tell {
            let stamp = self.gx_store.core.focus().local_stamp;
            let mut visible_session_ids = visible_session_ids;
            if !visible_session_ids.contains(&tell.key.session_id) {
                visible_session_ids.push(tell.key.session_id.clone());
            }
            let remembered = std::mem::take(&mut self.gx_store.local_focus.pending_remembered)
                .into_iter()
                .filter(|session| {
                    // The tell itself makes the old runtime remember its own session.
                    session.project_id != tell.key.project_id
                        && gpui_status_bridge_id_allowed(&session.project_id)
                        && gpui_status_bridge_id_allowed(&session.session_id)
                })
                .take(MAX_REMEMBERED_PER_TELL)
                .map(|session| {
                    serde_json::json!({
                        "projectId": session.project_id,
                        "sessionId": session.session_id,
                    })
                })
                .collect::<Vec<_>>();
            let mut message = serde_json::json!({
                "focusStamp": stamp,
                "projectId": tell.key.project_id,
                "sessionId": tell.key.session_id,
                "type": GPUI_SIDEBAR_WORKSPACE_TAB_SESSION_SELECTED_MESSAGE_TYPE,
                "version": GPUI_SIDEBAR_WORKSPACE_TAB_SESSION_SELECTED_MESSAGE_VERSION,
                "visibleSessionIds": visible_session_ids,
            });
            if tell.local_was_sleeping {
                message["localWasSleeping"] = serde_json::Value::Bool(true);
            }
            if tell.local_runtime_missing {
                message["localRuntimeMissing"] = serde_json::Value::Bool(true);
            }
            if !remembered.is_empty() {
                message["rememberedSessions"] = serde_json::Value::Array(remembered);
            }
            scripts.push(gpui_workspace_tab_session_selected_script(&message));
            let local_focus = &mut self.gx_store.local_focus;
            local_focus.counters.tells += 1;
            if tell.local_was_sleeping || tell.local_runtime_missing {
                // The old runtime may answer these flags with one focus request for the session.
                local_focus.expect_focus_echo(tell.key.clone(), stamp, FocusEchoKind::TellReply);
            }
            local_focus.last_tell = Some(ToldSelection {
                key: tell.key,
                stamp,
            });
            if !retell {
                local_focus.retell_attempts = 0;
            }
            local_focus.retell_due = Some(Instant::now() + RETELL_DELAY);
            support_logs::append(
                support_logs::GpuiSupportLog::TerminalFocus,
                "gpui.terminalFocus.oldRuntimeTold",
                serde_json::json!({
                    "focusStamp": stamp,
                    "tells": local_focus.counters.tells,
                    "localSelections": local_focus.counters.local_selections,
                }),
            );
        }
        if !scripts.is_empty() {
            sidebar.update(cx, |service, _| {
                for script in &scripts {
                    service.execute_app_owned_script(script);
                }
            });
        }
        if told {
            // The task also watches for the echo of this tell; a flush from outside a burst (before
            // a sidebar command) has none running.
            self.gx_store_burst_deadline_booked(cx);
            // The old runtime's echo of a selection used to reach two more readers of the focused
            // session. The echo now repeats what the app already holds and changes nothing, so
            // they hear about the selection here, once per burst.
            self.refresh_sidebar_gxserver_bootstrap_if_changed(cx);
            self.broadcast_extension_context_changes(cx);
        }
    }

    /// Whether a session is the active tab of a rendered Agents pane or fills a companion slot.
    fn gx_store_session_is_in_front(&self, key: &GpuiLocalWorkspaceSessionKey) -> bool {
        let Some(shell_session_id) = self.local_workspace_session_mappings.get(key).copied() else {
            return false;
        };
        self.agents_workspace
            .rendered_leaf_order()
            .into_iter()
            .any(|pane_id| {
                self.agents_workspace.active_session_in_pane(pane_id) == Some(shell_session_id)
            })
            || self
                .current_project_editor_companion_terminal_body_mount_slots()
                .iter()
                .any(|slot_id| slot_id.session_id == shell_session_id)
    }

    /// One line per next or previous tab step while the `native.terminal.focus` scenario is on:
    /// the time from the hotkey handler's entry to the repaint request, and whether the heavy
    /// work of this step waits for the selection to settle.
    pub(crate) fn gx_store_log_tab_step(&self, started: Instant, reverse: bool) {
        let local_focus = &self.gx_store.local_focus;
        let (layout_marks, layout_serializations) = self.gx_store.layout_persist.counters();
        support_logs::append(
            support_logs::GpuiSupportLog::TerminalFocus,
            "gpui.terminalFocus.tabStep",
            serde_json::json!({
                "elapsedUs": started.elapsed().as_micros() as u64,
                "heavyWorkDeferred": local_focus.settle_due.is_some(),
                "burstStep": local_focus.burst_steps,
                "tellPending": local_focus.pending_tell.is_some(),
                "reverse": reverse,
                "localStamp": self.gx_store.core.focus().local_stamp,
                "confirmedStamp": local_focus.confirmed_stamp,
                "tells": local_focus.counters.tells,
                "layoutMarks": layout_marks,
                "layoutSerializations": layout_serializations,
            }),
        );
    }
}
