//! Fork: the action that creates a session and moves a pane, and the one where nothing local
//! happens until the daemon has already done the work.
//!
//! CDXC:SessionFork 2026-09-20 WHY:
//! The question asked of every destructive or pane-moving action in this port is "what does the
//! user see if the call fails after the local change", and for fork the answer is that the case
//! does not exist. The pane move is `postLocalWorkspaceTerminalFocus` with the source row as its
//! placement target, and it runs only after `/api/forkSession` has returned a fork WITH a session
//! id. There is no window in which a pane has moved and the call then fails, so there is nothing
//! to reverse and no optimistic row to take back.
//!
//! One thing DOES happen before the call and is not reversed: the source session's project and
//! group become active. That is kept rather than fixed. It is not a pane and not a row, it is
//! where the user is looking, and a failed fork that also threw the user back to another project
//! would be a second surprise on top of the error. The TypeScript leaves it too, and the toast is
//! what says the fork did not happen.
//!
//! SEE-ALSO: apps/desktop/sidebar/gxserver-runtime/sessions-and-focus.ts (`forkSession`),
//! apps/desktop/src/app/gx_store/sidebar_lifecycle.rs.

use serde_json::{json, Value};

use crate::core::Core;
use crate::focus::ActiveGroup;
use crate::keys::{ProjectKey, SessionKey};

use super::plan::ToastLevel;
use super::resolve::text_field;

/// What the host must call, and the one thing that happens before it.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct ForkRequest {
    pub session: SessionKey,
    pub rpc_path: &'static str,
    pub rpc_params: Value,
    /// The project's own group to make active before the call, when it is not active already.
    /// `None` means the user is already looking at the right place. It is a GROUP and not just a
    /// project because the TypeScript compares both and a project can be active with another of
    /// its groups selected.
    pub activate: Option<ProjectKey>,
}

impl ForkRequest {
    pub fn to_json(&self) -> Value {
        json!({
            "rpc": { "path": self.rpc_path, "params": self.rpc_params },
            "activate": self.activate.as_ref().map(ProjectKey::to_sidebar_group_id),
        })
    }
}

/// What the host does once the daemon has answered.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum ForkFollowUp {
    /// Select the new session and append its pane beside the row it was forked from.
    PlacePane {
        session: SessionKey,
        placement_target: SessionKey,
    },
    /// `postSidebarActionToast('error', 'Could not fork session', ...)`.
    Toast {
        level: ToastLevel,
        title: String,
        /// Whether the toast carries the failure text. The text itself is the daemon's or the
        /// transport's and the two clients word it differently by construction, so it is reported
        /// as presence and never compared.
        has_description: bool,
    },
}

impl ForkFollowUp {
    pub fn to_json(&self) -> Value {
        match self {
            Self::PlacePane {
                session,
                placement_target,
            } => json!({
                "follow": "placePane",
                "session": session.to_sidebar_session_id(),
                "placementTarget": placement_target.to_sidebar_session_id(),
            }),
            Self::Toast {
                level,
                title,
                has_description,
            } => json!({
                "follow": "toast",
                "level": level.as_str(),
                "title": title,
                "hasDescription": has_description,
            }),
        }
    }
}

/// The `forkSession` payload, or `None` when this file does not own it.
///
/// Refused, with the reason at each refusal:
///
/// - A REMOTE row: the fork is made by that machine's daemon over its tunnel, and every machine is
///   disabled.
/// - A row the store does not hold: the TypeScript returns before the call for exactly this,
///   because a fork of a row that is not in the presentation has no source.
/// - A row inside a USER-MADE session group: the fork is then also written into the workspace
///   groups document, which is client storage with a debounced write-through, an indefinite retry
///   and a guard that refuses the daemon's echo while a push is pending. That document is a
///   two-writer problem of its own and belongs with the order writes, not here, so a fork from
///   inside a group stays with the old runtime until then.
pub fn plan_fork_request(core: &Core, message: &Value) -> Option<ForkRequest> {
    if text_field(message, "type")? != "forkSession" {
        return None;
    }
    let session = SessionKey::parse_sidebar_session_id(text_field(message, "sessionId")?)?;
    if !session.machine.is_local() {
        return None;
    }
    // `this.presentation?.sessions.some(...)`: the daemon's own row, overlays not consulted,
    // because what the fork needs is a source the daemon knows about.
    core.presentation()
        .loaded(&session.machine)?
        .server_session(&session.project_id, &session.session_id)?;
    let project = session.project_key();
    // A CHAT project's sessions live in the Chats group, and `forkSession` activates
    // `createGxserverPresentationProjectGroupId(projectId)` regardless: a group id the sidebar
    // draws no row for. Reproducing that would leave the store's active group naming a group its
    // own list does not have, and not reproducing it would be a silent divergence, so a fork from
    // a chat session stays with the old runtime.
    if core
        .presentation()
        .machine(&session.machine)
        .is_some_and(|entry| entry.is_chat_project(&session.project_id))
    {
        return None;
    }
    let focus = core.focus();
    // The TypeScript reads `workspaceSubgroupSidebarIdForSession` here and forks from the
    // subgroup when the row is in one. That leg is refused above, so the source group is always
    // the project's own.
    if matches!(focus.active_group.as_ref(), Some(ActiveGroup::Subgroup { project: active, .. }) if *active == project)
    {
        return None;
    }
    let already_active = focus.active_project.as_ref() == Some(&project)
        && focus.active_group.as_ref() == Some(&ActiveGroup::Project(project.clone()));
    Some(ForkRequest {
        rpc_path: "/api/forkSession",
        rpc_params: json!({
            "projectId": session.project_id,
            "reason": "gpui-sidebar",
            "sessionId": session.session_id,
        }),
        activate: (!already_active).then(|| project.clone()),
        session,
    })
}

/// What to do with the answer. `/api/forkSession` answers `{ fork: { session: { sessionId } } }`,
/// and a result without that id is a failure even though the call succeeded: the TypeScript
/// throws its own error for it and lands in the same toast.
pub fn apply_fork_answer(request: &ForkRequest, result: Result<&Value, &str>) -> Vec<ForkFollowUp> {
    let forked = result.ok().and_then(|value| {
        let session_id = value.pointer("/fork/session/sessionId")?.as_str()?;
        // `normalizeNonEmptyString`: a blank id is no id.
        (!session_id.trim().is_empty()).then(|| session_id.to_string())
    });
    match forked {
        Some(session_id) => vec![ForkFollowUp::PlacePane {
            session: SessionKey {
                machine: request.session.machine.clone(),
                project_id: request.session.project_id.clone(),
                session_id,
            },
            // The placement target is the row the user clicked, not whichever pane happens to be
            // focused when the call comes back.
            placement_target: request.session.clone(),
        }],
        None => vec![ForkFollowUp::Toast {
            level: ToastLevel::Error,
            title: "Could not fork session".to_string(),
            has_description: true,
        }],
    }
}

/// Whether this payload is one this file answers.
pub fn owns_fork_message(message: &Value) -> bool {
    text_field(message, "type") == Some("forkSession")
}
