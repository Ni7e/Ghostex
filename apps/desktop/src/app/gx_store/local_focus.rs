//! Local focus: a tab selection, a next or previous tab step, and a sidebar row click change the
//! store at once. This file holds what the rest of the app calls: the selection entry, the row
//! highlight, and the admission of the old runtime's focus payloads. `burst.rs` owns the timers
//! that tell the old runtime and release deferred work.

use std::time::{Duration, Instant};

use ghostex_gx_core::{
    Event, IgnoredReason, Intent, Loadable, MachineId, ProjectKey, SessionKey,
    default_group_for_project,
};

use super::host::{GxStoreHost, now_ms};
use crate::GhostexGpuiApp;
use crate::app::helpers::GpuiGxserverPresentationFocusEcho;
use crate::app::model::{
    GpuiGxserverPresentationFocusState, GpuiLocalWorkspaceSessionKey, GpuiPreferredAgentInterface,
    GpuiSidebarWorkspaceTerminalFocusMessage, GpuiWorkspaceTerminalFocusPlacement,
    ShellFocusTarget, TitlebarMode,
};
use crate::support_logs;

/// Sidebar row ids of local sessions start with this (`SessionKey::to_sidebar_session_id`).
const LOCAL_SESSION_ROW_PREFIX: &str = "combined-session:";

/// A local selection the old runtime has not been told about yet.
#[derive(Clone, Debug)]
pub(super) struct PendingTell {
    pub(super) key: GpuiLocalWorkspaceSessionKey,
    pub(super) local_was_sleeping: bool,
    pub(super) local_runtime_missing: bool,
}

/// The last selection the old runtime was told.
#[derive(Clone, Debug)]
pub(super) struct ToldSelection {
    pub(super) key: GpuiLocalWorkspaceSessionKey,
    pub(super) stamp: u64,
}

/// A plain focus request the old runtime is about to send for a selection Rust already made: its
/// own routing of a sidebar row click Rust handled in process, or its reconcile reply to a tell
/// that carried `localWasSleeping` or `localRuntimeMissing`.
#[derive(Clone, Debug)]
pub(super) struct ExpectedFocusEcho {
    key: GpuiLocalWorkspaceSessionKey,
    /// The store stamp of the selection the echo belongs to.
    stamp: u64,
    kind: FocusEchoKind,
    registered_at: Instant,
}

/// Where in the old runtime's output an echo sits relative to the focus payload that carries its
/// selection's stamp, which decides when it can no longer arrive.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(super) enum FocusEchoKind {
    /// The runtime routes a sidebar click before it is told the click's selection, so its focus
    /// request precedes every payload that echoes that stamp.
    Click,
    /// The runtime answers a flagged tell after it posted the focus state for that same tell, so
    /// the reply follows the first payload with the tell's stamp and precedes any newer one.
    TellReply,
    /// A row the session walk handed to the runtime's route (a session of another project). The
    /// request follows the payload that switches the project, like a tell reply, and it carries
    /// `keepView`, which the other two kinds never do.
    HandedOff,
}

/// An echo that has not arrived this long after it was registered is no longer waited for, so a
/// later request for the same session (a notification, the command palette) is never mistaken for
/// it. The decision to drop an echo is still made by stamp order; this only bounds how long the
/// marker lives when the runtime never sends the echo and never posts a newer stamp.
const FOCUS_ECHO_EXPIRY: Duration = Duration::from_secs(2);

/// Echoes remembered at once. A click or a flagged tell adds one and the echo removes it, so more
/// than a few only pile up when the old runtime is far behind.
const MAX_EXPECTED_FOCUS_ECHOES: usize = 8;

/// What happened since the app started. Memory only; the `native.terminal.focus` lines quote it.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub(super) struct LocalFocusCounters {
    pub(super) local_selections: u64,
    pub(super) unplaced_selections: u64,
    pub(super) tells: u64,
    pub(super) attention_acknowledges: u64,
    pub(super) stale_payloads: u64,
    pub(super) stale_project_contexts: u64,
    pub(super) stale_focus_requests_dropped: u64,
    pub(super) settles: u64,
    pub(super) disputed_empty_tab_lists: u64,
}

