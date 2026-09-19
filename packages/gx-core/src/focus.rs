//! Focus state and its reducer: active project, active group, focused session, visible sessions.
//!
//! Nothing here performs I/O. A focus change is a plain state change the host reads back and
//! draws; attaching a terminal or waking a session is the host's follow-up, never a precondition.

use serde::{Deserialize, Serialize};

use crate::keys::{
    encode_workspace_subgroup_id, parse_workspace_subgroup_id, MachineId, ProjectKey, SessionKey,
    CHATS_GROUP_ID,
};
use crate::presentation_store::PresentationStore;

/// The sidebar group whose sessions are the workspace tabs.
#[derive(Clone, Debug, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum ActiveGroup {
    /// A project's own group.
    Project(ProjectKey),
    /// The Chats collection of a machine: the sessions of all its chat projects.
    Chats(MachineId),
    /// A user-made session group inside a project.
    Subgroup {
        project: ProjectKey,
        group_id: String,
    },
}

impl ActiveGroup {
    /// The sidebar group id string the old runtime and client storage use.
    pub fn to_sidebar_group_id(&self) -> String {
        match self {
            Self::Project(project) => project.to_sidebar_group_id(),
            Self::Chats(MachineId::Local) => CHATS_GROUP_ID.to_string(),
            Self::Chats(MachineId::Remote(machine_id)) => {
                ProjectKey::remote(machine_id.as_str(), CHATS_GROUP_ID).to_sidebar_group_id()
            }
            Self::Subgroup { project, group_id } => encode_workspace_subgroup_id(project, group_id),
        }
    }

    /// Inverse of [`Self::to_sidebar_group_id`].
    pub fn parse_sidebar_group_id(value: &str) -> Option<Self> {
        if value == CHATS_GROUP_ID {
            return Some(Self::Chats(MachineId::Local));
        }
        if let Some((project, group_id)) = parse_workspace_subgroup_id(value) {
            return Some(Self::Subgroup { project, group_id });
        }
        let project = ProjectKey::parse_sidebar_group_id(value)?;
        if project.project_id == CHATS_GROUP_ID {
            return Some(Self::Chats(project.machine));
        }
        Some(Self::Project(project))
    }
}

/// A focus update that did not originate from a local intent: a daemon `focusSession` renderer
/// command, the old runtime's echo while it still runs beside the store, or a bootstrap hint.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ExternalFocusUpdate {
    /// The value of [`FocusState::local_stamp`] the sender had seen when it produced this update.
    /// An update that observed an older stamp than the current one lost the race to a newer local
    /// intent and is dropped.
    pub observed_stamp: u64,
    pub active_project: Option<ProjectKey>,
    pub active_group: Option<ActiveGroup>,
    pub focused_session: Option<SessionKey>,
    /// `None` leaves the visible set as it is.
    pub visible_sessions: Option<Vec<SessionKey>>,
}

/// What a focus reducer call did.
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct FocusOutcome {
    /// Active project, active group, focused session, or the visible set changed.
    pub changed: bool,
    pub displayed_changed: bool,
    /// Set when the remembered last session of a project changed; the host persists it.
    pub remembered: Option<(ProjectKey, SessionKey)>,
    /// Set when an external update lost to a newer local intent: `(local, observed)`.
    pub stale_external: Option<(u64, u64)>,
}

/// Who is focused and what is on screen.
///
/// CDXC:FocusRouting 2026-09-19 WHY:
/// One owner for a fact the old system kept in seven places. A local intent applies at once and bumps `local_stamp`; anything that arrives later but was produced against an older stamp is dropped, which replaces the three time-based echo suppressors of the old bridge.
#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FocusState {
    pub active_project: Option<ProjectKey>,
    pub active_group: Option<ActiveGroup>,
    pub focused_session: Option<SessionKey>,
    /// Sessions that own a pane in the focus projection. Replaced by the host's exact report
    /// whenever one arrives; between reports a focus change updates it by the local rule.
    pub visible_sessions: Vec<SessionKey>,
    /// Sessions the host says are on screen right now. Always a host-reported fact, never derived
    /// from focus history: Auto Sleep safety depends on it.
    pub displayed_sessions: Vec<SessionKey>,
    /// The session the user last selected in each project, including sleeping sessions. At most
    /// one entry per project (a list, not a map, so the state serializes to plain JSON).
    pub last_session_by_project: Vec<SessionKey>,
    /// Count of local focus intents. Monotonic; never reset while the core lives.
    pub local_stamp: u64,
    /// Host time of the newest local intent (diagnostics only; ordering uses the stamp).
    pub last_local_intent_at_ms: Option<u64>,
}

