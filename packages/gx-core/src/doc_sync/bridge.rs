//! The two scripts the hand-back bridge to the sidebar page is made of.
//!
//! CDXC:Sessions 2026-09-21 WHY:
//! Here rather than in the desktop crate so a harness can evaluate the REAL text against the real
//! page code: the function name, the parking branch and the guard on a bridge that is not there yet
//! are all things only an end-to-end run can check, and everything else about a document host is
//! gateable without it. The workspace session groups document learned that in its own review round
//! (`workspace_groups_hand_back_script`), and the two project documents built their script in the
//! desktop crate, where a TypeScript harness cannot reach it; these are the same two shapes with
//! the names as arguments, so there is one text and not three.
//!
//! The parking branch is not a fallback that hides a failure: the controller drains the pending
//! field when it installs its hook, so a document that arrives before the page has connected its
//! sidebar is delivered late rather than lost.
//!
//! SEE-ALSO: packages/gx-core/src/doc_sync/sync.rs,
//! apps/desktop/src/app/gx_store/client_document.rs,
//! apps/desktop/sidebar/native-sidebar/controller.ts.

use serde_json::Value;

/// The script that hands the held document to the page, or parks it when the hook is not installed.
pub fn document_hand_back_script(apply_fn: &str, pending_field: &str, state: &Value) -> String {
    format!(
        "(function(bridge, state) {{ if (!bridge) return; if (bridge.{apply_fn}) bridge.{apply_fn}(state); else bridge.{pending_field} = state; }})(window.ghostexGpui, {state}); undefined;"
    )
}

/// The script that asks the page to post the document it holds.
///
/// Used after a read of the stored key that had not landed while the page was editing: the page's
/// copy is then the only one carrying that edit, and handing the stored document back would replace
/// it. The page answers with an ordinary hand-off, so the recovery and every other edit take the
/// same path and there is no second way for a document to cross.
pub fn document_request_script(request_fn: &str) -> String {
    format!(
        "(function(bridge) {{ if (bridge && bridge.{request_fn}) bridge.{request_fn}(); }})(window.ghostexGpui); undefined;"
    )
}
