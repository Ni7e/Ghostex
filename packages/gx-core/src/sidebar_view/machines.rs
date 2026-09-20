//! The machine tabs: which projects a machine would draw, and the counts its badge shows.
//!
//! The selected machine's list is built in full, so its counts come out of the built groups
//! (`assemble`). Every OTHER machine still has a tab with a badge, and building its whole list to
//! read two numbers off it would be the expensive way to ask a cheap question: a badge counts
//! sessions, and a session's activity is on the daemon row before any row is derived. So the counts
//! here walk the store directly, over exactly the sessions the list would draw.
//!
//! SEE-ALSO: apps/desktop/sidebar/native-sidebar/model.ts, which counts
//! `state.groupOrder.filter(machine).flatMap(sessionIdsByGroup)` through `getGroupSessionSummary`.
//! Browser tabs are in that list too and always count zero (an idle row with no pending question),
//! so they are left out here rather than mirrored.

use std::collections::BTreeSet;

use crate::keys::MachineId;
use crate::presentation_store::{MachinePresentation, PresentationStore};

use super::inputs::SidebarHostInputs;
use super::membership::project_members;
use super::view::MachineSummary;

/// The projects a machine draws: everything loaded, minus the ones it parked as Recent Projects
/// and the ones a local close hid. The same filter `build_project_meta` applies before it orders
/// them, without the ordering, which a count does not need.
fn drawn_project_ids<'a>(
    machine: &'a MachinePresentation,
    parked: &BTreeSet<String>,
) -> Vec<&'a str> {
    let Some(loaded) = machine.loaded() else {
        return Vec::new();
    };
    loaded
        .projects()
        .iter()
        .map(|project| project.project_id.as_str())
        .filter(|project_id| {
            !parked.contains(*project_id)
                && !machine.is_project_hidden(project_id)
                && machine
                    .domain_project(project_id)
                    .and_then(|project| project.get("isRecentProject"))
                    .and_then(serde_json::Value::as_bool)
                    != Some(true)
        })
        .collect()
}

/// The working and attention counts of one machine's tab.
pub(crate) fn machine_tab_summary(
    store: &PresentationStore,
    machine_id: &MachineId,
    parked: &BTreeSet<String>,
) -> MachineSummary {
    let mut summary = MachineSummary::default();
    let Some(machine) = store.machine(machine_id) else {
        return summary;
    };
    for project_id in drawn_project_ids(machine, parked) {
        // A chat project's user-made groups are never drawn, so their members are claimed out of
        // the project's own list and counted nowhere, exactly as `project_members` reports it.
        let emit_subgroups = !machine.is_chat_project(project_id);
        let members = project_members(store, machine, machine_id, project_id, emit_subgroups);
        let session_ids = members.session_ids.iter().chain(
            members
                .subgroups
                .iter()
                .flat_map(|subgroup| subgroup.session_ids.iter()),
        );
        for session_id in session_ids {
            let Some(session) = machine.effective_session(project_id, session_id) else {
                continue;
            };
            if session.activity.as_str() == "working" {
                summary.working_count += 1;
            }
            if session.activity.as_str() == "attention" || session.pending_question_count > 0 {
                summary.attention_count += 1;
            }
        }
    }
    summary
}

/// Whether ANY machine the store holds draws a project group, which is what the empty state's
/// "have we ever seen a project" test asks.
///
/// `hasKnownSidebarProjectInventory` reads `workspaceGroupIds`, which spans every machine, so a
/// user whose only projects live on a remote machine must not be shown first-run copy.
pub(crate) fn any_machine_draws_a_project(
    store: &PresentationStore,
    host: &SidebarHostInputs,
) -> bool {
    store.machines().any(|(machine_id, machine)| {
        drawn_project_ids(machine, host.parked_project_ids(machine_id))
            .into_iter()
            .any(|project_id| !machine.is_chat_project(project_id))
    })
}
