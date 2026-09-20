//! Comparing the Rust sidebar list with the one the old TypeScript projection published.
//!
//! A record names ids, counts, and field names only: never a title, a path, a tooltip, or
//! anything else a session carries.

use std::collections::HashMap;
use std::collections::hash_map::DefaultHasher;
use std::hash::{Hash, Hasher};

use ghostex_gx_core::{GroupView, SectionView, SessionView, SidebarView};
use serde_json::Value;

use super::sidebar_list_inputs::{detail_bool, detail_str, detail_u64};
use crate::app::native_sidebar::model::{
    NativeSidebarGroup, NativeSidebarSection, NativeSidebarSession, NativeSidebarSnapshot,
};

/// One compared field that differs, and which side carried a value for it.
///
/// The two booleans are what a reader of the record needs first: a field only one side holds is
/// a different question from a field both hold with different contents. A field that always
/// carries something (a flag, a count, a required string, a list whose contents differ) reports
/// both sides as holding a value, which is what it is.
#[derive(Clone, Debug, PartialEq, Eq, Hash)]
pub(super) struct FieldDiff {
    pub(super) name: &'static str,
    pub(super) old_has_value: bool,
    pub(super) store_has_value: bool,
    /// What each side held, for the few fields whose values are safe to name.
    ///
    /// CDXC:Sidebar 2026-09-20 WHY:
    /// A field only one side holds says which side is ahead by its presence alone, and that is how
    /// the stale icon and the stale favicon were traced. A field BOTH sides hold says nothing: a
    /// lifecycle difference reads as "lifecycleState" and leaves the question of which side thinks
    /// the session is asleep unanswerable from the log. These fields are a closed vocabulary (four
    /// lifecycle words, an activity word) or a small count, never a title, a path or anything the
    /// user typed, so they are named outright.
    pub(super) values: Option<(String, String)>,
}

impl FieldDiff {
    /// A field both sides always carry.
    fn carried(name: &'static str) -> Self {
        Self {
            name,
            old_has_value: true,
            store_has_value: true,
            values: None,
        }
    }

    /// A field both sides carry, named with what each of them held.
    fn valued(name: &'static str, old: impl ToString, store: impl ToString) -> Self {
        Self {
            name,
            old_has_value: true,
            store_has_value: true,
            values: Some((old.to_string(), store.to_string())),
        }
    }
}

/// Records one differing field. The three-argument form is for a field both sides always carry;
/// the five-argument form takes whether each side holds a value.
macro_rules! note {
    ($fields:expr, $name:literal, $same:expr $(,)?) => {
        if !$same {
            $fields.push(FieldDiff::carried($name));
        }
    };
    ($fields:expr, $name:literal, $same:expr, $old:expr, $store:expr $(,)?) => {
        if !$same {
            $fields.push(FieldDiff {
                name: $name,
                old_has_value: $old,
                store_has_value: $store,
                values: None,
            });
        }
    };
}

/// Records a differing field and what each side held. Only for a closed vocabulary or a count.
macro_rules! note_values {
    ($fields:expr, $name:literal, $old:expr, $store:expr $(,)?) => {
        if $old != $store {
            $fields.push(FieldDiff::valued($name, $old, $store));
        }
    };
}

/// Most ids one record names per list; the support log caps arrays at 32 anyway.
pub(super) const MAX_IDS_PER_RECORD: usize = 24;

