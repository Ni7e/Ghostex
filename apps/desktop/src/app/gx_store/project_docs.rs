//! K5 and K6 inside the app: the project collections document and the Spaces document.
//!
//! CDXC:Projects 2026-09-21 DECISION:
//! User, 2026-09-19: the desktop app stops running product logic in QuickJS and one Rust store owns
//! projects. For these two documents that decision lands as OWNERSHIP: this app is the only desktop
//! writer of `ghostex.sidebar.projectCollections.v1` and the only caller of
//! `/api/updateSidebarProjectCollections` and `/api/updateSidebarSpaces` for this computer. The
//! sidebar page keeps its in-memory copy and its menus, and is handed the held document back after
//! every change so its next edit is never computed from a stale base. Supersedes the placement, not
//! the intent, of `CDXC:Projects 2026-07-18-00:00` and `CDXC:Spaces 2026-08-27`: localStorage is
//! still the instant-edit overlay and the write-through is still debounced with an indefinite retry
//! and an echo guard, all of it now in Rust.
//!
//! **A REMOTE machine's copies are held, not owned.** `updateRemoteSidebarProjectCollections` and
//! `updateRemoteSidebarSpaces` are direct calls down that machine's tunnel, with no debounce and no
//! guard at all, and this app cannot reach one. So a gesture on a remote machine tab is refused in
//! the planner and the old runtime performs it, exactly as every other remote refusal in M5.
//!
//! SEE-ALSO: packages/gx-core/src/project_docs/,
//! apps/desktop/src/app/gx_store/client_document.rs,
//! apps/desktop/sidebar/native-sidebar/membership.ts.

use ghostex_gx_core::{
    CollectionsDocument, MachineId, ProjectWrite, SideStateUpdate, SidebarUiIntent, SpacesDocument,
    owns_project_move_command, plan_project_move,
};
use serde_json::{Value, json};

use super::client_document::{ClientDocument, ClientDocumentHost};
use crate::GhostexGpuiApp;

/// `ghostex.sidebar.projectCollections.v1`.
pub(crate) const COLLECTIONS_STORAGE_KEY: &str = "ghostex.sidebar.projectCollections.v1";

/// What this app run did with the project moves. Memory only.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub(crate) struct ProjectMoveCounters {
    /// Project-move payloads the store answered.
    pub(crate) moves: u64,
    /// Moves the rules refused (a group that is not there, a Space that is not there, a drop onto
    /// a target that moved out with the source).
    pub(crate) refusals: u64,
    pub(crate) collection_edits: u64,
    pub(crate) space_edits: u64,
    pub(crate) group_orders: u64,
    pub(crate) rename_requests: u64,
    pub(crate) hidden_toggles: u64,
    pub(crate) space_editors: u64,
    /// Payloads the store owns but did not answer because the renderer is not drawing its list.
    pub(crate) declined_source: u64,
    /// Payloads handed to the old runtime: a remote machine tab, a second loaded machine, or a
    /// shape this store cannot see the whole of.
    pub(crate) hand_offs: u64,
    /// Documents the sidebar page edited and handed over, one per `saveNativeCollections` and one
    /// per `updateSpaces` it makes for this computer. A run with a collection renamed, recoloured
    /// or ungrouped in it and a zero here means that edit was never stored.
    pub(crate) collection_hand_offs: u64,
    pub(crate) space_hand_offs: u64,
    /// Hand-offs refused because the stored key had not been read yet. The page keeps the document
    /// it edited and its next edit carries it.
    pub(crate) hand_offs_refused: u64,
    /// Hand-offs whose payload was not a document. Its own counter for the same reason
    /// `echoesUnparsable` has one: a silent drop here is an edit the user made and never got back.
    pub(crate) hand_offs_unparsable: u64,
}

impl ClientDocument for CollectionsDocument {
    const NAME: &'static str = "collections";
    const STORAGE_KEY: Option<&'static str> = Some(COLLECTIONS_STORAGE_KEY);
    const RPC_PATH: &'static str = "/api/updateSidebarProjectCollections";

    fn parse_storage(value: &Value) -> Self {
        Self::from_storage_json(value)
    }

    fn hand_back_script(&self) -> String {
        ghostex_gx_core::collections_hand_back_script(&self.to_wire_json())
    }