/// CDXC:FocusRouting 2026-09-19 DECISION:
/// User: holding "next tab" must fly through tabs, and sidebar clicks and tab selections must be instant; the old runtime is told about focus, never asked, and never allowed to override a newer local choice.
/// A selection is a store intent plus one repaint. This supersedes the three optimistic focus markers of 2026-09-19 (the in-process click echo drop with its three second window, the sidebar's `optimistic_focus` with its 1.5 second timeout, and the GPUI highlight waiting for the TypeScript pending focus marker): the store's stamp orders a local selection against anything the old runtime says later, so nothing is matched by time.
/// SEE-ALSO: burst.rs (tell and settle timers), shadow_diff.rs (the mirror that feeds `Intent::ExternalFocus`), packages/gx-core/src/focus.rs (`FocusState::local_stamp`), apps/desktop/sidebar/gxserver-runtime/terminal-lifecycle-queue.ts and sidebar-groups.ts (`focusStamp` echo).
#[derive(Default)]
pub(crate) struct LocalFocus {
    /// The persisted focus was seeded into the core (once, before the first frame).
    pub(super) restored: bool,
    /// Newest stamp the old runtime echoed in a focus payload.
    pub(super) confirmed_stamp: u64,
    /// The old runtime's newest accepted focus names something the store does not own the focus of
    /// (a remote session, the quick automations row). Local rows then draw unfocused and the
    /// sidebar snapshot's own flag owns the highlight, which for a remote row is the mark the list
    /// carries from the publish (`remote_row_focus`). Cleared by every local selection.
    pub(super) foreign_focus: bool,
    /// Row id of the store's focused session, and of its visible sessions, so a row compares two
    /// strings per frame instead of decoding its id.
    focused_row_id: Option<String>,
    visible_row_ids: Vec<String>,
    /// `foreign_focus` as of the last cache refresh, so a flip alone also counts as a change.
    cached_foreign_focus: bool,
    /// The newest sidebar snapshot marks a browser row of the active group focused. The old
    /// runtime then draws no session row focused (`browserOwnsFocus` in sidebar-groups.ts), and
    /// neither do local rows here.
    snapshot_browser_focus: bool,
    pub(super) pending_tell: Option<PendingTell>,
    pub(super) pending_attention: Vec<GpuiLocalWorkspaceSessionKey>,
    /// Newest remembered session per project from local selections that no tell covered yet.
    pub(super) pending_remembered: Vec<SessionKey>,
    pub(super) last_tell: Option<ToldSelection>,
    expected_echoes: Vec<ExpectedFocusEcho>,
    pub(super) last_selection_at: Option<Instant>,
    /// Set while heavy per-selection work is held back; `burst.rs` clears it.
    pub(super) settle_due: Option<Instant>,
    pub(super) tell_due: Option<Instant>,
    /// When the last tell is sent again unless a payload has echoed its stamp by then.
    pub(super) retell_due: Option<Instant>,
    pub(super) retell_attempts: u8,
    /// The row a held previous or next session key landed on has no live terminal: the runtime is
    /// asked to wake or attach it once the selection settles, and only if it is still focused.
    pub(super) walk_runtime_ask: Option<String>,
    /// The row the walk handed to the runtime (another project, a remote session, a browser tab)
    /// and the store's focused row at that moment. While a key is held, repeats that resolve to
    /// the same row from the same focused row are not handed over again.
    walk_handoff: Option<(String, Option<String>)>,
    /// The row to reveal (animated, or flashed when already in view) once the selection settles.
    pub(super) walk_landing_reveal: Option<String>,
    /// The selection being booked comes from a key that is being held (a key repeat), so it is
    /// part of a burst whatever the time since the previous step.
    pub(super) key_held: bool,
    pub(super) burst_task_running: bool,
    /// The instant the burst task sleeps towards, and the channel that wakes it earlier; see
    /// `gx_store_burst_deadline_booked`.
    pub(super) burst_sleeping_until: Option<Instant>,
    pub(super) burst_wake: Option<futures::channel::mpsc::UnboundedSender<()>>,
    pub(super) burst_steps: u32,
    pub(super) chat_reconcile_wanted: bool,
    pub(super) browser_surface_wanted: bool,
    /// What the focus state file holds, so it is written only when one of its fields moved.
    persisted_focus: Option<(Option<String>, Option<String>, Vec<String>)>,
    /// A focus payload that lost to a newer local selection asked for this other project. The
    /// focus request that rides with it must lose too (CDXC:Navigation 2026-07-29).
    pub(super) stale_project_switch: Option<String>,
    /// The old runtime sent an empty tab list the store does not confirm; judged again when the
    /// store's tab lists change.
    pub(super) disputed_empty_tab_list: Option<String>,
    pub(super) counters: LocalFocusCounters,
}

impl LocalFocus {
    /// The old runtime will send a plain focus request for `key`, an echo of the selection with
    /// this stamp.
    pub(super) fn expect_focus_echo(
        &mut self,
        key: GpuiLocalWorkspaceSessionKey,
        stamp: u64,
        kind: FocusEchoKind,
    ) {
        self.expected_echoes.retain(|echo| echo.key != key);
        if self.expected_echoes.len() >= MAX_EXPECTED_FOCUS_ECHOES {
            self.expected_echoes.remove(0);
        }
        self.expected_echoes.push(ExpectedFocusEcho {
            key,
            stamp,
            kind,
            registered_at: Instant::now(),
        });
    }

