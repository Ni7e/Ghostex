//! The workspace session groups document as an instance of the shared guard, plus the two scripts
//! the bridge to the sidebar runtime is made of.
//!
//! CDXC:Sessions 2026-09-21 WHY:
//! The guard this document needs is the same guard the project collections document and the Spaces
//! document need, so it lives in `crate::doc_sync` and this file only says how THIS document
//! answers the three questions that differ: it stores the same shape it pushes and removes the key
//! when the document is empty; an empty server document is never adopted over a non-empty local one
//! (a server that has never been written looks exactly like one that was emptied, and adopting it
//! would delete every group the user has); and a malformed echo is an EMPTY document rather than no
//! document at all, which is what `parseGpuiWorkspaceSessionGroupsState` does on purpose so a
//! corrupt key is harmless. Supersedes nothing: this is where the guard's own text used to be, and
//! it moved rather than changed, which the guard gate proves by reporting the same numbers.
//!
//! SEE-ALSO: packages/gx-core/src/doc_sync/sync.rs,
//! apps/desktop/sidebar/gxserver-runtime/workspace-groups-sync.ts
//! (`persistWorkspaceGroups`, `applyWorkspaceGroupsFromHost`),
//! apps/desktop/src/app/gx_store/workspace_groups.rs.

use serde_json::Value;

use crate::doc_sync::{DocumentSync, EmptyEchoRule, SyncPolicy, SyncedDocument};

use super::document::WorkspaceGroupsDocument;

/// The `type` of the message the sidebar runtime posts when it hands an edited document over.
///
/// A constant shared by the host's routing arm and the gate, because the two ends of a bridge
/// agreeing on a string is the one thing neither side can check alone: piece 3d shipped an entire
/// dialog port dead on exactly that, with a clean gate beside it.
pub const WORKSPACE_GROUPS_HAND_OFF_MESSAGE_TYPE: &str = "persistWorkspaceGroups";

/// The placeholder the gate substitutes a document into. A JSON string, so
/// [`workspace_groups_hand_back_script`] serializes it with quotes and the substitution is exact.
pub const WORKSPACE_GROUPS_SCRIPT_PLACEHOLDER: &str = "__GX_WORKSPACE_GROUPS_STATE__";

/// The script the host runs in the sidebar runtime to ask it to post its own document.
///
/// Used once, after a read of the stored key that failed while the runtime was editing: the
/// runtime's copy is then the only one carrying that edit, and handing the stored document back
/// would replace it. It answers with an ordinary `persistWorkspaceGroups`, so the recovery and
/// every other edit take the same path.
pub fn workspace_groups_request_script() -> String {
    "(function(bridge) { if (bridge && bridge.requestWorkspaceGroups) bridge.requestWorkspaceGroups(); })(window.ghostexGpui); undefined;".to_string()
}

/// The script the host runs in the sidebar runtime to hand the held document back.
///
/// Here rather than in the desktop crate so a harness can evaluate the REAL text against the real
/// runtime code: the function name, the parking branch and the guard on a bridge that is not there
/// yet are all things only an end-to-end run can check, and everything else about this piece is
/// gateable without it.
///
/// The parking branch is not a fallback that hides a failure: `installGpuiWorkspaceGroupsHandBack`
/// drains `pendingWorkspaceGroups` when it installs the hook, so a document that arrives before
/// the runtime has started is delivered late rather than lost.
pub fn workspace_groups_hand_back_script(state: &Value) -> String {
    format!(
        "(function(bridge, state) {{ if (!bridge) return; if (bridge.applyWorkspaceGroups) bridge.applyWorkspaceGroups(state); else bridge.pendingWorkspaceGroups = state; }})(window.ghostexGpui, {state}); undefined;"
    )
}

/// `GPUI_WORKSPACE_GROUPS_SERVER_SYNC_DELAY_MS`.
pub const WORKSPACE_GROUPS_SYNC_DELAY_MS: u64 = 400;
/// `GPUI_WORKSPACE_GROUPS_SERVER_SYNC_RETRY_DELAY_MS`.
pub const WORKSPACE_GROUPS_SYNC_RETRY_DELAY_MS: u64 = 5_000;

/// What the host must do after a call into the guard.
pub type WorkspaceGroupsEffect = crate::doc_sync::SyncEffect;

/// The document plus everything needed to decide whether an echo may be applied.
pub type WorkspaceGroupsSync = DocumentSync<WorkspaceGroupsDocument>;

impl SyncedDocument for WorkspaceGroupsDocument {
    fn policy() -> SyncPolicy {
        SyncPolicy {
            delay_ms: WORKSPACE_GROUPS_SYNC_DELAY_MS,
            retry_delay_ms: WORKSPACE_GROUPS_SYNC_RETRY_DELAY_MS,
            empty_echo: EmptyEchoRule::AlwaysPushBack,
            stores: true,
        }
    }

    /// Always a document. `parseGpuiWorkspaceSessionGroupsState` answers an empty one for anything
    /// that is not an object, which is what makes a corrupt key harmless, so this never refuses.
    fn parse_echo(value: &Value) -> Option<Self> {
        Some(Self::parse(value))
    }

    fn to_wire(&self) -> Value {
        self.to_json()
    }

    /// `writeStoredGpuiWorkspaceSessionGroupsState`, which REMOVES the key for an empty document
    /// rather than storing an empty object.
    fn to_storage(&self) -> Option<Value> {
        (!self.is_empty()).then(|| self.to_json())
    }

    fn is_empty(&self) -> bool {
        WorkspaceGroupsDocument::is_empty(self)
    }
}
