//! The sidebar view model: one cache that derives the list from the store, keeps it up to date
//! from a [`ChangeSummary`], and can rebuild it from scratch to the same result.
//!
//! CDXC:Sidebar 2026-09-20 WHY:
//! Every publish of the TypeScript projection re-derived every row of the machine (title, tooltip, tag lookup, sorting), which cost 30 to 40 ms on the service thread while agents were running. Here a row is derived once and kept behind an `Arc` until the store says that session changed, a group is rebuilt only when one of its own inputs moved, and an update with an empty change summary and unchanged inputs does no work at all. The from-scratch build exists so the two can be compared: anything the incremental path forgets to invalidate shows up as a difference.

use std::borrow::Cow;
use std::collections::{BTreeMap, BTreeSet};
use std::sync::Arc;

use crate::change::ChangeSummary;
use crate::core::Core;
use crate::keys::{MachineId, ProjectKey, SessionKey, CHATS_GROUP_ID};
use crate::presentation_store::PresentationStore;

use super::assemble::{assemble, AssembleInput};
use super::collections::CollectionsState;
use super::groups::{build_group, FocusKey, GroupBuild, GroupKind, GroupPlan, ProjectContextInput};
use super::inputs::{BrowserTabInput, SectionCollapse, SidebarInputs, LOCAL_MACHINE_ID};
use super::membership::{project_members, ProjectMembers};
use super::projects::ProjectMeta;
use super::rows::{browser_row, session_row, RowContext};
use super::spaces::SpacesState;
use super::tags::TagCatalog;
use super::view::{SessionRow, SidebarView};

/// The inputs of one group, so a group that nothing touched is kept as it is.
#[derive(Clone, Debug, PartialEq, Eq)]
struct GroupKey {
    /// Identity of every row of the group, in order.
    rows: Vec<usize>,
    title: String,
    storage_id: String,
    /// Identity of the project facts; a changed project gives a new one.
    project: Option<usize>,
    is_active: bool,
    /// Focus only matters for the active group; every other group draws no focused row.
    focused_session_id: Option<String>,
    visible_session_ids: Vec<String>,
    active_project_matches: bool,
    selected_rows: Vec<usize>,
    tag_filters: Vec<String>,
    collapsed: bool,
    expanded: bool,
    hover_actions_expanded: bool,
    section_collapse: SectionCollapse,
    enable_parking: bool,
    compact_count: u32,
    sort_mode: super::inputs::SessionSortMode,
}

struct CachedGroup {
    key: GroupKey,
    build: GroupBuild,
}

struct CacheState {
    machine: MachineId,
    inputs: SidebarInputs,
    focus: FocusKey,
    catalog: TagCatalog,
    meta: Arc<ProjectMeta>,
    membership: BTreeMap<String, Arc<ProjectMembers>>,
    project_contexts: BTreeMap<String, Arc<ProjectContextInput>>,
    rows: BTreeMap<String, BTreeMap<String, Arc<SessionRow>>>,
    browser_rows: BTreeMap<String, (Vec<BrowserTabInput>, Vec<Arc<SessionRow>>)>,
    groups: BTreeMap<String, CachedGroup>,
    view: SidebarView,
    next_deadline_ms: Option<u64>,
    machine_loaded: bool,
}

/// The sidebar list of one machine, kept up to date from the store.
#[derive(Default)]
pub struct SidebarViewModel {
    state: Option<CacheState>,
}

impl SidebarViewModel {
    pub fn new() -> Self {
        Self::default()
    }

    /// The list as it stands. Empty until the first [`Self::update`].
    pub fn view(&self) -> &SidebarView {
        static EMPTY: std::sync::OnceLock<SidebarView> = std::sync::OnceLock::new();
        match &self.state {
            Some(state) => &state.view,
            None => EMPTY.get_or_init(SidebarView::default),
        }
    }

    /// The next host time at which a row moves on its own (a new session stops leading the list, a
    /// snooze ends). The host re-runs the update then; nothing else has to.
    pub fn next_deadline_ms(&self) -> Option<u64> {
        self.state.as_ref().and_then(|state| state.next_deadline_ms)
    }