    /// The old runtime echoed `stamp` in an admitted focus payload. It handles messages in order
    /// and posts in order, so every echo that had to precede this payload has arrived or never
    /// will (see `FocusEchoKind` for which payload that is). Expired echoes go with them.
    fn forget_echoes_answered_by(&mut self, stamp: u64) {
        self.expected_echoes.retain(|echo| {
            let may_still_arrive = match echo.kind {
                FocusEchoKind::Click => stamp < echo.stamp,
                FocusEchoKind::TellReply | FocusEchoKind::HandedOff => stamp <= echo.stamp,
            };
            may_still_arrive && echo.registered_at.elapsed() < FOCUS_ECHO_EXPIRY
        });
    }

    /// Keeps the newest remembered session per project.
    pub(super) fn remember(&mut self, session: SessionKey) {
        let project = session.project_key();
        self.pending_remembered
            .retain(|remembered| remembered.project_key() != project);
        self.pending_remembered.push(session);
    }
}

pub(super) struct LocalSelectionOutcome {
    pub(super) moved: bool,
}

impl GxStoreHost {
    /// Applies a local selection to the core. Memory only.
    pub(super) fn apply_local_selection(
        &mut self,
        session: SessionKey,
        visible: Vec<SessionKey>,
    ) -> LocalSelectionOutcome {
        let moved = self.core.focus().focused_session.as_ref() != Some(&session);
        let output = self.core.handle(
            Event::Intent(Intent::FocusSession {
                session,
                visible: Some(visible),
            }),
            now_ms(),
        );
        self.local_focus.counters.local_selections += 1;
        if output.changes.ignored == Some(IgnoredReason::UnknownTarget) {
            // A session the daemon created a moment ago is not in the store yet. The stamp did
            // not move, so the old runtime's next focus payload is not stale and places it.
            self.local_focus.counters.unplaced_selections += 1;
        }
        self.local_focus.foreign_focus = false;
        self.run_effects(output.effects);
        self.refresh_row_focus_cache();
        LocalSelectionOutcome { moved }
    }

    /// Whether the store already holds exactly this selection and the old runtime was told it
    /// with the current stamp.
    fn selection_is_already_told(
        &self,
        key: &GpuiLocalWorkspaceSessionKey,
        session: &SessionKey,
        visible: &[SessionKey],
    ) -> bool {
        let focus = self.core.focus();
        self.local_focus.pending_tell.is_none()
            && !self.local_focus.foreign_focus
            && focus.focused_session.as_ref() == Some(session)
            && focus.visible_sessions == visible
            && self
                .local_focus
                .last_tell
                .as_ref()
                .is_some_and(|told| told.key == *key && told.stamp == focus.local_stamp)
    }

    /// Rebuilds the row ids the sidebar compares against. Returns `true` when they changed.
    pub(super) fn refresh_row_focus_cache(&mut self) -> bool {
        let focus = self.core.focus();
        let focused = focus
            .focused_session
            .as_ref()
            .filter(|session| session.machine.is_local())
            .map(SessionKey::to_sidebar_session_id);
        let visible = focus
            .visible_sessions
            .iter()
            .filter(|session| session.machine.is_local())
            .map(SessionKey::to_sidebar_session_id)
            .collect::<Vec<_>>();
        let changed = self.local_focus.focused_row_id != focused
            || self.local_focus.visible_row_ids != visible
            || self.local_focus.cached_foreign_focus != self.local_focus.foreign_focus;
        self.local_focus.cached_foreign_focus = self.local_focus.foreign_focus;
        self.local_focus.focused_row_id = focused;
        self.local_focus.visible_row_ids = visible;
        changed
    }

    /// Seeds the core's focus from the persisted focus state, once, before any frame is applied.
    /// The file names a local session by its raw id, so the project comes from the file's active
    /// project; a remote focus is left to the old path, which owns remote machines.
    pub(super) fn restore_focus_once(&mut self, persisted: &GpuiGxserverPresentationFocusState) {
        if std::mem::replace(&mut self.local_focus.restored, true) {
            return;
        }
        let project = persisted
            .active_project_id
            .as_deref()
            .and_then(ProjectKey::parse_workspace_project_id);
        let remote_session = persisted
            .focused_session_id
            .as_deref()
            .is_some_and(|id| SessionKey::parse_remote_scoped_session_id(id).is_some());
        let Some(project) = project.filter(|project| project.machine.is_local()) else {
            self.local_focus.foreign_focus = project_is_remote(persisted) || remote_session;
            return;
        };
        if remote_session {
            self.local_focus.foreign_focus = true;
            return;
        }
        let mut focus = self.core.focus().clone();
        let session = persisted
            .focused_session_id
            .as_deref()
            .map(|session_id| SessionKey::local(project.project_id.as_str(), session_id));
        focus.active_group = Some(default_group_for_project(
            self.core.presentation(),
            &project,
        ));
        focus.active_project = Some(project);
        focus.visible_sessions = session.iter().cloned().collect();
        if let Some(session) = &session {
            focus
                .last_session_by_project
                .retain(|remembered| remembered.project_key() != session.project_key());
            focus.last_session_by_project.push(session.clone());
        }
        focus.focused_session = session;
        self.core.restore_focus(focus);
        self.refresh_row_focus_cache();
        self.diagnostics.focus_restored(&self.core);
    }

