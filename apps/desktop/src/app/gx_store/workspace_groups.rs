//! The workspace session groups document inside the app: the stored key, the debounced push, and
//! the echo the guard refuses.
//!
//! CDXC:Sessions 2026-09-21 WHY:
//! This is the fourth client-storage key (K4) and it is a different shape from the other three: one
//! writer plus a SYNCHRONISER. The client owns the document, writes it to the key on every edit,
//! and pushes it to gxserver as a debounced write-through with an indefinite retry; between the
//! edit and the push the daemon still holds the old copy and can echo it, and applying that echo is
//! the oscillation the user sees as a row jumping back and then forward. `WorkspaceGroupsSync` in
//! gx-core is that guard; this file is the three edges it cannot have, which are the clock, the
//! stored key and the socket.
//!
//! **The store's own copy is the one the list reads**, through `side_state().workspace_groups`, and
//! the daemon's stream writes that field too. So the echo is not intercepted on the way in (a
//! second place to get the frame path wrong): the daemon's value lands, and the funnel below then
//! asks the guard what it means. An echo the guard refuses is undone by putting the held document
//! back, which is the one and only place that decision is made.
//!
//! **Since M5 piece 7c this is the ONLY writer of the key and the only pusher.** The old runtime
//! still EDITS the document for the paths it owns (rename, close, create, the project order, and
//! placing a session it has just created or forked into a group), because those are not the store's
//! yet; what it no longer does is write client storage or call the daemon. `persistWorkspaceGroups`
//! posts the edited document to the host instead (`hand_offs` below), and the held document is
//! handed BACK to the old runtime after every change here, which is what keeps its copy from being
//! the stale base the next edit is computed from. Its own `adoptWorkspaceGroupsFromGxserver` is
//! gone with the write: an echo has to pass the guard, and the old runtime has no way to know
//! whether a push is outstanding.
//!
//! **The counters that prove this path fires** are `edits`, `storageWrites`, `pushes`,
//! `pushFailures`, `echoesAdopted`, `echoesRefused`, `handOffs`, `handBacks` and `prunes` on
//! `gxStore.workspaceGroups`. A run in which the user dragged a session inside a user-made group
//! and `edits` is zero means the command never reached here; a run in which the user renamed or
//! closed a group and `handOffs` is zero means the old runtime's edit never reached here and that
//! rename was never stored.
//!
//! SEE-ALSO: packages/gx-core/src/workspace_groups/sync.rs,
//! apps/desktop/sidebar/gxserver-runtime/workspace-groups-sync.ts,
//! apps/desktop/src/app/gx_store/sidebar_drag.rs.

use std::collections::{BTreeMap, BTreeSet};
use std::time::Duration;

use ghostex_gx_core::{
    AdoptOutcome, Event, Intent, MachineId, ProjectKey, WorkspaceGroupsDocument,
    WorkspaceGroupsEffect, WorkspaceGroupsSync,
};
use serde_json::Value;

use super::sidebar_ui_storage;
use crate::GhostexGpuiApp;
use crate::app::helpers::board_gxserver::gxserver_health_and_daemon::gpui_gxserver_rpc_result;

/// `GPUI_WORKSPACE_SESSION_GROUPS_STORAGE_KEY`.
pub(crate) const WORKSPACE_GROUPS_STORAGE_KEY: &str = "ghostex-gpui-workspace-session-groups";

/// The push is a plain write-through, so it gets the same timeout every other sidebar call has.
const PUSH_TIMEOUT: Duration = Duration::from_secs(10);

/// What this app run did with the document. Memory only; the record lines are built from it.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub(crate) struct WorkspaceGroupsCounters {
    /// Local edits, which is one per move that writes.
    pub(crate) edits: u64,
    pub(crate) storage_writes: u64,
    pub(crate) storage_removes: u64,
    pub(crate) storage_failures: u64,
    pub(crate) pushes: u64,
    pub(crate) push_failures: u64,
    /// Echoes the guard refused because a push was outstanding. This is the counter the guard
    /// exists for: a run with moves and a zero here means the window never opened, and a run with
    /// moves and a zero `edits` means nothing reached this file at all.
    pub(crate) echoes_refused: u64,
    pub(crate) echoes_adopted: u64,
    pub(crate) echoes_equal: u64,
    pub(crate) echoes_pushed_back: u64,
    /// Documents the old runtime edited and handed over, one per `persistWorkspaceGroups`. A run
    /// with a rename, a close, a new group or a project reorder in it and a zero here means the
    /// old runtime's edits are reaching nothing at all.
    pub(crate) hand_offs: u64,
    /// Times the held document was pushed back to the old runtime, which is what stops the next
    /// hand-off being computed from a stale base.
    pub(crate) hand_backs: u64,
    /// Passes of the prune that actually dropped a member. A pass that drops nothing is not an
    /// edit and is not counted, exactly as `pruneWorkspaceGroupAssignments` writes nothing.
    pub(crate) prunes: u64,
}

