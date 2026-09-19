//! Read-only views over the presentation store. Every selector sees the effective state: daemon
//! rows with local overlays applied, locally hidden rows left out.

use std::borrow::Cow;

use ghostex_gx_protocol::{
    LifecycleState, PresentationProject, PresentationSession, SessionActivity, SessionKind,
    SessionSurface, WorkspaceSessionGroup,
};
use serde::{Deserialize, Serialize};
use serde_json::Value;

use crate::focus::ActiveGroup;
use crate::keys::{MachineId, ProjectKey, SessionKey};
use crate::presentation_store::{LoadedPresentation, MachinePresentation, PresentationStore};

/// A value that does not exist until a machine's first snapshot arrived.
///
/// `NotLoaded` must never be read as "empty": an empty tab list tells the workspace that the
/// project has no sessions, and it then clears every restored tab, split, and session mapping.
#[derive(Clone, Debug, PartialEq)]
pub enum Loadable<T> {
    NotLoaded,
    Loaded(T),
}

impl<T> Loadable<T> {
    pub fn loaded(self) -> Option<T> {
        match self {
            Self::NotLoaded => None,
            Self::Loaded(value) => Some(value),
        }
    }

    pub fn is_loaded(&self) -> bool {
        matches!(self, Self::Loaded(_))
    }
}

/// Synthetic project id of the Quick Automations overview row; never a workspace tab.
pub const QUICK_AUTOMATIONS_PROJECT_ID: &str = "quick-automations";
/// Title of a session that has none.
pub const DEFAULT_TERMINAL_SESSION_TITLE: &str = "Terminal Session";
/// Upper bound of a tab title, in UTF-16 code units like the JavaScript it replaces.
pub const TAB_SESSION_TITLE_MAX_UTF16: usize = 512;

/// One workspace tab, in the shape the tab strip draws.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TabSession {
    pub key: SessionKey,
    /// `displayTitle`, else `primaryTitle`, else `terminalTitle`, else `title`, else the default;
    /// trimmed and bounded.
    pub title: String,
    pub kind: SessionKind,
    pub activity: SessionActivity,
    pub lifecycle_state: LifecycleState,
    pub is_sleeping: bool,
    pub is_draft: bool,
    pub is_generating_first_prompt_title: bool,
    /// The session's cwd, else the project folder.
    pub working_directory: Option<String>,
    /// The daemon's icon key, unresolved (the old runtime mapped it through the agent catalog).
    pub agent_icon: Option<String>,
    pub agent_name: Option<String>,
    pub agent_session_id: Option<String>,
    pub has_session_note: bool,
    pub stashed_prompt_count: Option<u64>,
    pub has_switchable_agents: bool,
}

