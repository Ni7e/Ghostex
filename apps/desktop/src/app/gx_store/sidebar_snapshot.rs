//! The Rust sidebar list in the shape the renderer draws.
//!
//! CDXC:Sidebar 2026-09-20 WHY:
//! The renderer reads one list, and this milestone moves where that list comes from without
//! rewriting the thirty files that draw it. Every value the list itself decides (which groups,
//! which rows, their order, sections, titles, tooltips, labels, counts, collapse and focus flags)
//! is the store's view model, and since M4c so are the menus, the hover buttons, the header
//! buttons, the more menu and the agent artwork (`sidebar_menus.rs`).
//!
//! What is still taken from the old projection's newest publish is named here and nowhere else:
//! the HUD, the machine tabs, the reveal and rename requests, the daemon revision, and the
//! per-group facts only a remote machine has (`isStale`, its machine context) plus the project
//! facts no milestone has moved (`canRemoveProject`, the editor state, the theme). Each of those
//! belongs to M4d or M5. Nothing here derives product state: a value is either the view model's
//! or the old projection's, and this file says which.

use std::collections::HashMap;
use std::sync::Arc;

use ghostex_gx_core::{
    CollectionView, GroupCore, GroupView, MenuHost, SessionView, SidebarHiddenItems, SidebarMenus,
    SidebarSettings, SidebarView, TagPresentation, colored_agent_logo, menu_to_json,
};
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
    is_focused: bool,
    is_visible: bool,
    is_multi_selected: bool,
    /// The one menu input that moves on its own: a snooze ends without the row changing, and the
    /// hover button turns from Unsnooze back into Snooze.
    is_snoozed: bool,
    timer_label: Option<String>,
    last_interaction_label: Option<String>,
    element: Arc<NativeSidebarSession>,
}

impl CachedRow {
    fn matches(
        &self,
        row: &Arc<ghostex_gx_core::SessionRow>,
        session: &SessionView,
        is_snoozed: bool,
        timer_label: &Option<String>,
        last_interaction_label: &Option<String>,
    ) -> bool {
        Arc::ptr_eq(&self.row, row)
            && self.is_snoozed == is_snoozed
            && self.is_focused == session.is_focused
            && self.is_visible == session.is_visible
            && self.is_multi_selected == session.is_multi_selected
            && self.timer_label == *timer_label
            && self.last_interaction_label == *last_interaction_label
    }
}

/// A group's menu and header buttons, kept until one of their inputs moves.
///
/// CDXC:Sidebar 2026-09-20 WHY:
/// A project menu is about fifteen rows and its header buttons carry the agent launcher, whose
/// items each hold a logo data URL of up to eight kilobytes. Rebuilding both for thirty-five
/// groups on every install was more than half the install's time and a few hundred kilobytes of
/// JSON, for groups whose inputs had not moved. The `GroupCore` is held rather than compared by
/// address, for the same reason `CachedRow` holds its row: an entry outlives the group it was
/// built from, and a freed allocation's address handed to the next group would compare equal.
struct CachedGroupMenus {
    core: Arc<GroupCore>,
    /// The collection a project belongs to decides its Add to Group ticks, and it is not part of
    /// `GroupCore`.
    collection_id: Option<String>,
    menu: Value,
    header_actions: Vec<Value>,
}

/// What every cached menu was built from besides the group or row it belongs to. A difference in
/// any of it drops the whole cache, which is right: all of them are user actions, not traffic.
#[derive(Clone, PartialEq)]
struct MenuKey {
    settings: SidebarSettings,
    hidden_items: SidebarHiddenItems,
    host: MenuHost,
    /// The tag catalog, the Spaces and the collections, as `SidebarMenus` derived them.
    context: u64,
}