#[derive(Default)]
pub(crate) struct WorkspaceGroupsHost {
    pub(super) sync: WorkspaceGroupsSync,
    pub(crate) counters: WorkspaceGroupsCounters,
    /// Bumped by every booking, so a fired timer of a booking that was replaced does nothing.
    booking: u64,
    restored: bool,
    /// The document the old runtime was last told about, so it is told again only when the held
    /// document really moved. Set only when the script was dispatched: a page that was not there
    /// yet must be told on the next change rather than never.
    handed_back: Option<WorkspaceGroupsDocument>,
}

impl GhostexGpuiApp {
    /// Seeds the document from the stored key, once. Not an edit: nothing has changed that the
    /// server does not have, so no push is booked.
    pub(crate) fn gx_store_restore_workspace_groups(&mut self, cx: &mut gpui::Context<Self>) {
        if self.gx_store.workspace_groups.restored {
            return;
        }
        self.gx_store.workspace_groups.restored = true;
        let stored = sidebar_ui_storage::read_preference_value(WORKSPACE_GROUPS_STORAGE_KEY)
            .ok()
            .flatten()
            .and_then(|raw| serde_json::from_str::<Value>(&raw).ok());
        let Some(stored) = stored else {
            return;
        };
        let document = WorkspaceGroupsDocument::parse(&stored);
        self.gx_store
            .workspace_groups
            .sync
            .restore(document.clone());
        self.gx_store_apply_workspace_groups_to_store(&document, cx);
        self.gx_store_tell_old_runtime_workspace_groups(cx);
    }

    /// The old runtime edited the document and handed it over instead of writing it. Applied as a
    /// local edit, which is exactly what `persistWorkspaceGroups` used to do by itself: write the
    /// key, book the push.
    ///
    /// The document is taken WHOLE rather than merged, because the old runtime computed it from the
    /// document this file handed it and a merge would invent a third answer neither side made.
    pub(crate) fn gx_store_receive_workspace_groups_hand_off(
        &mut self,
        state: &Value,
        cx: &mut gpui::Context<Self>,
    ) {
        // The stored key has to be in hand before any edit lands on top of it, for the same reason
        // the echo path reads it first: a cold start must not write a document built on nothing.
        self.gx_store_restore_workspace_groups(cx);
        self.gx_store.workspace_groups.counters.hand_offs += 1;
        let document = WorkspaceGroupsDocument::parse(state);
        if document == *self.gx_store.workspace_groups.sync.document() {
            // `persistWorkspaceGroups` writes unconditionally, and the no-op write is preserved
            // for the store's own edits (workspace_groups/edits.rs). Here the two sides hold the
            // same document by construction, so an equal hand-off is the old runtime echoing back
            // what this file just told it and must not book a push of its own.
            return;
        }
        self.gx_store_edit_workspace_groups(document, cx);
    }

    /// Drops members whose sessions the daemon no longer lists, which is what
    /// `pruneWorkspaceGroupAssignments` did on every `createSidebarGroups`.
    ///
    /// Only projects the loaded presentation actually lists are pruned. A machine whose rows have
    /// not arrived lists none, and pruning its entries against the nothing it has would delete
    /// every group the user made on it.
    pub(crate) fn gx_store_prune_workspace_groups(&mut self, cx: &mut gpui::Context<Self>) {
        // Before the empty check, not after: until the stored key is read the document IS empty,
        // so checking first would return here for ever and this app would never hold the user's
        // groups at all unless a drag or a daemon echo happened to read them.
        self.gx_store_restore_workspace_groups(cx);
        if self
            .gx_store
            .workspace_groups
            .sync
            .document()
            .projects
            .is_empty()
        {
            return;
        }
        let mut existing: BTreeMap<String, BTreeSet<String>> = BTreeMap::new();
        {
            let document = self.gx_store.workspace_groups.sync.document();
            for (machine, entry) in self.gx_store.core.presentation().machines() {
                let Some(loaded) = entry.loaded() else {
                    continue;
                };
                for project in loaded.projects() {
                    let key = ProjectKey {
                        machine: machine.clone(),
                        project_id: project.project_id.clone(),
                    }
                    .to_workspace_project_id();
                    if document.projects.contains_key(&key) {
                        existing.entry(key).or_default();
                    }
                }
                for session in loaded.server_sessions() {
                    let key = ProjectKey {
                        machine: machine.clone(),
                        project_id: session.project_id.clone(),
                    }
                    .to_workspace_project_id();
                    if let Some(ids) = existing.get_mut(&key) {
                        ids.insert(session.session_id.clone());
                    }
                }
            }
        }
        let pruned = self
            .gx_store
            .workspace_groups
            .sync
            .document()
            .prune_projects(existing.iter().map(|(key, ids)| (key.as_str(), ids)));
        let Some(pruned) = pruned else {
            return;
        };
        self.gx_store.workspace_groups.counters.prunes += 1;
        self.gx_store_edit_workspace_groups(pruned, cx);
    }