    fn request_script() -> Option<String> {
        Some(ghostex_gx_core::collections_request_script())
    }

    fn host(app: &mut GhostexGpuiApp) -> &mut ClientDocumentHost<Self> {
        &mut app.gx_store.collections
    }

    fn apply_to_store(
        app: &mut GhostexGpuiApp,
        document: &Self,
        cx: &mut gpui::Context<GhostexGpuiApp>,
    ) {
        let state = serde_json::from_value(document.to_wire_json()).unwrap_or_default();
        app.gx_store_apply_side_state(SideStateUpdate::ProjectCollections(state), cx);
    }

    fn server_state(app: &GhostexGpuiApp) -> Option<Value> {
        app.gx_store
            .core
            .presentation()
            .machine(&MachineId::Local)
            .and_then(|machine| machine.side_state().project_collections.as_ref())
            .and_then(|state| serde_json::to_value(state).ok())
    }
}

impl ClientDocument for SpacesDocument {
    const NAME: &'static str = "spaces";
    /// None at all: `CDXC:Spaces 2026-08-27` says gxserver owns the whole document, so there has
    /// never been a local copy and creating one here would be a second source of truth.
    const STORAGE_KEY: Option<&'static str> = None;
    const RPC_PATH: &'static str = "/api/updateSidebarSpaces";

    fn parse_storage(_value: &Value) -> Self {
        // Unreachable: `STORAGE_KEY` is `None`, so nothing reads a stored copy.
        Self::default()
    }

    fn hand_back_script(&self) -> String {
        ghostex_gx_core::spaces_hand_back_script(&self.to_wire_json())
    }

    /// None: with no stored key this host is ready from the first frame, so it never refuses a
    /// hand-off and there is nothing for a request to recover.
    fn request_script() -> Option<String> {
        None
    }

    fn host(app: &mut GhostexGpuiApp) -> &mut ClientDocumentHost<Self> {
        &mut app.gx_store.spaces
    }

    fn apply_to_store(
        app: &mut GhostexGpuiApp,
        document: &Self,
        cx: &mut gpui::Context<GhostexGpuiApp>,
    ) {
        let state = serde_json::from_value(document.to_wire_json()).unwrap_or_default();
        app.gx_store_apply_side_state(SideStateUpdate::Spaces(state), cx);
    }

    fn server_state(app: &GhostexGpuiApp) -> Option<Value> {
        app.gx_store
            .core
            .presentation()
            .machine(&MachineId::Local)
            .and_then(|machine| machine.side_state().spaces.as_ref())
            .and_then(|state| serde_json::to_value(state).ok())
    }
}

impl GhostexGpuiApp {
    /// Answers a project move. Returns whether it did, in which case the command must NOT also
    /// reach the old runtime, which would write both documents a second time.
    ///
    /// `moveGroup`, `moveSpace`, `moveToSpace`, `moveToCollection` and `moveCollection` are
    /// RENDERER commands and arrive at the TOP level; `projectMembership` and `spaceMembership`
    /// arrive the same way, because `controller.ts` answers the whole drag family itself. Getting
    /// that backwards is how piece 3d shipped dead with a clean gate, so this entry point reads the
    /// envelope it really gets and the caller passes the top-level payload.
    pub(crate) fn gx_store_run_project_move(
        &mut self,
        command: &Value,
        cx: &mut gpui::Context<Self>,
    ) -> bool {
        if !owns_project_move_command(command) {
            return false;
        }
        if !self.gx_store_sidebar_draws_store_list() {
            self.gx_store.project_moves.declined_source += 1;
            return false;
        }
        // Both documents have to be in hand before an edit lands on top of one: a move computed
        // against a document this app has not read yet would write an order over what it cannot
        // see. The Spaces document has no stored key, so it is ready at once; the collections
        // document books its read here and refuses until it lands.
        if !self.gx_document_restored::<CollectionsDocument>(cx) {
            self.gx_store.project_moves.declined_source += 1;
            return false;
        }
        // The project order also edits the workspace session groups document, so its stored key
        // has to be in hand too, for the same reason.
        if !self.gx_store_restore_workspace_groups(cx) {
            self.gx_store.project_moves.declined_source += 1;
            return false;
        }
        let plan = {
            let store = &self.gx_store;
            let spaces = store
                .spaces
                .sync
                .has_document()
                .then(|| store.spaces.sync.document());
            plan_project_move(
                &store.core,
                &store.sidebar_list.last_inputs,
                store.collections.sync.document(),
                spaces,
                command,
                super::host::now_ms() as i64,
            )
        };
        let Some(plan) = plan else {
            self.gx_store.project_moves.hand_offs += 1;
            return false;
        };
        self.gx_store.project_moves.moves += 1;
        if plan.writes.is_empty() {
            self.gx_store.project_moves.refusals += 1;
        }
        self.gx_store
            .diagnostics
            .project_move_ran(&plan, self.gx_store.project_moves);
        for write in plan.writes {
            self.gx_store_run_project_write(write, cx);
        }
        true
    }