    /// Whether an empty tab list from the old runtime may clear a local project's workspace: only
    /// when the store is loaded and lists no tab for that project either.
    ///
    /// CDXC:Workarea 2026-09-19 WHY:
    /// An empty list makes `reconcile_with_sidebar_tab_sessions` drop every restored tab, split and mapping (the "different session after restart" bug of 2026-09-04). The old runtime guards its side by not posting before its first snapshot; the store is a second reader of the same daemon, so an empty list is only believed when both agree. `NotLoaded` and `Missing` are never read as "no tabs".
    pub(super) fn confirms_empty_tab_list(&self, project_id: &str) -> bool {
        let Some(project) = ProjectKey::parse_workspace_project_id(project_id) else {
            return false;
        };
        let store = self.core.presentation();
        if store.loaded(&project.machine).is_none() {
            // A machine the store does not hold cannot dispute anything: its list keeps the old
            // rule. Before M4d that was every remote machine; now it is only one whose client is
            // not running.
            return true;
        }
        // The active group is the store's own only while the store owns that machine's focus,
        // which it does for this computer. A remote project's group is derived instead, from the
        // project the old runtime named.
        let group = self
            .core
            .focus()
            .active_group
            .clone()
            .filter(|_| project.machine.is_local())
            .filter(|group| match group {
                ghostex_gx_core::ActiveGroup::Project(owner) => *owner == project,
                ghostex_gx_core::ActiveGroup::Subgroup { project: owner, .. } => *owner == project,
                ghostex_gx_core::ActiveGroup::Chats(machine) => {
                    *machine == MachineId::Local && store.is_chat_project(&project)
                }
            })
            .unwrap_or_else(|| default_group_for_project(store, &project));
        matches!(store.tab_sessions(&group), Loadable::Loaded(tabs) if tabs.is_empty())
    }
}

fn project_is_remote(state: &GpuiGxserverPresentationFocusState) -> bool {
    state
        .active_project_id
        .as_deref()
        .and_then(ProjectKey::parse_workspace_project_id)
        .is_some_and(|project| !project.machine.is_local())
}

impl GhostexGpuiApp {
    /// A local session was selected in the workspace (tab click, next or previous tab, sidebar
    /// row click, attach completion). The store changes now; the old runtime hears about it once
    /// the burst is over. Callers repaint themselves, as they did before.
    pub(crate) fn gx_store_select_local_session(
        &mut self,
        key: &GpuiLocalWorkspaceSessionKey,
        local_was_sleeping: bool,
        local_runtime_missing: bool,
        cx: &mut gpui::Context<Self>,
    ) {
        let session = SessionKey::local(key.project_id.as_str(), key.session_id.as_str());
        let visible = self.gx_store_visible_local_session_keys(key);
        let focus_state = &mut self.sidebar_gxserver_presentation_focus_state;
        if focus_state.active_project_id.as_deref() == Some(key.project_id.as_str()) {
            // Thirty-odd readers still resolve "the focused session" from this copy of the old
            // runtime's focus state (the companion pane, attach completions, extensions). It
            // follows the store here, and a payload older than this selection cannot move it back.
            let visible_ids = visible
                .iter()
                .map(|session| session.session_id.clone())
                .collect::<Vec<_>>();
            focus_state.focused_session_id = Some(key.session_id.clone());
            focus_state.visible_session_ids = visible_ids;
        }
        if self
            .gx_store
            .selection_is_already_told(key, &session, &visible)
            && !local_was_sleeping
            && !local_runtime_missing
        {
            // An attach completion or the runtime's own focus request repeating a selection the
            // store holds and the old runtime has heard: nothing to change, nothing to tell.
            return;
        }
        let outcome = self.gx_store.apply_local_selection(session, visible);
        let local_focus = &mut self.gx_store.local_focus;
        // Flags of an earlier selection of the same session still hold: the tab has not been
        // attached or woken in between, or the later caller would not be selecting it again.
        let (was_sleeping, runtime_missing) = match &local_focus.pending_tell {
            Some(pending) if pending.key == *key => (
                pending.local_was_sleeping || local_was_sleeping,
                pending.local_runtime_missing || local_runtime_missing,
            ),
            _ => (local_was_sleeping, local_runtime_missing),
        };
        local_focus.pending_tell = Some(PendingTell {
            key: key.clone(),
            local_was_sleeping: was_sleeping,
            local_runtime_missing: runtime_missing,
        });
        self.gx_store_note_local_selection(outcome.moved, cx);
        if local_runtime_missing && !self.gx_store_selection_is_settling() {
            self.gx_store_attach_surfaced_terminals(cx);
        }
    }