    /// A local edit: the document the move produced. Writes the key, books the push, and puts the
    /// document into the store so the list redraws in this frame.
    pub(crate) fn gx_store_edit_workspace_groups(
        &mut self,
        document: WorkspaceGroupsDocument,
        cx: &mut gpui::Context<Self>,
    ) {
        self.gx_store.workspace_groups.counters.edits += 1;
        let effects = self.gx_store.workspace_groups.sync.edit(document.clone());
        self.gx_store_run_workspace_groups_effects(effects, cx);
        self.gx_store_apply_workspace_groups_to_store(&document, cx);
        self.gx_store_tell_old_runtime_workspace_groups(cx);
    }

    /// The daemon's copy just landed in the store. Asks the guard what it means and, when the guard
    /// refuses it, puts the held document back.
    ///
    /// Called from the one place a change summary reports `side_state.workspace_groups`, so there
    /// is no second copy of this decision and no frame path to get wrong.
    pub(crate) fn gx_store_reconcile_workspace_groups(&mut self, cx: &mut gpui::Context<Self>) {
        // The stored key is the instant-edit source and has to be in hand before the first echo is
        // judged, or a cold start would adopt the daemon's copy over a document the user edited
        // offline. One read, on the first call.
        self.gx_store_restore_workspace_groups(cx);
        let server_state = self
            .gx_store
            .core
            .presentation()
            .machine(&MachineId::Local)
            .and_then(|machine| machine.side_state().workspace_groups.as_ref())
            .map(WorkspaceGroupsDocument::from_side_state);
        let value = server_state.as_ref().map(WorkspaceGroupsDocument::to_json);
        let (outcome, effects) = self
            .gx_store
            .workspace_groups
            .sync
            .adopt(value.as_ref().filter(|_| server_state.is_some()));
        match outcome {
            AdoptOutcome::Adopted => self.gx_store.workspace_groups.counters.echoes_adopted += 1,
            AdoptOutcome::IgnoredEqual => self.gx_store.workspace_groups.counters.echoes_equal += 1,
            AdoptOutcome::IgnoredPending => {
                self.gx_store.workspace_groups.counters.echoes_refused += 1
            }
            AdoptOutcome::ScheduledPush => {
                self.gx_store.workspace_groups.counters.echoes_pushed_back += 1
            }
        }
        self.gx_store_run_workspace_groups_effects(effects, cx);
        // Whatever the guard decided, the store must end up holding the document the guard holds:
        // the daemon's value is already in the side state by the time this runs, so a refusal is
        // only a refusal if it is put back.
        let held = self.gx_store.workspace_groups.sync.document().clone();
        if Some(&held) != server_state.as_ref() {
            self.gx_store_apply_workspace_groups_to_store(&held, cx);
        }
        self.gx_store_tell_old_runtime_workspace_groups(cx);
    }

    /// Hands the held document to the old runtime, which no longer reads the daemon's copy itself.
    ///
    /// This is the half of the hand-off that makes the other half safe: the old runtime's next
    /// edit is computed from whatever it holds, so if it kept adopting the daemon's echo it would
    /// hand back a document built on the copy the guard had just refused, which is declared
    /// difference 29 in a second shape. Told only when the document really moved, and the record of
    /// what it was told is updated only when the script was dispatched, so a page that was not
    /// there yet is told on the next change rather than never.
    fn gx_store_tell_old_runtime_workspace_groups(&mut self, cx: &mut gpui::Context<Self>) {
        let held = self.gx_store.workspace_groups.sync.document();
        if self.gx_store.workspace_groups.handed_back.as_ref() == Some(held) {
            return;
        }
        let held = held.clone();
        let Some(service) = self.sidebar.clone() else {
            return;
        };
        // Its own named bridge function, not a sidebar command: a command arrives in one of two
        // envelopes and picking the wrong one is how piece 3d shipped dead with a clean gate.
        //
        // A document that arrives before the page has connected its sidebar is PARKED on the bridge
        // rather than dropped, and the controller drains it when it installs the hook. Dropping it
        // would leave the old runtime holding the stored key's copy for the rest of the run with
        // nothing to say so.
        let state = held.to_json();
        let script = format!(
            "(function(bridge, state) {{ if (!bridge) return; if (bridge.applyWorkspaceGroups) bridge.applyWorkspaceGroups(state); else bridge.pendingWorkspaceGroups = state; }})(window.ghostexGpui, {state}); undefined;"
        );
        service.update(cx, |surface, _| {
            surface.execute_app_owned_script(&script);
        });
        self.gx_store.workspace_groups.counters.hand_backs += 1;
        self.gx_store.workspace_groups.handed_back = Some(held);
    }

