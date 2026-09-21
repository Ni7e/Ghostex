//! The project the Add Project dialog just added, joining the open Space and going to the top.
//!
//! CDXC:Spaces 2026-09-15 DECISION:
//! User: a project added through the Add Project dialog joins the Space that is open in the sidebar
//! and goes to the top of it. The sidebar page owned both halves (`receiveNativeSidebarEvent`), and
//! it is going away, so the app owns them for THIS COMPUTER: the membership is written the moment
//! the dialog reports the project, and the project id is then HELD until the daemon lists it and
//! the sidebar has a group for it, which is when the order can be written at all. The page keeps
//! both halves for a remote machine, whose documents go down that machine's tunnel.
//!
//! The held id survives nothing: it is memory only and a launch that never sees the project
//! forgets it, exactly as the page's `pendingAddedProject` did.
//!
//! SEE-ALSO: packages/gx-core/src/sidebar_drag/added_project.rs,
//! apps/desktop/sidebar/native-sidebar/events.ts,
//! apps/desktop/src/app/gx_store/project_docs.rs.

use ghostex_gx_core::{
    AddedProjectPlacement, SpacesDocument, plan_added_project_placement,
    plan_added_project_space_membership,
};
use serde_json::json;

use crate::GhostexGpuiApp;

/// The project the dialog reported and what this run did with the ones before it.
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub(crate) struct AddedProjectHost {
    /// The workspace project id waiting for a sidebar group. Memory only.
    pub(super) pending_project_id: Option<String>,
    pub(super) counters: AddedProjectCounters,
}

/// What this app run did with the added projects. Memory only.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub(crate) struct AddedProjectCounters {
    /// Projects the dialog reported for this computer.
    pub(crate) added: u64,
    /// Of those, the ones that joined the open Space.
    pub(crate) space_memberships: u64,
    /// Projects whose group appeared and whose family was moved to the top.
    pub(crate) placements: u64,
    /// Projects whose group appeared where the order was already the one wanted.
    pub(crate) placements_unchanged: u64,
    /// Projects reported for a remote machine, which the old runtime still places.
    pub(crate) hand_offs: u64,
}

impl GhostexGpuiApp {
    /// The Add Project dialog reported a project. Writes the Space membership and starts holding
    /// the project id for the order.
    pub(crate) fn gx_store_note_added_project(
        &mut self,
        project_id: &str,
        remote_machine_id: Option<&str>,
        cx: &mut gpui::Context<Self>,
    ) {
        if remote_machine_id.is_some() {
            self.gx_store.added_project.counters.hand_offs += 1;
            return;
        }
        self.gx_store.added_project.counters.added += 1;
        let plan = {
            let store = &self.gx_store;
            let spaces = store
                .spaces
                .sync
                .has_document()
                .then(|| store.spaces.sync.document());
            plan_added_project_space_membership(
                &store.core,
                &store.sidebar_list.last_inputs,
                store.collections.sync.document(),
                spaces,
                project_id,
            )
        };
        if let Some(document) = plan {
            self.gx_store.added_project.counters.space_memberships += 1;
            self.gx_document_edit::<SpacesDocument>(document, cx);
        }
        // Held even when the membership wrote nothing: the ORDER is owed for every added project,
        // and the two halves of `receiveNativeSidebarEvent` are independent of each other.
        self.gx_store.added_project.pending_project_id = Some(project_id.to_string());
        self.gx_store.diagnostics.added_project_noted(
            self.gx_store.added_project.counters,
            self.gx_store.added_project.pending_project_id.is_some(),
        );
        // The group may already be there: the dialog can be reporting a project the daemon lists
        // this instant, and the page ran its own pending check in the same call.
        self.gx_store_place_added_project(cx);
    }

    /// Moves a held project's family to the top of the group order once the sidebar has a group
    /// for it. Called on every burst, and costs one `None` check per burst when nothing is held.
    pub(crate) fn gx_store_place_added_project(&mut self, cx: &mut gpui::Context<Self>) {
        let Some(project_id) = self.gx_store.added_project.pending_project_id.clone() else {
            return;
        };
        let placement = {
            let store = &self.gx_store;
            plan_added_project_placement(&store.core, &store.sidebar_list.last_inputs, &project_id)
        };
        let AddedProjectPlacement::Placed { group_ids } = placement else {
            return;
        };
        self.gx_store.added_project.pending_project_id = None;
        let Some(group_ids) = group_ids else {
            self.gx_store.added_project.counters.placements_unchanged += 1;
            self.gx_store
                .diagnostics
                .added_project_noted(self.gx_store.added_project.counters, false);
            return;
        };
        self.gx_store.added_project.counters.placements += 1;
        self.gx_store
            .diagnostics
            .added_project_noted(self.gx_store.added_project.counters, false);
        // The same entry point the project moves' own order write reaches, so the project order has
        // one implementation and not two.
        let message = json!({ "type": "syncGroupOrder", "groupIds": group_ids });
        if !self.gx_store_run_project_order_message(&message, cx) {
            self.dispatch_native_sidebar_command(message, cx);
        }
    }
}