    fn gx_store_run_project_write(&mut self, write: ProjectWrite, cx: &mut gpui::Context<Self>) {
        match write {
            ProjectWrite::EditCollections { document } => {
                self.gx_store.project_moves.collection_edits += 1;
                self.gx_document_edit::<CollectionsDocument>(document, cx);
            }
            ProjectWrite::EditSpaces { document } => {
                self.gx_store.project_moves.space_edits += 1;
                self.gx_document_edit::<SpacesDocument>(document, cx);
            }
            ProjectWrite::GroupOrder { group_ids } => {
                self.gx_store.project_moves.group_orders += 1;
                // The same entry point the renderer's own posts reach, so the project order write
                // has one implementation and not two.
                let message = json!({ "type": "syncGroupOrder", "groupIds": group_ids });
                if !self.gx_store_run_project_order_message(&message, cx) {
                    self.dispatch_native_sidebar_command(message, cx);
                }
            }
            ProjectWrite::RequestCollectionRename { collection_id } => {
                self.gx_store.project_moves.rename_requests += 1;
                // `ui.renameRequest = { collectionId, requestId: Date.now() }`, which the RENDERER
                // consumes: it opens its inline rename on the collection the drop just created. It
                // is held here rather than posted anywhere, because the snapshot carries it and the
                // old projection, which used to carry it, no longer knows the collection exists.
                let request_id = super::host::now_ms();
                self.gx_store.pending_collection_rename = Some((collection_id, request_id));
                self.gx_store_update_sidebar_list(cx);
            }
            ProjectWrite::HiddenGroup { group_id, hidden } => {
                self.gx_store.project_moves.hidden_toggles += 1;
                let intent = match hidden {
                    true => SidebarUiIntent::HideGroup { group_id },
                    false => SidebarUiIntent::UnhideGroup { group_id },
                };
                self.gx_store_apply_sidebar_ui_intent(intent, cx);
            }
            ProjectWrite::OpenSpaceEditor {
                section_key,
                member_collection_id,
                member_project_id,
            } => {
                self.gx_store.project_moves.space_editors += 1;
                // `openAppModal` from the sidebar page, through the same entry the store's Rename
                // and Note dialogs use. The keys the payload does NOT carry matter: an absent
                // `memberProjectId` is a field `JSON.stringify` drops, where a `null` would be one
                // the dialog has to interpret, which is the absent-versus-null class that has cost
                // this port two findings already.
                let mut open = json!({
                    "type": "open",
                    "modal": "sidebarSpaceEditor",
                    "mode": "create",
                    "sectionKey": section_key,
                });
                if let Some(collection_id) = member_collection_id {
                    open["memberCollectionId"] = Value::from(collection_id);
                }
                if let Some(project_id) = member_project_id {
                    open["memberProjectId"] = Value::from(project_id);
                }
                self.dispatch_open_gpui_app_modal_message(open, cx);
            }
        }
    }