    /// Builds the whole list without any cache. The incremental update must give the same result;
    /// the replay tool compares the two on every event.
    pub fn build_from_scratch(core: &Core, inputs: &SidebarInputs, now_ms: u64) -> SidebarView {
        let mut model = Self::new();
        model.update(core, inputs, &full_change_summary(), now_ms);
        model.view().clone()
    }

    /// Applies what changed. Returns whether the list itself moved.
    pub fn update(
        &mut self,
        core: &Core,
        inputs: &SidebarInputs,
        changes: &ChangeSummary,
        now_ms: u64,
    ) -> bool {
        let machine = machine_id(&inputs.ui.selected_machine_id);
        let focus = focus_key(core, &machine);
        let store = core.presentation();
        let machine_loaded = store.loaded(&machine).is_some();

        let reset = match &self.state {
            None => true,
            Some(state) => {
                state.machine != machine
                    || state.machine_loaded != machine_loaded
                    || changes.machines_reloaded.contains(&machine)
            }
        };
        if !reset {
            let state = self.state.as_ref().expect("checked above");
            let time_passed = state
                .next_deadline_ms
                .is_some_and(|deadline| now_ms >= deadline);
            if changes.is_empty() && !time_passed && state.focus == focus && state.inputs == *inputs
            {
                return false;
            }
        }
        if reset {
            self.state = None;
        }

        let mut previous = self.state.take();
        let catalog = TagCatalog::from_state(
            store
                .machine(&machine)
                .and_then(|machine| machine.side_state().custom_session_tags.as_ref()),
        );
        let rows_all_dirty = previous.as_ref().is_none_or(|state| {
            state.catalog != catalog
                || state.inputs.settings.debugging_mode != inputs.settings.debugging_mode
        });
        let meta_dirty = previous.as_ref().is_none_or(|_| {
            !changes.projects_changed.is_empty()
                || !changes.projects_removed.is_empty()
                || !changes.project_order_changed.is_empty()
                || !changes.chat_collection_changed.is_empty()
                || changes.side_state.workspace_groups
        });
        // The projection prunes the ticked filters to the ones the Sort & Filter menu still
        // offers before it reads them, so a filter whose tag was turned off in settings (or whose
        // custom tag the daemon dropped) filters nothing.
        let enabled_filters = inputs.settings.enabled_tag_filters(&catalog);
        let effective_inputs: Cow<'_, SidebarInputs> = if inputs
            .ui
            .selected_tag_filters
            .iter()
            .all(|tag| enabled_filters.contains(tag))
        {
            Cow::Borrowed(inputs)
        } else {
            let mut pruned = inputs.clone();
            pruned
                .ui
                .selected_tag_filters
                .retain(|tag| enabled_filters.contains(tag));
            Cow::Owned(pruned)
        };
        let effective = effective_inputs.as_ref();
        let row_context = RowContext {
            catalog: &catalog,
            debugging_mode: effective.settings.debugging_mode,
        };

        // 1. Project facts.
        let meta = match (&previous, meta_dirty) {
            (Some(previous), false) => previous.meta.clone(),
            _ => Arc::new(match store.machine(&machine) {
                Some(entry) => super::projects::build_project_meta(
                    entry,
                    store
                        .machine(&MachineId::Local)
                        .and_then(|local| local.side_state().workspace_groups.as_ref())
                        .map(|groups| groups.project_order.as_slice())
                        .unwrap_or_default(),
                ),
                None => ProjectMeta::default(),
            }),
        };

        // 2. Which sessions and projects moved.
        let mut dirty_projects: BTreeSet<&str> = BTreeSet::new();
        let mut dirty_rows: BTreeSet<(&str, &str)> = BTreeSet::new();
        for project in changes
            .session_order_changed
            .iter()
            .filter(|project| project.machine == machine)
        {
            dirty_projects.insert(project.project_id.as_str());
        }
        for session in changes
            .sessions_changed
            .iter()
            .chain(&changes.sessions_removed)
            .filter(|session| session.machine == machine)
        {
            dirty_projects.insert(session.project_id.as_str());
            dirty_rows.insert((session.project_id.as_str(), session.session_id.as_str()));
        }
        let timer_keys: BTreeSet<(String, String)> = match &previous {
            Some(previous) if !rows_all_dirty => changed_timer_keys(&previous.inputs, inputs)
                .iter()
                .filter_map(|key| parse_sidebar_session_key(key))
                .collect(),
            _ => BTreeSet::new(),
        };
        // Projects whose git numbers moved; their header and tooltip are rebuilt.
        let diff_stats_dirty: BTreeSet<String> = match &previous {
            Some(previous) => previous
                .inputs
                .host
                .project_diff_stats
                .keys()
                .chain(inputs.host.project_diff_stats.keys())
                .filter(|project_id| {
                    previous.inputs.host.project_diff_stats.get(*project_id)
                        != inputs.host.project_diff_stats.get(*project_id)
                })
                .cloned()
                .collect(),
            None => BTreeSet::new(),
        };
        for (project_id, session_id) in &timer_keys {
            dirty_rows.insert((project_id.as_str(), session_id.as_str()));
        }

        // 3. The rows themselves: kept from the previous round unless the store or a host timer
        // touched them.
        // The rows are moved out of the previous round rather than copied: a machine with two
        // hundred sessions would otherwise clone every key on every update.
        let mut rows = match (&mut previous, rows_all_dirty) {
            (Some(previous), false) => std::mem::take(&mut previous.rows),
            _ => BTreeMap::new(),
        };
        for (project_id, session_id) in &dirty_rows {
            if let Some(sessions) = rows.get_mut(*project_id) {
                sessions.remove(*session_id);
            }
        }
        for project in changes
            .projects_removed
            .iter()
            .filter(|project| project.machine == machine)
        {
            rows.remove(&project.project_id);
        }

        // 4. Membership, per project.
        let membership_all_dirty = previous.is_none() || meta_dirty;
        let mut membership: BTreeMap<String, Arc<ProjectMembers>> = BTreeMap::new();
        for project_id in meta.project_order.iter().chain(&meta.chat_order) {
            let reuse = !membership_all_dirty && !dirty_projects.contains(project_id.as_str());
            let members = match (&previous, reuse) {
                (Some(previous), true) => previous.membership.get(project_id).cloned(),
                _ => None,
            };
            let members = members.unwrap_or_else(|| {
                Arc::new(match store.machine(&machine) {
                    Some(entry) => project_members(
                        store,
                        entry,
                        &machine,
                        project_id,
                        meta.project_order.iter().any(|id| id == project_id),
                    ),
                    None => ProjectMembers::default(),
                })
            });
            membership.insert(project_id.clone(), members);
        }

        // 5. Group plans, with every row resolved.
        let mut state = CacheState {
            machine: machine.clone(),
            inputs: inputs.clone(),
            focus,
            catalog: catalog.clone(),
            meta: meta.clone(),
            membership,
            project_contexts: BTreeMap::new(),
            rows,
            browser_rows: BTreeMap::new(),
            groups: BTreeMap::new(),
            view: SidebarView::default(),
            next_deadline_ms: None,
            machine_loaded,
        };
        let mut plans: Vec<GroupPlan> = Vec::new();
        let chat_members: Vec<(String, String)> = meta
            .chat_order
            .iter()
            .flat_map(|project_id| {
                state
                    .membership
                    .get(project_id)
                    .map(|members| members.session_ids.clone())
                    .unwrap_or_default()
                    .into_iter()
                    .map(|session_id| (project_id.clone(), session_id))
            })
            .collect();
        let chat_rows = chat_members
            .iter()
            .filter_map(|(project_id, session_id)| {
                resolve_row(
                    &mut state,
                    store,
                    &machine,
                    project_id,
                    session_id,
                    effective,
                    &row_context,
                )
            })
            .collect();
        plans.push(GroupPlan {
            group_id: chats_group_id(&machine),
            storage_id: chats_group_id(&machine),
            title: "Chats".to_string(),
            kind: GroupKind::Chats,
            rows: chat_rows,
            project: None,
        });
        for project_id in meta.project_order.iter() {
            let project_key = ProjectKey {
                machine: machine.clone(),
                project_id: project_id.clone(),
            };
            let members = state
                .membership
                .get(project_id)
                .cloned()
                .unwrap_or_default();
            let mut rows: Vec<Arc<SessionRow>> = browser_rows_for_project(
                &mut state,
                previous.as_ref(),
                project_id,
                effective,
                &row_context,
            );
            for session_id in &members.session_ids {
                if let Some(row) = resolve_row(
                    &mut state,
                    store,
                    &machine,
                    project_id,
                    session_id,
                    effective,
                    &row_context,
                ) {
                    rows.push(row);
                }
            }
            // A project's facts are kept until the project row, the overlays, or the host's git
            // numbers move.
            let project_dirty = meta_dirty
                || dirty_projects.contains(project_id.as_str())
                || diff_stats_dirty.contains(project_id);
            let project = match (&previous, project_dirty) {
                (Some(previous), false) => previous.project_contexts.get(project_id).cloned(),
                _ => None,
            }
            .or_else(|| {
                project_context(store, &machine, &meta, project_id, effective).map(Arc::new)
            });
            if let Some(project) = &project {
                state
                    .project_contexts
                    .insert(project_id.clone(), project.clone());
            }
            plans.push(GroupPlan {
                group_id: project_key.to_sidebar_group_id(),
                storage_id: project_id.clone(),
                title: project
                    .as_ref()
                    .map(|project| project.title.clone())
                    .unwrap_or_default(),
                kind: GroupKind::Project,
                rows,
                project,
            });
            for subgroup in &members.subgroups {
                let mut rows: Vec<Arc<SessionRow>> = Vec::new();
                for session_id in &subgroup.session_ids {
                    if let Some(row) = resolve_row(
                        &mut state,
                        store,
                        &machine,
                        project_id,
                        session_id,
                        effective,
                        &row_context,
                    ) {
                        rows.push(row);
                    }
                }
                plans.push(GroupPlan {
                    group_id: subgroup.sidebar_group_id.clone(),
                    storage_id: subgroup.sidebar_group_id.clone(),
                    title: subgroup.title.clone(),
                    kind: GroupKind::Subgroup,
                    rows,
                    project: None,
                });
            }
        }

        let mut builds: BTreeMap<String, GroupBuild> = BTreeMap::new();
        for plan in &plans {
            let key = group_key(plan, &state.focus, effective);
            let reuse = previous
                .as_mut()
                .and_then(|previous| previous.groups.remove(&plan.group_id))
                .filter(|cached| cached.key == key)
                .filter(|cached| {
                    cached
                        .build
                        .deadline_ms
                        .is_none_or(|deadline| now_ms < deadline)
                });
            let build = match reuse {
                Some(cached) => cached.build,
                None => build_group(
                    plan,
                    &state.focus,
                    &effective.ui,
                    &effective.settings,
                    now_ms,
                ),
            };
            state.next_deadline_ms = min_deadline(state.next_deadline_ms, build.deadline_ms);
            builds.insert(plan.group_id.clone(), build.clone());
            state
                .groups
                .insert(plan.group_id.clone(), CachedGroup { key, build });
        }

        // 6. The list itself.
        let side_state = store.machine(&machine).map(|entry| entry.side_state());
        state.view = assemble(AssembleInput {
            plans: &plans,
            builds: &builds,
            meta: &meta,
            ui: &effective.ui,
            settings: &effective.settings,
            host: &effective.host,
            spaces: side_state
                .and_then(|side| side.spaces.as_ref())
                .map(SpacesState::from_wire),
            collections: side_state
                .and_then(|side| side.project_collections.as_ref())
                .map(CollectionsState::from_wire)
                .unwrap_or_default(),
            machine_loaded,
            now_ms,
        });
        let changed = previous
            .as_ref()
            .is_none_or(|previous| previous.view != state.view);
        self.state = Some(state);
        changed
    }
}

