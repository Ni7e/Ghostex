//! The record lines for the Project Group and Space EDITS, in a sibling because `diagnostics.rs`
//! is over the size ceiling and waiting for a quiet window.
//!
//! CDXC:Spaces 2026-09-21 WHY:
//! Nothing a user typed or named may reach these lines. A Project Group carries a title the user
//! wrote and a Space carries a name and an icon, so the lines say which action ran, whether it
//! wrote, and the run's totals, and never an id, a title, a Space name or a path. The counters ride
//! every line because they are the only proof the path fires at all: a run in which the user
//! renamed a Project Group and `renames` is zero means the old runtime is still the only writer.
//!
//! SEE-ALSO: apps/desktop/src/app/gx_store/collection_menu.rs,
//! apps/desktop/src/app/gx_store/diagnostics.rs.

use serde_json::json;

use ghostex_gx_core::SpaceEditorMode;

use super::collection_menu::CollectionMenuCounters;
use super::diagnostics::{
    GxStoreDiagnostics, MAX_SIDEBAR_ACTION_RECORDS, record, routine_logging_enabled,
};
use super::space_editor::SpaceEditorCounters;

impl GxStoreDiagnostics {
    /// One line per Project Group menu item that reached the document: which action, whether it
    /// wrote, and the run's totals.
    pub(super) fn collection_menu_ran(
        &mut self,
        action: &str,
        wrote: bool,
        counters: CollectionMenuCounters,
    ) {
        if !self.project_doc_edit_budget() {
            return;
        }
        record(
            "gxStore.collectionMenu",
            json!({
                // A fixed word from the closed set this store matches on, never the payload.
                "action": action,
                "wrote": wrote,
                "renames": counters.renames,
                "colors": counters.colors,
                "ungroups": counters.ungroups,
                "refusals": counters.refusals,
                "declinedSource": counters.declined_source,
                "handOffs": counters.hand_offs,
            }),
        );
    }

    /// One line per Space editor result the app applied: which button, whether it wrote, and the
    /// run's totals. Never the Space's name, its icon or its id, all three of which are the user's.
    pub(super) fn space_editor_ran(
        &mut self,
        mode: SpaceEditorMode,
        wrote: bool,
        counters: SpaceEditorCounters,
    ) {
        if !self.project_doc_edit_budget() {
            return;
        }
        record(
            "gxStore.spaceEditor",
            json!({
                "mode": match mode {
                    SpaceEditorMode::Create => "create",
                    SpaceEditorMode::Delete => "delete",
                    SpaceEditorMode::Edit => "edit",
                },
                "wrote": wrote,
                "creates": counters.creates,
                "edits": counters.edits,
                "deletes": counters.deletes,
                "refusals": counters.refusals,
                "handOffs": counters.hand_offs,
                "unparsable": counters.unparsable,
            }),
        );
    }

    /// Whether another line in this file may be written, spending the budget when it may.
    fn project_doc_edit_budget(&mut self) -> bool {
        if self.project_doc_edit_records >= MAX_SIDEBAR_ACTION_RECORDS || !routine_logging_enabled()
        {
            return false;
        }
        self.project_doc_edit_records += 1;
        true
    }
}