/// A confirmed difference between the two lists: ids, counts, and field names.
#[derive(Clone, Debug, Default, PartialEq, Eq, Hash)]
pub(super) struct SidebarMismatch {
    pub(super) old_group_count: usize,
    pub(super) store_group_count: usize,
    pub(super) only_old_groups: Vec<String>,
    pub(super) only_store_groups: Vec<String>,
    pub(super) group_order_differs: bool,
    /// The fields of the list itself (`order`, `spaces`, `emptyState`, ...).
    pub(super) top_level: Vec<FieldDiff>,
    /// Per group: the fields that differ.
    pub(super) groups: Vec<(String, Vec<FieldDiff>)>,
    /// Per row, by session id: the fields that differ.
    pub(super) sessions: Vec<(String, Vec<FieldDiff>)>,
    pub(super) only_old_sessions: Vec<String>,
    pub(super) only_store_sessions: Vec<String>,
    /// Rows whose differing fields include the question count, which the old sidebar store
    /// freezes on a row nothing else touched.
    pub(super) question_count_only: usize,
    /// Rows whose only differing field is the tooltip while the question count agrees, so the
    /// frozen row does not explain them and the tooltip port is the likelier cause.
    pub(super) tooltip_only: usize,
    /// Every difference in this record is a field the old sidebar store freezes, so it is that
    /// side standing still rather than this list moving.
    pub(super) only_frozen_fields: bool,
    /// Every difference in this record is a timestamp that moves on its own, so it is the two
    /// sides reading the same session a publish apart rather than either of them being wrong.
    pub(super) only_timing_fields: bool,
    /// Every difference in this record is a value only the store holds, in a field the old
    /// projection can hold a stale absence of for the whole run.
    pub(super) only_stale_fields: bool,
    /// Every difference in this record is explained by one of the three rules above, whichever
    /// mix of them it takes.
    ///
    /// CDXC:Sidebar 2026-09-20 WHY:
    /// The three flags are each all-or-nothing over the whole record, so a record holding one
    /// frozen field and one stale field satisfied none of them and was counted as a real
    /// difference. That is not an edge case in a live sidebar: a row the old store froze and a
    /// browser row a publish behind arrive in the same comparison constantly. This asks the
    /// question the gate actually wants, which is whether anything in the record is unaccounted
    /// for, and it is the one number to watch: mismatches minus this is the milestone's gate.
    pub(super) only_explained_fields: bool,
    /// Where a group's row order first diverges: the group, the index, and the row each side has
    /// there. A bare "the order differs" cannot be diagnosed, and this is the smallest thing that
    /// can: a row only one side holds reads as a row that moved unless the ids are named.
    pub(super) order_divergence: Vec<OrderDivergence>,
}

/// The first index at which two orders disagree.
#[derive(Clone, Debug, PartialEq, Eq, Hash)]
pub(super) struct OrderDivergence {
    pub(super) group_id: String,
    pub(super) index: usize,
    pub(super) old_id: Option<String>,
    pub(super) store_id: Option<String>,
    /// The two lengths, because an order that only differs in length is a row one side is missing
    /// rather than a row that moved.
    pub(super) old_len: usize,
    pub(super) store_len: usize,
}

/// The two compared fields a frozen row can differ in on its own.
///
/// `haveSameSidebarSessionItem` (packages/core-ui/sidebar-store-model.ts) decides whether a row
/// changed, and it does not look at `pendingQuestionCount`, `isLive`, `providerSessionState`,
/// `nativePaneState`, `sessionRoutingId`, `forkedFromSessionId`, `forkFamilySessionIds`,
/// `workingStartedAt` or the account and agent-name fields. A row whose only change is one of
/// those keeps its previous object.
///
/// Only two of them reach a compared field by themselves: the question count, and the tooltip,
/// which with Debugging Mode on (the only state this comparison runs in) carries several of the
/// others as lines. The rest are deliberately not listed here, because they surface in fields a
/// real bug also lands in and bucketing them would label that bug as the old side standing
/// still: `workingStartedAt` surfaces as row order, so it lands in a group's `sessionOrder` and
/// `sections` rather than in a row, and the agent-name fields surface as `agentIcon`, which is
/// also where a mistake in the agent catalog lands. A difference in those is reported.
const FROZEN_FIELDS: [&str; 2] = ["pendingQuestionCount", "titleTooltip"];