impl PresentationStore {
    /// The effective session, or `None` when it does not exist, its machine is not loaded, or it
    /// is hidden locally.
    pub fn session(&self, key: &SessionKey) -> Option<Cow<'_, PresentationSession>> {
        self.machine(&key.machine)?
            .effective_session(&key.project_id, &key.session_id)
    }

    /// The project row, or `None` when it does not exist or is hidden locally.
    pub fn project(&self, key: &ProjectKey) -> Option<&PresentationProject> {
        let machine = self.machine(&key.machine)?;
        if machine.is_project_hidden(&key.project_id) {
            return None;
        }
        machine.loaded()?.project(&key.project_id)
    }

    pub fn project_of_session(&self, key: &SessionKey) -> Option<&PresentationProject> {
        self.session(key)?;
        self.project(&key.project_key())
    }

    /// Every effective session of a project on any surface, ordered by
    /// `(group_id, sort_key, session_id)`.
    pub fn sessions_of_project(
        &self,
        key: &ProjectKey,
    ) -> Loadable<Vec<Cow<'_, PresentationSession>>> {
        let Some(machine) = self.machine(&key.machine) else {
            return Loadable::NotLoaded;
        };
        let Some(loaded) = machine.loaded() else {
            return Loadable::NotLoaded;
        };
        let mut sessions: Vec<Cow<'_, PresentationSession>> = loaded
            .project_sessions(&key.project_id)
            .into_iter()
            .flat_map(|sessions| sessions.keys())
            .filter_map(|session_id| machine.effective_session(&key.project_id, session_id))
            .collect();
        sessions.sort_by(|left, right| {
            (&left.group_id, &left.sort_key, &left.session_id).cmp(&(
                &right.group_id,
                &right.sort_key,
                &right.session_id,
            ))
        });
        Loadable::Loaded(sessions)
    }

    /// Resolves the raw local session id the focus state file holds (it does not name the
    /// project) or a remote-scoped id. `None` when no such session exists right now.
    pub fn resolve_focus_state_session_id(&self, value: &str) -> Option<SessionKey> {
        if let Some(remote) = SessionKey::parse_remote_scoped_session_id(value) {
            return Some(remote);
        }
        let loaded = self.loaded(&MachineId::Local)?;
        loaded
            .server_sessions()
            .find(|session| session.session_id == value)
            .map(|session| {
                SessionKey::local(session.project_id.as_str(), session.session_id.as_str())
            })
    }

    /// Whether the local daemon reports the session as running (with local patches applied).
    pub fn is_running_local_session(&self, project_id: &str, session_id: &str) -> bool {
        self.local_lifecycle(project_id, session_id) == Some(LifecycleState::Running)
    }

    /// Whether the local session is sleeping (with local patches applied).
    ///
    /// The TypeScript version also consulted two caches of the last published sidebar groups.
    /// Both were projections of this same presentation, so they add nothing here.
    pub fn is_sleeping_local_session(&self, project_id: &str, session_id: &str) -> bool {
        self.local_lifecycle(project_id, session_id) == Some(LifecycleState::Sleeping)
    }

    fn local_lifecycle(&self, project_id: &str, session_id: &str) -> Option<LifecycleState> {
        self.machine(&MachineId::Local)?
            .effective_session(project_id, session_id)
            .map(|session| session.lifecycle_state.clone())
    }

    /// Whether a project is a projectless Chats container: flagged as chat or quick on its domain
    /// row, or stored under a Ghostex chats folder.
    pub fn is_chat_project(&self, key: &ProjectKey) -> bool {
        let Some(machine) = self.machine(&key.machine) else {
            return false;
        };
        let domain = machine.domain_project(&key.project_id);
        let domain_flag = |name: &str| {
            domain.is_some_and(|project| {
                project.get(name).and_then(Value::as_bool) == Some(true)
                    || project
                        .get("launchSettings")
                        .and_then(|settings| settings.get(name))
                        .and_then(Value::as_bool)
                        == Some(true)
            })
        };
        domain_flag("isChat")
            || domain_flag("isQuick")
            || domain
                .and_then(|project| project.get("path"))
                .and_then(Value::as_str)
                .is_some_and(is_chat_project_path)
            || machine
                .loaded()
                .and_then(|loaded| loaded.project(&key.project_id))
                .and_then(|project| project.path.as_deref())
                .is_some_and(is_chat_project_path)
    }

    /// The ordered workspace tabs of a sidebar group.
    ///
    /// A project group lists the project's default-group sessions in display order, leaving out:
    /// ids without a row, rows with `visibleInSidebarByDefault` false, command-pane rows
    /// (`surface == commands`), locally hidden rows, and rows that belong to one of the project's
    /// user-made groups (those are the tabs of that group instead). A user-made group lists its
    /// member ids that still have a row, in its own order, with no further filter. The Chats
    /// collection concatenates the project lists of every chat project of the machine. The
    /// synthetic Quick Automations project is never a tab. Browser rows are host state, not
    /// sessions, and are not part of this list.
    pub fn tab_sessions(&self, group: &ActiveGroup) -> Loadable<Vec<TabSession>> {
        let machine_id = match group {
            ActiveGroup::Project(project) | ActiveGroup::Subgroup { project, .. } => {
                &project.machine
            }
            ActiveGroup::Chats(machine) => machine,
        };
        let Some(machine) = self.machine(machine_id) else {
            return Loadable::NotLoaded;
        };
        let Some(loaded) = machine.loaded() else {
            return Loadable::NotLoaded;
        };
        let mut tabs = Vec::new();
        match group {
            ActiveGroup::Project(project) => {
                let subgroups = self.user_groups_of_project(project);
                push_project_tabs(
                    machine_id,
                    machine,
                    loaded,
                    &project.project_id,
                    subgroups,
                    &mut tabs,
                );
            }
            ActiveGroup::Subgroup { project, group_id } => {
                let members = self
                    .user_groups_of_project(project)
                    .iter()
                    .find(|group| group.group_id == *group_id)
                    .map(|group| group.session_ids.as_slice())
                    .unwrap_or_default();
                for session_id in members {
                    push_tab(
                        machine_id,
                        machine,
                        loaded,
                        &project.project_id,
                        session_id,
                        &mut tabs,
                    );
                }
            }
            ActiveGroup::Chats(_) => {
                for project_id in self.ordered_chat_project_ids(machine_id, machine, loaded) {
                    // Chat projects have no user-made groups.
                    push_project_tabs(machine_id, machine, loaded, project_id, &[], &mut tabs);
                }
            }
        }
        Loadable::Loaded(tabs)
    }

    /// The user-made session groups of a project. They live in the LOCAL machine's workspace-groups
    /// document for every project, keyed by the workspace project id (raw for a local project,
    /// `remote:<machine>:project:<id>` for a remote one), because the desktop client owns them.
    pub fn user_groups_of_project(&self, project: &ProjectKey) -> &[WorkspaceSessionGroup] {
        self.machine(&MachineId::Local)
            .and_then(|machine| machine.side_state().workspace_groups.as_ref())
            .and_then(|state| state.projects.get(&project.to_workspace_project_id()))
            .map(|groups| groups.groups.as_slice())
            .unwrap_or_default()
    }

    /// Chat projects in sidebar order: by manual project order when either side has one, else by
    /// `sort_key`, then newest `updated_at`, then id.
    fn ordered_chat_project_ids<'a>(
        &self,
        machine_id: &MachineId,
        machine: &MachinePresentation,
        loaded: &'a LoadedPresentation,
    ) -> Vec<&'a str> {
        let order = machine
            .side_state()
            .workspace_groups
            .as_ref()
            .map(|state| state.project_order.as_slice())
            .unwrap_or_default();
        // A machine's own document orders its projects by raw project id.
        let order_index = |project: &PresentationProject| {
            order
                .iter()
                .position(|candidate| *candidate == project.project_id)
        };
        let mut projects: Vec<(&PresentationProject, Option<usize>)> = loaded
            .projects()
            .iter()
            .filter(|project| !machine.is_project_hidden(&project.project_id))
            .filter(|project| {
                self.is_chat_project(&ProjectKey {
                    machine: machine_id.clone(),
                    project_id: project.project_id.clone(),
                })
            })
            .map(|project| (project, order_index(project)))
            .collect();
        projects.sort_by(|(left, left_index), (right, right_index)| {
            if left_index.is_some() || right_index.is_some() {
                return left_index
                    .unwrap_or(usize::MAX)
                    .cmp(&right_index.unwrap_or(usize::MAX));
            }
            left.sort_key
                .cmp(&right.sort_key)
                .then_with(|| right.updated_at.cmp(&left.updated_at))
                .then_with(|| left.project_id.cmp(&right.project_id))
        });
        projects
            .into_iter()
            .map(|(project, _)| project.project_id.as_str())
            .collect()
    }
}