    /// The sidebar page edited one of the two documents and handed it over instead of writing it.
    /// Applied as a local edit, which is exactly what `saveNativeCollections` and `updateSpaces`
    /// used to do by themselves: write the key, book the push.
    ///
    /// The document is taken WHOLE rather than merged, because the page computed it from the
    /// document this file handed it and a merge would invent a third answer neither side made.
    /// Taken as an edit even when it is equal to the held one, because that is what the page did:
    /// it wrote and posted unconditionally, and swallowing an equal hand-off here would be the same
    /// silent simplification one layer up.
    pub(crate) fn gx_store_receive_project_doc_hand_off(
        &mut self,
        collections: bool,
        state: &Value,
        cx: &mut gpui::Context<Self>,
    ) {
        if collections {
            // The stored key has to be in hand before an edit lands on top of it, for the same
            // reason the echo path reads it first: a cold start must not write a document built on
            // nothing. A read that has not landed refuses the edit and REMEMBERS that the page is
            // the only holder of it, so nothing is handed back in the meantime and the page is
            // asked to post it again when the read lands. Relying on "its next edit carries it" is
            // what K4's review round proved false: the restore hands the stored document over and
            // the page's copy, with the user's rename in it, is replaced.
            if !self.gx_document_restored::<CollectionsDocument>(cx) {
                self.gx_store.project_moves.hand_offs_refused += 1;
                self.gx_document_page_holds_newer::<CollectionsDocument>(true);
                return;
            }
            let Some(document) = CollectionsDocument::from_echo_json(state) else {
                self.gx_store.project_moves.hand_offs_unparsable += 1;
                return;
            };
            self.gx_store.project_moves.collection_hand_offs += 1;
            // The page's document is here; this app is the holder again.
            self.gx_document_page_holds_newer::<CollectionsDocument>(false);
            self.gx_document_edit::<CollectionsDocument>(document, cx);
            return;
        }
        let Some(document) = SpacesDocument::from_echo_json(state) else {
            self.gx_store.project_moves.hand_offs_unparsable += 1;
            return;
        };
        self.gx_store.project_moves.space_hand_offs += 1;
        self.gx_document_edit::<SpacesDocument>(document, cx);
    }

    /// The collection a project move just created, for the renderer's inline Rename. Read once:
    /// the renderer remembers the request id it handled, exactly as it does for the publish's.
    pub(crate) fn gx_store_pending_collection_rename(
        &self,
    ) -> Option<crate::app::native_sidebar::model::NativeSidebarRenameRequest> {
        self.gx_store
            .pending_collection_rename
            .as_ref()
            .map(|(collection_id, request_id)| {
                crate::app::native_sidebar::model::NativeSidebarRenameRequest {
                    collection_id: collection_id.clone(),
                    request_id: *request_id,
                }
            })
    }

    /// The daemon's copy of either document just landed in the store. Called from the one place a
    /// change summary reports it, so there is no second copy of this decision.
    pub(crate) fn gx_store_reconcile_project_docs(
        &mut self,
        collections: bool,
        spaces: bool,
        cx: &mut gpui::Context<Self>,
    ) {
        if collections {
            let state = CollectionsDocument::server_state(self);
            self.gx_document_reconcile::<CollectionsDocument>(state, cx);
        }
        if spaces {
            let state = SpacesDocument::server_state(self);
            self.gx_document_reconcile::<SpacesDocument>(state, cx);
        }
    }

    /// Books the read of the collections key, whatever else is happening.
    ///
    /// CDXC:Projects 2026-09-21 WHY:
    /// Asked on every pump, the way the prune books the workspace groups key, because nothing else
    /// books it before the daemon's first snapshot: the first call used to come from the reconcile
    /// that snapshot triggers, so the FIRST echo of every run was deferred, and a deferral judged
    /// against a side state the restore had just overwritten spent the collections document's
    /// first-echo push-back on this app's own document. It is one boolean after the read lands.
    pub(crate) fn gx_store_book_project_docs_read(&mut self, cx: &mut gpui::Context<Self>) {
        self.gx_document_restored::<CollectionsDocument>(cx);
    }

    /// Both documents on the quit path: the owed storage write, and then the push the daemon has
    /// not got yet.
    ///
    /// The push matters most for the Spaces document, which has no stored key at all, so a 400 ms
    /// debounce is the only thing between the gesture and the daemon; for the collections document
    /// it is the difference between the next launch reading the user's own key and adopting the
    /// daemon's older copy over it.
    pub(crate) fn gx_store_flush_project_docs(&mut self) {
        self.gx_document_flush_write::<CollectionsDocument>();
        self.gx_document_flush_write::<SpacesDocument>();
        self.gx_document_flush_push::<CollectionsDocument>();
        self.gx_document_flush_push::<SpacesDocument>();
    }
}