/// Every row of a project's browser tabs, kept until the tabs themselves change.
fn browser_rows_for_project(
    state: &mut CacheState,
    previous: Option<&CacheState>,
    project_id: &str,
    inputs: &SidebarInputs,
    context: &RowContext<'_>,
) -> Vec<Arc<SessionRow>> {
    let tabs: Vec<BrowserTabInput> = inputs
        .host
        .browser_tabs
        .iter()
        .filter(|tab| tab.project_id == project_id)
        .cloned()
        .collect();
    if tabs.is_empty() {
        return Vec::new();
    }
    let reuse = previous
        .and_then(|previous| previous.browser_rows.get(project_id))
        .filter(|(cached_tabs, _)| *cached_tabs == tabs)
        .map(|(_, rows)| rows.clone());
    let rows = reuse.unwrap_or_else(|| {
        tabs.iter()
            .map(|tab| Arc::new(browser_row(tab, context)))
            .collect()
    });
    state
        .browser_rows
        .insert(project_id.to_string(), (tabs, rows.clone()));
    rows
}

/// One session's row: the one already held when nothing touched it, a fresh one otherwise. The
/// rows of sessions the store reported as changed were dropped before the plans were built.
fn resolve_row(
    state: &mut CacheState,
    store: &PresentationStore,
    machine: &MachineId,
    project_id: &str,
    session_id: &str,
    inputs: &SidebarInputs,
    context: &RowContext<'_>,
) -> Option<Arc<SessionRow>> {
    if let Some(row) = state
        .rows
        .get(project_id)
        .and_then(|sessions| sessions.get(session_id))
    {
        return Some(row.clone());
    }
    let session = store
        .machine(machine)?
        .effective_session(project_id, session_id)?;
    let key = SessionKey {
        machine: machine.clone(),
        project_id: project_id.to_string(),
        session_id: session_id.to_string(),
    };
    let sidebar_id = super::rows::sidebar_session_id(project_id, session_id);
    let row = Arc::new(session_row(
        key,
        &session,
        inputs.host.close_after_done.get(&sidebar_id),
        inputs.host.local_delayed_sends.get(&sidebar_id),
        context,
    ));
    state
        .rows
        .entry(project_id.to_string())
        .or_default()
        .insert(session_id.to_string(), row.clone());
    Some(row)
}

