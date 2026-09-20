//! What has to change for one row to be on screen: the port of `applyNativeSidebarReveal`.
//!
//! CDXC:Sidebar 2026-09-20 WHY:
//! Revealing a session is the one command that reads the list to decide what to change: which
//! group holds the row, which collection holds that group, which heading the row falls under, and
//! whether the compact list would still leave it out. It is worked out by building the list twice
//! with the answers assumed, which costs about a millisecond and happens only when something asks
//! for a reveal, rather than by duplicating the grouping, sectioning and compact-list rules here
//! where they would drift from the ones the list itself uses.
//!
//! SEE-ALSO: apps/desktop/sidebar/native-sidebar/reveal.ts.

use crate::core::Core;

use super::inputs::{SectionId, SidebarInputs};
use super::model::SidebarViewModel;

/// The changes that put a row on screen. Every field is already compared against what the sidebar
/// state holds, so a field that is `false` or `None` needs nothing done.
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct SidebarRevealPlan {
    /// The group holding the row.
    pub group_id: String,
    /// The id the group's own UI state is keyed by.
    pub storage_id: String,
    /// The collection holding that group, when it is in one and that collection is collapsed.
    pub collapsed_collection_storage_id: Option<String>,
    /// The heading the row falls under, when it is collapsed.
    pub collapsed_section: Option<SectionId>,
    /// The group is collapsed.
    pub collapsed_group: bool,
    /// The group or its collection is hidden and Show Hidden is off.
    pub show_hidden: bool,
    /// The ticked tag filters leave the row out.
    pub clear_tag_filters: bool,
    /// The compact list would still leave the row out.
    pub expand_list: bool,
}

/// Works out what has to change for `sidebar_session_id` to be drawn. `None` when the row is not
/// one of the selected machine's, which is where a remote reveal lands until remote machines are
/// in the store.
pub fn reveal_plan(
    core: &Core,
    inputs: &SidebarInputs,
    sidebar_session_id: &str,
    now_ms: u64,
) -> Option<SidebarRevealPlan> {
    // First pass: nothing hidden and nothing filtered, so the row is in the list wherever it is.
    let mut probe = inputs.clone();
    probe.ui.show_hidden = true;
    probe.ui.selected_tag_filters.clear();
    let view = SidebarViewModel::build_from_scratch(core, &probe, now_ms);
    let group = view.groups.iter().find(|group| {
        group
            .core
            .sessions
            .iter()
            .any(|session| session.row.sidebar_session_id == sidebar_session_id)
    })?;
    let group_id = group.core.group_id.clone();
    let storage_id = group.core.storage_id.clone();
    let section = group
        .core
        .sections
        .iter()
        .find(|section| {
            section
                .session_ids
                .iter()
                .any(|session_id| session_id == sidebar_session_id)
        })
        .map(|section| section.id)
        // A row the compact list leaves out is in no heading's drawn list, so its heading is
        // worked out from the row itself, exactly as the sections are built.
        .or_else(|| {
            group
                .core
                .sessions
                .iter()
                .find(|session| session.row.sidebar_session_id == sidebar_session_id)
                .map(|session| {
                    super::ordering::section_of(
                        &session.row,
                        probe.settings.enable_session_parking,
                        now_ms,
                    )
                })
        })?;
    let collection = view
        .collections
        .iter()
        .find(|collection| collection.group_ids.iter().any(|id| *id == group_id));

    let mut plan = SidebarRevealPlan {
        collapsed_group: inputs.ui.collapse.collapsed_groups.contains(&group_id),
        collapsed_collection_storage_id: collection
            .filter(|collection| {
                inputs
                    .ui
                    .collapse
                    .collapsed_collections
                    .contains(&collection.storage_id)
            })
            .map(|collection| collection.storage_id.clone()),
        collapsed_section: inputs
            .ui
            .collapse
            .section_collapse
            .get(&storage_id)
            .copied()
            .unwrap_or_default()
            .get(section)
            .then_some(section),
        show_hidden: !inputs.ui.show_hidden
            && (inputs
                .ui
                .hidden_items
                .group_ids
                .iter()
                .any(|id| *id == group_id)
                || collection.is_some_and(|collection| {
                    inputs
                        .ui
                        .hidden_items
                        .collection_keys
                        .iter()
                        .any(|key| *key == collection.storage_id)
                })),
        clear_tag_filters: !inputs.ui.selected_tag_filters.is_empty()
            && !row_is_drawn(core, inputs, &group_id, sidebar_session_id, now_ms),
        group_id,
        storage_id: storage_id.clone(),
        expand_list: false,
    };

    // Second pass: with the heading open and nothing filtered, is the row one of the rows the
    // list draws? If it still is not, only the full list will show it.
    probe
        .ui
        .collapse
        .section_collapse
        .entry(storage_id.clone())
        .or_default()
        .set(section, false);
    let opened = SidebarViewModel::build_from_scratch(core, &probe, now_ms);
    plan.expand_list = !opened
        .group(&plan.group_id)
        .is_some_and(|group| drawn_in_sections(group, sidebar_session_id));
    Some(plan)
}

/// Whether the row survives the ticked tag filters at all.
fn row_is_drawn(
    core: &Core,
    inputs: &SidebarInputs,
    group_id: &str,
    sidebar_session_id: &str,
    now_ms: u64,
) -> bool {
    let mut probe = inputs.clone();
    probe.ui.show_hidden = true;
    SidebarViewModel::build_from_scratch(core, &probe, now_ms)
        .group(group_id)
        .is_some_and(|group| {
            group
                .core
                .sessions
                .iter()
                .any(|session| session.row.sidebar_session_id == sidebar_session_id)
        })
}

fn drawn_in_sections(group: &super::view::GroupView, sidebar_session_id: &str) -> bool {
    group.core.sections.iter().any(|section| {
        section
            .session_ids
            .iter()
            .any(|session_id| session_id == sidebar_session_id)
    })
}
