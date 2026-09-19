//! Per-machine presentation state: the last daemon snapshot, deltas on top, and local overlays.

use std::borrow::Cow;
use std::collections::BTreeMap;

use ghostex_gx_protocol::{
    CustomSessionTagsState, LifecycleState, PresentationCapabilities, PresentationDelta,
    PresentationGroup, PresentationProject, PresentationSession, PresentationSnapshot,
    SidebarProjectCollectionsState, SidebarSpacesState, Tri, WorkspaceSessionGroupsState,
};
use serde_json::Value;

use crate::change::{ChangeSummary, IgnoredReason};
use crate::keys::{MachineId, ProjectKey, SessionKey};
use crate::overlay::{Overlays, ProjectSessionMap, SessionPatch};

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

/// The side-state documents of one machine. `None` means the daemon never published that
/// document (an older daemon), which is different from an empty document.
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct SideState {
    pub workspace_groups: Option<WorkspaceSessionGroupsState>,
    pub project_collections: Option<SidebarProjectCollectionsState>,
    pub spaces: Option<SidebarSpacesState>,
    pub custom_session_tags: Option<CustomSessionTagsState>,
}

/// One side-state replacement, from a change frame.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum SideStateUpdate {
    WorkspaceGroups(WorkspaceSessionGroupsState),
    ProjectCollections(SidebarProjectCollectionsState),
    Spaces(SidebarSpacesState),
    CustomSessionTags(CustomSessionTagsState),
}

/// The daemon state of a loaded machine. Rows here are exactly what the daemon sent; overlays are
/// applied on read.
#[derive(Clone, Debug, PartialEq)]
pub struct LoadedPresentation {
    /// Daemon identity of the snapshot. Empty when the snapshot came from an HTTP read, which
    /// does not carry it.
    pub server_id: String,
    /// The highest revision applied or seen for this machine: the value to quote as
    /// `lastRevision` on a reconnect.
    pub revision: i64,
    pub generated_at: String,
    pub capabilities: Option<PresentationCapabilities>,
    pub auto_settle_after_days: Tri<f64>,
    pub portless: Option<Value>,
    /// Ordered by `(sort_key, project_id)`.
    projects: Vec<PresentationProject>,
    /// Ordered by `(sort_key, group_id)`; each group's `session_ids` is the display order.
    groups: Vec<PresentationGroup>,
    sessions: ProjectSessionMap<PresentationSession>,
}

/// Whether a machine's presentation has arrived.
///
/// CDXC:Workarea 2026-09-19 WHY:
/// `NotLoaded` and "loaded with no rows" are different facts and must stay different types: a consumer that reads "no tab sessions" before the first snapshot clears every restored tab, split, and session mapping.
#[derive(Clone, Debug, PartialEq)]
pub enum PresentationState {
    NotLoaded,
    Loaded(Box<LoadedPresentation>),
}

/// Everything the store holds for one machine.
#[derive(Clone, Debug, PartialEq)]
pub struct MachinePresentation {
    pub(crate) state: PresentationState,
    pub(crate) side: SideState,
    pub(crate) overlays: Overlays,
    /// Full domain project rows by project id, as far as the store has seen them (deltas carry
    /// one; the host can load the full list). Kept loose until a narrow typed view is needed.
    pub(crate) domain_projects: BTreeMap<String, Value>,
}

impl Default for MachinePresentation {
    fn default() -> Self {
        Self {
            state: PresentationState::NotLoaded,
            side: SideState::default(),
            overlays: Overlays::default(),
            domain_projects: BTreeMap::new(),
        }
    }
}

impl LoadedPresentation {
    pub fn projects(&self) -> &[PresentationProject] {
        &self.projects
    }

    pub fn groups(&self) -> &[PresentationGroup] {
        &self.groups
    }

    pub fn project(&self, project_id: &str) -> Option<&PresentationProject> {
        self.projects
            .iter()
            .find(|project| project.project_id == project_id)
    }

    /// The daemon row of a session, without overlays.
    pub fn server_session(
        &self,
        project_id: &str,
        session_id: &str,
    ) -> Option<&PresentationSession> {
        self.sessions.get(project_id, session_id)
    }

