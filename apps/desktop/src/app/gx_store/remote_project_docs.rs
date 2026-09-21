//! A REMOTE machine's project collections and Spaces documents: read from that machine's side
//! state, edited by the same planners this computer's use, and sent back down its own tunnel.
//!
//! CDXC:RemoteMachines 2026-09-21 DECISION:
//! User, plan question 3 option A: a Project Group or Space edit made on a remote machine's tab
//! behaves exactly as it does today, by reaching the runtime functions that already perform it
//! (`updateRemoteSidebarProjectCollections`, `updateRemoteSidebarSpaces`). What changes is only who
//! computes the document: the STORE does, as it already does for this computer, and the message
//! goes straight to the runtime on `window.ghostexGpui.onSidebarCommand` instead of through the
//! sidebar page. Forwarding the gesture verbatim was not an option: `handleSidebarMessage` has no
//! arm for `moveGroup`, `moveToSpace`, `moveToCollection`, `moveCollection`, `moveSpace`,
//! `projectMembership` or `spaceMembership`, because the page answered that whole family itself.
//!
//! **A remote document is HELD, never owned.** There is no stored key, no debounce, no
//! pending-push guard and no echo funnel: `updateSidebarProjectCollections` with a
//! `remoteMachineId` is one direct call, and the machine's answer comes back on the presentation
//! and replaces the held copy. That is what the page did and all it did, so nothing here waits for
//! a read before it edits, and blocker 9's drop queue must never hold a remote drop for this
//! computer's keys.
//!
//! SEE-ALSO: apps/desktop/sidebar/native-sidebar/membership.ts (`saveNativeCollections`),
//! apps/desktop/sidebar/native-sidebar/metadata.ts (`updateSpaces`, `adoptCollections`),
//! apps/desktop/src/app/gx_store/project_docs.rs.

use std::collections::HashMap;

use ghostex_gx_core::{CollectionsDocument, MachineId, SpacesDocument};
use serde_json::{Value, json};

use crate::GhostexGpuiApp;

/// The per-machine state a remote edit needs, and what this run did with them. Memory only.
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub(crate) struct RemoteProjectDocsHost {
    /// `adoptCollections`'s `Math.max(parsed.nextCollectionNumber, previous?.nextCollectionNumber
    /// ?? 1)`, kept per machine.
    next_collection_numbers: HashMap<String, i64>,
    pub(super) counters: RemoteProjectDocCounters,
}

/// What this app run sent down the machine tunnels. Memory only.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub(crate) struct RemoteProjectDocCounters {
    /// Collections documents sent to a remote machine.
    pub(crate) collection_writes: u64,
    /// Spaces documents sent to a remote machine.
    pub(crate) space_writes: u64,
    /// Project order writes a remote gesture did not send at all. See
    /// `ProjectMovePlan::without_group_order`: the order the sidebar page posted for a remote drag
    /// named two machines and was refused by the runtime, so a remote reorder has never saved one.
    pub(crate) orders_dropped: u64,
    /// Edits made with no runtime to send them to, which is a launch window and not a state the
    /// user can reach by hand. Its own counter because a silent drop here is an edit that vanished.
    pub(crate) unsent: u64,
}

impl GhostexGpuiApp {
    /// The remote machine whose tab is open, or `None` for this computer's.
    pub(crate) fn gx_store_selected_remote_machine_id(&self) -> Option<String> {
        let selected = self.gx_store.sidebar_ui.selected_machine_id();
        match selected == ghostex_gx_core::LOCAL_MACHINE_ID {
            true => None,
            false => Some(selected.to_string()),
        }
    }

