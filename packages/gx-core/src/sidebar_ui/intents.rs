//! What the user can do to the sidebar's own state, and what each of those does.

use serde::{Deserialize, Serialize};

use crate::sidebar_view::SectionId;

/// One change to the sidebar's own state. Applied synchronously; nothing here waits on the daemon.
///
/// New variants are added by later milestones; match with a wildcard arm.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[non_exhaustive]
pub enum SidebarUiIntent {
    /// Collapse or expand a project row or a user-made group.
    ToggleGroupCollapsed {
        group_id: String,
    },
    /// Show every row of a project's session list rather than the compact first rows.
    ToggleSessionListExpanded {
        storage_id: String,
    },
    /// Show the full hover-button row on a project's cards.
    ToggleHoverActions {
        storage_id: String,
    },
    /// Collapse or expand one heading of a project's session list.
    ToggleSection {
        storage_id: String,
        section: SectionId,
    },
    /// Collapse or expand a collection, by its `<section key>:<collection id>` storage id.
    ToggleCollectionCollapsed {
        storage_id: String,
    },
    /// Filter the section by a Space.
    SelectSpace {
        space_id: String,
    },
    /// Forget a Space the user deleted, so the section resolves its selection afresh.
    ForgetSpace {
        section_key: String,
        space_id: String,
    },
    /// Switch the machine tab.
    SelectMachine {
        machine_id: String,
    },
    /// Tick or untick one tag filter.
    ToggleTagFilter {
        tag: String,
    },
    /// Show or hide the projects and collections the user hid.
    ToggleShowHidden,
    HideGroup {
        group_id: String,
    },
    UnhideGroup {
        group_id: String,
    },
    /// By the collection's `<section key>:<collection id>` storage id.
    HideCollection {
        storage_id: String,
    },
    UnhideCollection {
        storage_id: String,
    },
    /// Replace the multi-selection with exactly these sidebar row ids.
    SetSelectedSessions {
        session_ids: Vec<String>,
    },
    /// Collapse every drawn project of the machine, or put back the ones that were expanded.
    ToggleAllProjects(ToggleAllProjectsInput),
    /// Make a group visible: switch to its machine and expand it.
    RevealGroup {
        machine_id: String,
        group_id: String,
    },
}

/// The drawn project rows of a machine, in the order the list draws them.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ToggleAllProjectsInput {
    pub machine_id: String,
    /// Every project group the machine currently draws, the Chats collection left out.
    pub group_ids: Vec<String>,
}

/// What applying one intent changed.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub struct SidebarUiOutcome {
    /// The state moved, so the list must be built again.
    pub changed: bool,
    /// The values that have to reach client storage.
    pub persist: super::store::SidebarPersistSet,
}
