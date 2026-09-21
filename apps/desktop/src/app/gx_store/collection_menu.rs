//! A Project Group's Rename, colour and Ungroup inside the app.
//!
//! CDXC:Projects 2026-09-21 DECISION:
//! User, 2026-09-19: the desktop app stops running product logic in QuickJS. These three menu items
//! were the last `collectionAction` arms the sidebar page still wrote the collections document for
//! (`runNativeCollectionAction`), so they join the project moves on the same host and this app is
//! the only desktop writer of that document for this computer. The other four arms of the same
//! payload (`toggle`, `select`, `toggleProjects`, `hide`) write no document and stay where they
//! are, in `sidebar_ui_commands.rs`.
//!
//! **A REMOTE machine's tab is refused here**, exactly as the project moves refuse it:
//! `updateRemoteSidebarProjectCollections` is a direct call down that machine's tunnel with no
//! debounce and no guard, and this app cannot make one. The payload then reaches the old runtime
//! whole and behaves as it always has.
//!
//! SEE-ALSO: packages/gx-core/src/project_docs/collection_menu.rs,
//! apps/desktop/sidebar/native-sidebar/collections.ts,
//! apps/desktop/src/app/gx_store/project_docs.rs.

use ghostex_gx_core::{
    CollectionsDocument, owns_collection_menu_command, plan_collection_menu_edit,
};
use serde_json::Value;

use crate::GhostexGpuiApp;

/// What this app run did with the three document-writing Project Group menu items. Memory only.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub(crate) struct CollectionMenuCounters {
    pub(crate) renames: u64,
    pub(crate) colors: u64,
    pub(crate) ungroups: u64,
    /// Payloads whose collection id names nothing the document holds, which write nothing at all.
    pub(crate) refusals: u64,
    /// Payloads the store owns but did not answer because the renderer is not drawing its list.
    pub(crate) declined_source: u64,
    /// Payloads left to the old runtime: a remote machine's tab, or the stored key not read yet.
    pub(crate) hand_offs: u64,
}

impl GhostexGpuiApp {
    /// Answers a Project Group's Rename, colour or Ungroup. Returns whether it did, in which case
    /// the payload must NOT also reach the old runtime, which would write the document twice.
    pub(crate) fn gx_store_run_collection_menu_edit(
        &mut self,
        command: &Value,
        cx: &mut gpui::Context<Self>,
    ) -> bool {
        if !owns_collection_menu_command(command) {
            return false;
        }
        if !self.gx_store_sidebar_draws_store_list() {
            self.gx_store.collection_menu.declined_source += 1;
            return false;
        }
        // Every arm of `runNativeCollectionAction` reads `ui.selectedMachineId`, and only this
        // computer's document is one this app owns.
        if self.gx_store.sidebar_ui.selected_machine_id() != ghostex_gx_core::LOCAL_MACHINE_ID {
            self.gx_store.collection_menu.hand_offs += 1;
            return false;
        }
        // The stored key has to be in hand before an edit lands on top of it, for the same reason
        // a project drop refuses until it is: a rename computed against a document this app has not
        // read would store one folder and drop every other.
        if !self.gx_document_restored::<CollectionsDocument>(cx) {
            self.gx_store.collection_menu.hand_offs += 1;
            return false;
        }
        let plan = plan_collection_menu_edit(self.gx_store.collections.sync.document(), command);
        let action = command
            .get("action")
            .and_then(Value::as_str)
            .unwrap_or_default()
            .to_string();
        let Some(document) = plan else {
            self.gx_store.collection_menu.refusals += 1;
            self.gx_store.diagnostics.collection_menu_ran(
                &action,
                false,
                self.gx_store.collection_menu,
            );
            // Answered: the TypeScript's `if (!collection) return` writes nothing and sends the
            // payload nowhere else either, so handing it on would be a second, different answer.
            return true;
        };
        match action.as_str() {
            "rename" => self.gx_store.collection_menu.renames += 1,
            "ungroup" => self.gx_store.collection_menu.ungroups += 1,
            _ => self.gx_store.collection_menu.colors += 1,
        }
        self.gx_store
            .diagnostics
            .collection_menu_ran(&action, true, self.gx_store.collection_menu);
        self.gx_document_edit::<CollectionsDocument>(document, cx);
        true
    }
}