/// The compared fields that move while nothing the user does changes.
///
/// `lastInteractionAt` is stamped by the daemon on every event of a working session, and the two
/// sides read it over separate subscriptions: the old list carries the value of the moment it
/// published, this one the value the store holds when the comparison runs. On an actively
/// working session the two are never equal for long enough to settle, which is why a record made
/// only of these is counted rather than confirmed as a difference in the list.
///
/// It is still compared, and its one real consequence still is: the row order it feeds shows up
/// as a group's `sessionOrder` and `sections`, which are not in this list and are reported.
const TIMING_FIELDS: [&str; 1] = ["lastInteractionAt"];

/// The compared fields the old projection can hold a stale absence of for the life of a run.
///
/// CDXC:Sidebar 2026-09-20 WHY:
/// Both of these reach the two sides from the same source and are never invented here, so a
/// difference where only the STORE holds a value is the other side standing still, not this list
/// being wrong. `discoveredIconDataUrl` rides on a daemon project row, and in a recording of 1,928
/// frames not one project delta re-sent a row: the icon exists in snapshots only, so a client
/// whose snapshot was taken before the daemon finished probing never learns it, and the two
/// clients here take theirs about a second apart at launch. `faviconDataUrl` on a browser row
/// comes from this app's own tab list, which the store reads in the frame the app publishes it and
/// the projection a publish later.
///
/// Only that direction is classified. A field the old side holds and the store does not is
/// reported, because that is the shape a real loss in this port would take.
///
/// The recording is evidence, not a protocol guarantee: `projectUpdated` carries a whole project
/// row, so a daemon that retracted the icon in a delta the store missed would land in this bucket
/// and read as explained. A missed delta normally disagrees in several fields at once, which one
/// unlisted field is enough to defeat, so the hole is narrow; it is named here rather than left
/// for the next reader to find.
const STALE_PUBLISH_FIELDS: [&str; 2] = ["projectContext.discoveredIconDataUrl", "faviconDataUrl"];

impl SidebarMismatch {
    /// Every differing field of the record, once, by NAME and never by value.
    ///
    /// The values are deliberately left out here, unlike in the log's own encoding: this feeds the
    /// gained-and-lost list of a shape that never settles, and a lifecycle that walks through its
    /// four words would read as four fields gained and lost rather than as one field that keeps
    /// moving, which is the opposite of what that record is for.
    pub(super) fn field_names(&self) -> Vec<String> {
        let mut names: Vec<String> = Vec::new();
        for field in self
            .top_level
            .iter()
            .chain(self.groups.iter().flat_map(|(_, fields)| fields))
            .chain(self.sessions.iter().flat_map(|(_, fields)| fields))
        {
            let encoded = match (field.old_has_value, field.store_has_value) {
                (true, false) => format!("{}=old", field.name),
                (false, true) => format!("{}=store", field.name),
                _ => field.name.to_string(),
            };
            if !names.contains(&encoded) {
                names.push(encoded);
            }
        }
        names.truncate(MAX_IDS_PER_RECORD);
        names
    }

    pub(super) fn signature(&self) -> u64 {
        let mut hasher = DefaultHasher::new();
        self.hash(&mut hasher);
        hasher.finish()
    }

    fn differs(&self) -> bool {
        !self.only_old_groups.is_empty()
            || !self.only_store_groups.is_empty()
            || self.group_order_differs
            || !self.top_level.is_empty()
            || !self.groups.is_empty()
            || !self.sessions.is_empty()
            || !self.only_old_sessions.is_empty()
            || !self.only_store_sessions.is_empty()
    }

    fn bound(&mut self) {
        self.only_old_groups.truncate(MAX_IDS_PER_RECORD);
        self.only_store_groups.truncate(MAX_IDS_PER_RECORD);
        self.only_old_sessions.truncate(MAX_IDS_PER_RECORD);
        self.order_divergence.truncate(MAX_IDS_PER_RECORD);
        self.only_store_sessions.truncate(MAX_IDS_PER_RECORD);
        self.groups.truncate(MAX_IDS_PER_RECORD);
        self.sessions.truncate(MAX_IDS_PER_RECORD);
        for (_, fields) in &mut self.groups {
            fields.truncate(MAX_IDS_PER_RECORD);
        }
        for (_, fields) in &mut self.sessions {
            fields.truncate(MAX_IDS_PER_RECORD);
        }
    }
}