    /// Every daemon row, ordered by `(project_id, session_id)`.
    pub fn server_sessions(&self) -> impl Iterator<Item = &PresentationSession> {
        self.sessions.iter().map(|(_, _, session)| session)
    }

    pub fn session_count(&self) -> usize {
        self.sessions.len()
    }

    pub(crate) fn project_sessions(
        &self,
        project_id: &str,
    ) -> Option<&BTreeMap<String, PresentationSession>> {
        self.sessions.project(project_id)
    }

    fn from_snapshot(server_id: String, snapshot: PresentationSnapshot) -> Self {
        let mut sessions = ProjectSessionMap::default();
        for session in snapshot.sessions {
            let project_id = session.project_id.clone();
            let session_id = session.session_id.clone();
            sessions.insert(&project_id, &session_id, session);
        }
        let mut loaded = Self {
            server_id,
            revision: snapshot.revision,
            generated_at: snapshot.generated_at,
            capabilities: snapshot.capabilities,
            auto_settle_after_days: snapshot.auto_settle_after_days,
            portless: snapshot.portless,
            projects: snapshot.projects,
            groups: snapshot.groups,
            sessions,
        };
        // The daemon already sends these ordered; sorting keeps the order rule in one place for
        // daemons that do not.
        sort_projects(&mut loaded.projects);
        sort_groups(&mut loaded.groups);
        loaded
    }

    /// Rebuilds one group's display order from the sessions that name it. Returns whether the
    /// list changed.
    fn rebuild_group_session_ids(&mut self, project_id: &str, group_id: &str) -> bool {
        let mut members: Vec<(&str, &str)> = self
            .sessions
            .project(project_id)
            .map(|sessions| {
                sessions
                    .values()
                    .filter(|session| session.group_id == group_id)
                    .map(|session| (session.sort_key.as_str(), session.session_id.as_str()))
                    .collect()
            })
            .unwrap_or_default();
        members.sort_unstable();
        let next: Vec<String> = members
            .into_iter()
            .map(|(_, session_id)| session_id.to_string())
            .collect();
        match self
            .groups
            .iter_mut()
            .find(|group| group.project_id == project_id && group.group_id == group_id)
        {
            Some(group) if group.session_ids != next => {
                group.session_ids = next;
                true
            }
            _ => false,
        }
    }
}

/// CDXC:StateSync 2026-09-19 WHY:
/// The daemon orders rows by the byte order of `sortKey` (Rust `sort_by_key`), so the store does too. The TypeScript reducer used `localeCompare`, which can order punctuation and case differently from the daemon; following the daemon keeps a delta-built list equal to the list a fresh snapshot would give.
fn sort_projects(projects: &mut [PresentationProject]) {
    projects.sort_by(|left, right| {
        (left.sort_key.as_str(), left.project_id.as_str())
            .cmp(&(right.sort_key.as_str(), right.project_id.as_str()))
    });
}

fn sort_groups(groups: &mut [PresentationGroup]) {
    groups.sort_by(|left, right| {
        (left.sort_key.as_str(), left.group_id.as_str())
            .cmp(&(right.sort_key.as_str(), right.group_id.as_str()))
    });
}

fn project_id_order(projects: &[PresentationProject]) -> Vec<String> {
    projects
        .iter()
        .map(|project| project.project_id.clone())
        .collect()
}

impl MachinePresentation {
    pub fn state(&self) -> &PresentationState {
        &self.state
    }

    pub fn is_loaded(&self) -> bool {
        matches!(self.state, PresentationState::Loaded(_))
    }

    pub fn loaded(&self) -> Option<&LoadedPresentation> {
        match &self.state {
            PresentationState::Loaded(loaded) => Some(loaded),
            PresentationState::NotLoaded => None,
        }
    }

    pub fn side_state(&self) -> &SideState {
        &self.side
    }

    pub fn domain_project(&self, project_id: &str) -> Option<&Value> {
        self.domain_projects.get(project_id)
    }

    pub fn is_session_hidden(&self, project_id: &str, session_id: &str) -> bool {
        self.overlays.is_session_hidden(project_id, session_id)
    }

    pub fn is_project_hidden(&self, project_id: &str) -> bool {
        self.overlays.hidden_projects.contains(project_id)
    }

