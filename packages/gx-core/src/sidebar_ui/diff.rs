//! What one burst of intents changed about the collapse state, and applying exactly that to the
//! stored envelope.
//!
//! CDXC:Sidebar 2026-09-20 WHY:
//! The desktop app is not the only writer of this key while the port runs: the TypeScript sidebar
//! still owns the per-Space session memory, the Space the active session pulls the section to, and
//! the selection a deleted Space leaves behind, and it writes the whole object when it persists
//! them. Writing the whole object from here would undo those, so a write carries the difference
//! this state made and applies it to whatever is stored at that moment. Once nothing else writes
//! the key, the difference is simply applied to what this state wrote last.

use std::collections::{BTreeMap, BTreeSet};

use serde_json::{json, Map, Value};

use super::persist::{collapse_into_storage, COLLAPSE_STORAGE_VERSION};
use crate::sidebar_view::{SectionCollapse, SidebarCollapseState};

/// The keys one burst added and removed, per collapse field.
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct SidebarCollapseDiff {
    collapsed_groups: SetDiff,
    collapsed_collections: SetDiff,
    expanded_session_lists: SetDiff,
    expanded_hover_actions: SetDiff,
    section_collapse: BTreeMap<String, Option<SectionCollapse>>,
    selected_space_by_section: BTreeMap<String, Option<String>>,
}

#[derive(Clone, Debug, Default, PartialEq, Eq)]
struct SetDiff {
    added: BTreeSet<String>,
    removed: BTreeSet<String>,
}

impl SetDiff {
    fn between(base: &BTreeSet<String>, next: &BTreeSet<String>) -> Self {
        Self {
            added: next.difference(base).cloned().collect(),
            removed: base.difference(next).cloned().collect(),
        }
    }

    fn is_empty(&self) -> bool {
        self.added.is_empty() && self.removed.is_empty()
    }

    fn apply(&self, stored: Option<&Value>) -> Value {
        let mut object = match stored {
            Some(Value::Object(object)) => object.clone(),
            _ => Map::new(),
        };
        for key in &self.removed {
            object.remove(key);
        }
        for key in &self.added {
            object.insert(key.clone(), Value::Bool(true));
        }
        Value::Object(object)
    }
}

impl SidebarCollapseDiff {
    /// What changed between the state that was read and the state that is held now.
    pub fn between(base: &SidebarCollapseState, next: &SidebarCollapseState) -> Self {
        Self {
            collapsed_groups: SetDiff::between(&base.collapsed_groups, &next.collapsed_groups),
            collapsed_collections: SetDiff::between(
                &base.collapsed_collections,
                &next.collapsed_collections,
            ),
            expanded_session_lists: SetDiff::between(
                &base.expanded_session_lists,
                &next.expanded_session_lists,
            ),
            expanded_hover_actions: SetDiff::between(
                &base.expanded_hover_actions,
                &next.expanded_hover_actions,
            ),
            section_collapse: map_diff(&base.section_collapse, &next.section_collapse),
            selected_space_by_section: map_diff(
                &base.selected_space_by_section,
                &next.selected_space_by_section,
            ),
        }
    }

    pub fn is_empty(&self) -> bool {
        self.collapsed_groups.is_empty()
            && self.collapsed_collections.is_empty()
            && self.expanded_session_lists.is_empty()
            && self.expanded_hover_actions.is_empty()
            && self.section_collapse.is_empty()
            && self.selected_space_by_section.is_empty()
    }

    /// The envelope to store: the stored one with this difference applied. A stored value that
    /// cannot be read is replaced by one built from `fallback`, so a damaged payload does not keep
    /// a user's clicks from being saved.
    pub fn apply(&self, stored: Option<&str>, fallback: &SidebarCollapseState) -> String {
        let Some(mut object) = stored
            .and_then(|raw| match serde_json::from_str::<Value>(raw) {
                Ok(Value::Object(envelope)) => Some(envelope),
                _ => None,
            })
            .filter(|envelope| {
                envelope.get("version").and_then(Value::as_u64) == Some(COLLAPSE_STORAGE_VERSION)
            })
            .and_then(|envelope| match envelope.get("state") {
                Some(Value::Object(state)) => Some(state.clone()),
                _ => None,
            })
        else {
            return collapse_into_storage(fallback, None);
        };
        apply_set(&mut object, "collapsedGroupsById", &self.collapsed_groups);
        apply_set(
            &mut object,
            "collapsedProjectCollectionsByKey",
            &self.collapsed_collections,
        );
        apply_set(
            &mut object,
            "expandedProjectSessionListsById",
            &self.expanded_session_lists,
        );
        apply_set(
            &mut object,
            "expandedSessionCardHoverActionsById",
            &self.expanded_hover_actions,
        );
        if !self.section_collapse.is_empty() {
            let mut sections = match object.get("collapsedProjectSessionSectionsById") {
                Some(Value::Object(object)) => object.clone(),
                _ => Map::new(),
            };
            for (storage_id, state) in &self.section_collapse {
                match state {
                    // Only the two headings that are stored; the rest go back to their defaults on
                    // the next read, which is what the sidebar has always done.
                    Some(state) => {
                        sections.insert(
                            storage_id.clone(),
                            json!({ "pinned": state.pinned, "sessions": state.sessions }),
                        );
                    }
                    None => {
                        sections.remove(storage_id);
                    }
                }
            }
            object.insert(
                "collapsedProjectSessionSectionsById".to_string(),
                Value::Object(sections),
            );
        }
        if !self.selected_space_by_section.is_empty() {
            let mut spaces = match object.get("selectedSpaceIdBySectionKey") {
                Some(Value::Object(object)) => object.clone(),
                _ => Map::new(),
            };
            for (section_key, space_id) in &self.selected_space_by_section {
                match space_id {
                    Some(space_id) => {
                        spaces.insert(section_key.clone(), Value::String(space_id.clone()));
                    }
                    None => {
                        spaces.remove(section_key);
                    }
                }
            }
            object.insert(
                "selectedSpaceIdBySectionKey".to_string(),
                Value::Object(spaces),
            );
        }
        json!({ "state": Value::Object(object), "version": COLLAPSE_STORAGE_VERSION }).to_string()
    }
}

fn apply_set(object: &mut Map<String, Value>, key: &str, diff: &SetDiff) {
    if diff.is_empty() {
        return;
    }
    let applied = diff.apply(object.get(key));
    object.insert(key.to_string(), applied);
}

fn map_diff<T: Clone + PartialEq>(
    base: &BTreeMap<String, T>,
    next: &BTreeMap<String, T>,
) -> BTreeMap<String, Option<T>> {
    let mut diff: BTreeMap<String, Option<T>> = BTreeMap::new();
    for (key, value) in next {
        if base.get(key) != Some(value) {
            diff.insert(key.clone(), Some(value.clone()));
        }
    }
    for key in base.keys() {
        if !next.contains_key(key) {
            diff.insert(key.clone(), None);
        }
    }
    diff
}