/// Compares the two lists. `None` when they say the same thing.
pub(super) fn compare(
    snapshot: &NativeSidebarSnapshot,
    view: &SidebarView,
) -> Option<SidebarMismatch> {
    let mut mismatch = SidebarMismatch {
        old_group_count: snapshot.groups.len(),
        store_group_count: view.groups.len(),
        ..SidebarMismatch::default()
    };
    compare_top_level(snapshot, view, &mut mismatch);

    let store_groups: HashMap<&str, &GroupView> = view
        .groups
        .iter()
        .map(|group| (group.core.group_id.as_str(), group))
        .collect();
    for group in &snapshot.groups {
        match store_groups.get(group.group_id.as_str()) {
            None => mismatch.only_old_groups.push(group.group_id.clone()),
            Some(store) => compare_group(group, store, &mut mismatch),
        }
    }
    for group in &view.groups {
        if !snapshot
            .groups
            .iter()
            .any(|old| old.group_id == group.core.group_id)
        {
            mismatch.only_store_groups.push(group.core.group_id.clone());
        }
    }
    mismatch.group_order_differs = mismatch.only_old_groups.is_empty()
        && mismatch.only_store_groups.is_empty()
        && snapshot
            .groups
            .iter()
            .map(|group| group.group_id.as_str())
            .ne(view.groups.iter().map(|group| group.core.group_id.as_str()));

    let rows_only = mismatch.only_old_groups.is_empty()
        && mismatch.only_store_groups.is_empty()
        && !mismatch.group_order_differs
        && mismatch.top_level.is_empty()
        && mismatch.groups.is_empty()
        && mismatch.only_old_sessions.is_empty()
        && mismatch.only_store_sessions.is_empty()
        && !mismatch.sessions.is_empty();
    mismatch.only_frozen_fields = rows_only
        && mismatch.sessions.iter().all(|(_, fields)| {
            fields
                .iter()
                .all(|field| FROZEN_FIELDS.contains(&field.name))
        });
    mismatch.only_timing_fields = rows_only
        && mismatch.sessions.iter().all(|(_, fields)| {
            fields
                .iter()
                .all(|field| TIMING_FIELDS.contains(&field.name))
        });
    // Not `rows_only`: one of the two fields belongs to a project header, so this asks the wider
    // question of whether the record holds any STRUCTURAL difference, and then whether every
    // differing field of it, group or row, is one the old side goes stale in.
    let structural = !mismatch.only_old_groups.is_empty()
        || !mismatch.only_store_groups.is_empty()
        || mismatch.group_order_differs
        || !mismatch.only_old_sessions.is_empty()
        || !mismatch.only_store_sessions.is_empty()
        || !mismatch.top_level.is_empty();
    // Whether one field is accounted for, by whichever of the three rules covers it.
    let explained = |field: &FieldDiff| {
        FROZEN_FIELDS.contains(&field.name)
            || TIMING_FIELDS.contains(&field.name)
            || (STALE_PUBLISH_FIELDS.contains(&field.name)
                && field.store_has_value
                && !field.old_has_value)
    };
    mismatch.only_explained_fields = !structural
        && (!mismatch.groups.is_empty() || !mismatch.sessions.is_empty())
        && mismatch
            .groups
            .iter()
            .chain(&mismatch.sessions)
            .flat_map(|(_, fields)| fields)
            .all(explained);
    mismatch.only_stale_fields = !structural
        && (!mismatch.groups.is_empty() || !mismatch.sessions.is_empty())
        && mismatch
            .groups
            .iter()
            .chain(&mismatch.sessions)
            .flat_map(|(_, fields)| fields)
            .all(|field| {
                STALE_PUBLISH_FIELDS.contains(&field.name)
                    && field.store_has_value
                    && !field.old_has_value
            });
    mismatch.bound();
    mismatch.differs().then_some(mismatch)
}