    fn gx_store_run_workspace_groups_effects(
        &mut self,
        effects: Vec<WorkspaceGroupsEffect>,
        cx: &mut gpui::Context<Self>,
    ) {
        for effect in effects {
            match effect {
                WorkspaceGroupsEffect::WriteStorage { document, remove } => {
                    self.gx_store_write_workspace_groups_storage(&document, remove, cx);
                }
                WorkspaceGroupsEffect::SchedulePush { delay_ms } => {
                    self.gx_store_book_workspace_groups_push(delay_ms, cx);
                }
            }
        }
    }

    /// `writeStoredGpuiWorkspaceSessionGroupsState`, which REMOVES the key for an empty document
    /// rather than storing an empty object.
    fn gx_store_write_workspace_groups_storage(
        &mut self,
        document: &Value,
        remove: bool,
        cx: &mut gpui::Context<Self>,
    ) {
        let raw = match remove {
            true => None,
            false => Some(document.to_string()),
        };
        if remove {
            self.gx_store.workspace_groups.counters.storage_removes += 1;
        } else {
            self.gx_store.workspace_groups.counters.storage_writes += 1;
        }
        let background = cx.background_executor().clone();
        cx.spawn(async move |this, cx| {
            let result = background
                .spawn(async move {
                    sidebar_ui_storage::write_preference_value(
                        WORKSPACE_GROUPS_STORAGE_KEY,
                        raw.as_deref(),
                    )
                })
                .await;
            let _ = this.update(cx, |this, _| {
                if result.is_err() {
                    this.gx_store.workspace_groups.counters.storage_failures += 1;
                }
            });
        })
        .detach();
    }

    /// Books the push, replacing whatever booking was outstanding. A drag that moves a row five
    /// times therefore pushes once, after the last move.
    fn gx_store_book_workspace_groups_push(&mut self, delay_ms: u64, cx: &mut gpui::Context<Self>) {
        self.gx_store.workspace_groups.booking += 1;
        let booking = self.gx_store.workspace_groups.booking;
        let background = cx.background_executor().clone();
        cx.spawn(async move |this, cx| {
            background.timer(Duration::from_millis(delay_ms)).await;
            let _ = this.update(cx, |this, cx| {
                // A booking that was replaced fires nothing: `clearTimeout` is what the TypeScript
                // does, and a timer that cannot be cancelled has to check instead.
                if this.gx_store.workspace_groups.booking == booking {
                    this.gx_store_push_workspace_groups(cx);
                }
            });
        })
        .detach();
    }

    fn gx_store_push_workspace_groups(&mut self, cx: &mut gpui::Context<Self>) {
        let (document, revision) = self.gx_store.workspace_groups.sync.push_started();
        self.gx_store.workspace_groups.counters.pushes += 1;
        let params = serde_json::json!({ "state": document });
        let background = cx.background_executor().clone();
        cx.spawn(async move |this, cx| {
            let result = background
                .spawn(async move {
                    gpui_gxserver_rpc_result(
                        "/api/updateWorkspaceSessionGroups",
                        &params,
                        PUSH_TIMEOUT,
                    )
                })
                .await;
            let _ = this.update(cx, |this, cx| {
                let ok = result.is_ok();
                if !ok {
                    this.gx_store.workspace_groups.counters.push_failures += 1;
                }
                let effects = this
                    .gx_store
                    .workspace_groups
                    .sync
                    .push_finished(revision, ok);
                this.gx_store_run_workspace_groups_effects(effects, cx);
                this.gx_store
                    .diagnostics
                    .workspace_groups_pushed(ok, this.gx_store.workspace_groups.counters);
            });
        })
        .detach();
    }

    /// Puts a document into the store, which is what makes the list draw it. The intent carries no
    /// revision: this document is the client's and the daemon keeps a copy of it, not the reverse.
    fn gx_store_apply_workspace_groups_to_store(
        &mut self,
        document: &WorkspaceGroupsDocument,
        cx: &mut gpui::Context<Self>,
    ) {
        let output = self.gx_store.core.handle(
            Event::Intent(Intent::SetWorkspaceGroups {
                machine: MachineId::Local,
                state: Box::new(document.to_side_state()),
            }),
            super::host::now_ms(),
        );
        if !output.changes.is_empty() {
            self.gx_store.sidebar_list.note_changes(&output.changes);
            self.gx_store_update_sidebar_list(cx);
        }
    }
}