fn push_project_tabs(
    machine_id: &MachineId,
    machine: &MachinePresentation,
    loaded: &LoadedPresentation,
    project_id: &str,
    subgroups: &[WorkspaceSessionGroup],
    tabs: &mut Vec<TabSession>,
) {
    if project_id == QUICK_AUTOMATIONS_PROJECT_ID || machine.is_project_hidden(project_id) {
        return;
    }
    for group in loaded
        .groups()
        .iter()
        .filter(|group| group.project_id == project_id)
    {
        for session_id in &group.session_ids {
            let in_subgroup = subgroups
                .iter()
                .any(|subgroup| subgroup.session_ids.contains(session_id));
            let listed = loaded
                .server_session(project_id, session_id)
                .is_some_and(|session| {
                    session.visible_in_sidebar_by_default
                        && session.surface != SessionSurface::Commands
                });
            if listed && !in_subgroup {
                push_tab(machine_id, machine, loaded, project_id, session_id, tabs);
            }
        }
    }
}

fn push_tab(
    machine_id: &MachineId,
    machine: &MachinePresentation,
    loaded: &LoadedPresentation,
    project_id: &str,
    session_id: &str,
    tabs: &mut Vec<TabSession>,
) {
    let Some(session) = machine.effective_session(project_id, session_id) else {
        return;
    };
    // The tab strip shows terminals and agents; any other kind a newer daemon adds is not a tab.
    if !matches!(session.kind, SessionKind::Terminal | SessionKind::Agent) {
        return;
    }
    let key = SessionKey {
        machine: machine_id.clone(),
        project_id: project_id.to_string(),
        session_id: session_id.to_string(),
    };
    if tabs.iter().any(|tab| tab.key == key) {
        return;
    }
    let working_directory = non_blank(session.cwd.as_deref())
        .or_else(|| {
            non_blank(
                loaded
                    .project(project_id)
                    .and_then(|project| project.path.as_deref()),
            )
        })
        .map(str::to_string);
    tabs.push(TabSession {
        key,
        title: tab_title(&session),
        kind: session.kind.clone(),
        activity: session.activity.clone(),
        is_sleeping: session.lifecycle_state == LifecycleState::Sleeping,
        lifecycle_state: session.lifecycle_state.clone(),
        is_draft: session.is_draft,
        is_generating_first_prompt_title: session.is_generating_first_prompt_title,
        working_directory,
        agent_icon: session.agent_icon.clone(),
        agent_name: non_blank(session.agent_name.as_deref()).map(|name| name.trim().to_string()),
        agent_session_id: non_blank(session.agent_session_id.as_deref())
            .map(|id| id.trim().to_string()),
        has_session_note: non_blank(session.session_note.as_deref()).is_some(),
        stashed_prompt_count: session.stashed_prompt_count.filter(|count| *count > 0),
        has_switchable_agents: session
            .switchable_agents
            .as_ref()
            .and_then(Value::as_array)
            .is_some_and(|agents| !agents.is_empty()),
    });
}