/// Keeps the built rows and group menus between publishes.
#[derive(Default)]
pub(super) struct SnapshotCache {
    rows: HashMap<String, CachedRow>,
    groups: HashMap<String, CachedGroupMenus>,
    /// What the cached menus were built from. A settings change does not touch a row or a group
    /// in the view model, so nothing else would invalidate them.
    key: Option<MenuKey>,
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
    pub(super) fn moved_label_count(&self, view: &SidebarView, now_ms: u64) -> usize {
        view.groups
            .iter()
            .flat_map(|group| group.core.sessions.iter())
            .filter(|session| {
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
            .count()
    }
}

/// One number over every value the installed list still takes from a publish.
///
/// CDXC:Sidebar 2026-09-20 WHY:
/// Kept as a fingerprint rather than as the publish itself. Holding the `Arc` made the clock
/// branch's `Arc::make_mut` deep-copy the whole published snapshot once a second and after every
/// publish, because this was a second owner; holding clones of the values instead would copy the
/// settings object out of the HUD on every install. Hashing walks them without allocating. A
/// collision would skip one install of a value the renderer draws, and it would be picked up by
/// the next change to any of them.
///
/// The set is exactly what `snapshot_from_view` reads from `published`, minus the revision, which
/// nothing the renderer draws reads.
pub(super) fn carry_fingerprint(published: &NativeSidebarSnapshot) -> u64 {
    use std::hash::{Hash, Hasher};
    let mut hasher = std::collections::hash_map::DefaultHasher::new();
    hash_json(&published.hud, &mut hasher);
    for machine in &published.machines {
        machine.working_count.hash(&mut hasher);
        machine.attention_count.hash(&mut hasher);
        machine.id.hash(&mut hasher);
        machine.label.hash(&mut hasher);
        machine.state.hash(&mut hasher);
        machine.message.hash(&mut hasher);
    }
    if let Some(request) = &published.rename_request {
        request.collection_id.hash(&mut hasher);
        request.request_id.hash(&mut hasher);
    }
    if let Some(request) = &published.reveal_request {
        request.session_id.hash(&mut hasher);
        request.request_id.hash(&mut hasher);
    }
    published.search_shortcut.hash(&mut hasher);
    published.commands_shortcut.hash(&mut hasher);
    for group in &published.groups {
        group.group_id.hash(&mut hasher);
        group.is_stale.hash(&mut hasher);
        match &group.remote_machine_context {
            Some(context) => hash_json(context, &mut hasher),
            None => 0u8.hash(&mut hasher),
        }
        match &group.project_context {
            Some(context) => hash_json(context, &mut hasher),
            None => 0u8.hash(&mut hasher),
        }
    }
    hasher.finish()
}

/// `serde_json::Value` has no `Hash`: a float has none, and the map is ordered so its entries can
/// be walked in one order.
fn hash_json(value: &Value, hasher: &mut impl std::hash::Hasher) {
    use std::hash::Hash;
    match value {
        Value::Null => 0u8.hash(hasher),
        Value::Bool(value) => {
            1u8.hash(hasher);
            value.hash(hasher);
        }
        Value::Number(number) => {
            2u8.hash(hasher);
            match number.as_f64() {
                Some(number) => number.to_bits().hash(hasher),
                None => number.to_string().hash(hasher),
            }
        }
        Value::String(value) => {
            3u8.hash(hasher);
            value.hash(hasher);
        }
        Value::Array(items) => {
            4u8.hash(hasher);
            items.len().hash(hasher);
            for item in items {
                hash_json(item, hasher);
            }
        }
        Value::Object(object) => {
            5u8.hash(hasher);
            object.len().hash(hasher);
            for (key, item) in object {
                key.hash(hasher);
                hash_json(item, hasher);
            }
        }
    }
}

/// Everything one install needs besides the view and the cache.
pub(super) struct SnapshotInput<'a> {
    pub(super) menus: &'a SidebarMenus<'a>,
    /// The old projection's newest snapshot; the fields named in the module comment come from it.
    pub(super) published: &'a NativeSidebarSnapshot,
    pub(super) settings: &'a SidebarSettings,
    pub(super) hidden_items: &'a SidebarHiddenItems,
    pub(super) host: &'a MenuHost,
    /// The clock the time labels are formatted against.
    pub(super) now_ms: u64,
}

/// Builds the list the renderer draws from the view model and the menus.
pub(super) fn snapshot_from_view(
    view: &SidebarView,
    input: &SnapshotInput<'_>,
    cache: &mut SnapshotCache,
) -> NativeSidebarSnapshot {
    let SnapshotInput {
        menus,
        published,
        now_ms,
        ..
    } = *input;
    let published_groups: HashMap<&str, &NativeSidebarGroup> = published
        .groups
        .iter()
        .map(|group| (group.group_id.as_str(), group))
        .collect();

    let key = MenuKey {
        settings: input.settings.clone(),
        hidden_items: input.hidden_items.clone(),
        host: input.host.clone(),
        context: menus.context_fingerprint(),
    };
    if cache.key.as_ref() != Some(&key) {
        cache.key = Some(key);
        cache.rows.clear();
        cache.groups.clear();
    }
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
                    session_element(group, session, menus, cache, now_ms)
                })
                .collect();
            native_group(group, menus, published, sessions, cache)
        })
        .collect();
    cache
        .rows
        .retain(|session_id, _| used.contains(session_id.as_str()));
    let drawn: std::collections::HashSet<&str> = view
        .groups
        .iter()
        .map(|group| group.core.group_id.as_str())
        .collect();
    cache
        .groups
        .retain(|group_id, _| drawn.contains(group_id.as_str()));

    NativeSidebarSnapshot {
        version: 1,
        // The daemon document the old projection published. Carried rather than derived, and
        // deliberately not part of what decides an install: nothing the renderer draws reads it
        // (the settings patches quote the zustand store's own revision, controller.ts:138), and it
        // moves on nearly every publish.
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
            .map(|collection| native_collection(collection, menus))
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
        more_menu: menu_to_json(&menus.more_menu()),
        // The two hotkey labels are the hotkey settings formatted for the current platform, not a
        // menu; they move with the rest of the HUD in M5.
        search_shortcut: published.search_shortcut.clone(),
        commands_shortcut: published.commands_shortcut.clone(),
    }
}

