//! Comparing the Rust sidebar list with the one the old TypeScript projection published.
//!
//! A record names ids, counts, and field names only: never a title, a path, a tooltip, or
//! anything else a session carries.

use std::collections::HashMap;
use std::collections::hash_map::DefaultHasher;
use std::hash::{Hash, Hasher};

use ghostex_gx_core::{GroupView, SectionView, SessionView, SidebarView};
use serde_json::Value;

use super::sidebar_shadow_inputs::{detail_bool, detail_str, detail_u64};
use crate::app::native_sidebar::model::{
    NativeSidebarGroup, NativeSidebarSection, NativeSidebarSession, NativeSidebarSnapshot,
};

/// Most ids one record names per list; the support log caps arrays at 32 anyway.
const MAX_IDS_PER_RECORD: usize = 24;

/// A confirmed difference between the two lists: ids, counts, and field names.
#[derive(Clone, Debug, Default, PartialEq, Eq, Hash)]
pub(super) struct SidebarMismatch {
    pub(super) old_group_count: usize,
    pub(super) store_group_count: usize,
    pub(super) only_old_groups: Vec<String>,
    pub(super) only_store_groups: Vec<String>,
    pub(super) group_order_differs: bool,
    /// Field names of the list itself (`order`, `spaces`, `emptyState`, ...).
    pub(super) top_level: Vec<&'static str>,
    /// Per group: the names of the fields that differ.
    pub(super) groups: Vec<(String, Vec<&'static str>)>,
    /// Per row: the names of the fields that differ, as `<session id>`.
    pub(super) sessions: Vec<(String, Vec<&'static str>)>,
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

impl SidebarMismatch {
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

    mismatch.only_frozen_fields = mismatch.only_old_groups.is_empty()
        && mismatch.only_store_groups.is_empty()
        && !mismatch.group_order_differs
        && mismatch.top_level.is_empty()
        && mismatch.groups.is_empty()
        && mismatch.only_old_sessions.is_empty()
        && mismatch.only_store_sessions.is_empty()
        && !mismatch.sessions.is_empty()
        && mismatch
            .sessions
            .iter()
            .all(|(_, fields)| fields.iter().all(|field| FROZEN_FIELDS.contains(field)));
    mismatch.bound();
    mismatch.differs().then_some(mismatch)
}

fn compare_top_level(
    snapshot: &NativeSidebarSnapshot,
    view: &SidebarView,
    mismatch: &mut SidebarMismatch,
) {
    let mut note = |name: &'static str, same: bool| {
        if !same {
            mismatch.top_level.push(name);
        }
    };
    note("ready", snapshot.ready == view.ready);
    note("scrollScope", snapshot.scroll_scope == view.scroll_scope);
    note(
        "spacesEnabled",
        snapshot.spaces_enabled == view.spaces_enabled,
    );
    note(
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
    note(
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
    note(
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
    note(
        "machineCounts",
        local_machine.is_none_or(|machine| {
            machine.working_count == view.machine.working_count
                && machine.attention_count == view.machine.attention_count
        }),
    );
    let empty_flag =
        |key: &str| snapshot.empty_state.get(key).and_then(Value::as_bool) == Some(true);
    note(
        "emptyState.loading",
        empty_flag("loading") == view.empty_state.loading,
    );
    note(
        "emptyState.error",
        empty_flag("error") == view.empty_state.error,
    );
    note(
        "emptyState.canAddProject",
        empty_flag("canAddProject") == view.empty_state.can_add_project,
    );
    note(
        "emptyState.copy",
        snapshot.empty_state.get("copy").and_then(Value::as_str)
            == Some(view.empty_state.copy.as_str()),
    );
}

fn compare_group(old: &NativeSidebarGroup, store: &GroupView, mismatch: &mut SidebarMismatch) {
    let core = &store.core;
    let mut fields: Vec<&'static str> = Vec::new();
    let mut note = |name: &'static str, same: bool| {
        if !same {
            fields.push(name);
        }
    };
    note("title", old.title == core.title);
    note("titleTooltip", old.title_tooltip == core.title_tooltip);
    note("storageId", old.storage_id == core.storage_id);
    note("isActive", old.is_active == core.is_active);
    note("collapsed", old.collapsed == core.collapsed);
    note("expanded", old.expanded == core.expanded);
    note(
        "hiddenSessionCount",
        old.hidden_session_count == core.hidden_session_count,
    );
    note(
        "showListToggle",
        old.show_list_toggle == core.show_list_toggle,
    );
    note(
        "collectionColor",
        old.collection_color == store.collection_color,
    );
    let summary = |key: &str| old.summary.get(key).and_then(Value::as_u64).unwrap_or(0) as usize;
    note(
        "summary.workingCount",
        summary("workingCount") == core.summary.working_count,
    );
    note(
        "summary.attentionCount",
        summary("attentionCount") == core.summary.attention_count,
    );
    note(
        "summary.awakeCount",
        summary("awakeCount") == core.summary.awake_count,
    );
    compare_project_context(old.project_context.as_ref(), store, &mut note);
    note("sections", sections_equal(&old.sections, &core.sections));
    note(
        "sessionOrder",
        old.sessions
            .iter()
            .map(|session| session.session_id.as_str())
            .eq(core
                .sessions
                .iter()
                .map(|session| session.row.sidebar_session_id.as_str())),
    );
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

fn compare_project_context(
    old: Option<&Value>,
    store: &GroupView,
    note: &mut impl FnMut(&'static str, bool),
) {
    let context = store.core.project_context.as_ref();
    note("projectContext", old.is_some() == context.is_some());
    let (Some(old), Some(context)) = (old, context) else {
        return;
    };
    let text =
        |value: &Value, key: &str| value.get(key).and_then(Value::as_str).map(str::to_string);
    note(
        "projectContext.path",
        text(old, "path").unwrap_or_default() == context.path,
    );
    note(
        "projectContext.iconDataUrl",
        text(old, "iconDataUrl") == context.icon_data_url,
    );
    note(
        "projectContext.discoveredIconDataUrl",
        text(old, "discoveredIconDataUrl") == context.discovered_icon_data_url,
    );
    note(
        "projectContext.worktree",
        old.get("worktree")
            .and_then(|worktree| text(worktree, "parentProjectId"))
            == context
                .worktree
                .as_ref()
                .map(|worktree| worktree.parent_project_id.clone()),
    );
    let editor = old.get("editor");
    note(
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
    note(
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
    let mut fields: Vec<&'static str> = Vec::new();
    let mut note = |name: &'static str, same: bool| {
        if !same {
            fields.push(name);
        }
    };
    note("displayTitle", old.title() == row.display_title);
    note("alias", old.alias == row.alias);
    note(
        "titleTooltip",
        detail_str(old, "titleTooltip").unwrap_or(old.title()) == row.title_tooltip,
    );
    note("activity", old.activity == row.activity);
    note(
        "pendingQuestionCount",
        detail_u64(old, "pendingQuestionCount") == row.pending_question_count,
    );
    note(
        "agentIcon",
        old.agent_icon.as_deref() == row.agent_icon.as_deref(),
    );
    note("isBrowser", old.is_browser() == row.is_browser);
    note(
        "sessionKind",
        old.session_kind.as_deref() == row.session_kind.as_deref(),
    );
    note("isFocused", old.is_focused == store.is_focused);
    note("isVisible", old.is_visible == store.is_visible);
    note("isPinned", old.is_pinned == row.is_pinned);
    note("isParked", old.is_parked == row.is_parked);
    note("isDraft", old.is_draft == row.is_draft);
    note(
        "lifecycleState",
        old.lifecycle_state.as_deref() == Some(row.lifecycle_state.as_str()),
    );
    note("sessionNote", old.session_note == row.session_note);
    note(
        "faviconDataUrl",
        old.favicon_data_url.is_some() == row.favicon_data_url.is_some(),
    );
    note(
        "hasComposerDraft",
        old.has_composer_draft == row.has_composer_draft,
    );
    note(
        "queuedPromptCount",
        old.queued_prompt_count == row.queued_prompt_count.unwrap_or(0),
    );
    note(
        "queuedPromptFailedCount",
        detail_u64(old, "queuedPromptFailedCount") == row.queued_prompt_failed_count.unwrap_or(0),
    );
    note(
        "lastInteractionAt",
        old.last_interaction_at.as_deref() == row.last_interaction_at.as_deref(),
    );
    note(
        "effectiveTag",
        detail_str(old, "effectiveTag") == row.effective_tag.as_deref(),
    );
    note(
        "tagPresentation",
        tag_presentation_equal(old.details.get("tagPresentation"), row),
    );
    note(
        "agentLogo",
        detail_str(old, "agentLogoDataUrl").is_some() == row.agent_icon.is_some(),
    );
    note(
        "isMultiSelected",
        detail_bool(old, "isMultiSelected") == store.is_multi_selected,
    );
    note(
        "delayedSendDeadlineAt",
        detail_str(old, "delayedSendDeadlineAt")
            == row
                .delayed_send
                .as_ref()
                .and_then(|delayed| delayed.deadline_at.as_deref()),
    );
    note(
        "delayedSendRemainingLabel",
        detail_str(old, "delayedSendRemainingLabel")
            == row
                .delayed_send
                .as_ref()
                .and_then(|delayed| delayed.remaining_label.as_deref()),
    );
    note(
        "closeAfterDone",
        detail_bool(old, "closeAfterDone")
            == row
                .close_after_done
                .as_ref()
                .is_some_and(|close| close.armed),
    );
    note(
        "closeAfterDoneDeadlineAt",
        detail_str(old, "closeAfterDoneDeadlineAt")
            == row
                .close_after_done
                .as_ref()
                .and_then(|close| close.deadline_at.as_deref()),
    );
    note(
        "isFavorite",
        (old.details.get("isFavorite").and_then(Value::as_bool) == Some(true)) == row.is_favorite,
    );
    note(
        "sessionTag",
        detail_str(old, "sessionTag") == row.session_tag.as_deref(),
    );
    if fields.is_empty() {
        return;
    }
    if fields.contains(&"pendingQuestionCount") {
        mismatch.question_count_only += 1;
    } else if fields == ["titleTooltip"] {
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
