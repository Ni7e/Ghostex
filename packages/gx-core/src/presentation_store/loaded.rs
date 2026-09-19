//! The daemon state of one loaded machine, and the ordering rule for its rows.

use std::collections::BTreeMap;

use ghostex_gx_protocol::{
    PresentationCapabilities, PresentationGroup, PresentationProject, PresentationSession,
    PresentationSnapshot, Tri,
};
use serde_json::Value;

use crate::overlay::ProjectSessionMap;

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
    pub(super) projects: Vec<PresentationProject>,
    /// Ordered by `(sort_key, group_id)`; each group's `session_ids` is the display order.
    pub(super) groups: Vec<PresentationGroup>,
    pub(super) sessions: ProjectSessionMap<PresentationSession>,
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

    pub(super) fn from_snapshot(server_id: String, snapshot: PresentationSnapshot) -> Self {
        let mut sessions = ProjectSessionMap::default();
        for session in snapshot.sessions.rows {
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
            projects: snapshot.projects.rows,
            groups: snapshot.groups.rows,
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
    pub(super) fn rebuild_group_session_ids(&mut self, project_id: &str, group_id: &str) -> bool {
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
pub(super) fn sort_projects(projects: &mut [PresentationProject]) {
    projects.sort_by(|left, right| {
        (left.sort_key.as_str(), left.project_id.as_str())
            .cmp(&(right.sort_key.as_str(), right.project_id.as_str()))
    });
}

pub(super) fn sort_groups(groups: &mut [PresentationGroup]) {
    groups.sort_by(|left, right| {
        (left.sort_key.as_str(), left.group_id.as_str())
            .cmp(&(right.sort_key.as_str(), right.group_id.as_str()))
    });
}

pub(super) fn project_id_order(projects: &[PresentationProject]) -> Vec<String> {
    projects
        .iter()
        .map(|project| project.project_id.clone())
        .collect()
}