    /// Marks the selections made until it is cleared as steps of a held key. Set around the
    /// dispatch of a hotkey's key repeat.
    pub(crate) fn gx_store_set_key_held(&mut self, held: bool) {
        self.gx_store.local_focus.key_held = held;
    }

    pub(crate) fn gx_store_key_is_held(&self) -> bool {
        self.gx_store.local_focus.key_held
    }

    /// The sidebar row that counts as current for the previous and next session walk: the row of
    /// the store's focused session, the same source the highlight reads. While a browser tab or a
    /// row the store does not hold owns focus, it is the row the snapshot marks focused, which is
    /// then also the highlighted one.
    pub(super) fn gx_store_focused_sidebar_row_id(
        &self,
        snapshot: &crate::app::native_sidebar::model::NativeSidebarSnapshot,
    ) -> Option<String> {
        let local_focus = &self.gx_store.local_focus;
        let snapshot_focused_row = |browser: bool| {
            snapshot
                .groups
                .iter()
                .flat_map(|group| group.sessions.iter())
                .find(|session| session.is_focused && session.is_browser() == browser)
                .map(|session| session.session_id.clone())
        };
        let browser_holds_shell_focus = self.active_mode == TitlebarMode::Browser
            && matches!(
                self.shell_focus,
                ShellFocusTarget::BrowserSurface | ShellFocusTarget::BrowserPane(_)
            );
        if local_focus.snapshot_browser_focus && browser_holds_shell_focus {
            return snapshot_focused_row(true);
        }
        if local_focus.foreign_focus {
            return snapshot_focused_row(false);
        }
        local_focus.focused_row_id.clone()
    }

    /// No focus request will follow for this session after all.
    pub(super) fn gx_store_forget_expected_echo(&mut self, key: &GpuiLocalWorkspaceSessionKey) {
        self.gx_store
            .local_focus
            .expected_echoes
            .retain(|echo| echo.key != *key);
    }

    /// The runtime is about to be asked for this session right after the tell of its selection, so
    /// its focus request follows the payload that echoes the selection's stamp.
    pub(super) fn gx_store_expect_request_after_tell(
        &mut self,
        key: &GpuiLocalWorkspaceSessionKey,
    ) {
        let stamp = self.gx_store.core.focus().local_stamp;
        self.gx_store
            .local_focus
            .expect_focus_echo(key.clone(), stamp, FocusEchoKind::TellReply);
    }

    /// Whether a held walk step resolves to the row already handed to the runtime while the
    /// store's focused row is still the one it was handed over from.
    pub(super) fn gx_store_walk_waits_for_runtime(
        &self,
        target_row_id: &str,
        current_row_id: Option<&str>,
    ) -> bool {
        self.gx_store.local_focus.walk_handoff.as_ref().is_some_and(
            |(row_id, focused_at_handoff)| {
                row_id == target_row_id && focused_at_handoff.as_deref() == current_row_id
            },
        )
    }

    pub(super) fn gx_store_clear_walk_handoff(&mut self) {
        self.gx_store.local_focus.walk_handoff = None;
    }

    /// The walk hands a row to the runtime's route. For a local session the runtime answers with
    /// a focus request after the focus payload that switches the project, so that request is an
    /// expected echo: it is applied while the hand-off is still the newest thing the user did and
    /// dropped once a newer local selection exists. Remote and browser rows come back on their
    /// own channels and have no such request.
    pub(super) fn gx_store_hand_walk_row_to_runtime(
        &mut self,
        target_row_id: &str,
        current_row_id: Option<&str>,
    ) {
        self.gx_store.local_focus.walk_handoff = Some((
            target_row_id.to_string(),
            current_row_id.map(str::to_string),
        ));
        if let Some(key) =
            crate::app::helpers::gpui_combined_presentation_session_key(target_row_id)
        {
            let stamp = self.gx_store.core.focus().local_stamp;
            self.gx_store
                .local_focus
                .expect_focus_echo(key, stamp, FocusEchoKind::HandedOff);
        }
    }

    pub(super) fn gx_store_ask_runtime_for_landing_row(&mut self, row_id: &str) {
        self.gx_store.local_focus.walk_runtime_ask = Some(row_id.to_string());
    }

    /// A walk step revealed a row; when the selection is still moving, the landing row is
    /// revealed again at the settle.
    pub(super) fn gx_store_note_walk_reveal(&mut self, row_id: &str) {
        self.gx_store.local_focus.walk_landing_reveal = self
            .gx_store_selection_is_settling()
            .then(|| row_id.to_string());
    }