fn native_group(
    group: &GroupView,
    menus: &SidebarMenus<'_>,
    published: Option<&NativeSidebarGroup>,
    sessions: Vec<Arc<NativeSidebarSession>>,
    cache: &mut SnapshotCache,
) -> NativeSidebarGroup {
    let core = &group.core;
    let (menu, header_actions) = group_menus(group, menus, cache);
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
        menu,
        header_actions,
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

/// One group's menu and header buttons, kept until the group or one of the menu inputs moves.
fn group_menus(
    group: &GroupView,
    menus: &SidebarMenus<'_>,
    cache: &mut SnapshotCache,
) -> (Value, Vec<Value>) {
    let core = &group.core;
    if let Some(cached) = cache.groups.get(&core.group_id) {
        if Arc::ptr_eq(&cached.core, core) && cached.collection_id == group.collection_id {
            return (cached.menu.clone(), cached.header_actions.clone());
        }
    }
    let menu = menu_to_json(&menus.project_menu(group));
    let header_actions: Vec<Value> = menus
        .header_actions(group)
        .iter()
        .map(ghostex_gx_core::MenuItem::to_json)
        .collect();
    cache.groups.insert(
        core.group_id.clone(),
        CachedGroupMenus {
            core: core.clone(),
            collection_id: group.collection_id.clone(),
            menu: menu.clone(),
            header_actions: header_actions.clone(),
        },
    );
    (menu, header_actions)
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
    menus: &SidebarMenus<'_>,
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
        menu: menu_to_json(&menus.collection_menu(collection)),
    }
}

fn session_element(
    group: &GroupView,
    session: &SessionView,
    menus: &SidebarMenus<'_>,
    cache: &mut SnapshotCache,
    now_ms: u64,
) -> Arc<NativeSidebarSession> {
    let row = &session.row;
    let timer_label = row.timer_label(now_ms);
    let last_interaction_label = row.last_interaction_label(now_ms);
    let is_snoozed = row
        .timing
        .snoozed_until_ms
        .is_some_and(|wake_at| wake_at > now_ms as i64);
    if let Some(cached) = cache.rows.get(&row.sidebar_session_id) {
        if cached.matches(
            row,
            session,
            is_snoozed,
            &timer_label,
            &last_interaction_label,
        ) {
            return cached.element.clone();
        }
    }
    let element = Arc::new(build_session(
        group,
        session,
        menus,
        timer_label.clone(),
        last_interaction_label.clone(),
    ));
    cache.rows.insert(
        row.sidebar_session_id.clone(),
        CachedRow {
            row: row.clone(),
            is_focused: session.is_focused,
            is_visible: session.is_visible,
            is_multi_selected: session.is_multi_selected,
            is_snoozed,
            timer_label,
            last_interaction_label,
            element: element.clone(),
        },
    );
    element
}

/// One drawn row: every key the view model owns, plus the hover buttons and the placeholder menu
/// the store builds for it.
fn build_session(
    group: &GroupView,
    session: &SessionView,
    menus: &SidebarMenus<'_>,
    timer_label: Option<String>,
    last_interaction_label: Option<String>,
) -> NativeSidebarSession {
    let row = &session.row;
    let mut details = Map::new();
    let actions = menus.row_actions(group, session);
    details.insert("menu".to_string(), menu_to_json(&actions.menu));
    details.insert(
        "hoverBefore".to_string(),
        menu_to_json(&actions.hover_before),
    );
    details.insert("hoverAfter".to_string(), menu_to_json(&actions.hover_after));
    details.insert(
        "hoverChevron".to_string(),
        Value::Bool(actions.hover_chevron),
    );
    insert_optional(
        &mut details,
        "agentLogoDataUrl",
        row.agent_icon
            .as_deref()
            .and_then(colored_agent_logo)
            .map(str::to_string),
    );
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
    // Read by the direct-focus path to decide whether a row has a transcript to open.
    insert_optional(
        &mut details,
        "agentSessionId",
        row.menu_facts.agent_session_id.clone(),
    );
    insert_optional(&mut details, "sessionTag", row.session_tag.clone());
    insert_optional(&mut details, "effectiveTag", row.effective_tag.clone());
    details.insert(
        "tagPresentation".to_string(),
        tag_presentation(row.tag_presentation.as_ref()),
    );
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
