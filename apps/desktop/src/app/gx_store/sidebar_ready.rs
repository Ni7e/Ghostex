//! Whether the drawn list is the real one, and what happens when one of the two things it waits
//! for never arrives.
//!
//! CDXC:Sidebar 2026-09-21 WHY:
//! The list waits for two legs: the sidebar's own state read back from client storage (collapse,
//! Space, filters, hidden items), and the HUD the QuickJS runtime posts on the facts channel. Until
//! both land the renderer draws the loading skeleton and every command that arrives is dropped
//! (`gx_store_drop_sidebar_command_before_ready`). That was written as a launch-window wait of a
//! few hundred milliseconds, and it had no end: if the runtime's service throws before
//! `runtime.start()` (`sidebar/service/service.ts`) the HUD is never posted, and the sidebar stays a
//! skeleton with every click counted and thrown away, for the life of the app, with nothing on
//! screen saying why.
//!
//! **The list does not depend on either leg to DRAW, and that is the fix rather than a fallback.**
//! The rows, their order, the sections, the Spaces, the collections, the machine tabs and every
//! setting the view model reads come from the store and from the settings file
//! (`SidebarInputs::settings`), not from the HUD. What the HUD really carries is Recent Projects
//! (`refresh_recent_projects`), the agent list and the Saved Actions the MENUS read, and the
//! `hud.settings.*` block the renderer reads for appearance (project icons, diff stats, tooltip
//! delay, the double-click behaviours). Every one of those readers indexes a `serde_json::Value`
//! and falls back on its own default, so an empty HUD object draws the real list with the built-in
//! appearance and an empty launcher instead of drawing nothing at all.
//!
//! So after `RECOVERY_WAIT` the missing leg is declared absent, the real list is drawn, and an
//! UNCONDITIONAL error line names which leg it was. Nothing is hidden: the line is written whatever
//! the diagnostic settings say, and `gxStore.sidebarList.summary` carries `recoveredHud` and
//! `recoveredState` for the rest of the run.
//!
//! The state leg keeps its own retry for ever (`gx_store_schedule_sidebar_ui_read_retry`), and
//! recovering it changes only what is DRAWN: `restored` stays false, so
//! `gx_store_schedule_sidebar_ui_write` still refuses to write, and a click made meanwhile is
//! queued and replayed on top of the stored state if a read ever succeeds. The rule that this app
//! never writes a document it has not read is untouched.
//!
//! SEE-ALSO: apps/desktop/src/app/gx_store/sidebar_list.rs,
//! apps/desktop/src/app/gx_store/sidebar_ui.rs.

use std::time::{Duration, Instant};

use serde_json::{Value, json};

use super::diagnostics::GxStoreDiagnostics;
use crate::GhostexGpuiApp;

/// How long a leg may be missing before the list is drawn without it. Long enough that a cold
/// launch on a busy computer never reaches it (both legs land in the first hundreds of
/// milliseconds, and the HUD waits on the QuickJS service booting and gxserver answering) and short
/// enough that the user is not left deciding the app is broken. Overshooting is cheap: a leg that
/// arrives after the recovery takes over at once, because the real value is always preferred.
const RECOVERY_WAIT: Duration = Duration::from_secs(8);

/// The two legs the list waits for, and whether each one was given up on. A flag stays set for the
/// rest of the run as the record that it happened, even once the leg arrives.
#[derive(Default)]
pub(super) struct SidebarReadyRecovery {
    /// When the wait started: the store's bootstrap, where the once-a-second tick is started.
    started_at: Option<Instant>,
    /// The HUD never arrived and the list is drawn with an empty one.
    pub(super) hud: bool,
    /// The client-storage read never succeeded and the list is drawn on the default sidebar state.
    /// Writes stay blocked.
    pub(super) state: bool,
}

impl SidebarReadyRecovery {
    pub(super) fn start(&mut self) {
        self.started_at.get_or_insert_with(Instant::now);
    }

    fn waited(&self) -> Option<Duration> {
        self.started_at.map(|started| started.elapsed())
    }
}

