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
use std::sync::atomic::{AtomicU64, Ordering};
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
/// How long a storage write that lost the lock race waits before it is tried again, and how many
/// times. Nothing is lost while it fails: the owed write stays owed and the quit path flushes it.
const STORAGE_RETRY: Duration = Duration::from_millis(400);
const MAX_STORAGE_RETRIES: u32 = 3;
/// How long a failed read of the stored key waits before it is tried again, and how many times.
/// The same ladder the sidebar's own state uses, for the same reason: a lock race clears in
/// milliseconds and a missing database never will.
const READ_RETRY: Duration = Duration::from_secs(5);
const MAX_READ_RETRIES: u32 = 6;

/// Native-host messages dropped because no window was active when they arrived.
///
/// CDXC:Sessions 2026-09-21 WHY:
/// A process-wide count, not this document's own, and named for what it really measures: the
/// handler in `session_chat.rs` is shared by every `ghostexNativeHost` message and needs a window,
/// so a hand-off of the workspace session groups document can vanish there with nothing else to
/// say so. A non-zero value beside a `handOffs` that did not move is the shape of a rename that
/// never reached disk. It is not specific to this message and is not reported as if it were.
static NATIVE_HOST_MESSAGES_DROPPED: AtomicU64 = AtomicU64::new(0);

pub(crate) fn note_native_host_message_dropped() {
    NATIVE_HOST_MESSAGES_DROPPED.fetch_add(1, Ordering::Relaxed);
}

pub(super) fn native_host_messages_dropped() -> u64 {
    NATIVE_HOST_MESSAGES_DROPPED.load(Ordering::Relaxed)
}

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
    /// moves and a zero `edits` means nothing reached this file at all. It counts ONLY a real
    /// refusal; "there was no echo to judge" is `echoes_absent`, which it used to be folded into.
    pub(crate) echoes_refused: u64,
    /// Reconciles where the daemon had sent no document at all.
    pub(crate) echoes_absent: u64,
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
    /// Documents a storage bound refused. Not retried: the payload does not shrink by trying again.
    pub(crate) storage_refusals: u64,
    /// Reads of the stored key that failed. Until one succeeds nothing is adopted and nothing is
    /// edited, so a non-zero value here beside a zero `edits` is this app refusing to guess.
    pub(crate) read_failures: u64,
    /// Hand-offs refused because the stored key had not been read yet. The page still holds the
    /// document and its next edit carries it.
    pub(crate) hand_offs_refused: u64,
    /// Daemon echoes left unjudged for the same reason.
    pub(crate) echoes_deferred: u64,
    /// Hand-backs whose script the service refused to evaluate. The page's copy is then the stale
    /// base of its next edit, which is declared difference 29 in a second shape, so the record of
    /// what it was told is NOT advanced and the next change tells it again.
    pub(crate) hand_backs_dropped: u64,
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
    /// The storage write that has not landed yet: `None` is the REMOVE, `Some(raw)` the value, and
    /// the whole field absent is "nothing owed". Replaced by any newer write and cleared only by
    /// the attempt that was carrying it.
    owed_write: Option<Option<String>>,
    write_retries: u32,
    read_retries: u32,
    read_retry_scheduled: bool,
}

impl GhostexGpuiApp {
    /// Seeds the document from the stored key, once. Not an edit: nothing has changed that the
    /// server does not have, so no push is booked. Returns whether the stored key is in hand.
    ///
    /// CDXC:Sessions 2026-09-21 WHY:
    /// **A failed read is not a read.** The first cut set `restored` BEFORE the read and swallowed
    /// the error, so a read that lost the lock race left the held document EMPTY, the first daemon
    /// echo was adopted with nothing pending, and the write that follows an adopt overwrote the
    /// stored key: the exact thing the comment on the echo path says must not happen, done by that
    /// path. The flag is set only on a successful read now, the failure is retried on its own timer
    /// the way the sidebar's own state is, and until it lands nothing may adopt an echo or edit the
    /// document, because both would be computed against a document this app does not have.
    pub(super) fn gx_store_restore_workspace_groups(
        &mut self,
        cx: &mut gpui::Context<Self>,
    ) -> bool {
        if self.gx_store.workspace_groups.restored {
            return true;
        }
        let stored = match sidebar_ui_storage::read_preference_value(WORKSPACE_GROUPS_STORAGE_KEY) {
            Ok(stored) => stored,
            Err(code) => {
                self.gx_store.workspace_groups.counters.read_failures += 1;
                self.gx_store.diagnostics.workspace_groups_read_failed(code);
                self.gx_store_schedule_workspace_groups_read_retry(cx);
                return false;
            }
        };
        self.gx_store.workspace_groups.restored = true;
        let document = stored
            .and_then(|raw| serde_json::from_str::<Value>(&raw).ok())
            .map(|value| WorkspaceGroupsDocument::parse(&value));
        // A key that is absent, or holds something that is not JSON, is an EMPTY document and not a
        // failure: that is a first launch, and `parse` answers the same way for a damaged payload.
        let Some(document) = document else {
            self.gx_store_tell_old_runtime_workspace_groups(cx);
            return true;
        };
        self.gx_store
            .workspace_groups
            .sync
            .restore(document.clone());
        self.gx_store_apply_workspace_groups_to_store(&document, cx);
        self.gx_store_tell_old_runtime_workspace_groups(cx);
        true
    }

