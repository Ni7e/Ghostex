//! The sidebar's own state, the intents that move it, and which values a write still owes storage.
//!
//! CDXC:Sidebar 2026-09-20 DECISION:
//! User: the desktop app stops running product logic in QuickJS; one Rust state store owns it, and
//! every interaction is a local state change plus one redraw. This is the half of the sidebar's
//! input the user owns, moved out of `native-sidebar/ui-state.ts`. A click changes it here and the
//! list is rebuilt in the same frame; the write to client storage is a consequence the host
//! performs afterwards and never something the list waits for.

use std::collections::BTreeMap;

use super::intents::{SidebarUiIntent, SidebarUiOutcome, ToggleAllProjectsInput};
use crate::sidebar_view::SidebarUiState;

/// Which persisted values a change made stale. The host writes each one at most once per burst.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub struct SidebarPersistSet {
    pub collapse: bool,
    pub machine_tab: bool,
    pub hidden_items: bool,
}

impl SidebarPersistSet {
    fn collapse() -> Self {
        Self {
            collapse: true,
            ..Self::default()
        }
    }

    fn machine_tab() -> Self {
        Self {
            machine_tab: true,
            ..Self::default()
        }
    }

    fn hidden_items() -> Self {
        Self {
            hidden_items: true,
            ..Self::default()
        }
    }

    pub fn is_empty(self) -> bool {
        !self.collapse && !self.machine_tab && !self.hidden_items
    }

    pub fn merge(&mut self, other: Self) {
        self.collapse |= other.collapse;
        self.machine_tab |= other.machine_tab;
        self.hidden_items |= other.hidden_items;
    }
}

/// The sidebar's own state and the writes it still owes.
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct SidebarUiStore {
    state: SidebarUiState,
    /// Per machine, the projects that were expanded when Collapse All ran, so Expand All puts
    /// exactly those back rather than every project the machine has.
    previous_expanded_groups: BTreeMap<String, Vec<String>>,
    pending: SidebarPersistSet,
}

impl SidebarUiStore {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn state(&self) -> &SidebarUiState {
        &self.state
    }

    /// Seeds the state from client storage at startup. Owes no write: this is what storage holds.
    pub fn restore(&mut self, state: SidebarUiState) {
        self.state = state;
    }

    /// Drops rows the list no longer draws from the multi-selection, the way the projection prunes
    /// `selectedSessionIds` against the sessions it holds before it builds. Returns whether the
    /// selection moved. Never persisted: a selection does not survive a restart.
    pub fn retain_selected_sessions(&mut self, mut keep: impl FnMut(&str) -> bool) -> bool {
        let before = self.state.selected_session_ids.len();
        self.state
            .selected_session_ids
            .retain(|session_id| keep(session_id));
        before != self.state.selected_session_ids.len()
    }

    /// The machine tab the sidebar draws.
    pub fn selected_machine_id(&self) -> &str {
        &self.state.selected_machine_id
    }

    /// Everything the host still has to write, taken once so a burst writes each value once.
    pub fn take_pending(&mut self) -> SidebarPersistSet {
        std::mem::take(&mut self.pending)
    }

    /// Whether a write is still owed, without taking it.
    pub fn pending(&self) -> SidebarPersistSet {
        self.pending
    }

    /// Applies one intent. The state moves at once; the write is owed afterwards.
    pub fn apply(&mut self, intent: SidebarUiIntent) -> SidebarUiOutcome {
        let outcome = self.apply_inner(intent);
        if outcome.changed {
            self.pending.merge(outcome.persist);
        }
        outcome
    }