    /// One machine's collections document, as the page's `ui.metadata.collections[machineId]` held
    /// it: the daemon's copy with this run's `nextCollectionNumber` floor over it.
    ///
    /// The floor is the reason this is not a bare parse. The number is an in-memory counter, not a
    /// field the remote daemon maintains, so without it two Add to Group gestures in a row, made
    /// before the first answer comes back, both name their folder "Group 7".
    pub(crate) fn gx_store_remote_collections(&mut self, machine_id: &str) -> CollectionsDocument {
        let mut document = self
            .gx_store
            .core
            .presentation()
            .machine(&MachineId::Remote(machine_id.to_string()))
            .and_then(|machine| machine.side_state().project_collections.as_ref())
            .map(CollectionsDocument::from_wire)
            .unwrap_or_else(CollectionsDocument::empty);
        let held = self
            .gx_store
            .remote_project_docs
            .next_collection_numbers
            .entry(machine_id.to_string())
            .or_insert(1);
        document.next_collection_number = document.next_collection_number.max(*held);
        *held = document.next_collection_number;
        document
    }

    /// One machine's Spaces document, or `None` when it has published none.
    ///
    /// `None` is `ui.metadata.spaces[machineId]` being undefined, which every arm of the planners
    /// treats as "the tick does nothing at all", so it must stay distinct from an empty document.
    pub(crate) fn gx_store_remote_spaces(&self, machine_id: &str) -> Option<SpacesDocument> {
        self.gx_store
            .core
            .presentation()
            .machine(&MachineId::Remote(machine_id.to_string()))
            .and_then(|machine| machine.side_state().spaces.as_ref())
            .map(SpacesDocument::from_wire)
    }

    /// `post({ type: 'updateSidebarProjectCollections', state, remoteMachineId })`.
    pub(crate) fn gx_store_send_remote_collections(
        &mut self,
        machine_id: &str,
        document: &CollectionsDocument,
        cx: &mut gpui::Context<Self>,
    ) {
        // The counter this run just spent, so the next create on the same machine cannot reuse it
        // while the machine's answer is still in flight.
        self.gx_store
            .remote_project_docs
            .next_collection_numbers
            .insert(machine_id.to_string(), document.next_collection_number);
        self.gx_store.remote_project_docs.counters.collection_writes += 1;
        self.gx_store_send_remote_project_doc(
            "updateSidebarProjectCollections",
            machine_id,
            document.to_wire_json(),
            cx,
        );
    }

    /// `post({ type: 'updateSidebarSpaces', state, remoteMachineId })`.
    ///
    /// `/api/updateSidebarSpaces` is on the daemon's remote allowlist (`server/src/protocol.rs`),
    /// checked rather than assumed, so this really does reach the machine.
    pub(crate) fn gx_store_send_remote_spaces(
        &mut self,
        machine_id: &str,
        document: &SpacesDocument,
        cx: &mut gpui::Context<Self>,
    ) {
        self.gx_store.remote_project_docs.counters.space_writes += 1;
        self.gx_store_send_remote_project_doc(
            "updateSidebarSpaces",
            machine_id,
            document.to_wire_json(),
            cx,
        );
    }

    fn gx_store_send_remote_project_doc(
        &mut self,
        message_type: &str,
        machine_id: &str,
        state: Value,
        cx: &mut gpui::Context<Self>,
    ) {
        let sent = self.gx_store_send_sidebar_runtime_command(
            json!({
                "type": message_type,
                "state": state,
                "remoteMachineId": machine_id,
            }),
            cx,
        );
        if !sent {
            self.gx_store.remote_project_docs.counters.unsent += 1;
        }
    }

    /// The counters, for the periodic summary in `sidebar_remote.rs`.
    pub(super) fn gx_store_remote_project_doc_counters(&self) -> RemoteProjectDocCounters {
        self.gx_store.remote_project_docs.counters
    }

    /// A remote gesture whose project order write was dropped.
    pub(super) fn gx_store_note_remote_order_dropped(&mut self) {
        self.gx_store.remote_project_docs.counters.orders_dropped += 1;
    }
}

/// The counters as the summary carries them: 4 keys at depth 2.
pub(super) fn remote_project_doc_counters_json(counters: &RemoteProjectDocCounters) -> Value {
    json!({
        "collectionWrites": counters.collection_writes,
        "spaceWrites": counters.space_writes,
        "ordersDropped": counters.orders_dropped,
        "unsent": counters.unsent,
    })
}