/// The project facts a project group draws.
fn project_context(
    store: &PresentationStore,
    machine: &MachineId,
    meta: &ProjectMeta,
    project_id: &str,
    inputs: &SidebarInputs,
) -> Option<ProjectContextInput> {
    let loaded = store.loaded(machine)?;
    let project = loaded.project(project_id)?;
    let overlay = meta.overlay(project_id);
    let worktree = overlay.and_then(|overlay| overlay.worktree.clone());
    let worktree_count = meta
        .overlays
        .values()
        .filter(|candidate| {
            candidate
                .worktree
                .as_ref()
                .is_some_and(|worktree| worktree.parent_project_id == project_id)
        })
        .count();
    Some(ProjectContextInput {
        project_id: project_id.to_string(),
        title: project.title.clone(),
        path: project.path.clone().unwrap_or_default(),
        icon_data_url: overlay.and_then(|overlay| overlay.icon_data_url.clone()),
        discovered_icon_data_url: project.discovered_icon_data_url.clone(),
        worktree,
        diff_stats: inputs
            .host
            .project_diff_stats
            .get(project_id)
            .copied()
            .unwrap_or_default(),
        worktree_count,
    })
}

fn group_key(plan: &GroupPlan, focus: &FocusKey, inputs: &SidebarInputs) -> GroupKey {
    let is_active = focus.active_group_id.as_deref() == Some(plan.group_id.as_str());
    GroupKey {
        rows: plan
            .rows
            .iter()
            .map(|row| Arc::as_ptr(row) as usize)
            .collect(),
        title: plan.title.clone(),
        storage_id: plan.storage_id.clone(),
        project: plan
            .project
            .as_ref()
            .map(|project| Arc::as_ptr(project) as usize),
        is_active,
        focused_session_id: is_active
            .then(|| focus.focused_session_id.clone())
            .flatten(),
        visible_session_ids: if is_active {
            focus.visible_session_ids.clone()
        } else {
            Vec::new()
        },
        active_project_matches: plan.project.as_ref().is_some_and(|project| {
            focus.active_project_id.as_deref() == Some(project.project_id.as_str())
        }),
        selected_rows: plan
            .rows
            .iter()
            .enumerate()
            .filter(|(_, row)| {
                inputs
                    .ui
                    .selected_session_ids
                    .iter()
                    .any(|selected| *selected == row.sidebar_session_id)
            })
            .map(|(index, _)| index)
            .collect(),
        tag_filters: inputs.ui.selected_tag_filters.clone(),
        collapsed: inputs.ui.collapse.collapsed_groups.contains(&plan.group_id),
        expanded: inputs
            .ui
            .collapse
            .expanded_session_lists
            .contains(&plan.storage_id),
        hover_actions_expanded: inputs
            .ui
            .collapse
            .expanded_hover_actions
            .contains(&plan.storage_id),
        section_collapse: inputs
            .ui
            .collapse
            .section_collapse
            .get(&plan.storage_id)
            .copied()
            .unwrap_or_default(),
        enable_parking: inputs.settings.enable_session_parking,
        compact_count: inputs.settings.project_session_list_collapsed_count,
        sort_mode: inputs.settings.sort_mode,
    }
}

