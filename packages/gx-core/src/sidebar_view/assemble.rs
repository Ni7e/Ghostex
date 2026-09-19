//! The top level of the list: which groups are drawn, the Space buttons, the collections, the
//! machine tab counts, and the empty state.
//!
//! SEE-ALSO: apps/desktop/sidebar/native-sidebar/model.ts (`createNativeSidebarSnapshot`),
//! collections.ts, empty-state.ts, and space-navigation.ts.

use std::collections::{BTreeMap, BTreeSet};

use super::collections::{project_sidebar_collections, CollectionItem, CollectionsState};
use super::groups::{group_summary, GroupBuild, GroupKind, GroupPlan};
use super::inputs::{SidebarHostInputs, SidebarSettings, SidebarUiState, LOCAL_MACHINE_ID};
use super::projects::ProjectMeta;
use super::spaces::{
    resolve_selected_space, selection_shows_project, space_for_group, SpaceSelection, SpacesState,
    OTHER_SPACE_ICON, OTHER_SPACE_ID, OTHER_SPACE_LABEL,
};
use super::view::{
    CollectionView, EmptyState, GroupView, MachineSummary, OrderItem, OrderKind, SidebarView,
    SpaceView,
};

/// Everything the top level reads.
pub(crate) struct AssembleInput<'a> {
    pub(crate) plans: &'a [GroupPlan],
    pub(crate) builds: &'a BTreeMap<String, GroupBuild>,
    pub(crate) meta: &'a ProjectMeta,
    pub(crate) ui: &'a SidebarUiState,
    pub(crate) settings: &'a SidebarSettings,
    pub(crate) host: &'a SidebarHostInputs,
    pub(crate) spaces: Option<SpacesState>,
    pub(crate) collections: CollectionsState,
    /// The machine's first snapshot has arrived.
    pub(crate) machine_loaded: bool,
    pub(crate) now_ms: u64,
}