impl GhostexGpuiApp {
    /// Whether the drawn list is the real one, so a command that names a row has something to name
    /// and an install is worth making.
    ///
    /// CDXC:Sidebar 2026-09-21 WHY:
    /// False only in the first instants of a launch, and for exactly two reasons: the sidebar's own
    /// state has not been read back from client storage yet, so the real list would open every
    /// project and hide nothing and then snap; and the runtime has not posted the HUD yet, so the
    /// agent launcher, the Saved Actions and every `hud.settings.*` the renderer reads would be
    /// empty. Until both land the renderer draws the loading skeleton
    /// (`gx_store_install_loading_sidebar_list`) and `dispatch_native_sidebar_ui` drops what
    /// arrives, counted rather than routed to nobody. A leg that is still missing after
    /// `RECOVERY_WAIT` is declared absent by `gx_store_check_sidebar_ready_recovery` and stops
    /// holding the gate shut, because the skeleton had no other way out.
    ///
    /// A machine tab the host does not feed (no client, no last-seen copy) is NOT one of them any
    /// more: its list is empty because that machine really has no rows, and an empty list with its
    /// own empty state is the honest answer. Before step 6 that case kept the old projection's copy.
    pub(crate) fn gx_store_sidebar_list_ready(&self) -> bool {
        let recovery = self.gx_store.sidebar_list.ready_recovery();
        (self.gx_store.sidebar_ui.restored() || recovery.state)
            && (self.gx_store.runtime_facts.hud().is_some() || recovery.hud)
    }

    /// The HUD the installed list carries, which is an empty object once the HUD leg was given up
    /// on. Every reader of it indexes and defaults, so an empty one is the built-in appearance and
    /// an empty launcher rather than a list that is not drawn.
    pub(super) fn gx_store_sidebar_hud(&self) -> Option<Value> {
        match self.gx_store.runtime_facts.hud() {
            Some(hud) => Some(hud.clone()),
            None => self
                .gx_store
                .sidebar_list
                .ready_recovery()
                .hud
                .then(|| json!({})),
        }
    }

    /// Declares a leg absent once it has been missing for `RECOVERY_WAIT`, so the list is drawn.
    /// Rides the sidebar's once-a-second tick, which runs for the life of the app.
    pub(super) fn gx_store_check_sidebar_ready_recovery(&mut self, cx: &mut gpui::Context<Self>) {
        if self.gx_store_sidebar_list_ready() {
            return;
        }
        let Some(waited) = self.gx_store.sidebar_list.ready_recovery().waited() else {
            return;
        };
        if waited < RECOVERY_WAIT {
            return;
        }
        let hud_missing = self.gx_store.runtime_facts.hud().is_none();
        let state_missing = !self.gx_store.sidebar_ui.restored();
        let read_failures = self.gx_store.sidebar_ui.counters.read_failures;
        let read_error = self.gx_store.sidebar_ui.last_error();
        let hud_posts = self.gx_store.runtime_facts.counters().hud_posts;
        {
            let recovery = self.gx_store.sidebar_list.ready_recovery_mut();
            recovery.hud |= hud_missing;
            recovery.state |= state_missing;
        }
        self.gx_store.diagnostics.sidebar_ready_recovered(
            hud_missing,
            state_missing,
            waited.as_millis() as u64,
            read_failures,
            read_error,
            hud_posts,
        );
        // The skeleton is standing and nothing else is about to move the list, so the rebuild and
        // the install are asked for here.
        self.gx_store_sidebar_state_changed(cx);
    }
}

impl GxStoreDiagnostics {
    /// The one line that says the sidebar is drawn without a leg it was waiting for.
    /// UNCONDITIONAL, in the support log's important-diagnostic sense: the event name ends in
    /// `.error`, so neither "Show debug UI controls" nor a scenario gates it. Names the LEG and
    /// counts only, never a row, a project or a path.
    pub(super) fn sidebar_ready_recovered(
        &mut self,
        hud_missing: bool,
        state_missing: bool,
        waited_ms: u64,
        read_failures: u64,
        read_error: Option<&'static str>,
        hud_posts: u64,
    ) {
        self.warning(
            "gxStore.sidebarList.legMissing.error",
            json!({
                // The runtime never posted the sidebar HUD: its service threw before
                // `runtime.start()`, or the facts channel is not connected.
                "hudMissing": hud_missing,
                // Client storage never answered with the sidebar's own state. The list is drawn on
                // defaults and no write is made until a read succeeds.
                "stateMissing": state_missing,
                "waitedMs": waited_ms,
                "readFailures": read_failures,
                "readError": read_error,
                "hudPosts": hud_posts,
            }),
        );
    }
}