impl FocusState {
    /// The session the user last selected in a project.
    pub fn last_session_of_project(&self, project: &ProjectKey) -> Option<&SessionKey> {
        self.last_session_by_project
            .iter()
            .find(|session| session.project_key() == *project)
    }

    fn stamp(&mut self, now_ms: u64) {
        self.local_stamp += 1;
        self.last_local_intent_at_ms = Some(now_ms);
    }

    /// Local intent: focus a session.
    ///
    /// `group` names the sidebar group the click came from; without it the session's project
    /// group is used (the Chats collection for a chat project). `exact_visible` is the host's
    /// rendered set when the selection came from the workspace (tab click, next or previous tab);
    /// without it the visible set is updated by [`next_visible_sessions_for_local_focus`].
    pub fn focus_session(
        &mut self,
        store: &PresentationStore,
        session: SessionKey,
        group: Option<ActiveGroup>,
        exact_visible: Option<Vec<SessionKey>>,
        now_ms: u64,
    ) -> FocusOutcome {
        let before = self.projection();
        self.stamp(now_ms);

        let project = session.project_key();
        let group = group.unwrap_or_else(|| default_group_for_project(store, &project));
        let visible = match exact_visible {
            Some(exact) => dedupe(exact),
            None if session.machine.is_local() => next_visible_sessions_for_local_focus(
                store,
                &self.visible_sessions,
                self.focused_session.as_ref(),
                &session,
            ),
            // A remote session is shown alone until the host reports the rendered set.
            None => vec![session.clone()],
        };

        let remembered = (self.last_session_of_project(&project) != Some(&session)).then(|| {
            self.last_session_by_project
                .retain(|remembered| remembered.project_key() != project);
            self.last_session_by_project.push(session.clone());
            (project.clone(), session.clone())
        });
        self.active_project = Some(project);
        self.active_group = Some(group);
        self.focused_session = Some(session);
        self.visible_sessions = visible;

        FocusOutcome {
            changed: before != self.projection(),
            remembered,
            ..FocusOutcome::default()
        }
    }

    /// Local intent: make a project active without choosing a session. The focused session and
    /// the visible set are left alone.
    pub fn focus_project(
        &mut self,
        store: &PresentationStore,
        project: ProjectKey,
        now_ms: u64,
    ) -> FocusOutcome {
        let before = self.projection();
        self.stamp(now_ms);
        self.active_group = Some(default_group_for_project(store, &project));
        self.active_project = Some(project);
        FocusOutcome {
            changed: before != self.projection(),
            ..FocusOutcome::default()
        }
    }

    /// Local intent: the host reports the exact set of sessions that own a pane.
    pub fn set_visible_sessions(&mut self, sessions: Vec<SessionKey>, now_ms: u64) -> FocusOutcome {
        self.stamp(now_ms);
        let sessions = dedupe(sessions);
        let changed = self.visible_sessions != sessions;
        self.visible_sessions = sessions;
        FocusOutcome {
            changed,
            ..FocusOutcome::default()
        }
    }

    /// The host reports which sessions are on screen. Not a focus intent: it does not bump the
    /// stamp and never touches focus.
    pub fn set_displayed_sessions(&mut self, sessions: Vec<SessionKey>) -> FocusOutcome {
        let sessions = dedupe(sessions);
        let displayed_changed = self.displayed_sessions != sessions;
        self.displayed_sessions = sessions;
        FocusOutcome {
            displayed_changed,
            ..FocusOutcome::default()
        }
    }

    /// A focus update from outside. Applied only when it is not older than the newest local
    /// intent; it never bumps the stamp, so it can never beat a local intent itself.
    pub fn apply_external(&mut self, update: ExternalFocusUpdate) -> FocusOutcome {
        if update.observed_stamp < self.local_stamp {
            return FocusOutcome {
                stale_external: Some((self.local_stamp, update.observed_stamp)),
                ..FocusOutcome::default()
            };
        }
        let before = self.projection();
        self.active_project = update.active_project;
        self.active_group = update.active_group;
        self.focused_session = update.focused_session;
        if let Some(visible) = update.visible_sessions {
            self.visible_sessions = dedupe(visible);
        }
        FocusOutcome {
            changed: before != self.projection(),
            ..FocusOutcome::default()
        }
    }