    pub fn session_patch(&self, project_id: &str, session_id: &str) -> Option<&SessionPatch> {
        self.overlays.session_patches.get(project_id, session_id)
    }

    /// The session as the UI should see it: the daemon row with the local patch applied, or
    /// `None` when it does not exist or is hidden locally.
    pub fn effective_session(
        &self,
        project_id: &str,
        session_id: &str,
    ) -> Option<Cow<'_, PresentationSession>> {
        if self.overlays.is_session_hidden(project_id, session_id) {
            return None;
        }
        let server = self.loaded()?.server_session(project_id, session_id)?;
        Some(
            match self.overlays.session_patches.get(project_id, session_id) {
                Some(patch) if !patch.is_caught_up(server) => Cow::Owned(patch.apply_to(server)),
                _ => Cow::Borrowed(server),
            },
        )
    }
}

/// The presentation of every machine, keyed by [`MachineId`]. The same reducer serves the local
/// daemon and every remote one.
#[derive(Clone, Debug, Default, PartialEq)]
pub struct PresentationStore {
    machines: BTreeMap<MachineId, MachinePresentation>,
}

impl PresentationStore {
    pub fn machine(&self, machine: &MachineId) -> Option<&MachinePresentation> {
        self.machines.get(machine)
    }

    pub fn machines(&self) -> impl Iterator<Item = (&MachineId, &MachinePresentation)> {
        self.machines.iter()
    }

    /// The loaded state of a machine; `None` while it is not loaded.
    pub fn loaded(&self, machine: &MachineId) -> Option<&LoadedPresentation> {
        self.machines.get(machine)?.loaded()
    }

    fn machine_mut(&mut self, machine: &MachineId) -> &mut MachinePresentation {
        self.machines.entry(machine.clone()).or_default()
    }

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

    /// Hides a session locally (a local-first close). Returns whether it was visible before.
    pub fn hide_session(&mut self, key: &SessionKey) -> ChangeSummary {
        let entry = self.machine_mut(&key.machine);
        let was_visible = entry
            .effective_session(&key.project_id, &key.session_id)
            .is_some();
        entry
            .overlays
            .hidden_sessions
            .insert(&key.project_id, &key.session_id, ());
        let mut summary = ChangeSummary::default();
        if was_visible {
            summary.note_session_removed(key.clone());
            summary.note_session_order_changed(key.project_key());
        }
        summary
    }

    /// Takes a local hide back (the close request failed).
    pub fn unhide_session(&mut self, key: &SessionKey) -> ChangeSummary {
        let entry = self.machine_mut(&key.machine);
        let mut summary = ChangeSummary::default();
        if entry
            .overlays
            .hidden_sessions
            .remove(&key.project_id, &key.session_id)
            .is_some()
            && entry
                .effective_session(&key.project_id, &key.session_id)
                .is_some()
        {
            summary.note_session_changed(key.clone());
            summary.note_session_order_changed(key.project_key());
        }
        summary
    }

    /// Hides a project locally (close to recent) until the daemon's removal arrives.
    pub fn hide_project(&mut self, key: &ProjectKey) -> ChangeSummary {
        let entry = self.machine_mut(&key.machine);
        let mut summary = ChangeSummary::default();
        let exists = entry
            .loaded()
            .is_some_and(|loaded| loaded.project(&key.project_id).is_some());
        if entry
            .overlays
            .hidden_projects
            .insert(key.project_id.clone())
            && exists
        {
            summary.note_project_removed(key.clone());
            summary.note_project_order_changed(key.machine.clone());
        }
        summary
    }

    pub fn unhide_project(&mut self, key: &ProjectKey) -> ChangeSummary {
        let entry = self.machine_mut(&key.machine);
        let mut summary = ChangeSummary::default();
        let exists = entry
            .loaded()
            .is_some_and(|loaded| loaded.project(&key.project_id).is_some());
        if entry.overlays.hidden_projects.remove(&key.project_id) && exists {
            summary.note_project_changed(key.clone());
            summary.note_project_order_changed(key.machine.clone());
        }
        summary
    }

