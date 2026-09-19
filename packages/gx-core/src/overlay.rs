//! Local overlays on top of the last daemon state.
//!
//! An overlay is a local-first edit the UI shows before the daemon confirms it. Overlays are
//! never written into the server rows and never renumber the revision: inventing `revision + 1`
//! for a local edit made the next real delta look stale and dropped it.

use std::collections::{BTreeMap, BTreeSet};

use ghostex_gx_protocol::{LifecycleState, PresentationSession, SessionActivity};
use serde::{Deserialize, Serialize};

/// An optimistic patch of one session. Only the fields that are `Some` are overlaid.
///
/// A patch always expires: the request it anticipates can fail silently, and an overlay that
/// never ends would hide the daemon's state for good. Build one with [`SessionPatch::lifecycle`]
/// or [`SessionPatch::activity`].
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[non_exhaustive]
pub struct SessionPatch {
    pub lifecycle_state: Option<LifecycleState>,
    pub activity: Option<SessionActivity>,
    /// Host time after which the patch is dropped, checked on every tick against `now_ms`.
    pub expires_at_ms: u64,
}

impl SessionPatch {
    /// Shows `lifecycle_state` until the daemon reports it, reports something newer, or the patch
    /// expires.
    pub fn lifecycle(lifecycle_state: LifecycleState, expires_at_ms: u64) -> Self {
        Self {
            lifecycle_state: Some(lifecycle_state),
            activity: None,
            expires_at_ms,
        }
    }

    /// Shows `activity` until the daemon reports it, reports something newer, or the patch expires.
    pub fn activity(activity: SessionActivity, expires_at_ms: u64) -> Self {
        Self {
            lifecycle_state: None,
            activity: Some(activity),
            expires_at_ms,
        }
    }

    pub fn with_lifecycle(mut self, lifecycle_state: LifecycleState) -> Self {
        self.lifecycle_state = Some(lifecycle_state);
        self
    }

    pub fn with_activity(mut self, activity: SessionActivity) -> Self {
        self.activity = Some(activity);
        self
    }

    pub fn is_empty(&self) -> bool {
        self.lifecycle_state.is_none() && self.activity.is_none()
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

/// What the daemon row says now, compared with a stored patch.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum PatchVerdict {
    /// The daemon still says what it said when the patch was made: keep overlaying.
    Pending,
    /// The daemon row says what the patch says: the patch has nothing left to do.
    CaughtUp,
    /// The daemon row changed to something else: it is newer than the patch, and the patch must
    /// not hide it.
    ServerMovedOn,
}

/// A patch plus the daemon values it was made against.
///
/// CDXC:StateSync 2026-09-19 WHY:
/// A patch must never hide daemon state that is newer than it. Example: the user acknowledges attention (patch activity to idle), the agent starts working again and raises a second attention event before the acknowledgement lands; comparing only "does the row equal the patch" would keep showing idle until the patch expired. Recording the base and dropping the patch as soon as the row leaves that base keeps the overlay strictly about the one transition it anticipated. The attention event id is part of the base because a new attention event has the same activity value as the old one.
#[derive(Clone, Debug, PartialEq, Eq)]
pub(crate) struct StoredPatch {
    pub(crate) patch: SessionPatch,
    base_lifecycle_state: LifecycleState,
    base_activity: SessionActivity,
    base_attention_event_id: Option<String>,
}

fn attention_event_id(session: &PresentationSession) -> Option<&str> {
    session
        .attention
        .as_ref()
        .and_then(|attention| attention.event_id.as_deref())
}

impl StoredPatch {
    pub(crate) fn new(patch: SessionPatch, server: &PresentationSession) -> Self {
        Self {
            patch,
            base_lifecycle_state: server.lifecycle_state.clone(),
            base_activity: server.activity.clone(),
            base_attention_event_id: attention_event_id(server).map(str::to_string),
        }
    }

    pub(crate) fn verdict(&self, server: &PresentationSession) -> PatchVerdict {
        let mut pending = false;
        if let Some(lifecycle) = &self.patch.lifecycle_state {
            if *lifecycle != server.lifecycle_state {
                if server.lifecycle_state != self.base_lifecycle_state {
                    return PatchVerdict::ServerMovedOn;
                }
                pending = true;
            }
        }
        if let Some(activity) = &self.patch.activity {
            if *activity != server.activity {
                let same_base = server.activity == self.base_activity
                    && attention_event_id(server) == self.base_attention_event_id.as_deref();
                if !same_base {
                    return PatchVerdict::ServerMovedOn;
                }
                pending = true;
            }
        }
        if pending {
            PatchVerdict::Pending
        } else {
            PatchVerdict::CaughtUp
        }
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
    pub(crate) session_patches: ProjectSessionMap<StoredPatch>,
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
