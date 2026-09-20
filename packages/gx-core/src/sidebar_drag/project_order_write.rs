//! `syncGroupOrder`: what a project reorder writes into the workspace session groups document.
//!
//! CDXC:Projects 2026-09-21 WHY:
//! This is the second half of `moveGroup` and it is a DIFFERENT writer from `syncSessionOrder`:
//! the project order and each project's user-made group order both live in the workspace session
//! groups document (K4), so a project drag writes the collections document AND this one, through
//! two separate guards. It is kept apart from `order_write.rs` because it needs the projection's
//! worktree metadata (`normalizeWorkspaceProjectOrder` re-nests the order before storing it) where
//! the session order messages need only the document.
//!
//! **The re-nest is not cosmetic.** The order posted by a drop has already been nested by
//! `moveProjectsWithWorktrees`, but the ids that reach the document are the PROJECT ids of the
//! groups, and a project with user-made groups contributes its id several times. Storing that list
//! as given would put a project in the order more than once; `syncGpuiWorkspaceProjectOrder`
//! de-duplicates, and the re-nest runs first so the de-duplication keeps the first position.
//!
//! SEE-ALSO: apps/desktop/sidebar/gxserver-runtime/workspace-groups-sync.ts
//! (`syncWorkspaceGroupOrder`, `normalizeWorkspaceProjectOrder`),
//! packages/gx-core/src/sidebar_drag/project_move.rs.

use serde_json::Value;

use crate::core::Core;
use crate::keys::{parse_workspace_subgroup_id, MachineId, ProjectKey};
use crate::project_docs::{order_projects_with_worktrees, ProjectOrderItem};
use crate::sidebar_view::projects::build_project_meta;
use crate::sidebar_view::SidebarInputs;

use super::inventory::workspace_project_order;
use super::order_write::OrderWritePlan;

/// The one message type this file answers.
pub const PROJECT_ORDER_MESSAGE_TYPE: &str = "syncGroupOrder";

/// Whether this message is the project order write.
pub fn owns_project_order_message(message: &Value) -> bool {
    message.get("type").and_then(Value::as_str) == Some(PROJECT_ORDER_MESSAGE_TYPE)
}

/// What `syncGroupOrder` writes, or `None` when the store must not answer it.
///
/// **Refused, with the reason at the refusal:** an order holding ANY remote group id.
/// `syncWorkspaceGroupOrder` sends those down that machine's tunnel as a whole-order replacement,
/// and it refuses outright when the ids name more than one machine, so a port that took the local
/// half would write an order the app never writes.
pub fn plan_project_order_write(
    core: &Core,
    inputs: &SidebarInputs,
    document: &crate::workspace_groups::WorkspaceGroupsDocument,
    message: &Value,
) -> Option<OrderWritePlan> {
    if !owns_project_order_message(message) {
        return None;
    }
    let group_ids: Vec<&str> = message
        .get("groupIds")?
        .as_array()?
        .iter()
        .filter_map(Value::as_str)
        .collect();
    // `remoteReferences.some(Boolean)`. A remote id is one whose project key names a machine.
    if group_ids.iter().any(is_remote_group_id) {
        return None;
    }
    let project_ids: Vec<String> = group_ids
        .iter()
        .filter_map(|group_id| ProjectKey::parse_sidebar_group_id(group_id))
        .filter(|project| project.machine.is_local())
        .map(|project| project.project_id)
        .collect();
    let mut next = document.clone();
    let mut edited = false;
    // `if (projectIds.length > 0)`: an order with no project group in it (every row a user-made
    // group) leaves the project order alone rather than emptying it.
    if !project_ids.is_empty() {
        let normalized = normalize_project_order(core, inputs, &project_ids);
        if let Some(document) = next.sync_project_order(&normalized) {
            next = document;
            edited = true;
        }
    }
    // The subgroup orders, by project, in the order the projects first appear.
    let mut by_project: Vec<(String, Vec<String>)> = Vec::new();
    for group_id in &group_ids {
        let Some((project, subgroup_id)) = parse_workspace_subgroup_id(group_id) else {
            continue;
        };
        if !project.machine.is_local() {
            continue;
        }
        let key = project.to_workspace_project_id();
        match by_project
            .iter_mut()
            .find(|(candidate, _)| *candidate == key)
        {
            Some((_, order)) => order.push(subgroup_id),
            None => by_project.push((key, vec![subgroup_id])),
        }
    }
    for (project_id, order) in &by_project {
        if let Some(document) = next.sync_subgroup_order(project_id, order) {
            next = document;
            edited = true;
        }
    }
    // `if (this.workspaceGroups === before) return`: nothing moved, so no key is written and no
    // push is booked. This is the one place in the project moves where a write really is skipped,
    // and it is skipped because the shipped code skips it.
    if !edited {
        return Some(OrderWritePlan::refused("orderUnchanged"));
    }
    Some(OrderWritePlan::edit(next))
}

/// `normalizeWorkspaceProjectOrder`: re-nest the ids so every worktree follows its parent.
fn normalize_project_order(
    core: &Core,
    inputs: &SidebarInputs,
    project_ids: &[String],
) -> Vec<String> {
    let machine = MachineId::Local;
    let Some(entry) = core.presentation().machine(&machine) else {
        return project_ids.to_vec();
    };
    let meta = build_project_meta(
        entry,
        workspace_project_order(core, &machine),
        inputs.host.parked_project_ids(&machine),
    );
    let items: Vec<ProjectOrderItem> = project_ids
        .iter()
        .map(|project_id| ProjectOrderItem {
            order_id: project_id.clone(),
            project_id: project_id.clone(),
            parent_project_id: meta
                .overlay(project_id)
                .and_then(|overlay| overlay.worktree.as_ref())
                .map(|worktree| worktree.parent_project_id.clone()),
            // `normalizeWorkspaceProjectOrder` builds its items with a worktree and nothing else,
            // so every one of them is a code project here even if the sidebar calls it a chat.
            // Reproduced rather than improved: the chat partition would change the stored order.
            is_chat: false,
        })
        .collect();
    order_projects_with_worktrees(&items)
        .into_iter()
        .map(|item| item.project_id)
        .collect()
}

/// `parseGpuiRemotePresentationGroupId`: a group id naming a machine.
fn is_remote_group_id(group_id: &&str) -> bool {
    if let Some((project, _)) = parse_workspace_subgroup_id(group_id) {
        return !project.machine.is_local();
    }
    ProjectKey::parse_sidebar_group_id(group_id).is_some_and(|project| !project.machine.is_local())
}