/// The sidebar session ids whose host-owned timers changed.
fn changed_timer_keys(previous: &SidebarInputs, next: &SidebarInputs) -> BTreeSet<String> {
    let mut keys: BTreeSet<String> = BTreeSet::new();
    for key in previous
        .host
        .close_after_done
        .keys()
        .chain(next.host.close_after_done.keys())
    {
        if previous.host.close_after_done.get(key) != next.host.close_after_done.get(key) {
            keys.insert(key.clone());
        }
    }
    for key in previous
        .host
        .local_delayed_sends
        .keys()
        .chain(next.host.local_delayed_sends.keys())
    {
        if previous.host.local_delayed_sends.get(key) != next.host.local_delayed_sends.get(key) {
            keys.insert(key.clone());
        }
    }
    keys
}

/// `combined-session:<project>:<session>` back to its parts.
fn parse_sidebar_session_key(sidebar_session_id: &str) -> Option<(String, String)> {
    SessionKey::parse_sidebar_session_id(sidebar_session_id)
        .map(|key| (key.project_id, key.session_id))
}

fn machine_id(selected_machine_id: &str) -> MachineId {
    if selected_machine_id == LOCAL_MACHINE_ID {
        MachineId::Local
    } else {
        MachineId::Remote(selected_machine_id.to_string())
    }
}