fn compare_top_level(
    snapshot: &NativeSidebarSnapshot,
    view: &SidebarView,
    mismatch: &mut SidebarMismatch,
) {
    note!(mismatch.top_level, "ready", snapshot.ready == view.ready);
    note!(
        mismatch.top_level,
        "scrollScope",
        snapshot.scroll_scope == view.scroll_scope
    );
    note!(
        mismatch.top_level,
        "spacesEnabled",
        snapshot.spaces_enabled == view.spaces_enabled,
    );
    note!(
        mismatch.top_level,
        "order",
        snapshot.order.len() == view.order.len()
            && snapshot.order.iter().zip(&view.order).all(|(old, store)| {
                old.id == store.id
                    && old.kind
                        == match store.kind {
                            ghostex_gx_core::OrderKind::Project => "project",
                            ghostex_gx_core::OrderKind::Collection => "collection",
                        }
            }),
    );
    note!(
        mismatch.top_level,
        "spaces",
        snapshot.spaces.len() == view.spaces.len()
            && snapshot
                .spaces
                .iter()
                .zip(&view.spaces)
                .all(|(old, store)| {
                    old.id == store.id
                        && old.name == store.name
                        && old.icon == store.icon
                        && old.color == store.color
                        && old.selected == store.selected
                        && old.contains_active_session == store.contains_active_session
                        && old.working_count == store.working_count
                        && old.attention_count == store.attention_count
                }),
    );
    note!(
        mismatch.top_level,
        "collections",
        snapshot.collections.len() == view.collections.len()
            && snapshot
                .collections
                .iter()
                .zip(&view.collections)
                .all(|(old, store)| {
                    old.collection_id == store.collection_id
                        && old.storage_id == store.storage_id
                        && old.title == store.title
                        && old.color == store.color
                        && old.group_ids == store.group_ids
                        && old.collapsed == store.collapsed
                        && old.contains_active_session == store.contains_active_session
                        && old.working_count == store.working_count
                        && old.attention_count == store.attention_count
                        && old.awake_count as usize == store.awake_count
                }),
    );
    let local_machine = snapshot
        .machines
        .iter()
        .find(|machine| machine.id == "local");
    note!(
        mismatch.top_level,
        "machineCounts",
        local_machine.is_none_or(|machine| {
            machine.working_count == view.machine.working_count
                && machine.attention_count == view.machine.attention_count
        }),
    );
    let empty_flag =
        |key: &str| snapshot.empty_state.get(key).and_then(Value::as_bool) == Some(true);
    note!(
        mismatch.top_level,
        "emptyState.loading",
        empty_flag("loading") == view.empty_state.loading,
    );
    note!(
        mismatch.top_level,
        "emptyState.error",
        empty_flag("error") == view.empty_state.error,
    );
    note!(
        mismatch.top_level,
        "emptyState.canAddProject",
        empty_flag("canAddProject") == view.empty_state.can_add_project,
    );
    note!(
        mismatch.top_level,
        "emptyState.copy",
        snapshot.empty_state.get("copy").and_then(Value::as_str)
            == Some(view.empty_state.copy.as_str()),
    );
}

