//! Applying daemon input: snapshots, deltas, side-state frames, and domain project rows.

use std::collections::BTreeMap;

use ghostex_gx_protocol::{PresentationDelta, PresentationSnapshot};
use serde_json::Value;

use super::loaded::{sort_groups, LoadedPresentation};
use super::reducers::{remove_project, remove_session, upsert_project, upsert_session};
use super::settle::{diff_loaded, settle_overlays_after_snapshot};
use super::store::{PresentationState, PresentationStore, SideStateUpdate};
use crate::change::{ChangeSummary, IgnoredReason};
use crate::keys::{MachineId, ProjectKey};

/// Where a snapshot came from, which decides whether it may be older than what is held.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum SnapshotOrigin {
    /// The answer to a subscribe on the event stream. Authoritative: the daemon sends a full
    /// snapshot whenever the quoted revision does not match, whether the client is behind or
    /// ahead, so it always replaces what is held.
    Stream,
    /// An HTTP `readPresentationSnapshot` result. It can race the stream, so one that is older
    /// than the held revision is dropped instead of rolling newer deltas back.
    Read,
}

impl PresentationStore {
    /// Replaces a machine's presentation with a snapshot.
    ///
    /// Side-state documents are adopted only when the snapshot carries them: an older daemon that
    /// omits one must not wipe what a change frame delivered. Overlays survive, except those the
    /// snapshot shows the daemon has caught up with.
    pub fn apply_snapshot(
        &mut self,
        machine: &MachineId,
        server_id: &str,
        mut snapshot: PresentationSnapshot,
        origin: SnapshotOrigin,
    ) -> ChangeSummary {
        let entry = self.machine_mut(machine);
        if let (SnapshotOrigin::Read, PresentationState::Loaded(held)) = (origin, &entry.state) {
            if snapshot.revision < held.revision {
                return ChangeSummary::ignored(IgnoredReason::StaleRevision {
                    held: held.revision,
                    received: snapshot.revision,
                });
            }
        }

        let mut summary = ChangeSummary::default();
        let side = &mut entry.side;
        if let Some(groups) = snapshot.workspace_groups.take() {
            summary.side_state.workspace_groups = side.workspace_groups.as_ref() != Some(&groups);
            side.workspace_groups = Some(groups);
        }
        if let Some(collections) = snapshot.sidebar_project_collections.take() {
            summary.side_state.project_collections =
                side.project_collections.as_ref() != Some(&collections);
            side.project_collections = Some(collections);
        }
        if let Some(spaces) = snapshot.sidebar_spaces.take() {
            summary.side_state.spaces = side.spaces.as_ref() != Some(&spaces);
            side.spaces = Some(spaces);
        }
        if let Some(tags) = snapshot.custom_session_tags.take() {
            summary.side_state.custom_session_tags =
                side.custom_session_tags.as_ref() != Some(&tags);
            side.custom_session_tags = Some(tags);
        }

        let mut next = LoadedPresentation::from_snapshot(server_id.to_string(), snapshot);
        match &entry.state {
            PresentationState::NotLoaded => summary.machines_reloaded.push(machine.clone()),
            PresentationState::Loaded(previous) => {
                // A read does not know the daemon identity; keep the one the stream gave.
                if next.server_id.is_empty() {
                    next.server_id = previous.server_id.clone();
                }
                // The held revision becomes the snapshot's even when that is lower (a stream reply
                // from a daemon whose database was restored): keeping the higher number would make
                // every later delta look stale.
                diff_loaded(machine, previous, &next, &mut summary);
            }
        }
        entry.state = PresentationState::Loaded(Box::new(next));
        settle_overlays_after_snapshot(machine, entry, &mut summary);
        summary
    }