fn chats_group_id(machine: &MachineId) -> String {
    match machine {
        MachineId::Local => CHATS_GROUP_ID.to_string(),
        MachineId::Remote(machine_id) => {
            ProjectKey::remote(machine_id.as_str(), CHATS_GROUP_ID).to_sidebar_group_id()
        }
    }
}

/// Focus in the vocabulary the rows compare against: raw session ids of this machine.
fn focus_key(core: &Core, machine: &MachineId) -> FocusKey {
    let focus = core.focus();
    FocusKey {
        active_group_id: focus
            .active_group
            .as_ref()
            .map(crate::focus::ActiveGroup::to_sidebar_group_id),
        active_project_id: focus
            .active_project
            .as_ref()
            .filter(|project| project.machine == *machine)
            .map(|project| project.project_id.clone()),
        focused_session_id: focus
            .focused_session
            .as_ref()
            .filter(|session| session.machine == *machine)
            .map(|session| session.session_id.clone()),
        visible_session_ids: focus
            .visible_sessions
            .iter()
            .filter(|session| session.machine == *machine)
            .map(|session| session.session_id.clone())
            .collect(),
    }
}

fn min_deadline(left: Option<u64>, right: Option<u64>) -> Option<u64> {
    match (left, right) {
        (Some(left), Some(right)) => Some(left.min(right)),
        (value, None) | (None, value) => value,
    }
}

/// A change summary that invalidates everything, for the from-scratch build.
fn full_change_summary() -> ChangeSummary {
    ChangeSummary::default()
}