fn non_blank(value: Option<&str>) -> Option<&str> {
    value.filter(|value| !value.trim().is_empty())
}

fn tab_title(session: &PresentationSession) -> String {
    // `primaryTitle ?? title`: only an absent primary title falls through to the stored title here.
    let primary = session
        .primary_title
        .as_deref()
        .unwrap_or(session.title.as_str());
    let title = non_blank(session.display_title.as_deref())
        .or_else(|| non_blank(Some(primary)))
        .or_else(|| non_blank(session.terminal_title.as_deref()))
        .or_else(|| non_blank(Some(session.title.as_str())))
        .unwrap_or(DEFAULT_TERMINAL_SESSION_TITLE)
        .trim();
    let mut bounded = String::new();
    let mut units = 0;
    for character in title.chars() {
        units += character.len_utf16();
        if units > TAB_SESSION_TITLE_MAX_UTF16 {
            break;
        }
        bounded.push(character);
    }
    bounded
}

/// Chat-project detection by storage root, never by display title: `ghostex/chats`,
/// `.ghostex[-variant]/chats`, and `.active/chats`, anywhere in the path. Arbitrary projects named
/// "Chat ..." are not chat projects.
pub fn is_chat_project_path(path: &str) -> bool {
    let normalized = path.trim().replace('\\', "/");
    let mut previous: Option<&str> = None;
    for segment in normalized.trim_end_matches('/').split('/') {
        if segment == "chats" {
            if let Some(parent) = previous {
                let variant = parent
                    .strip_prefix(".ghostex-")
                    .is_some_and(|rest| !rest.is_empty());
                if parent == "ghostex" || parent == ".ghostex" || parent == ".active" || variant {
                    return true;
                }
            }
        }
        previous = Some(segment);
    }
    false
}
