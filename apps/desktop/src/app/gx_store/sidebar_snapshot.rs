//! The Rust sidebar list in the shape the renderer draws.
//!
//! CDXC:Sidebar 2026-09-20 WHY:
//! The renderer reads one list, and this milestone moves where that list comes from without
//! rewriting the thirty files that draw it. Every value the list itself decides (which groups,
//! which rows, their order, sections, titles, tooltips, labels, counts, collapse and focus flags)
//! is taken from the store's view model. The menus, hover actions and header actions are the one
//! part the old projection still owns until M4c, so they are carried over from its newest publish
//! by group, collection and row id, and so are the fields no milestone has moved yet (the HUD, the
//! machine tabs, the more menu). Nothing here derives product state: a value is either the view
//! model's or the old projection's, and this file says which.
//!
//! A row, group or collection the store holds and the old projection has not published yet has
//! nothing to carry, so it draws with no context menu, no hover buttons and its fallback icon
//! until the next publish, which is the following frame in practice. That is the shape of the
//! seam until M4c moves the menus; it is not a fallback for a missing value, because there is no
//! second source for a menu this app does not build yet.

use std::collections::HashMap;
use std::sync::Arc;

use ghostex_gx_core::{CollectionView, GroupView, SessionView, SidebarView, TagPresentation};
use serde_json::{Map, Value, json};

use crate::app::native_sidebar::model::{
    NativeSidebarCollection, NativeSidebarGroup, NativeSidebarMachine, NativeSidebarOrderItem,
    NativeSidebarSection, NativeSidebarSession, NativeSidebarSnapshot,
};

/// What a cached session element was built from, so a focus change rebuilds two rows rather than
/// two hundred.
///
/// CDXC:Sidebar 2026-09-20 WHY:
/// The two sources are held rather than compared by address. This cache is kept between installs,
/// so an entry can outlive the row it was built from, and a freed allocation whose address is
/// handed to the next row would make a stale element compare equal. Holding the two `Arc`s is what
/// makes `Arc::ptr_eq` a real answer: the allocation cannot be freed while the cache holds it, so
/// no other row can ever be given its address.
struct CachedRow {
    row: Arc<ghostex_gx_core::SessionRow>,
    published: Option<Arc<NativeSidebarSession>>,
    is_focused: bool,
    is_visible: bool,
    is_multi_selected: bool,
    timer_label: Option<String>,
    last_interaction_label: Option<String>,
    element: Arc<NativeSidebarSession>,
}

impl CachedRow {
    fn matches(
        &self,
        row: &Arc<ghostex_gx_core::SessionRow>,
        published: Option<&Arc<NativeSidebarSession>>,
        session: &SessionView,
        timer_label: &Option<String>,
        last_interaction_label: &Option<String>,
    ) -> bool {
        Arc::ptr_eq(&self.row, row)
            && match (&self.published, published) {
                (Some(held), Some(published)) => Arc::ptr_eq(held, published),
                (None, None) => true,
                _ => false,
            }
            && self.is_focused == session.is_focused
            && self.is_visible == session.is_visible
            && self.is_multi_selected == session.is_multi_selected
            && self.timer_label == *timer_label
            && self.last_interaction_label == *last_interaction_label
    }
}

/// Keeps the built rows between publishes.
#[derive(Default)]
pub(super) struct SnapshotCache {
    rows: HashMap<String, CachedRow>,
}

impl SnapshotCache {
    /// Whether any drawn row's time would read differently now than in the list that is installed.
    ///
    /// CDXC:Sidebar 2026-09-20 WHY:
    /// A clock wake books a rebuild for the moment a label changes, but it books one for the
    /// EARLIEST of them, and a list of two hundred rows has one coming due most seconds while only
    /// that row's label moves. Installing on every wake rebuilt the whole list, resynced the
    /// disclosures and repainted the sidebar for nothing. This asks the question the install would
    /// have answered, over the same cached labels, without building anything.
    pub(super) fn labels_changed(&self, view: &SidebarView, now_ms: u64) -> bool {
        view.groups
            .iter()
            .flat_map(|group| group.core.sessions.iter())
            .any(|session| {
                let row = &session.row;
                match self.rows.get(&row.sidebar_session_id) {
                    // A row with no element yet is one the install has to build anyway.
                    None => true,
                    Some(cached) => {
                        cached.timer_label != row.timer_label(now_ms)
                            || cached.last_interaction_label != row.last_interaction_label(now_ms)
                    }
                }
            })
    }
}