    /// Books another read after a failure, a bounded number of times. Nothing is lost while it
    /// fails: the page keeps its own copy, and no edit or echo is applied until this lands.
    fn gx_store_schedule_workspace_groups_read_retry(&mut self, cx: &mut gpui::Context<Self>) {
        let groups = &mut self.gx_store.workspace_groups;
        if groups.read_retry_scheduled || groups.read_retries >= MAX_READ_RETRIES {
            return;
        }
        groups.read_retries += 1;
        groups.read_retry_scheduled = true;
        cx.spawn(async move |this, cx| {
            cx.background_executor().timer(READ_RETRY).await;
            let _ = this.update(cx, |this, cx| {
                this.gx_store.workspace_groups.read_retry_scheduled = false;
                this.gx_store_restore_workspace_groups(cx);
            });
        })
        .detach();
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
        // A read that has not landed refuses the edit rather than writing over what it cannot see;
        // the page keeps the document in memory and its next edit carries it.
        if !self.gx_store_restore_workspace_groups(cx) {
            self.gx_store.workspace_groups.counters.hand_offs_refused += 1;
            return;
        }
        self.gx_store.workspace_groups.counters.hand_offs += 1;
        // Taken as an edit even when the document is equal to the held one, because that is what
        // `persistWorkspaceGroups` did: it wrote the key and booked the push unconditionally, and
        // `syncGpuiWorkspaceSessionOrderInSubgroup` really does hand back an equal document
        // (workspace_groups/edits.rs explains why that identity is modelled rather than improved).
        // Swallowing it here would be the same silent simplification one layer up.
        self.gx_store_edit_workspace_groups(WorkspaceGroupsDocument::parse(state), cx);
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
        if !self.gx_store_restore_workspace_groups(cx) {
            return;
        }
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
        // offline. One read, on the first call, and an echo arriving before it lands is left
        // entirely alone: the daemon's value stays in the side state and the next reconcile, after
        // the retry, judges it properly.
        if !self.gx_store_restore_workspace_groups(cx) {
            self.gx_store.workspace_groups.counters.echoes_deferred += 1;
            return;
        }
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
            AdoptOutcome::NoEcho => self.gx_store.workspace_groups.counters.echoes_absent += 1,
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
        // envelopes and picking the wrong one is how piece 3d shipped dead with a clean gate. The
        // script itself is built in gx-core so the gate can evaluate the real text against the real
        // page code (`workspace_groups_hand_back_script`).
        let script = ghostex_gx_core::workspace_groups_hand_back_script(&held.to_json());
        // The return value decides whether this counts as told. `evaluate` reports an error and
        // discards the script, so recording the document as handed back from the CALL rather than
        // from the answer would leave the page holding a stale base for ever.
        let sent = service.update(cx, |surface, _| surface.execute_app_owned_script(&script));
        if !sent {
            self.gx_store.workspace_groups.counters.hand_backs_dropped += 1;
            return;
        }
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
    ///
    /// CDXC:Sessions 2026-09-21 WHY:
    /// A write that does not reach storage is OWED again rather than counted and dropped. The
    /// database is WAL, so reads never block, but a second connection's write really does fail with
    /// "database is locked" after the busy timeout while the QuickJS service holds a write
    /// transaction; a rename or a move that lost that race, followed by a quit before the debounced
    /// push reached the daemon, was gone. The owed write is replaced by any later one, retried a
    /// bounded number of times, and flushed synchronously on the quit path beside the other three
    /// keys.
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
        // The newest write replaces whatever was owed: they are the same key and the same document
        // lineage, so an older payload has nothing to add.
        self.gx_store.workspace_groups.owed_write = Some(raw.clone());
        self.gx_store.workspace_groups.write_retries = 0;
        self.gx_store_run_workspace_groups_storage_write(raw, cx);
    }

