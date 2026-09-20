//! What the sidebar draws: the same content the native renderer reads from the TypeScript
//! snapshot today, minus menus, hover actions and header actions.

use std::sync::Arc;

use crate::keys::SessionKey;

use super::inputs::{CloseAfterDoneInput, ProjectDiffStats, SectionId};
use super::session_text::{last_interaction_label, next_label_deadline_ms, timer_trailing_label};
use super::tags::TagPresentation;

/// The whole list for one machine tab.
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct SidebarView {
    /// A first snapshot of the machine has been applied, or the host has seen it unavailable.
    pub ready: bool,
    /// The selected machine is one this view model can build (the local daemon, for now). A host
    /// that selects a machine tab this says `false` for must keep drawing whatever it had.
    pub supported: bool,
    pub selected_machine_id: String,
    /// `<machine>|<space or all>`: the scope a scroll position belongs to.
    pub scroll_scope: String,
    pub machine: MachineSummary,
    pub spaces_enabled: bool,
    pub spaces: Vec<SpaceView>,
    /// Every group of the machine that is drawn, in order.
    pub groups: Vec<GroupView>,
    pub collections: Vec<CollectionView>,
    /// The top-level row sequence: a project group or a collection of them.
    pub order: Vec<OrderItem>,
    pub empty_state: EmptyState,
}

impl SidebarView {
    pub fn group(&self, group_id: &str) -> Option<&GroupView> {
        self.groups
            .iter()
            .find(|group| group.core.group_id == group_id)
    }
}

/// The working and attention counts of a machine tab.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub struct MachineSummary {
    pub working_count: usize,
    pub attention_count: usize,
}

/// A drawn group: a project, or a user-made session group inside one.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct GroupView {
    pub core: Arc<GroupCore>,
    /// The colour of the collection the group is in, when it is drawn inside one.
    pub collection_color: Option<String>,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct GroupCore {
    pub group_id: String,
    /// The id every per-project UI state is keyed by: the project id, or the group id for a
    /// user-made group.
    pub storage_id: String,
    pub title: String,
    /// The multi-line project header tooltip; absent for a user-made group.
    pub title_tooltip: Option<String>,
    pub is_active: bool,
    pub project_context: Option<ProjectContextView>,
    pub summary: GroupSummary,
    pub collapsed: bool,
    /// The session list shows every row rather than the compact first rows.
    pub expanded: bool,
    pub hidden_session_count: usize,
    pub show_list_toggle: bool,
    pub hover_actions_expanded: bool,
    pub sections: Vec<SectionView>,
    /// Every row of the group that passes the tag filter, in display order.
    pub sessions: Vec<SessionView>,
}

/// What a project row draws besides its sessions.
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct ProjectContextView {
    pub project_id: String,
    pub path: String,
    pub icon_data_url: Option<String>,
    pub discovered_icon_data_url: Option<String>,
    pub diff_stats: ProjectDiffStats,
    pub worktree: Option<WorktreeView>,
}

#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct WorktreeView {
    pub branch: String,
    pub name: String,
    pub parent_project_id: String,
    pub parent_project_name: String,
    pub parent_project_path: String,
}

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub struct GroupSummary {
    pub working_count: usize,
    pub attention_count: usize,
    pub awake_count: usize,
}

/// One heading of a project's session list.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct SectionView {
    pub id: SectionId,
    pub collapsed: bool,
    pub count: usize,
    pub contains_active_session: bool,
    pub working_count: usize,
    pub attention_count: usize,
    pub question_count: usize,
    /// The rows this heading draws: its sessions, minus the ones the compact list leaves out.
    pub session_ids: Vec<String>,
}

/// A row in a group: the session's own values plus what this list says about it.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct SessionView {
    pub row: Arc<SessionRow>,
    pub is_focused: bool,
    pub is_visible: bool,
    pub is_multi_selected: bool,
}