/// Builds the whole list from the groups that were already built.
pub(crate) fn assemble(input: AssembleInput<'_>) -> SidebarView {
    let section_key = input.ui.section_key();
    let group_ids: Vec<String> = input
        .plans
        .iter()
        .map(|plan| plan.group_id.clone())
        .collect();
    // Both are asked once per group per Space, so the lookup is a map rather than a scan.
    let mut projects_by_group: BTreeMap<&str, (&str, Option<&str>)> = BTreeMap::new();
    for plan in input.plans {
        if let Some(project) = &plan.project {
            projects_by_group.insert(
                plan.group_id.as_str(),
                (
                    project.project_id.as_str(),
                    project
                        .worktree
                        .as_ref()
                        .map(|worktree| worktree.parent_project_id.as_str()),
                ),
            );
        }
    }
    let project_of_group = |group_id: &str| -> Option<String> {
        projects_by_group
            .get(group_id)
            .map(|(project_id, _)| (*project_id).to_string())
    };
    let parent_project_of_group = |group_id: &str| -> Option<String> {
        projects_by_group
            .get(group_id)
            .and_then(|(_, parent)| *parent)
            .map(str::to_string)
    };
    let collection_id_by_project = input.collections.collection_id_by_project(
        &group_ids,
        &project_of_group,
        &parent_project_of_group,
    );

    // A section has a Space row only when the setting is on and its daemon published a Space
    // document at all; an older daemon has no Spaces and is never filtered.
    let spaces_document = input
        .spaces
        .clone()
        .filter(|_| input.settings.sidebar_spaces_enabled);
    let spaces_state = spaces_document.clone().unwrap_or_default();
    let selection = spaces_document.as_ref().map(|state| {
        resolve_selected_space(
            state,
            input
                .ui
                .collapse
                .selected_space_by_section
                .get(&section_key)
                .map(String::as_str),
        )
    });
    let shows_group = |selection: &SpaceSelection, group_id: &str| -> bool {
        let project = projects_by_group.get(group_id).copied();
        selection_shows_project(
            selection,
            &spaces_state,
            project.map(|(project_id, _)| project_id),
            project
                .and_then(|(project_id, _)| collection_id_by_project.get(project_id))
                .map(String::as_str),
            project.and_then(|(_, parent)| parent),
        )
    };

    // The group that owns the focused row, in section order.
    let active_group_id = group_ids.iter().find(|group_id| {
        input
            .builds
            .get(*group_id)
            .is_some_and(GroupBuild::contains_focused_session)
    });
    let active_space_id = match (&selection, active_group_id) {
        (Some(selection), Some(group_id)) => {
            let project_id = project_of_group(group_id);
            Some(space_for_group(
                &spaces_state,
                selection,
                project_id.as_deref(),
                project_id
                    .as_deref()
                    .and_then(|project_id| collection_id_by_project.get(project_id))
                    .map(String::as_str),
                parent_project_of_group(group_id).as_deref(),
            ))
        }
        _ => None,
    };

    let mut spaces: Vec<SpaceView> = Vec::new();
    if let Some(selection) = &selection {
        let mut rows: Vec<SpaceView> = spaces_state
            .ordered()
            .into_iter()
            .map(|space| SpaceView {
                id: space.space_id.clone(),
                name: space.name.clone(),
                icon: space.icon.clone(),
                color: space.color.clone(),
                ..SpaceView::default()
            })
            .collect();
        rows.push(SpaceView {
            id: OTHER_SPACE_ID.to_string(),
            name: OTHER_SPACE_LABEL.to_string(),
            icon: OTHER_SPACE_ICON.to_string(),
            color: String::new(),
            ..SpaceView::default()
        });
        for row in &mut rows {
            let view = if row.id == OTHER_SPACE_ID {
                SpaceSelection::Other
            } else {
                SpaceSelection::Space(row.id.clone())
            };
            let mut session_ids: BTreeSet<&str> = BTreeSet::new();
            let mut working_count = 0;
            let mut attention_count = 0;
            for group_id in group_ids
                .iter()
                .filter(|group_id| shows_group(&view, group_id))
            {
                let Some(build) = input.builds.get(group_id) else {
                    continue;
                };
                for session in &build.store_rows {
                    if !session_ids.insert(session.row.sidebar_session_id.as_str()) {
                        continue;
                    }
                    if session.row.activity == "working" {
                        working_count += 1;
                    }
                    if session.row.activity == "attention" || session.row.pending_question_count > 0
                    {
                        attention_count += 1;
                    }
                }
            }
            row.selected = selection.space_id() == row.id;
            row.contains_active_session = active_space_id.as_deref() == Some(row.id.as_str());
            row.working_count = working_count;
            row.attention_count = attention_count;
        }
        spaces = rows;
    }

    let mut groups: Vec<GroupView> = Vec::new();
    for plan in input.plans {
        if plan.kind == GroupKind::Chats {
            continue;
        }
        let Some(build) = input.builds.get(&plan.group_id) else {
            continue;
        };
        if let Some(selection) = &selection {
            if !shows_group(selection, &plan.group_id) {
                continue;
            }
        }
        if !input.ui.show_hidden && input.ui.hidden_items.group_ids.contains(&plan.group_id) {
            continue;
        }
        if build.tag_filtered_out {
            continue;
        }
        groups.push(GroupView {
            core: build.core.clone(),
            collection_color: None,
        });
    }

    let rendered_ids: Vec<String> = groups
        .iter()
        .map(|group| group.core.group_id.clone())
        .collect();
    let mut collections: Vec<CollectionView> = Vec::new();
    let mut order: Vec<OrderItem> = Vec::new();
    for item in project_sidebar_collections(
        &rendered_ids,
        &input.collections,
        &project_of_group,
        &parent_project_of_group,
    ) {
        match item {
            CollectionItem::Project { group_id } => order.push(OrderItem {
                kind: OrderKind::Project,
                id: group_id,
            }),
            CollectionItem::Collection {
                collection,
                group_ids,
            } => {
                let storage_id = format!("{section_key}:{}", collection.collection_id);
                if !input.ui.show_hidden
                    && input.ui.hidden_items.collection_keys.contains(&storage_id)
                {
                    continue;
                }
                for group in &mut groups {
                    if group_ids.contains(&group.core.group_id) {
                        group.collection_color = Some(collection.color.clone());
                    }
                }
                let sessions: Vec<_> = group_ids
                    .iter()
                    .filter_map(|group_id| {
                        groups
                            .iter()
                            .find(|group| group.core.group_id == *group_id)
                            .map(|group| group.core.sessions.clone())
                    })
                    .flatten()
                    .collect();
                let summary = group_summary(&sessions);
                collections.push(CollectionView {
                    collection_id: collection.collection_id.clone(),
                    storage_id,
                    title: collection.title.clone(),
                    color: collection.color.clone(),
                    group_ids,
                    collapsed: input
                        .ui
                        .collapse
                        .collapsed_collections
                        .contains(&format!("{section_key}:{}", collection.collection_id)),
                    contains_active_session: sessions.iter().any(|session| session.is_focused),
                    working_count: summary.working_count,
                    attention_count: summary.attention_count,
                    awake_count: summary.awake_count,
                });
                order.push(OrderItem {
                    kind: OrderKind::Collection,
                    id: collection.collection_id,
                });
            }
        }
    }

    let mut machine_summary = MachineSummary::default();
    for build in group_ids
        .iter()
        .filter_map(|group_id| input.builds.get(group_id))
    {
        for session in &build.store_rows {
            if session.row.activity == "working" {
                machine_summary.working_count += 1;
            }
            if session.row.activity == "attention" || session.row.pending_question_count > 0 {
                machine_summary.attention_count += 1;
            }
        }
    }

    SidebarView {
        ready: true,
        supported: input.ui.selected_machine_id == LOCAL_MACHINE_ID,
        selected_machine_id: input.ui.selected_machine_id.clone(),
        scroll_scope: format!(
            "{}|{}",
            input.ui.selected_machine_id,
            selection
                .as_ref()
                .map_or("all", |selection| selection.space_id())
        ),
        machine: machine_summary,
        spaces_enabled: selection.is_some(),
        spaces,
        groups,
        collections,
        order,
        empty_state: empty_state(&input, selection.as_ref()),
    }
}

/// `createNativeEmptyState`.
fn empty_state(input: &AssembleInput<'_>, selection: Option<&SpaceSelection>) -> EmptyState {
    let unavailable = !input.machine_loaded;
    let error = unavailable
        && (input.host.unavailable.observed_available
            || input
                .host
                .unavailable
                .since_ms
                .is_some_and(|since| input.now_ms.saturating_sub(since) >= 20_000));
    let loading = !error && unavailable;
    let known = input.meta.project_settings_count > 0
        || input.host.recent_project_count > 0
        || input.plans.iter().any(|plan| plan.kind != GroupKind::Chats);
    let can_add_project = input.ui.selected_machine_id == LOCAL_MACHINE_ID;
    let copy = if error {
        "Unable to load sessions."
    } else if !known {
        "No projects added yet."
    } else if selection.is_some_and(|selection| !selection.is_other()) {
        "No projects in this Space."
    } else {
        "No projects"
    };
    EmptyState {
        loading,
        error,
        can_add_project,
        copy: copy.to_string(),
    }
}
