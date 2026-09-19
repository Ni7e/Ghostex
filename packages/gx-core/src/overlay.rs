//! Local overlays on top of the last daemon state.
//!
//! An overlay is a local-first edit the UI shows before the daemon confirms it. Overlays are
//! never written into the server rows and never renumber the revision: inventing `revision + 1`
//! for a local edit made the next real delta look stale and dropped it.

use std::collections::{BTreeMap, BTreeSet};

use ghostex_gx_protocol::{LifecycleState, PresentationSession, SessionActivity};
use serde::{Deserialize, Serialize};

/// An optimistic patch of one session. Only the fields that are `Some` are overlaid.
#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionPatch {
    pub lifecycle_state: Option<LifecycleState>,
    pub activity: Option<SessionActivity>,
    /// When the host wants the patch dropped even if the daemon never catches up (for example a
    /// request that may fail silently). Checked on every tick against the host's `now_ms`.
    pub expires_at_ms: Option<u64>,
}

impl SessionPatch {
    pub fn is_empty(&self) -> bool {
        self.lifecycle_state.is_none() && self.activity.is_none()
    }

    /// True when the daemon row already says what the patch says, so the patch has nothing left
    /// to do.
    pub fn is_caught_up(&self, server: &PresentationSession) -> bool {
        let lifecycle_differs = self
            .lifecycle_state
            .as_ref()
            .is_some_and(|lifecycle| *lifecycle != server.lifecycle_state);
        let activity_differs = self
            .activity
            .as_ref()
            .is_some_and(|activity| *activity != server.activity);
        !lifecycle_differs && !activity_differs
    }

    /// The session as the UI should show it.
    pub fn apply_to(&self, server: &PresentationSession) -> PresentationSession {
        let mut session = server.clone();
        if let Some(lifecycle) = &self.lifecycle_state {
            session.lifecycle_state = lifecycle.clone();
        }
        if let Some(activity) = &self.activity {
            session.activity = activity.clone();
            // `attention` is present only while the activity is attention; a stale payload would
            // keep drawing the attention state after a local acknowledgement.
            if *activity != SessionActivity::Attention {
                session.attention = None;
            }
        }
        session
    }
}

/// A set or map keyed by `(project_id, session_id)` that can be probed with `&str` parts, so the
/// hot lookups allocate nothing.
#[derive(Clone, Debug, PartialEq, Eq)]
pub(crate) struct ProjectSessionMap<T> {
    by_project: BTreeMap<String, BTreeMap<String, T>>,
}

impl<T> Default for ProjectSessionMap<T> {
    fn default() -> Self {
        Self {
            by_project: BTreeMap::new(),
        }
    }
}

impl<T> ProjectSessionMap<T> {
    pub(crate) fn get(&self, project_id: &str, session_id: &str) -> Option<&T> {
        self.by_project.get(project_id)?.get(session_id)
    }

    pub(crate) fn contains(&self, project_id: &str, session_id: &str) -> bool {
        self.get(project_id, session_id).is_some()
    }

    pub(crate) fn insert(&mut self, project_id: &str, session_id: &str, value: T) -> Option<T> {
        self.by_project
            .entry(project_id.to_string())
            .or_default()
            .insert(session_id.to_string(), value)
    }

    pub(crate) fn remove(&mut self, project_id: &str, session_id: &str) -> Option<T> {
        let sessions = self.by_project.get_mut(project_id)?;
        let removed = sessions.remove(session_id);
        if sessions.is_empty() {
            self.by_project.remove(project_id);
        }
        removed
    }

    pub(crate) fn remove_project(&mut self, project_id: &str) -> BTreeMap<String, T> {
        self.by_project.remove(project_id).unwrap_or_default()
    }

    pub(crate) fn project(&self, project_id: &str) -> Option<&BTreeMap<String, T>> {
        self.by_project.get(project_id)
    }

    pub(crate) fn iter(&self) -> impl Iterator<Item = (&str, &str, &T)> {
        self.by_project.iter().flat_map(|(project_id, sessions)| {
            sessions
                .iter()
                .map(move |(session_id, value)| (project_id.as_str(), session_id.as_str(), value))
        })
    }

    pub(crate) fn len(&self) -> usize {
        self.by_project.values().map(BTreeMap::len).sum()
    }
}

/// Every local overlay of one machine.
///
/// CDXC:StateSync 2026-09-19 WHY:
/// Overlays are kept beside the daemon rows instead of being written into them, and they never renumber the revision. The TypeScript runtime patched the snapshot in place, so any unrelated upsert of the same session wiped an optimistic value before the daemon had caught up; and an invented `revision + 1` once made the next real delta look stale.
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub(crate) struct Overlays {
    /// Sessions closed locally. Keeps a later hydrate from putting the row back while the daemon's
    /// transition catches up.
    pub(crate) hidden_sessions: ProjectSessionMap<()>,
    /// Projects removed locally (close to recent) before the daemon's removal arrives.
    pub(crate) hidden_projects: BTreeSet<String>,
    pub(crate) session_patches: ProjectSessionMap<SessionPatch>,
}

impl Overlays {
    pub(crate) fn is_session_hidden(&self, project_id: &str, session_id: &str) -> bool {
        self.hidden_projects.contains(project_id)
            || self.hidden_sessions.contains(project_id, session_id)
    }

    pub(crate) fn clear_project(&mut self, project_id: &str) {
        self.hidden_projects.remove(project_id);
        self.hidden_sessions.remove_project(project_id);
        self.session_patches.remove_project(project_id);
    }
}