fn compare_group(old: &NativeSidebarGroup, store: &GroupView, mismatch: &mut SidebarMismatch) {
    let core = &store.core;
    let mut fields: Vec<FieldDiff> = Vec::new();
    note!(fields, "title", old.title == core.title);
    note!(
        fields,
        "titleTooltip",
        old.title_tooltip == core.title_tooltip
    );
    note!(fields, "storageId", old.storage_id == core.storage_id);
    note!(fields, "isActive", old.is_active == core.is_active);
    note!(fields, "collapsed", old.collapsed == core.collapsed);
    note!(fields, "expanded", old.expanded == core.expanded);
    note!(
        fields,
        "hiddenSessionCount",
        old.hidden_session_count == core.hidden_session_count,
    );
    note!(
        fields,
        "showListToggle",
        old.show_list_toggle == core.show_list_toggle,
    );
    note!(
        fields,
        "collectionColor",
        old.collection_color == store.collection_color,
        old.collection_color.is_some(),
        store.collection_color.is_some()
    );
    let summary = |key: &str| old.summary.get(key).and_then(Value::as_u64).unwrap_or(0) as usize;
    note_values!(
        fields,
        "summary.workingCount",
        summary("workingCount"),
        core.summary.working_count,
    );
    note_values!(
        fields,
        "summary.attentionCount",
        summary("attentionCount"),
        core.summary.attention_count,
    );
    note_values!(
        fields,
        "summary.awakeCount",
        summary("awakeCount"),
        core.summary.awake_count,
    );
    compare_project_context(old.project_context.as_ref(), store, &mut fields);
    note!(
        fields,
        "sections",
        sections_equal(&old.sections, &core.sections)
    );
    let old_order: Vec<&str> = old
        .sessions
        .iter()
        .map(|session| session.session_id.as_str())
        .collect();
    let store_order: Vec<&str> = core
        .sessions
        .iter()
        .map(|session| session.row.sidebar_session_id.as_str())
        .collect();
    note!(fields, "sessionOrder", old_order == store_order);
    if old_order != store_order {
        let index = (0..old_order.len().max(store_order.len()))
            .find(|index| old_order.get(*index) != store_order.get(*index))
            .unwrap_or_default();
        mismatch.order_divergence.push(OrderDivergence {
            group_id: old.group_id.clone(),
            index,
            old_id: old_order.get(index).map(|id| (*id).to_string()),
            store_id: store_order.get(index).map(|id| (*id).to_string()),
            old_len: old_order.len(),
            store_len: store_order.len(),
        });
    }
    if !fields.is_empty() {
        mismatch.groups.push((old.group_id.clone(), fields));
    }

    let store_sessions: HashMap<&str, &SessionView> = core
        .sessions
        .iter()
        .map(|session| (session.row.sidebar_session_id.as_str(), session))
        .collect();
    for session in &old.sessions {
        match store_sessions.get(session.session_id.as_str()) {
            None => mismatch.only_old_sessions.push(session.session_id.clone()),
            Some(store) => compare_session(session, store, mismatch),
        }
    }
    for session in &core.sessions {
        if !old
            .sessions
            .iter()
            .any(|candidate| candidate.session_id == session.row.sidebar_session_id)
        {
            mismatch
                .only_store_sessions
                .push(session.row.sidebar_session_id.clone());
        }
    }
}

fn compare_project_context(old: Option<&Value>, store: &GroupView, fields: &mut Vec<FieldDiff>) {
    let context = store.core.project_context.as_ref();
    note!(
        fields,
        "projectContext",
        old.is_some() == context.is_some(),
        old.is_some(),
        context.is_some()
    );
    let (Some(old), Some(context)) = (old, context) else {
        return;
    };
    let text =
        |value: &Value, key: &str| value.get(key).and_then(Value::as_str).map(str::to_string);
    note!(
        fields,
        "projectContext.path",
        text(old, "path").unwrap_or_default() == context.path,
    );
    note!(
        fields,
        "projectContext.iconDataUrl",
        text(old, "iconDataUrl") == context.icon_data_url,
        text(old, "iconDataUrl").is_some(),
        context.icon_data_url.is_some()
    );
    note!(
        fields,
        "projectContext.discoveredIconDataUrl",
        text(old, "discoveredIconDataUrl") == context.discovered_icon_data_url,
        text(old, "discoveredIconDataUrl").is_some(),
        context.discovered_icon_data_url.is_some()
    );
    note!(
        fields,
        "projectContext.worktree",
        old.get("worktree")
            .and_then(|worktree| text(worktree, "parentProjectId"))
            == context
                .worktree
                .as_ref()
                .map(|worktree| worktree.parent_project_id.clone()),
        old.get("worktree").is_some(),
        context.worktree.is_some()
    );
    let editor = old.get("editor");
    note!(
        fields,
        "projectContext.projectId",
        editor
            .and_then(|editor| text(editor, "projectId"))
            .as_deref()
            == Some(context.project_id.as_str()),
    );
    let stats = editor.and_then(|editor| editor.get("diffStats"));
    let number = |key: &str| {
        stats
            .and_then(|stats| stats.get(key))
            .and_then(Value::as_i64)
            .unwrap_or_default()
    };
    note!(
        fields,
        "projectContext.diffStats",
        number("additions") == context.diff_stats.additions
            && number("deletions") == context.diff_stats.deletions
            && number("files") == context.diff_stats.files,
    );
}