    /// The selection settled: what the walk left for the row it landed on. Returns the row the
    /// runtime must be asked for, when it is still the focused one.
    pub(super) fn gx_store_take_walk_landing(&mut self) -> (Option<String>, Option<String>) {
        let local_focus = &mut self.gx_store.local_focus;
        let reveal = local_focus.walk_landing_reveal.take();
        let ask = local_focus
            .walk_runtime_ask
            .take()
            .filter(|row_id| local_focus.focused_row_id.as_deref() == Some(row_id.as_str()));
        (reveal, ask)
    }

    /// A remote session was selected in the workspace. Remote machines are not in the store, so
    /// the selection itself keeps the old path; the store only stops drawing its last local
    /// session as focused. Callers repaint themselves.
    pub(crate) fn gx_store_note_remote_selection(&mut self) {
        self.gx_store.local_focus.foreign_focus = true;
    }

    /// The store keys of the sessions that own a rendered pane, the selected one included: the
    /// exact visible set of `Intent::FocusSession`.
    fn gx_store_visible_local_session_keys(
        &self,
        selected: &GpuiLocalWorkspaceSessionKey,
    ) -> Vec<SessionKey> {
        let shell_session_ids = self
            .agents_workspace
            .rendered_leaf_order()
            .into_iter()
            .filter_map(|pane_id| self.agents_workspace.active_session_in_pane(pane_id))
            .collect::<Vec<_>>();
        let mut keys = Vec::with_capacity(shell_session_ids.len() + 1);
        for shell_session_id in shell_session_ids {
            let Some(key) = self
                .local_workspace_session_mappings
                .iter()
                .find_map(|(key, mapped)| (*mapped == shell_session_id).then_some(key))
            else {
                continue;
            };
            let key = SessionKey::local(key.project_id.as_str(), key.session_id.as_str());
            if !keys.contains(&key) {
                keys.push(key);
            }
        }
        let selected =
            SessionKey::local(selected.project_id.as_str(), selected.session_id.as_str());
        if !keys.contains(&selected) {
            keys.push(selected);
        }
        keys
    }

    /// Writes the focus state file when the focus it holds moved. The one writer while the app
    /// runs: a payload of the old runtime and the end of a local burst both come through here, so
    /// a held key costs one write, not one per tab. The quit path writes unconditionally.
    pub(crate) fn gx_store_persist_focus_state_file(&mut self) {
        let focus_state = &self.sidebar_gxserver_presentation_focus_state;
        let current = (
            focus_state.active_project_id.clone(),
            focus_state.focused_session_id.clone(),
            focus_state.visible_session_ids.clone(),
        );
        if self.gx_store.local_focus.persisted_focus.as_ref() == Some(&current) {
            return;
        }
        crate::app::helpers::persist_gpui_gxserver_presentation_focus_state(focus_state);
        self.gx_store.local_focus.persisted_focus = Some(current);
    }

    /// A sidebar snapshot arrived: whether it marks a browser row of an active group focused.
    /// Computed once per snapshot by the receiver, never per row.
    pub(crate) fn gx_store_note_sidebar_snapshot_browser_focus(&mut self, browser_focus: bool) {
        self.gx_store.local_focus.snapshot_browser_focus = browser_focus;
    }

    /// Whether a native sidebar row draws focused and with the visible fill.
    ///
    /// A local session row reads the store, unless a browser tab owns focus. A browser row keeps
    /// the snapshot's flags while the shell's focus is on the browser (browser tabs are host
    /// state, not sessions). Any other row (a remote session, the quick automations
    /// row) reads the snapshot only while the old runtime's accepted focus is such a row, so a
    /// local selection never shows two focused rows while the old runtime catches up.
    pub(crate) fn gx_store_sidebar_row_focus(
        &self,
        row_id: &str,
        is_browser: bool,
        snapshot_focused: bool,
        snapshot_visible: bool,
    ) -> (bool, bool) {
        let local_focus = &self.gx_store.local_focus;
        // Whether a browser tab has focus is a fact of this shell (it is what the old runtime's
        // flag is derived from), so leaving the browser shows at once; the snapshot's flag lags.
        let browser_holds_shell_focus = self.active_mode == TitlebarMode::Browser
            && matches!(
                self.shell_focus,
                ShellFocusTarget::BrowserSurface | ShellFocusTarget::BrowserPane(_)
            );
        if is_browser {
            return (
                snapshot_focused && browser_holds_shell_focus,
                snapshot_visible,
            );
        }
        if local_focus.snapshot_browser_focus && browser_holds_shell_focus {
            // One focused row: the browser tab's, which the snapshot already draws.
            let visible =
                if row_id.starts_with(LOCAL_SESSION_ROW_PREFIX) && !local_focus.foreign_focus {
                    local_focus
                        .visible_row_ids
                        .iter()
                        .any(|visible| visible == row_id)
                } else {
                    snapshot_visible
                };
            return (false, visible);
        }
        if !row_id.starts_with(LOCAL_SESSION_ROW_PREFIX) {
            return (
                snapshot_focused && local_focus.foreign_focus,
                snapshot_visible,
            );
        }
        if local_focus.foreign_focus {
            // The store does not own the focus of whatever this is (a remote session, the quick
            // automations row), so its visible set is the last local one.
            return (false, snapshot_visible);
        }
        let focused = local_focus.focused_row_id.as_deref() == Some(row_id);
        let visible = local_focus
            .visible_row_ids
            .iter()
            .any(|visible| visible == row_id);
        (focused, visible)
    }