/// One session (or browser tab) as a sidebar row.
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct SessionRow {
    /// `combined-session:<project>:<session>` for a session, `gpui-browser:<project>:<tab>` for a
    /// browser tab.
    pub sidebar_session_id: String,
    /// The store key; absent for a browser tab, which is host state and not a session.
    pub key: Option<SessionKey>,
    pub is_browser: bool,
    /// A browser tab the host reports as the focused one of its project.
    pub browser_is_active: bool,
    /// A browser tab the host reports as on screen.
    pub browser_is_visible: bool,
    /// The stored title, before the display rules.
    pub alias: String,
    /// The one line the row draws.
    pub display_title: String,
    /// The hover tooltip, already assembled.
    pub title_tooltip: String,
    pub activity: String,
    pub pending_question_count: u64,
    pub agent_icon: Option<String>,
    /// `terminal`, `browser`, or whatever else a newer daemon publishes.
    pub session_kind: Option<String>,
    /// The sidebar's own lifecycle vocabulary: `running`, `sleeping`, `error`, `done`.
    pub lifecycle_state: String,
    pub is_pinned: bool,
    pub is_parked: bool,
    pub is_draft: bool,
    pub is_favorite: bool,
    pub session_tag: Option<String>,
    pub effective_tag: Option<String>,
    pub tag_presentation: Option<TagPresentation>,
    pub last_interaction_at: Option<String>,
    pub session_note: Option<String>,
    pub favicon_data_url: Option<String>,
    pub has_composer_draft: bool,
    pub queued_prompt_count: Option<u64>,
    pub queued_prompt_failed_count: Option<u64>,
    pub delayed_send: Option<DelayedSendView>,
    pub close_after_done: Option<CloseAfterDoneInput>,
    pub is_generating_first_prompt_title: bool,
    /// Inputs of the time-based values, which the renderer formats against its own clock.
    pub timing: SessionTiming,
}

/// The daemon's or the host's Delayed Send, as the row shows it.
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct DelayedSendView {
    pub deadline_at: Option<String>,
    pub remaining_label: Option<String>,
    pub remaining_ms: Option<i64>,
    pub send_when_all_project_sessions_stop_active: bool,
    pub send_when_agent_stops_active: bool,
}

/// The timestamps the row's labels, sections and order are derived from.
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct SessionTiming {
    pub created_at: Option<String>,
    pub created_ms: Option<i64>,
    pub last_interaction_ms: Option<i64>,
    pub working_started_ms: Option<i64>,
    pub snoozed_until_ms: Option<i64>,
}

impl SessionRow {
    /// The compact countdown a row draws instead of its relative time, at the host's clock.
    pub fn timer_label(&self, now_ms: u64) -> Option<String> {
        timer_trailing_label(self, now_ms)
    }

    /// The relative time a row draws (`5m`), at the host's clock.
    pub fn last_interaction_label(&self, now_ms: u64) -> Option<String> {
        self.last_interaction_at
            .as_deref()
            .map(|at| last_interaction_label(at, now_ms))
    }

    /// The next host time at which the time this row draws reads differently, or `None` when it
    /// draws none or draws one that never moves. `show_relative_time` is the card setting: with it
    /// off, only a countdown is drawn. A host that draws these wakes then and no more often;
    /// nothing in the store reports it, because they are formatted against the host's clock.
    pub fn next_label_deadline_ms(&self, now_ms: u64, show_relative_time: bool) -> Option<u64> {
        next_label_deadline_ms(self, now_ms, show_relative_time)
    }
}

/// A Space button.
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct SpaceView {
    pub id: String,
    pub name: String,
    pub icon: String,
    pub color: String,
    pub selected: bool,
    pub contains_active_session: bool,
    pub working_count: usize,
    pub attention_count: usize,
}

/// A collection (a colored folder of projects).
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct CollectionView {
    pub collection_id: String,
    /// `<section key>:<collection id>`, the key its UI state is stored under.
    pub storage_id: String,
    pub title: String,
    pub color: String,
    pub group_ids: Vec<String>,
    pub collapsed: bool,
    pub contains_active_session: bool,
    pub working_count: usize,
    pub attention_count: usize,
    pub awake_count: usize,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum OrderKind {
    Project,
    Collection,
}

/// One row of the top-level sequence.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct OrderItem {
    pub kind: OrderKind,
    pub id: String,
}

/// What the list says when it draws nothing.
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct EmptyState {
    pub loading: bool,
    pub error: bool,
    pub can_add_project: bool,
    pub copy: String,
}