    /// Sessions disappeared (removed by the daemon, or hidden locally): clear focus that points at
    /// them and drop them from the visible and displayed sets. Choosing a successor is a later
    /// milestone's rule; until then focus is simply empty.
    ///
    /// `forget_remembered` also drops them as a project's remembered last session. Pass `false`
    /// when the sessions are merely missing from a fresh load: the remembered session of a closed
    /// project is not in the presentation, and the user still expects it back.
    pub fn sessions_gone(&mut self, gone: &[SessionKey], forget_remembered: bool) -> FocusOutcome {
        if gone.is_empty() {
            return FocusOutcome::default();
        }
        let before = self.projection();
        if self
            .focused_session
            .as_ref()
            .is_some_and(|focused| gone.contains(focused))
        {
            self.focused_session = None;
        }
        self.visible_sessions.retain(|key| !gone.contains(key));
        let displayed_before = self.displayed_sessions.len();
        self.displayed_sessions.retain(|key| !gone.contains(key));
        if forget_remembered {
            self.last_session_by_project
                .retain(|session| !gone.contains(session));
        }
        FocusOutcome {
            changed: before != self.projection(),
            displayed_changed: displayed_before != self.displayed_sessions.len(),
            ..FocusOutcome::default()
        }
    }

    /// A machine went away: drop everything that points at it.
    pub fn machine_gone(&mut self, machine: &MachineId) -> FocusOutcome {
        let before = self.projection();
        if self
            .focused_session
            .as_ref()
            .is_some_and(|focused| focused.machine == *machine)
        {
            self.focused_session = None;
        }
        self.visible_sessions.retain(|key| key.machine != *machine);
        let displayed_before = self.displayed_sessions.len();
        self.displayed_sessions
            .retain(|key| key.machine != *machine);
        FocusOutcome {
            changed: before != self.projection(),
            displayed_changed: displayed_before != self.displayed_sessions.len(),
            ..FocusOutcome::default()
        }
    }

    fn projection(
        &self,
    ) -> (
        Option<ProjectKey>,
        Option<ActiveGroup>,
        Option<SessionKey>,
        Vec<SessionKey>,
    ) {
        (
            self.active_project.clone(),
            self.active_group.clone(),
            self.focused_session.clone(),
            self.visible_sessions.clone(),
        )
    }
}

/// The group a project's sessions live in when the caller names none.
pub fn default_group_for_project(store: &PresentationStore, project: &ProjectKey) -> ActiveGroup {
    if store.is_chat_project(project) {
        ActiveGroup::Chats(project.machine.clone())
    } else {
        ActiveGroup::Project(project.clone())
    }
}

/// The visible set after a local focus change that came without the host's rendered set.
///
/// The clicked session replaces the focused pane's session: the previously focused session leaves
/// the set, the other panes keep theirs, and the target is added. Remote ids are kept as they
/// are; local ids are kept only while the session still exists. While the local machine is not
/// loaded yet, liveness cannot be judged, so local ids are kept (the TypeScript rule dropped them,
/// but there a click before the first snapshot was impossible).
pub fn next_visible_sessions_for_local_focus(
    store: &PresentationStore,
    visible: &[SessionKey],
    previous_focused: Option<&SessionKey>,
    target: &SessionKey,
) -> Vec<SessionKey> {
    let mut next: Vec<SessionKey> = visible
        .iter()
        .filter(|key| Some(*key) != previous_focused && *key != target)
        .filter(|key| match (&key.machine, store.loaded(&key.machine)) {
            (MachineId::Remote(_), _) | (MachineId::Local, None) => true,
            (MachineId::Local, Some(loaded)) => loaded
                .server_session(&key.project_id, &key.session_id)
                .is_some(),
        })
        .cloned()
        .collect();
    next.push(target.clone());
    next
}

fn dedupe(sessions: Vec<SessionKey>) -> Vec<SessionKey> {
    let mut unique: Vec<SessionKey> = Vec::with_capacity(sessions.len());
    for session in sessions {
        if !unique.contains(&session) {
            unique.push(session);
        }
    }
    unique
}