/// Builds the list the renderer draws from the view model, keeping what the old projection still
/// owns. `published` is its newest snapshot; `now_ms` is the clock the time labels are formatted
/// against.
pub(super) fn snapshot_from_view(
    view: &SidebarView,
    published: &NativeSidebarSnapshot,
    cache: &mut SnapshotCache,
    now_ms: u64,
) -> NativeSidebarSnapshot {
    let published_groups: HashMap<&str, &NativeSidebarGroup> = published
        .groups
        .iter()
        .map(|group| (group.group_id.as_str(), group))
        .collect();
    let published_collections: HashMap<&str, &NativeSidebarCollection> = published
        .collections
        .iter()
        .map(|collection| (collection.collection_id.as_str(), collection))
        .collect();
    let published_rows: HashMap<&str, &Arc<NativeSidebarSession>> = published
        .groups
        .iter()
        .flat_map(|group| group.sessions.iter())
        .map(|session| (session.session_id.as_str(), session))
        .collect();

    let mut used: std::collections::HashSet<String> = std::collections::HashSet::new();
    let groups: Vec<NativeSidebarGroup> = view
        .groups
        .iter()
        .map(|group| {
            let published = published_groups.get(group.core.group_id.as_str()).copied();
            let sessions = group
                .core
                .sessions
                .iter()
                .map(|session| {
                    used.insert(session.row.sidebar_session_id.clone());
                    session_element(session, &published_rows, cache, now_ms)
                })
                .collect();
            native_group(group, published, sessions)
        })
        .collect();
    cache
        .rows
        .retain(|session_id, _| used.contains(session_id.as_str()));

    NativeSidebarSnapshot {
        version: 1,
        // The revision names the daemon document the old projection published, which is what the
        // settings patches built from this snapshot quote as their base.
        revision: published.revision,
        scroll_scope: view.scroll_scope.clone(),
        rename_request: published.rename_request.clone(),
        reveal_request: published.reveal_request.clone(),
        ready: view.ready,
        empty_state: json!({
            "loading": view.empty_state.loading,
            "error": view.empty_state.error,
            "canAddProject": view.empty_state.can_add_project,
            "copy": view.empty_state.copy,
        }),
        hud: published.hud.clone(),
        groups,
        selected_machine_id: view.selected_machine_id.clone(),
        // Remote machines are not in the store yet (M4d), so the machine tabs, their connection
        // state and their counts stay the old projection's.
        machines: published
            .machines
            .iter()
            .map(|machine| NativeSidebarMachine {
                working_count: machine.working_count,
                attention_count: machine.attention_count,
                id: machine.id.clone(),
                label: machine.label.clone(),
                state: machine.state.clone(),
                message: machine.message.clone(),
            })
            .collect(),
        spaces: view
            .spaces
            .iter()
            .map(
                |space| crate::app::native_sidebar::model::NativeSidebarSpace {
                    id: space.id.clone(),
                    name: space.name.clone(),
                    icon: space.icon.clone(),
                    color: space.color.clone(),
                    selected: space.selected,
                    contains_active_session: space.contains_active_session,
                    working_count: space.working_count,
                    attention_count: space.attention_count,
                },
            )
            .collect(),
        spaces_enabled: view.spaces_enabled,
        collections: view
            .collections
            .iter()
            .map(|collection| {
                native_collection(
                    collection,
                    published_collections
                        .get(collection.collection_id.as_str())
                        .copied(),
                )
            })
            .collect(),
        order: view
            .order
            .iter()
            .map(|item| NativeSidebarOrderItem {
                kind: match item.kind {
                    ghostex_gx_core::OrderKind::Project => "project".to_string(),
                    ghostex_gx_core::OrderKind::Collection => "collection".to_string(),
                },
                id: item.id.clone(),
            })
            .collect(),
        more_menu: published.more_menu.clone(),
        search_shortcut: published.search_shortcut.clone(),
        commands_shortcut: published.commands_shortcut.clone(),
    }
}

fn native_group(
    group: &GroupView,
    published: Option<&NativeSidebarGroup>,
    sessions: Vec<Arc<NativeSidebarSession>>,
) -> NativeSidebarGroup {
    let core = &group.core;
    NativeSidebarGroup {
        collection_color: group.collection_color.clone(),
        title_tooltip: core.title_tooltip.clone(),
        group_id: core.group_id.clone(),
        storage_id: core.storage_id.clone(),
        summary: json!({
            "workingCount": core.summary.working_count,
            "attentionCount": core.summary.attention_count,
            "awakeCount": core.summary.awake_count,
        }),
        collapsed: core.collapsed,
        expanded: core.expanded,
        hidden_session_count: core.hidden_session_count,
        show_list_toggle: core.show_list_toggle,
        hover_actions_expanded: core.hover_actions_expanded,
        // The project menu and the header buttons are the old projection's until M4c.
        menu: published.map_or(Value::Null, |group| group.menu.clone()),
        header_actions: published.map_or_else(Vec::new, |group| group.header_actions.clone()),
        sections: core
            .sections
            .iter()
            .map(|section| NativeSidebarSection {
                id: section.id.as_str().to_string(),
                collapsed: section.collapsed,
                count: section.count,
                contains_active_session: section.contains_active_session,
                working_count: section.working_count,
                attention_count: section.attention_count,
                question_count: section.question_count,
                session_ids: section.session_ids.clone(),
            })
            .collect(),
        title: core.title.clone(),
        is_active: core.is_active,
        is_chat_collection: core.group_id == ghostex_gx_core::CHATS_GROUP_ID,
        // `isStale` marks a remote machine's rows while its stream is down, which the store does
        // not hold yet (M4d).
        is_stale: published.is_some_and(|group| group.is_stale),
        project_context: project_context(group, published),
        remote_machine_context: published.and_then(|group| group.remote_machine_context.clone()),
        sessions,
    }
}