    /// The old runtime published its focus state with the stamp it had last been told. The store
    /// mirrors it through `Intent::ExternalFocus`, which applies the same ordering rule. A payload
    /// older than the newest local selection still carries the tab list of the current project,
    /// but its selection, its active project and its visible set are replaced by what the app
    /// already holds, so nothing downstream can follow it. The flag says the state is such a
    /// rewrite: the caller applies it without choosing a workspace project.
    pub(crate) fn gx_store_admit_old_runtime_focus_state(
        &mut self,
        mut next_state: GpuiGxserverPresentationFocusState,
        echo: &GpuiGxserverPresentationFocusEcho,
        cx: &mut gpui::Context<Self>,
    ) -> (GpuiGxserverPresentationFocusState, bool) {
        let observed_stamp = echo.focus_stamp.unwrap_or(0);
        let local_stamp = self.gx_store.core.focus().local_stamp;
        self.gx_store_observe_old_runtime_focus_state(&next_state, echo, cx);
        if self.gx_store.refresh_row_focus_cache() {
            // The highlight follows the store even when the payload changes nothing else.
            cx.notify();
        }
        if observed_stamp >= local_stamp {
            let local_focus = &mut self.gx_store.local_focus;
            local_focus.confirmed_stamp = observed_stamp;
            local_focus.stale_project_switch = None;
            local_focus.forget_echoes_answered_by(observed_stamp);
            if local_focus
                .last_tell
                .as_ref()
                .is_some_and(|told| observed_stamp >= told.stamp)
            {
                // The old runtime has the stamp it was last told: nothing to send again.
                local_focus.retell_due = None;
            }
            return (next_state, false);
        }
        let local_focus = &mut self.gx_store.local_focus;
        local_focus.counters.stale_payloads += 1;
        let current = &self.sidebar_gxserver_presentation_focus_state;
        if next_state.active_project_id != current.active_project_id {
            local_focus.stale_project_switch = next_state.active_project_id.clone();
            next_state.active_project_tab_sessions = current.active_project_tab_sessions.clone();
        }
        support_logs::append(
            support_logs::GpuiSupportLog::TerminalFocus,
            "gpui.terminalFocus.staleFocusPayload",
            serde_json::json!({
                "localStamp": local_stamp,
                "observedStamp": observed_stamp,
                "namedOtherProject": next_state.active_project_id != current.active_project_id,
            }),
        );
        next_state.active_project_id = current.active_project_id.clone();
        next_state.focused_session_id = current.focused_session_id.clone();
        next_state.visible_session_ids = current.visible_session_ids.clone();
        (next_state, true)
    }

    /// The store's count of local focus intents, for the channels that carry its echo.
    pub(crate) fn gx_store_local_focus_stamp(&self) -> u64 {
        self.gx_store.core.focus().local_stamp
    }

    /// An active project context for another project was refused because the old runtime produced
    /// it before it heard of the newest local selection.
    pub(crate) fn gx_store_note_stale_project_context(&mut self, observed_stamp: u64) {
        self.gx_store.local_focus.counters.stale_project_contexts += 1;
        support_logs::append(
            support_logs::GpuiSupportLog::TerminalFocus,
            "gpui.terminalFocus.staleProjectContextRefused",
            serde_json::json!({
                "localStamp": self.gx_store.core.focus().local_stamp,
                "observedStamp": observed_stamp,
            }),
        );
    }

    /// A sidebar row click was applied in process; the old runtime routes the same click and will
    /// send its own focus request for the session.
    pub(crate) fn gx_store_expect_click_echo(&mut self, key: &GpuiLocalWorkspaceSessionKey) {
        let stamp = self.gx_store.core.focus().local_stamp;
        self.gx_store
            .local_focus
            .expect_focus_echo(key.clone(), stamp, FocusEchoKind::Click);
    }