fn sections_equal(old: &[NativeSidebarSection], store: &[SectionView]) -> bool {
    old.len() == store.len()
        && old.iter().zip(store).all(|(old, store)| {
            old.id == store.id.as_str()
                && old.collapsed == store.collapsed
                && old.count == store.count
                && old.contains_active_session == store.contains_active_session
                && old.working_count == store.working_count
                && old.attention_count == store.attention_count
                && old.question_count == store.question_count
                && old.session_ids == store.session_ids
        })
}

fn compare_session(
    old: &NativeSidebarSession,
    store: &SessionView,
    mismatch: &mut SidebarMismatch,
) {
    let row = &store.row;
    let mut fields: Vec<FieldDiff> = Vec::new();
    note!(fields, "displayTitle", old.title() == row.display_title);
    note!(
        fields,
        "alias",
        old.alias == row.alias,
        !old.alias.is_empty(),
        !row.alias.is_empty()
    );
    note!(
        fields,
        "titleTooltip",
        detail_str(old, "titleTooltip").unwrap_or(old.title()) == row.title_tooltip,
    );
    note_values!(
        fields,
        "activity",
        old.activity.as_str(),
        row.activity.as_str()
    );
    note_values!(
        fields,
        "pendingQuestionCount",
        detail_u64(old, "pendingQuestionCount"),
        row.pending_question_count,
    );
    note!(
        fields,
        "agentIcon",
        old.agent_icon.as_deref() == row.agent_icon.as_deref(),
        old.agent_icon.is_some(),
        row.agent_icon.is_some()
    );
    note!(fields, "isBrowser", old.is_browser() == row.is_browser);
    note!(
        fields,
        "sessionKind",
        old.session_kind.as_deref() == row.session_kind.as_deref(),
        old.session_kind.is_some(),
        row.session_kind.is_some()
    );
    note!(fields, "isFocused", old.is_focused == store.is_focused);
    note!(fields, "isVisible", old.is_visible == store.is_visible);
    note!(fields, "isPinned", old.is_pinned == row.is_pinned);
    note!(fields, "isParked", old.is_parked == row.is_parked);
    note!(fields, "isDraft", old.is_draft == row.is_draft);
    note_values!(
        fields,
        "lifecycleState",
        old.lifecycle_state.as_deref().unwrap_or("-"),
        row.lifecycle_state.as_str(),
    );
    note!(
        fields,
        "sessionNote",
        old.session_note == row.session_note,
        old.session_note.is_some(),
        row.session_note.is_some()
    );
    note!(
        fields,
        "faviconDataUrl",
        old.favicon_data_url.is_some() == row.favicon_data_url.is_some(),
        old.favicon_data_url.is_some(),
        row.favicon_data_url.is_some()
    );
    note!(
        fields,
        "hasComposerDraft",
        old.has_composer_draft == row.has_composer_draft,
    );
    note!(
        fields,
        "queuedPromptCount",
        old.queued_prompt_count == row.queued_prompt_count.unwrap_or(0),
    );
    note!(
        fields,
        "queuedPromptFailedCount",
        detail_u64(old, "queuedPromptFailedCount") == row.queued_prompt_failed_count.unwrap_or(0),
    );
    note!(
        fields,
        "lastInteractionAt",
        old.last_interaction_at.as_deref() == row.last_interaction_at.as_deref(),
        old.last_interaction_at.is_some(),
        row.last_interaction_at.is_some()
    );
    note!(
        fields,
        "effectiveTag",
        detail_str(old, "effectiveTag") == row.effective_tag.as_deref(),
        detail_str(old, "effectiveTag").is_some(),
        row.effective_tag.is_some()
    );
    note!(
        fields,
        "tagPresentation",
        tag_presentation_equal(old.details.get("tagPresentation"), row),
        old.details.get("tagPresentation").is_some(),
        row.tag_presentation.is_some()
    );
    note!(
        fields,
        "agentLogo",
        detail_str(old, "agentLogoDataUrl").is_some() == row.agent_icon.is_some(),
        detail_str(old, "agentLogoDataUrl").is_some(),
        row.agent_icon.is_some()
    );
    note!(
        fields,
        "isMultiSelected",
        detail_bool(old, "isMultiSelected") == store.is_multi_selected,
    );
    note!(
        fields,
        "delayedSendDeadlineAt",
        detail_str(old, "delayedSendDeadlineAt")
            == row
                .delayed_send
                .as_ref()
                .and_then(|delayed| delayed.deadline_at.as_deref()),
        detail_str(old, "delayedSendDeadlineAt").is_some(),
        row.delayed_send
            .as_ref()
            .is_some_and(|delayed| delayed.deadline_at.is_some())
    );
    note!(
        fields,
        "delayedSendRemainingLabel",
        detail_str(old, "delayedSendRemainingLabel")
            == row
                .delayed_send
                .as_ref()
                .and_then(|delayed| delayed.remaining_label.as_deref()),
        detail_str(old, "delayedSendRemainingLabel").is_some(),
        row.delayed_send
            .as_ref()
            .is_some_and(|delayed| delayed.remaining_label.is_some())
    );
    note!(
        fields,
        "closeAfterDone",
        detail_bool(old, "closeAfterDone")
            == row
                .close_after_done
                .as_ref()
                .is_some_and(|close| close.armed),
    );
    note!(
        fields,
        "closeAfterDoneDeadlineAt",
        detail_str(old, "closeAfterDoneDeadlineAt")
            == row
                .close_after_done
                .as_ref()
                .and_then(|close| close.deadline_at.as_deref()),
        detail_str(old, "closeAfterDoneDeadlineAt").is_some(),
        row.close_after_done
            .as_ref()
            .is_some_and(|close| close.deadline_at.is_some())
    );
    note!(
        fields,
        "isFavorite",
        (old.details.get("isFavorite").and_then(Value::as_bool) == Some(true)) == row.is_favorite,
    );
    note!(
        fields,
        "sessionTag",
        detail_str(old, "sessionTag") == row.session_tag.as_deref(),
        detail_str(old, "sessionTag").is_some(),
        row.session_tag.is_some()
    );
    if fields.is_empty() {
        return;
    }
    if fields
        .iter()
        .any(|field| field.name == "pendingQuestionCount")
    {
        mismatch.question_count_only += 1;
    } else if matches!(fields.as_slice(), [only] if only.name == "titleTooltip") {
        mismatch.tooltip_only += 1;
    }
    mismatch.sessions.push((old.session_id.clone(), fields));
}

fn tag_presentation_equal(old: Option<&Value>, row: &ghostex_gx_core::SessionRow) -> bool {
    let old = old.filter(|value| value.is_object());
    match (old, &row.tag_presentation) {
        (None, None) => true,
        (Some(old), Some(presentation)) => {
            old.get("icon").and_then(Value::as_str) == Some(presentation.icon.as_str())
                && old.get("iconColor").and_then(Value::as_str)
                    == Some(presentation.icon_color.as_str())
        }
        _ => false,
    }
}