/// The project facts a header draws: the view model's values, over whatever else the old
/// projection's object carried (the editor identity its menus and the agent launcher read).
fn project_context(group: &GroupView, published: Option<&NativeSidebarGroup>) -> Option<Value> {
    let context = group.core.project_context.as_ref()?;
    let mut object = match published.and_then(|group| group.project_context.clone()) {
        Some(Value::Object(object)) => object,
        _ => Map::new(),
    };
    object.insert("path".to_string(), Value::String(context.path.clone()));
    insert_optional(&mut object, "iconDataUrl", context.icon_data_url.clone());
    insert_optional(
        &mut object,
        "discoveredIconDataUrl",
        context.discovered_icon_data_url.clone(),
    );
    match &context.worktree {
        Some(worktree) => {
            object.insert(
                "worktree".to_string(),
                json!({
                    "branch": worktree.branch,
                    "name": worktree.name,
                    "parentProjectId": worktree.parent_project_id,
                    "parentProjectName": worktree.parent_project_name,
                    "parentProjectPath": worktree.parent_project_path,
                }),
            );
        }
        None => {
            object.remove("worktree");
        }
    }
    let mut editor = match object.remove("editor") {
        Some(Value::Object(editor)) => editor,
        _ => Map::new(),
    };
    editor.insert(
        "projectId".to_string(),
        Value::String(context.project_id.clone()),
    );
    editor.insert(
        "diffStats".to_string(),
        json!({
            "additions": context.diff_stats.additions,
            "deletions": context.diff_stats.deletions,
            "files": context.diff_stats.files,
            "isLoading": context.diff_stats.is_loading,
            "isRepo": context.diff_stats.is_repo,
        }),
    );
    object.insert("editor".to_string(), Value::Object(editor));
    Some(Value::Object(object))
}

fn native_collection(
    collection: &CollectionView,
    published: Option<&NativeSidebarCollection>,
) -> NativeSidebarCollection {
    NativeSidebarCollection {
        awake_count: collection.awake_count as u64,
        collection_id: collection.collection_id.clone(),
        storage_id: collection.storage_id.clone(),
        title: collection.title.clone(),
        color: collection.color.clone(),
        group_ids: collection.group_ids.clone(),
        collapsed: collection.collapsed,
        contains_active_session: collection.contains_active_session,
        working_count: collection.working_count,
        attention_count: collection.attention_count,
        // The collection menu is the old projection's until M4c.
        menu: published.map_or(Value::Null, |collection| collection.menu.clone()),
    }
}

fn session_element(
    session: &SessionView,
    published_rows: &HashMap<&str, &Arc<NativeSidebarSession>>,
    cache: &mut SnapshotCache,
    now_ms: u64,
) -> Arc<NativeSidebarSession> {
    let row = &session.row;
    let published = published_rows.get(row.sidebar_session_id.as_str()).copied();
    let timer_label = row.timer_label(now_ms);
    let last_interaction_label = row.last_interaction_label(now_ms);
    if let Some(cached) = cache.rows.get(&row.sidebar_session_id) {
        if cached.matches(
            row,
            published,
            session,
            &timer_label,
            &last_interaction_label,
        ) {
            return cached.element.clone();
        }
    }
    let element = Arc::new(build_session(
        session,
        published,
        timer_label.clone(),
        last_interaction_label.clone(),
    ));
    cache.rows.insert(
        row.sidebar_session_id.clone(),
        CachedRow {
            row: row.clone(),
            published: published.cloned(),
            is_focused: session.is_focused,
            is_visible: session.is_visible,
            is_multi_selected: session.is_multi_selected,
            timer_label,
            last_interaction_label,
            element: element.clone(),
        },
    );
    element
}