    fn apply_inner(&mut self, intent: SidebarUiIntent) -> SidebarUiOutcome {
        match intent {
            SidebarUiIntent::ToggleGroupCollapsed { group_id } => {
                toggle(&mut self.state.collapse.collapsed_groups, group_id);
                changed(SidebarPersistSet::collapse())
            }
            SidebarUiIntent::ToggleSessionListExpanded { storage_id } => {
                toggle(&mut self.state.collapse.expanded_session_lists, storage_id);
                changed(SidebarPersistSet::collapse())
            }
            SidebarUiIntent::ToggleHoverActions { storage_id } => {
                toggle(&mut self.state.collapse.expanded_hover_actions, storage_id);
                changed(SidebarPersistSet::collapse())
            }
            SidebarUiIntent::ToggleSection {
                storage_id,
                section,
            } => {
                let sections = self
                    .state
                    .collapse
                    .section_collapse
                    .entry(storage_id)
                    .or_default();
                let collapsed = sections.get(section);
                sections.set(section, !collapsed);
                changed(SidebarPersistSet::collapse())
            }
            SidebarUiIntent::ToggleCollectionCollapsed { storage_id } => {
                toggle(&mut self.state.collapse.collapsed_collections, storage_id);
                changed(SidebarPersistSet::collapse())
            }
            SidebarUiIntent::SelectSpace { space_id } => {
                let section_key = self.state.section_key();
                let previous = self
                    .state
                    .collapse
                    .selected_space_by_section
                    .insert(section_key, space_id.clone());
                outcome(
                    previous.as_deref() != Some(space_id.as_str()),
                    SidebarPersistSet::collapse(),
                )
            }
            SidebarUiIntent::ForgetSpace {
                section_key,
                space_id,
            } => {
                let held = self
                    .state
                    .collapse
                    .selected_space_by_section
                    .get(&section_key)
                    .is_some_and(|held| *held == space_id);
                if held {
                    self.state
                        .collapse
                        .selected_space_by_section
                        .remove(&section_key);
                }
                outcome(held, SidebarPersistSet::collapse())
            }
            SidebarUiIntent::SelectMachine { machine_id } => {
                let moved = self.state.selected_machine_id != machine_id;
                self.state.selected_machine_id = machine_id;
                outcome(moved, SidebarPersistSet::machine_tab())
            }
            SidebarUiIntent::ToggleTagFilter { tag } => {
                match self
                    .state
                    .selected_tag_filters
                    .iter()
                    .position(|held| *held == tag)
                {
                    Some(index) => {
                        self.state.selected_tag_filters.remove(index);
                    }
                    // The order the user ticked them in; the filter itself is a set, but the menu
                    // and the projection both keep the list as it was built.
                    None => self.state.selected_tag_filters.push(tag),
                }
                changed(SidebarPersistSet::default())
            }
            SidebarUiIntent::ToggleShowHidden => {
                self.state.show_hidden = !self.state.show_hidden;
                changed(SidebarPersistSet::default())
            }
            SidebarUiIntent::HideGroup { group_id } => {
                let moved = insert_unique(&mut self.state.hidden_items.group_ids, group_id);
                outcome(moved, SidebarPersistSet::hidden_items())
            }
            SidebarUiIntent::UnhideGroup { group_id } => {
                let moved = remove_entry(&mut self.state.hidden_items.group_ids, &group_id);
                outcome(moved, SidebarPersistSet::hidden_items())
            }
            SidebarUiIntent::HideCollection { storage_id } => {
                let moved = insert_unique(&mut self.state.hidden_items.collection_keys, storage_id);
                outcome(moved, SidebarPersistSet::hidden_items())
            }
            SidebarUiIntent::UnhideCollection { storage_id } => {
                let moved = remove_entry(&mut self.state.hidden_items.collection_keys, &storage_id);
                outcome(moved, SidebarPersistSet::hidden_items())
            }
            SidebarUiIntent::SetSelectedSessions { session_ids } => {
                let moved = self.state.selected_session_ids != session_ids;
                self.state.selected_session_ids = session_ids;
                outcome(moved, SidebarPersistSet::default())
            }
            SidebarUiIntent::ToggleAllProjects(input) => self.toggle_all_projects(input),
            SidebarUiIntent::RevealGroup {
                machine_id,
                group_id,
            } => {
                let mut moved = self.state.selected_machine_id != machine_id;
                let mut persist = SidebarPersistSet::default();
                if moved {
                    self.state.selected_machine_id = machine_id;
                    persist.machine_tab = true;
                }
                if self.state.collapse.collapsed_groups.remove(&group_id) {
                    moved = true;
                    persist.collapse = true;
                }
                outcome(moved, persist)
            }
        }
    }

    /// `toggleProjects`: collapse every drawn project when any is expanded, else put back the ones
    /// that were expanded last time, falling back to every drawn project.
    fn toggle_all_projects(&mut self, input: ToggleAllProjectsInput) -> SidebarUiOutcome {
        let collapsed = &mut self.state.collapse.collapsed_groups;
        let expanded: Vec<String> = input
            .group_ids
            .iter()
            .filter(|group_id| !collapsed.contains(*group_id))
            .cloned()
            .collect();
        let mut moved = false;
        if expanded.is_empty() {
            let restore = self
                .previous_expanded_groups
                .get(&input.machine_id)
                .cloned()
                .unwrap_or(input.group_ids);
            for group_id in restore {
                moved |= collapsed.remove(&group_id);
            }
        } else {
            self.previous_expanded_groups
                .insert(input.machine_id, expanded);
            for group_id in input.group_ids {
                moved |= collapsed.insert(group_id);
            }
        }
        outcome(moved, SidebarPersistSet::collapse())
    }
}

fn toggle(set: &mut std::collections::BTreeSet<String>, key: String) {
    if !set.remove(&key) {
        set.insert(key);
    }
}

fn insert_unique(list: &mut Vec<String>, value: String) -> bool {
    if list.iter().any(|held| *held == value) {
        return false;
    }
    list.push(value);
    true
}

fn remove_entry(list: &mut Vec<String>, value: &str) -> bool {
    let before = list.len();
    list.retain(|held| held != value);
    before != list.len()
}

fn changed(persist: SidebarPersistSet) -> SidebarUiOutcome {
    SidebarUiOutcome {
        changed: true,
        persist,
    }
}

fn outcome(changed: bool, persist: SidebarPersistSet) -> SidebarUiOutcome {
    SidebarUiOutcome { changed, persist }
}
