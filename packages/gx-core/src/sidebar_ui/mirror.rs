//! What an applied intent changed, in the words of the old sidebar page's in-memory copy.
//!
//! CDXC:Sidebar 2026-09-21 WHY:
//! The old page still holds its own copy of this state while the store's list is drawn, and that
//! copy is not only compared by the shadow: the page resolves cmd+1..9 (`focusSessionSlot`) against
//! the list it builds from it. Every change a sidebar COMMAND makes reaches that copy as the same
//! command. A change the app makes on its own (the project slot hotkey's jump and the reveal it
//! performs) has no command to forward, and the first port told the page a `revealSidebarSession`
//! instead, which missed the jump's two deletions and, because the page never clears its reveal
//! request, overwrote the id both Rust readers use to skip an already handled one, so the previous
//! reveal ran again. This is the replacement: the resulting VALUE of every key the intent touched,
//! read from the state after it was applied, which the page sets without revealing, scrolling or
//! focusing anything. Values rather than toggles, so a copy that had drifted converges on the
//! app's instead of inverting.
//!
//! SEE-ALSO: apps/desktop/sidebar/native-sidebar/ui-state.ts (`NativeSidebarUiState.mirror`),
//! apps/desktop/src/app/gx_store/sidebar_slot_jump.rs, tooling/gx-core/slot-jump-parity.ts.

use serde_json::{json, Value};

use super::SidebarUiIntent;
use crate::sidebar_view::{SectionCollapse, SectionId, SidebarUiState};

/// The page-side changes of one intent that CHANGED `state`, read from `state` after it was
/// applied. The caller skips intents that changed nothing.
pub fn sidebar_ui_mirror_changes(intent: &SidebarUiIntent, state: &SidebarUiState) -> Vec<Value> {
    let collapse = &state.collapse;
    let flag = |kind: &str, id: &str, on: bool| json!({ "kind": kind, "id": id, "on": on });
    let space_of = |section_key: &str| {
        json!({
            "kind": "selectedSpace",
            "sectionKey": section_key,
            "spaceId": collapse.selected_space_by_section.get(section_key),
        })
    };
    match intent {
        SidebarUiIntent::ToggleGroupCollapsed { group_id } => vec![flag(
            "collapsedGroup",
            group_id,
            collapse.collapsed_groups.contains(group_id),
        )],
        SidebarUiIntent::ToggleSessionListExpanded { storage_id } => vec![flag(
            "expandedList",
            storage_id,
            collapse.expanded_session_lists.contains(storage_id),
        )],
        SidebarUiIntent::ToggleHoverActions { storage_id } => vec![flag(
            "hoverActions",
            storage_id,
            collapse.expanded_hover_actions.contains(storage_id),
        )],
        SidebarUiIntent::ToggleSection { storage_id, .. } => {
            let sections = collapse
                .section_collapse
                .get(storage_id)
                .copied()
                .unwrap_or_default();
            vec![json!({
                "kind": "section",
                "id": storage_id,
                "state": section_json(&sections),
            })]
        }
        SidebarUiIntent::ToggleCollectionCollapsed { storage_id } => vec![flag(
            "collapsedCollection",
            storage_id,
            collapse.collapsed_collections.contains(storage_id),
        )],
        SidebarUiIntent::SelectSpace { .. } => vec![space_of(&state.section_key())],
        SidebarUiIntent::SetSectionSpace { section_key, .. }
        | SidebarUiIntent::ForgetSectionSpace { section_key } => vec![space_of(section_key)],
        SidebarUiIntent::SelectMachine { .. } => vec![json!({
            "kind": "selectedMachine",
            "machineId": state.selected_machine_id,
        })],
        SidebarUiIntent::ToggleTagFilter { .. } => vec![json!({
            "kind": "tagFilters",
            "tags": state.selected_tag_filters,
        })],
        SidebarUiIntent::ToggleShowHidden => {
            vec![json!({ "kind": "showHidden", "on": state.show_hidden })]
        }
        SidebarUiIntent::HideGroup { group_id } | SidebarUiIntent::UnhideGroup { group_id } => {
            vec![flag(
                "hiddenGroup",
                group_id,
                state.hidden_items.group_ids.contains(group_id),
            )]
        }
        SidebarUiIntent::HideCollection { storage_id }
        | SidebarUiIntent::UnhideCollection { storage_id } => vec![flag(
            "hiddenCollection",
            storage_id,
            state.hidden_items.collection_keys.contains(storage_id),
        )],
        SidebarUiIntent::SetSelectedSessions { .. } => vec![json!({
            "kind": "selectedSessions",
            "sessionIds": state.selected_session_ids,
        })],
        SidebarUiIntent::ToggleAllProjects(input) => input
            .group_ids
            .iter()
            .map(|group_id| {
                flag(
                    "collapsedGroup",
                    group_id,
                    collapse.collapsed_groups.contains(group_id),
                )
            })
            .collect(),
        SidebarUiIntent::RememberSpaceSession {
            section_key,
            space_id,
            ..
        } => vec![json!({
            "kind": "recentSessions",
            "sectionKey": section_key,
            "spaceId": space_id,
            "sessionIds": collapse
                .recent_sessions_by_space
                .get(section_key)
                .and_then(|by_space| by_space.get(space_id)),
        })],
        SidebarUiIntent::ExpandProjectForSlotJump {
            group_id,
            collapse_session_list_storage_id,
        } => {
            let mut changes = vec![flag(
                "collapsedGroup",
                group_id,
                collapse.collapsed_groups.contains(group_id),
            )];
            if let Some(storage_id) = collapse_session_list_storage_id {
                changes.push(flag(
                    "expandedList",
                    storage_id,
                    collapse.expanded_session_lists.contains(storage_id),
                ));
            }
            changes
        }
    }
}

/// A heading entry the way the page keeps one: all six headings, spelled out.
fn section_json(sections: &SectionCollapse) -> Value {
    Value::Object(
        SectionId::ORDER
            .into_iter()
            .map(|section| (section.as_str().to_string(), json!(sections.get(section))))
            .collect(),
    )
}