    fn gx_store_run_workspace_groups_storage_write(
        &mut self,
        raw: Option<String>,
        cx: &mut gpui::Context<Self>,
    ) {
        if raw.is_none() {
            self.gx_store.workspace_groups.counters.storage_removes += 1;
        } else {
            self.gx_store.workspace_groups.counters.storage_writes += 1;
        }
        let attempted = raw.clone();
        let background = cx.background_executor().clone();
        cx.spawn(async move |this, cx| {
            let result = background
                .spawn(async move {
                    sidebar_ui_storage::write_workspace_groups_value(
                        WORKSPACE_GROUPS_STORAGE_KEY,
                        raw.as_deref(),
                    )
                })
                .await;
            let _ = this.update(cx, |this, cx| {
                this.gx_store_note_workspace_groups_write(attempted, result, cx);
            });
        })
        .detach();
    }

    /// What a storage attempt came back with. A refusal is not retried, because the payload does
    /// not shrink by trying again; a failure is, because it is a lock race.
    fn gx_store_note_workspace_groups_write(
        &mut self,
        attempted: Option<String>,
        result: Result<Option<&'static str>, &'static str>,
        cx: &mut gpui::Context<Self>,
    ) {
        let groups = &mut self.gx_store.workspace_groups;
        // An owed write that a newer one replaced is not this attempt's to clear.
        let current = groups.owed_write.as_ref() == Some(&attempted);
        match result {
            Ok(refusal) => {
                if current {
                    groups.owed_write = None;
                    groups.write_retries = 0;
                }
                if let Some(bound) = refusal {
                    groups.counters.storage_refusals += 1;
                    self.gx_store
                        .diagnostics
                        .workspace_groups_write_refused(bound);
                }
            }
            Err(code) => {
                groups.counters.storage_failures += 1;
                let retry = current && groups.write_retries < MAX_STORAGE_RETRIES;
                if current {
                    groups.write_retries += 1;
                }
                self.gx_store
                    .diagnostics
                    .workspace_groups_write_failed(code);
                if retry {
                    self.gx_store_book_workspace_groups_storage_retry(attempted, cx);
                }
            }
        }
    }

    fn gx_store_book_workspace_groups_storage_retry(
        &mut self,
        raw: Option<String>,
        cx: &mut gpui::Context<Self>,
    ) {
        cx.spawn(async move |this, cx| {
            cx.background_executor().timer(STORAGE_RETRY).await;
            let _ = this.update(cx, |this, cx| {
                // Only if nothing newer is owed, which would already be on its way.
                if this.gx_store.workspace_groups.owed_write.as_ref() == Some(&raw) {
                    this.gx_store_run_workspace_groups_storage_write(raw, cx);
                }
            });
        })
        .detach();
    }

    /// Stores whatever the document still owes, synchronously, on the quit path. Without it a
    /// rename made in the last four hundred milliseconds, or one whose write lost a lock race, dies
    /// with the app: the push has not gone out either.
    pub(crate) fn gx_store_flush_workspace_groups_write(&mut self) {
        let Some(raw) = self.gx_store.workspace_groups.owed_write.take() else {
            return;
        };
        match sidebar_ui_storage::write_workspace_groups_value(
            WORKSPACE_GROUPS_STORAGE_KEY,
            raw.as_deref(),
        ) {
            Ok(refusal) => {
                if raw.is_none() {
                    self.gx_store.workspace_groups.counters.storage_removes += 1;
                } else {
                    self.gx_store.workspace_groups.counters.storage_writes += 1;
                }
                if let Some(bound) = refusal {
                    self.gx_store.workspace_groups.counters.storage_refusals += 1;
                    self.gx_store
                        .diagnostics
                        .workspace_groups_write_refused(bound);
                }
            }
            Err(code) => {
                self.gx_store.workspace_groups.counters.storage_failures += 1;
                self.gx_store
                    .diagnostics
                    .workspace_groups_write_failed(code);
            }
        }
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