    /// Overlays an optimistic patch on a session. The revision is untouched. A patch for a session
    /// the store does not hold is refused: there is nothing to overlay.
    pub fn patch_session(&mut self, key: &SessionKey, patch: SessionPatch) -> ChangeSummary {
        let entry = self.machine_mut(&key.machine);
        let exists = entry.loaded().is_some_and(|loaded| {
            loaded
                .server_session(&key.project_id, &key.session_id)
                .is_some()
        });
        if !exists {
            return ChangeSummary::ignored(IgnoredReason::UnknownTarget);
        }
        let before = entry
            .effective_session(&key.project_id, &key.session_id)
            .map(Cow::into_owned);
        if patch.is_empty() {
            entry
                .overlays
                .session_patches
                .remove(&key.project_id, &key.session_id);
        } else {
            entry
                .overlays
                .session_patches
                .insert(&key.project_id, &key.session_id, patch);
        }
        let after = entry.effective_session(&key.project_id, &key.session_id);
        let mut summary = ChangeSummary::default();
        if before.as_ref() != after.as_deref() {
            summary.note_session_changed(key.clone());
        }
        summary
    }

    /// Drops a session's optimistic patch (the request it anticipated failed).
    pub fn clear_session_patch(&mut self, key: &SessionKey) -> ChangeSummary {
        self.patch_session(key, SessionPatch::default())
    }

    /// Drops every patch whose expiry has passed.
    pub fn expire_patches(&mut self, now_ms: u64) -> ChangeSummary {
        let mut summary = ChangeSummary::default();
        for (machine, entry) in &mut self.machines {
            let expired: Vec<(String, String)> = entry
                .overlays
                .session_patches
                .iter()
                .filter(|(_, _, patch)| patch.expires_at_ms.is_some_and(|at| at <= now_ms))
                .map(|(project_id, session_id, _)| (project_id.to_string(), session_id.to_string()))
                .collect();
            for (project_id, session_id) in expired {
                entry
                    .overlays
                    .session_patches
                    .remove(&project_id, &session_id);
                summary.note_session_changed(SessionKey {
                    machine: machine.clone(),
                    project_id,
                    session_id,
                });
            }
        }
        summary
    }
}