    /// Whether a focus request from the old runtime lost to a newer local selection.
    ///
    /// Two cases, both ordered by the store's stamp and never by time. The request that rides with
    /// a project switch whose focus payload was already dropped as stale loses with it
    /// (CDXC:Navigation 2026-07-29: the request belongs to its snapshot). And a plain request that
    /// only echoes a selection Rust made itself (see `ExpectedFocusEcho`) loses when the user has
    /// selected another session since; while that selection is still the newest it passes, because
    /// it is what attaches a staged or restored tab. Every other request (a created, forked or
    /// restored session, a notification, a wake that finished) is applied, and becomes the newest
    /// local selection when it selects its tab.
    pub(crate) fn gx_store_focus_request_lost_to_local_selection(
        &mut self,
        message: &GpuiSidebarWorkspaceTerminalFocusMessage,
    ) -> bool {
        let project_id = message.project_id.as_str();
        let session_id = message.session_id.as_str();
        let local_focus = &mut self.gx_store.local_focus;
        let mut lost = false;
        if !message.startup_restore
            && !message.force_remount
            && local_focus.stale_project_switch.as_deref() == Some(project_id)
        {
            local_focus.stale_project_switch = None;
            lost = self.agents_workspace_project_id.as_deref() != Some(project_id);
        }
        let plain = message.placement == GpuiWorkspaceTerminalFocusPlacement::Tab
            && message.placement_target_session_id.is_none()
            && !message.force_remount
            && !message.startup_restore
            && message.preferred_interface == GpuiPreferredAgentInterface::Terminal;
        local_focus
            .expected_echoes
            .retain(|echo| echo.registered_at.elapsed() < FOCUS_ECHO_EXPIRY);
        let echo = local_focus
            .expected_echoes
            .iter()
            .position(|echo| {
                // Only a hand-off to another project comes back with `keepView`.
                plain
                    && (echo.kind == FocusEchoKind::HandedOff || !message.keep_view)
                    && echo.key.project_id == project_id
                    && echo.key.session_id == session_id
            })
            .map(|index| local_focus.expected_echoes.remove(index));
        if let Some(echo) = echo {
            let focus = self.gx_store.core.focus();
            let still_focused = focus.focused_session.as_ref().is_some_and(|focused| {
                focused.machine.is_local()
                    && focused.project_id == project_id
                    && focused.session_id == session_id
            });
            lost |= focus.local_stamp > echo.stamp && !still_focused;
        }
        if lost {
            self.gx_store
                .local_focus
                .counters
                .stale_focus_requests_dropped += 1;
            support_logs::append(
                support_logs::GpuiSupportLog::TerminalFocus,
                "gpui.terminalFocus.staleFocusRequestDropped",
                serde_json::json!({
                    "projectId": project_id,
                    "sessionId": session_id,
                    "localStamp": self.gx_store.core.focus().local_stamp,
                }),
            );
        }
        lost
    }

    /// Whether the tab list of a focus payload may be reconciled into the workspace now. A list
    /// with rows always may; an empty one needs the store's agreement and is judged again when the
    /// store's tab lists change.
    pub(crate) fn gx_store_allows_tab_reconcile(
        &mut self,
        project_id: Option<&str>,
        tab_count: usize,
    ) -> bool {
        let local_focus = &mut self.gx_store.local_focus;
        if tab_count > 0 {
            local_focus.disputed_empty_tab_list = None;
            return true;
        }
        let Some(project_id) = project_id else {
            return true;
        };
        if self.gx_store.confirms_empty_tab_list(project_id) {
            self.gx_store.local_focus.disputed_empty_tab_list = None;
            return true;
        }
        let local_focus = &mut self.gx_store.local_focus;
        if local_focus.disputed_empty_tab_list.as_deref() != Some(project_id) {
            local_focus.disputed_empty_tab_list = Some(project_id.to_string());
            local_focus.counters.disputed_empty_tab_lists += 1;
            self.gx_store.diagnostics.empty_tab_list_disputed(
                &self.gx_store.core,
                self.gx_store.local_focus.counters.disputed_empty_tab_lists,
            );
        }
        false
    }

    /// The store changed (frames applied): finish what was waiting for it. Returns `true` when
    /// something on screen changed.
    pub(super) fn gx_store_after_pump(
        &mut self,
        tab_lists_changed: bool,
        cx: &mut gpui::Context<Self>,
    ) -> bool {
        // A frame can move focus too: the focused session was closed, or its project went away.
        let mut repaint = self.gx_store.refresh_row_focus_cache();
        if tab_lists_changed
            && let Some(project_id) = self.gx_store.local_focus.disputed_empty_tab_list.clone()
        {
            let focus_state = self.sidebar_gxserver_presentation_focus_state.clone();
            let still_empty = focus_state.active_project_id.as_deref() == Some(project_id.as_str())
                && focus_state
                    .active_project_tab_sessions
                    .as_ref()
                    .is_some_and(Vec::is_empty);
            if !still_empty {
                self.gx_store.local_focus.disputed_empty_tab_list = None;
            } else if self.gx_store.confirms_empty_tab_list(&project_id)
                && self.reconcile_local_workspace_tabs_with_sidebar(&focus_state, cx)
            {
                self.reconcile_agents_chat_surfaces(cx);
                self.persist_shell_layout_state();
                repaint = true;
            }
        }
        repaint
    }
}