    /// The daemon confirmed that the quoted `lastRevision` is current: nothing to apply.
    ///
    /// Returns `NotLoaded` when the store holds nothing for the machine, which means the host
    /// quoted a revision the store never had; the caller must resubscribe without `lastRevision`.
    pub fn apply_snapshot_current(
        &mut self,
        machine: &MachineId,
        server_id: &str,
        revision: i64,
    ) -> ChangeSummary {
        match &mut self.machine_mut(machine).state {
            PresentationState::NotLoaded => ChangeSummary::ignored(IgnoredReason::NotLoaded),
            PresentationState::Loaded(loaded) => {
                if loaded.server_id.is_empty() {
                    loaded.server_id = server_id.to_string();
                }
                loaded.revision = loaded.revision.max(revision);
                ChangeSummary::default()
            }
        }
    }

    /// Applies one delta.
    ///
    /// Revision rules: a delta before the first snapshot, or at or below the held revision, is
    /// dropped without complaint (the subscribe handler itself can enqueue such deltas right
    /// before the snapshot). A gap is never loss, because side-channel frames consume revisions
    /// from the same counter; loss is signalled only by the socket closing. Sessions and projects
    /// are whole-object replacements, never merges, because present-only keys clear by absence.
    pub fn apply_delta(
        &mut self,
        machine: &MachineId,
        server_id: &str,
        revision: i64,
        delta: PresentationDelta,
    ) -> ChangeSummary {
        let entry = self.machine_mut(machine);
        let loaded = match &mut entry.state {
            PresentationState::NotLoaded => {
                return ChangeSummary::ignored(IgnoredReason::NotLoaded)
            }
            PresentationState::Loaded(loaded) => loaded,
        };
        if let Some(reason) = frame_rejection(loaded, server_id, revision) {
            return ChangeSummary::ignored(reason);
        }
        loaded.revision = revision;

        let mut summary = ChangeSummary::default();
        match delta {
            PresentationDelta::SessionPresentationChanged { session } => {
                upsert_session(machine, loaded, &mut entry.overlays, *session, &mut summary);
            }
            PresentationDelta::SessionRemoved {
                project_id,
                session_id,
            } => {
                remove_session(
                    machine,
                    loaded,
                    &mut entry.overlays,
                    &project_id,
                    &session_id,
                    &mut summary,
                );
            }
            PresentationDelta::ProjectAdded {
                project,
                domain_project,
            }
            | PresentationDelta::ProjectUpdated {
                project,
                domain_project,
            } => {
                if let Some(domain_project) = domain_project {
                    entry
                        .domain_projects
                        .insert(project.project_id.clone(), domain_project);
                }
                upsert_project(machine, loaded, *project, &mut summary);
            }
            PresentationDelta::ProjectRemoved { project_id } => {
                entry.domain_projects.remove(&project_id);
                remove_project(
                    machine,
                    loaded,
                    &mut entry.overlays,
                    &project_id,
                    &mut summary,
                );
            }
            PresentationDelta::GroupUpserted { group } => {
                let project = ProjectKey {
                    machine: machine.clone(),
                    project_id: group.project_id.clone(),
                };
                match loaded
                    .groups
                    .iter_mut()
                    .find(|existing| existing.group_id == group.group_id)
                {
                    Some(existing) => *existing = group,
                    None => loaded.groups.push(group),
                }
                sort_groups(&mut loaded.groups);
                summary.note_session_order_changed(project);
            }
            PresentationDelta::GroupRemoved {
                project_id,
                group_id,
            } => {
                loaded.groups.retain(|group| group.group_id != group_id);
                let doomed: Vec<String> = loaded
                    .project_sessions(&project_id)
                    .map(|sessions| {
                        sessions
                            .values()
                            .filter(|session| session.group_id == group_id)
                            .map(|session| session.session_id.clone())
                            .collect()
                    })
                    .unwrap_or_default();
                for session_id in doomed {
                    remove_session(
                        machine,
                        loaded,
                        &mut entry.overlays,
                        &project_id,
                        &session_id,
                        &mut summary,
                    );
                }
                summary.note_session_order_changed(ProjectKey {
                    machine: machine.clone(),
                    project_id,
                });
            }
            // An unknown delta type advances the revision and changes nothing.
            PresentationDelta::Unknown { .. } => {}
        }
        summary
    }