/// Why a revisioned frame must not be applied to `loaded`, if any.
fn frame_rejection(
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

fn upsert_session(
    machine: &MachineId,
    loaded: &mut LoadedPresentation,
    overlays: &mut Overlays,
    session: PresentationSession,
    summary: &mut ChangeSummary,
) {
    let project_id = session.project_id.clone();
    let session_id = session.session_id.clone();
    let group_id = session.group_id.clone();
    let key = SessionKey {
        machine: machine.clone(),
        project_id: project_id.clone(),
        session_id: session_id.clone(),
    };

    // The daemon has caught up with a local patch once its row says the same thing.
    let patch_done = overlays
        .session_patches
        .get(&project_id, &session_id)
        .is_some_and(|patch| patch.is_caught_up(&session));
    if patch_done {
        overlays.session_patches.remove(&project_id, &session_id);
    }
    // A locally closed session that the daemon now reports as stopped is no longer a live row the
    // hide has to keep out; what remains is the daemon's own stopped row (pinned, favorite, or
    // tagged), which the user must still be able to see.
    let unhidden = session.lifecycle_state == LifecycleState::Stopped
        && overlays
            .hidden_sessions
            .remove(&project_id, &session_id)
            .is_some();

    let previous = loaded.sessions.insert(&project_id, &session_id, session);
    let changed = match (&previous, loaded.sessions.get(&project_id, &session_id)) {
        (Some(previous), Some(current)) => previous != current,
        _ => true,
    };
    let hidden = overlays.is_session_hidden(&project_id, &session_id);
    if (changed || patch_done || unhidden) && !hidden {
        summary.note_session_changed(key);
    }

    let mut order_changed = loaded.rebuild_group_session_ids(&project_id, &group_id);
    if let Some(previous) = previous.filter(|previous| previous.group_id != group_id) {
        order_changed |= loaded.rebuild_group_session_ids(&project_id, &previous.group_id);
    }
    if order_changed || unhidden {
        summary.note_session_order_changed(ProjectKey {
            machine: machine.clone(),
            project_id,
        });
    }
}

fn remove_session(
    machine: &MachineId,
    loaded: &mut LoadedPresentation,
    overlays: &mut Overlays,
    project_id: &str,
    session_id: &str,
    summary: &mut ChangeSummary,
) {
    // The daemon agrees the session is gone, so the overlays about it have nothing left to do.
    let was_hidden = overlays.is_session_hidden(project_id, session_id);
    overlays.hidden_sessions.remove(project_id, session_id);
    overlays.session_patches.remove(project_id, session_id);
    let Some(removed) = loaded.sessions.remove(project_id, session_id) else {
        return;
    };
    loaded.rebuild_group_session_ids(project_id, &removed.group_id);
    if !was_hidden {
        summary.note_session_removed(SessionKey {
            machine: machine.clone(),
            project_id: project_id.to_string(),
            session_id: session_id.to_string(),
        });
        summary.note_session_order_changed(ProjectKey {
            machine: machine.clone(),
            project_id: project_id.to_string(),
        });
    }
}

fn upsert_project(
    machine: &MachineId,
    loaded: &mut LoadedPresentation,
    project: PresentationProject,
    summary: &mut ChangeSummary,
) {
    let project_id = project.project_id.clone();
    let group_id = project.default_group_id();
    let group_sort_key = format!("{}:active", project.sort_key);
    let order_before = project_id_order(&loaded.projects);

    let changed = match loaded
        .projects
        .iter_mut()
        .find(|existing| existing.project_id == project_id)
    {
        Some(existing) => {
            let changed = *existing != project;
            *existing = project;
            changed
        }
        None => {
            loaded.projects.push(project);
            true
        }
    };
    sort_projects(&mut loaded.projects);

    let mut new_group = false;
    match loaded
        .groups
        .iter_mut()
        .find(|group| group.project_id == project_id || group.group_id == group_id)
    {
        Some(group) => {
            group.group_id = group_id.clone();
            group.project_id = project_id.clone();
            group.sort_key = group_sort_key;
        }
        None => {
            new_group = true;
            loaded.groups.push(PresentationGroup {
                group_id: group_id.clone(),
                project_id: project_id.clone(),
                session_ids: Vec::new(),
                sort_key: group_sort_key,
                title: "Active".to_string(),
            });
        }
    }
    sort_groups(&mut loaded.groups);
    // Sessions can arrive before their project. The TypeScript reducer left a new group empty
    // until some later session delta rebuilt it; filling it here shows those sessions at once.
    let filled = new_group && loaded.rebuild_group_session_ids(&project_id, &group_id);

    let key = ProjectKey {
        machine: machine.clone(),
        project_id,
    };
    if changed {
        summary.note_project_changed(key.clone());
    }
    if filled {
        summary.note_session_order_changed(key);
    }
    if order_before != project_id_order(&loaded.projects) {
        summary.note_project_order_changed(machine.clone());
    }
}

fn remove_project(
    machine: &MachineId,
    loaded: &mut LoadedPresentation,
    overlays: &mut Overlays,
    project_id: &str,
    summary: &mut ChangeSummary,
) {
    let was_hidden = overlays.hidden_projects.contains(project_id);
    let hidden_sessions: Vec<String> = overlays
        .hidden_sessions
        .project(project_id)
        .map(|sessions| sessions.keys().cloned().collect())
        .unwrap_or_default();
    overlays.clear_project(project_id);

    let existed = loaded.project(project_id).is_some();
    loaded
        .projects
        .retain(|project| project.project_id != project_id);
    loaded.groups.retain(|group| group.project_id != project_id);
    let removed_sessions = loaded.sessions.remove_project(project_id);
    if was_hidden {
        return;
    }
    for session_id in removed_sessions.into_keys() {
        if !hidden_sessions.contains(&session_id) {
            summary.note_session_removed(SessionKey {
                machine: machine.clone(),
                project_id: project_id.to_string(),
                session_id,
            });
        }
    }
    if existed {
        summary.note_project_removed(ProjectKey {
            machine: machine.clone(),
            project_id: project_id.to_string(),
        });
        summary.note_project_order_changed(machine.clone());
    }
}

/// Lists what differs between two loaded states of one machine.
fn diff_loaded(
    machine: &MachineId,
    previous: &LoadedPresentation,
    next: &LoadedPresentation,
    summary: &mut ChangeSummary,
) {
    let project_key = |project_id: &str| ProjectKey {
        machine: machine.clone(),
        project_id: project_id.to_string(),
    };
    for project in &next.projects {
        if previous.project(&project.project_id) != Some(project) {
            summary.note_project_changed(project_key(&project.project_id));
        }
    }
    for project in &previous.projects {
        if next.project(&project.project_id).is_none() {
            summary.note_project_removed(project_key(&project.project_id));
        }
    }
    if project_id_order(&previous.projects) != project_id_order(&next.projects) {
        summary.note_project_order_changed(machine.clone());
    }
    for (project_id, session_id, session) in next.sessions.iter() {
        if previous.sessions.get(project_id, session_id) != Some(session) {
            summary.note_session_changed(SessionKey {
                machine: machine.clone(),
                project_id: project_id.to_string(),
                session_id: session_id.to_string(),
            });
        }
    }
    for (project_id, session_id, _) in previous.sessions.iter() {
        if !next.sessions.contains(project_id, session_id) {
            summary.note_session_removed(SessionKey {
                machine: machine.clone(),
                project_id: project_id.to_string(),
                session_id: session_id.to_string(),
            });
        }
    }
    for group in &next.groups {
        let before = previous
            .groups
            .iter()
            .find(|candidate| candidate.group_id == group.group_id)
            .map(|candidate| &candidate.session_ids);
        if before != Some(&group.session_ids) {
            summary.note_session_order_changed(project_key(&group.project_id));
        }
    }
    for group in &previous.groups {
        if !next
            .groups
            .iter()
            .any(|candidate| candidate.group_id == group.group_id)
        {
            summary.note_session_order_changed(project_key(&group.project_id));
        }
    }
}

/// After a snapshot: drop overlays the daemon has caught up with, and report sessions whose
/// effective value changed because of that.
fn settle_overlays_after_snapshot(
    machine: &MachineId,
    entry: &mut MachinePresentation,
    summary: &mut ChangeSummary,
) {
    let PresentationState::Loaded(loaded) = &entry.state else {
        return;
    };
    let session_key = |project_id: &str, session_id: &str| SessionKey {
        machine: machine.clone(),
        project_id: project_id.to_string(),
        session_id: session_id.to_string(),
    };

    let finished_patches: Vec<(String, String)> = entry
        .overlays
        .session_patches
        .iter()
        .filter(|(project_id, session_id, patch)| {
            // A patch is finished when its session is gone or the daemon row agrees with it.
            match loaded.server_session(project_id, session_id) {
                Some(server) => patch.is_caught_up(server),
                None => true,
            }
        })
        .map(|(project_id, session_id, _)| (project_id.to_string(), session_id.to_string()))
        .collect();
    for (project_id, session_id) in finished_patches {
        entry
            .overlays
            .session_patches
            .remove(&project_id, &session_id);
    }

    // A hide is finished when the daemon no longer lists the session, or lists it as stopped.
    let finished_hides: Vec<(String, String, bool)> = entry
        .overlays
        .hidden_sessions
        .iter()
        .filter_map(|(project_id, session_id, _)| {
            match loaded.server_session(project_id, session_id) {
                None => Some((project_id.to_string(), session_id.to_string(), false)),
                Some(server) if server.lifecycle_state == LifecycleState::Stopped => {
                    Some((project_id.to_string(), session_id.to_string(), true))
                }
                Some(_) => None,
            }
        })
        .collect();
    for (project_id, session_id, still_listed) in finished_hides {
        entry
            .overlays
            .hidden_sessions
            .remove(&project_id, &session_id);
        if still_listed {
            summary.note_session_changed(session_key(&project_id, &session_id));
        }
    }

    let finished_projects: Vec<String> = entry
        .overlays
        .hidden_projects
        .iter()
        .filter(|project_id| loaded.project(project_id).is_none())
        .cloned()
        .collect();
    for project_id in finished_projects {
        entry.overlays.hidden_projects.remove(&project_id);
    }

    // Rows that are still hidden were never shown, so they are not news.
    let overlays = &entry.overlays;
    summary
        .sessions_changed
        .retain(|key| !overlays.is_session_hidden(&key.project_id, &key.session_id));
    summary
        .sessions_removed
        .retain(|key| !overlays.is_session_hidden(&key.project_id, &key.session_id));
}
