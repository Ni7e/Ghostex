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
//! **The counters that prove this path fires** are `edits`, `storageWrites`, `pushes`,
//! `pushFailures`, `echoesAdopted` and `echoesRefused` on `gxStore.workspaceGroups`. A run in which
//! the user dragged a session inside a user-made group and `edits` is zero means the command never
//! reached here.
//!
//! SEE-ALSO: packages/gx-core/src/workspace_groups/sync.rs,
//! apps/desktop/sidebar/gxserver-runtime/workspace-groups-sync.ts,
//! apps/desktop/src/app/gx_store/sidebar_drag.rs.

use std::time::Duration;

use ghostex_gx_core::{
    AdoptOutcome, Event, Intent, MachineId, WorkspaceGroupsDocument, WorkspaceGroupsEffect,
    WorkspaceGroupsSync,
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
}

#[derive(Default)]
pub(crate) struct WorkspaceGroupsHost {
    pub(super) sync: WorkspaceGroupsSync,
    pub(crate) counters: WorkspaceGroupsCounters,
    /// Bumped by every booking, so a fired timer of a booking that was replaced does nothing.
    booking: u64,
    restored: bool,
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