    /// Replaces one side-state document.
    ///
    /// CDXC:StateSync 2026-09-19 WHY:
    /// Side-channel frames allocate from the presentation revision counter, so one at or below the held revision is already contained in the held snapshot and is dropped, and an applied one advances the held revision. That keeps `lastRevision` current across side-state changes, which the TypeScript runtime did not do (it then always got a full snapshot on the next reconnect). A frame without a revision (a daemon of another version) is applied. Before the first snapshot the document is kept, because an older daemon's snapshot may not carry it.
    pub fn apply_side_state(
        &mut self,
        machine: &MachineId,
        server_id: &str,
        revision: Option<i64>,
        update: SideStateUpdate,
    ) -> ChangeSummary {
        let entry = self.machine_mut(machine);
        if let (Some(revision), PresentationState::Loaded(loaded)) = (revision, &mut entry.state) {
            if let Some(reason) = frame_rejection(loaded, server_id, revision) {
                return ChangeSummary::ignored(reason);
            }
            loaded.revision = revision;
        }
        let mut summary = ChangeSummary::default();
        let side = &mut entry.side;
        match update {
            SideStateUpdate::WorkspaceGroups(state) => {
                summary.side_state.workspace_groups =
                    side.workspace_groups.as_ref() != Some(&state);
                side.workspace_groups = Some(state);
            }
            SideStateUpdate::ProjectCollections(state) => {
                summary.side_state.project_collections =
                    side.project_collections.as_ref() != Some(&state);
                side.project_collections = Some(state);
            }
            SideStateUpdate::Spaces(state) => {
                summary.side_state.spaces = side.spaces.as_ref() != Some(&state);
                side.spaces = Some(state);
            }
            SideStateUpdate::CustomSessionTags(state) => {
                summary.side_state.custom_session_tags =
                    side.custom_session_tags.as_ref() != Some(&state);
                side.custom_session_tags = Some(state);
            }
        }
        summary
    }

    /// Notes a frame that carries a revision but no state the store holds (for example
    /// `globalSidebarCommandsChanged`), so the held revision stays current.
    pub fn note_revision(&mut self, machine: &MachineId, server_id: &str, revision: i64) {
        if let PresentationState::Loaded(loaded) = &mut self.machine_mut(machine).state {
            if frame_rejection(loaded, server_id, revision).is_none() {
                loaded.revision = revision;
            }
        }
    }

    /// Replaces the full list of domain project rows (from `listProjects`).
    pub fn set_domain_projects(
        &mut self,
        machine: &MachineId,
        projects: Vec<Value>,
    ) -> ChangeSummary {
        let entry = self.machine_mut(machine);
        let mut next = BTreeMap::new();
        for project in projects {
            if let Some(project_id) = project.get("projectId").and_then(Value::as_str) {
                next.insert(project_id.to_string(), project);
            }
        }
        let mut summary = ChangeSummary::default();
        for project_id in next.keys().chain(entry.domain_projects.keys()) {
            if next.get(project_id) != entry.domain_projects.get(project_id) {
                summary.note_project_changed(ProjectKey {
                    machine: machine.clone(),
                    project_id: project_id.clone(),
                });
            }
        }
        entry.domain_projects = next;
        summary
    }

    /// Drops a machine's daemon state (a removed or disconnected machine). Overlays go with it.
    pub fn unload_machine(&mut self, machine: &MachineId) -> ChangeSummary {
        let mut summary = ChangeSummary::default();
        if let Some(entry) = self.machines.remove(machine) {
            if entry.is_loaded() {
                summary.machines_reloaded.push(machine.clone());
            }
        }
        summary
    }
}

/// Why a revisioned frame must not be applied to `loaded`, if any.
pub(super) fn frame_rejection(
    loaded: &LoadedPresentation,
    server_id: &str,
    revision: i64,
) -> Option<IgnoredReason> {
    if !server_id.is_empty() && !loaded.server_id.is_empty() && server_id != loaded.server_id {
        return Some(IgnoredReason::ServerChanged);
    }
    (revision <= loaded.revision).then_some(IgnoredReason::StaleRevision {
        held: loaded.revision,
        received: revision,
    })
}