/// Every key the view model owns, written over the details the old projection published so the
/// row's menu and hover actions survive until M4c moves them.
fn build_session(
    session: &SessionView,
    published: Option<&Arc<NativeSidebarSession>>,
    timer_label: Option<String>,
    last_interaction_label: Option<String>,
) -> NativeSidebarSession {
    let row = &session.row;
    let mut details = published.map_or_else(Map::new, |session| session.details.clone());
    details.insert(
        "titleTooltip".to_string(),
        Value::String(row.title_tooltip.clone()),
    );
    details.insert(
        "pendingQuestionCount".to_string(),
        Value::from(row.pending_question_count),
    );
    details.insert(
        "isMultiSelected".to_string(),
        Value::Bool(session.is_multi_selected),
    );
    details.insert("isFavorite".to_string(), Value::Bool(row.is_favorite));
    insert_optional(&mut details, "sessionTag", row.session_tag.clone());
    insert_optional(&mut details, "effectiveTag", row.effective_tag.clone());
    details.insert(
        "tagPresentation".to_string(),
        tag_presentation(row.tag_presentation.as_ref()),
    );
    // `agentLogoDataUrl` is the coloured logo the TypeScript asset map resolves from `agentIcon`,
    // which has no Rust source yet, so the published value is kept. A row the store holds and the
    // old projection has not published draws its fallback terminal icon until it does (M4c).
    details.insert(
        "queuedPromptFailedCount".to_string(),
        Value::from(row.queued_prompt_failed_count.unwrap_or(0)),
    );
    insert_optional(&mut details, "timerLabel", timer_label);
    insert_optional(&mut details, "lastInteractionLabel", last_interaction_label);
    let delayed = row.delayed_send.as_ref();
    insert_optional(
        &mut details,
        "delayedSendDeadlineAt",
        delayed.and_then(|delayed| delayed.deadline_at.clone()),
    );
    insert_optional(
        &mut details,
        "delayedSendRemainingLabel",
        delayed.and_then(|delayed| delayed.remaining_label.clone()),
    );
    insert_optional(
        &mut details,
        "delayedSendRemainingMs",
        delayed
            .and_then(|delayed| delayed.remaining_ms)
            .map(Value::from),
    );
    details.insert(
        "sendWhenAllProjectSessionsStopActive".to_string(),
        Value::Bool(
            delayed.is_some_and(|delayed| delayed.send_when_all_project_sessions_stop_active),
        ),
    );
    details.insert(
        "sendWhenAgentStopsActive".to_string(),
        Value::Bool(delayed.is_some_and(|delayed| delayed.send_when_agent_stops_active)),
    );
    let close = row.close_after_done.as_ref();
    details.insert(
        "closeAfterDone".to_string(),
        Value::Bool(close.is_some_and(|close| close.armed)),
    );
    insert_optional(
        &mut details,
        "closeAfterDoneDeadlineAt",
        close.and_then(|close| close.deadline_at.clone()),
    );
    insert_optional(
        &mut details,
        "closeAfterDoneRemainingLabel",
        close.and_then(|close| close.remaining_label.clone()),
    );
    insert_optional(
        &mut details,
        "closeAfterDoneRemainingMs",
        close.and_then(|close| close.remaining_ms).map(Value::from),
    );
    details.insert(
        "isGeneratingFirstPromptTitle".to_string(),
        Value::Bool(row.is_generating_first_prompt_title),
    );
    NativeSidebarSession {
        session_id: row.sidebar_session_id.clone(),
        display_title: Some(row.display_title.clone()),
        alias: row.alias.clone(),
        activity: row.activity.clone(),
        agent_icon: row.agent_icon.clone(),
        kind: row.is_browser.then(|| "browser".to_string()),
        session_kind: row.session_kind.clone(),
        is_focused: session.is_focused,
        is_visible: session.is_visible,
        is_pinned: row.is_pinned,
        is_parked: row.is_parked,
        is_draft: row.is_draft,
        last_interaction_at: row.last_interaction_at.clone(),
        lifecycle_state: Some(row.lifecycle_state.clone()),
        session_note: row.session_note.clone(),
        favicon_data_url: row.favicon_data_url.clone(),
        has_composer_draft: row.has_composer_draft,
        queued_prompt_count: row.queued_prompt_count.unwrap_or(0),
        details,
    }
}

fn tag_presentation(presentation: Option<&TagPresentation>) -> Value {
    match presentation {
        Some(presentation) => json!({
            "icon": presentation.icon,
            "iconColor": presentation.icon_color,
        }),
        None => Value::Null,
    }
}

fn insert_optional(object: &mut Map<String, Value>, key: &str, value: Option<impl Into<Value>>) {
    match value {
        Some(value) => {
            object.insert(key.to_string(), value.into());
        }
        None => {
            object.remove(key);
        }
    }
}
