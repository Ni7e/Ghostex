//! The exact shapes client storage holds for the sidebar's own state.
//!
//! CDXC:Sidebar 2026-09-20 WHY:
//! The keys, the envelope, the version number and every field name here are the ones
//! `collapse-state.ts`, `machine-tab-selection.ts` and `sidebar-hidden-items.ts` wrote before this
//! port, because an installation that upgrades must keep its collapsed groups, its Space, its
//! hidden items and its filters, and a build that predates the port must still read what this
//! writes. A write therefore keeps every field it does not own (`isReferenceChatsCollapsed`, the
//! per-Space session memory) exactly as it found it rather than re-deriving the object.
//!
//! SEE-ALSO: packages/core-ui/sidebar-app/collapse-state.ts,
//! packages/core-ui/sidebar-app/machine-tab-selection.ts, packages/core-ui/sidebar-hidden-items.ts,
//! packages/core-ui/sidebar-app/project-session-section-model.ts.

use std::collections::{BTreeMap, BTreeSet};

use serde_json::{json, Map, Value};

use crate::keys::encode_uri_component;
use crate::sidebar_view::{
    SectionCollapse, SidebarCollapseState, SidebarHiddenItems, LOCAL_MACHINE_ID,
};

/// The unscoped part of the collapse key; the window scope is appended.
pub const COLLAPSE_STORAGE_KEY: &str = "ghostex-sidebar-ui-collapse-state";
/// The unscoped part of the selected machine key.
pub const MACHINE_TAB_STORAGE_KEY: &str = "ghostex-sidebar-selected-machine-tab";
/// Hidden projects and collections; not scoped to a window.
pub const HIDDEN_ITEMS_STORAGE_KEY: &str = "ghostex.sidebar.hidden-items.v1";
/// The sidebar's own copy of the project collections.
pub const PROJECT_COLLECTIONS_STORAGE_KEY: &str = "ghostex.sidebar.projectCollections.v1";
/// The window scope the desktop app has always used.
pub const SIDEBAR_WINDOW_SCOPE_ID: &str = "main";
/// The envelope version a write stamps.
pub const COLLAPSE_STORAGE_VERSION: u64 = 3;

/// Versions a read accepts, as `SUPPORTED_SIDEBAR_UI_COLLAPSE_STORAGE_VERSIONS` does.
const SUPPORTED_VERSIONS: [u64; 2] = [2, 3];
/// `MAX_RECENT_SIDEBAR_SPACE_SESSION_IDS`, only so a preserved memory stays inside its own bound.
const MAX_RECENT_SPACE_SESSION_IDS: usize = 20;

/// `getSidebarUiCollapseStateStorageKey` and `getSidebarMachineTabStorageKey`: the unscoped key,
/// `:window:`, and the scope id escaped the way `encodeURIComponent` escapes it.
pub fn sidebar_window_storage_key(unscoped_key: &str, window_scope_id: &str) -> String {
    format!(
        "{unscoped_key}:window:{}",
        encode_uri_component(window_scope_id)
    )
}

/// `readSidebarSelectedMachineTabId`: a stored non-empty id, else this machine.
pub fn machine_tab_from_storage(raw: Option<&str>) -> String {
    raw.filter(|value| !value.is_empty())
        .unwrap_or(LOCAL_MACHINE_ID)
        .to_string()
}

/// `readSidebarUiCollapseState`: the scoped envelope when it parses and carries a supported
/// version, else the legacy unscoped payload, whose collapsed collections come from the separate
/// collections document instead.
///
/// An envelope that is present but damaged reads as the defaults, exactly as the TypeScript does,
/// rather than falling through to the legacy payload.
pub fn collapse_state_from_storage(
    scoped: Option<&str>,
    legacy: Option<&str>,
    legacy_collections: Option<&str>,
) -> SidebarCollapseState {
    if let Some(raw) = scoped {
        let Some(envelope) = parse_object(raw) else {
            return SidebarCollapseState::default();
        };
        let version = envelope.get("version").and_then(Value::as_u64);
        if !version.is_some_and(|version| SUPPORTED_VERSIONS.contains(&version)) {
            return SidebarCollapseState::default();
        }
        return normalize_collapse_state(envelope.get("state"));
    }
    let Some(raw) = legacy.and_then(parse_object) else {
        return SidebarCollapseState {
            collapsed_collections: legacy_collapsed_collections(legacy_collections),
            ..SidebarCollapseState::default()
        };
    };
    SidebarCollapseState {
        collapsed_collections: legacy_collapsed_collections(legacy_collections),
        ..normalize_collapse_state(Some(&Value::Object(raw)))
    }
}

/// The collapse envelope to write: the owned fields from `state`, every other field of a stored
/// envelope kept as it was, and the current version.
pub fn collapse_into_storage(state: &SidebarCollapseState, existing: Option<&str>) -> String {
    let mut object = existing
        .and_then(parse_object)
        .and_then(|envelope| match envelope.get("state") {
            Some(Value::Object(state)) => Some(state.clone()),
            _ => None,
        })
        .unwrap_or_default();
    object.insert(
        "collapsedGroupsById".to_string(),
        flag_map(&state.collapsed_groups),
    );
    object.insert(
        "collapsedProjectCollectionsByKey".to_string(),
        flag_map(&state.collapsed_collections),
    );
    object.insert(
        "expandedProjectSessionListsById".to_string(),
        flag_map(&state.expanded_session_lists),
    );
    object.insert(
        "expandedSessionCardHoverActionsById".to_string(),
        flag_map(&state.expanded_hover_actions),
    );
    object.insert(
        "collapsedProjectSessionSectionsById".to_string(),
        persisted_section_collapse(&state.section_collapse),
    );
    object.insert(
        "selectedSpaceIdBySectionKey".to_string(),
        Value::Object(
            state
                .selected_space_by_section
                .iter()
                .map(|(section, space_id)| (section.clone(), Value::String(space_id.clone())))
                .collect(),
        ),
    );
    // The two fields this state does not own. A stored envelope keeps whatever it had; a first
    // write spells out the defaults a reader would otherwise normalize to, so the object an older
    // build reads back is the one it would have written itself.
    object
        .entry("isReferenceChatsCollapsed".to_string())
        .or_insert(Value::Bool(false));
    let memory = object
        .remove("recentSessionIdsBySpace")
        .map(|memory| normalize_space_memory(&memory))
        .unwrap_or_else(|| Value::Object(Map::new()));
    object.insert("recentSessionIdsBySpace".to_string(), memory);
    json!({ "state": Value::Object(object), "version": COLLAPSE_STORAGE_VERSION }).to_string()
}

/// `readSidebarHiddenItems`: two lists of unique, non-empty strings; anything else reads as empty.
pub fn hidden_items_from_storage(raw: Option<&str>) -> SidebarHiddenItems {
    let Some(value) = raw.and_then(parse_object) else {
        return SidebarHiddenItems::default();
    };
    let list = |key: &str| -> Vec<String> {
        let mut unique: Vec<String> = Vec::new();
        for entry in value
            .get(key)
            .and_then(Value::as_array)
            .into_iter()
            .flatten()
        {
            let Some(entry) = entry.as_str().filter(|entry| !entry.is_empty()) else {
                continue;
            };
            if !unique.iter().any(|seen| seen == entry) {
                unique.push(entry.to_string());
            }
        }
        unique
    };
    SidebarHiddenItems {
        group_ids: list("groupIds"),
        collection_keys: list("collectionKeys"),
    }
}

/// `writeSidebarHiddenItems`: the two lists, in the order the sidebar holds them.
pub fn hidden_items_into_storage(items: &SidebarHiddenItems) -> String {
    json!({
        "collectionKeys": items.collection_keys,
        "groupIds": items.group_ids,
    })
    .to_string()
}

fn parse_object(raw: &str) -> Option<Map<String, Value>> {
    match serde_json::from_str::<Value>(raw) {
        Ok(Value::Object(object)) => Some(object),
        _ => None,
    }
}

/// `normalizeSidebarUiCollapseState`, for the fields this state owns.
fn normalize_collapse_state(state: Option<&Value>) -> SidebarCollapseState {
    let Some(Value::Object(state)) = state else {
        return SidebarCollapseState::default();
    };
    SidebarCollapseState {
        collapsed_groups: flag_set(state.get("collapsedGroupsById")),
        collapsed_collections: flag_set(state.get("collapsedProjectCollectionsByKey")),
        expanded_session_lists: flag_set(state.get("expandedProjectSessionListsById")),
        expanded_hover_actions: flag_set(state.get("expandedSessionCardHoverActionsById")),
        section_collapse: normalize_section_collapse(
            state.get("collapsedProjectSessionSectionsById"),
        ),
        selected_space_by_section: normalize_selected_spaces(
            state.get("selectedSpaceIdBySectionKey"),
        ),
    }
}

/// `normalizeStoredCollapsedGroupsById`: only entries whose value is exactly `true` count.
fn flag_set(value: Option<&Value>) -> BTreeSet<String> {
    let Some(Value::Object(object)) = value else {
        return BTreeSet::new();
    };
    object
        .iter()
        .filter(|(_, flag)| **flag == Value::Bool(true))
        .map(|(key, _)| key.clone())
        .collect()
}

fn flag_map(keys: &BTreeSet<String>) -> Value {
    Value::Object(
        keys.iter()
            .map(|key| (key.clone(), Value::Bool(true)))
            .collect(),
    )
}

/// `normalizeProjectSessionSectionCollapseState`: only Pinned and Sessions are stored; every other
/// heading takes the default the sidebar starts with.
fn normalize_section_collapse(value: Option<&Value>) -> BTreeMap<String, SectionCollapse> {
    let Some(Value::Object(object)) = value else {
        return BTreeMap::new();
    };
    object
        .iter()
        .filter_map(|(storage_id, state)| {
            let state = state.as_object()?;
            let flag = |key: &str| state.get(key) == Some(&Value::Bool(true));
            Some((
                storage_id.clone(),
                SectionCollapse {
                    pinned: flag("pinned"),
                    sessions: flag("sessions"),
                    ..SectionCollapse::default()
                },
            ))
        })
        .collect()
}

/// `persistedProjectSessionSectionCollapseState`: the two persisted headings, nothing else.
fn persisted_section_collapse(state: &BTreeMap<String, SectionCollapse>) -> Value {
    Value::Object(
        state
            .iter()
            .map(|(storage_id, sections)| {
                (
                    storage_id.clone(),
                    json!({ "pinned": sections.pinned, "sessions": sections.sessions }),
                )
            })
            .collect(),
    )
}

/// `normalizeStoredSelectedSpaceIdBySectionKey`: non-empty section key to non-empty Space id.
fn normalize_selected_spaces(value: Option<&Value>) -> BTreeMap<String, String> {
    let Some(Value::Object(object)) = value else {
        return BTreeMap::new();
    };
    object
        .iter()
        .filter(|(section_key, _)| !section_key.is_empty())
        .filter_map(|(section_key, space_id)| {
            let space_id = space_id.as_str().filter(|id| !id.is_empty())?;
            Some((section_key.clone(), space_id.to_string()))
        })
        .collect()
}

/// `normalizeStoredRecentSessionIdsBySpace`, applied to a value this state only carries through,
/// so a damaged memory is dropped here rather than handed back to a reader that would drop it.
fn normalize_space_memory(value: &Value) -> Value {
    let Value::Object(sections) = value else {
        return Value::Object(Map::new());
    };
    let mut normalized = Map::new();
    for (section_key, spaces) in sections {
        let (Some(spaces), false) = (spaces.as_object(), section_key.is_empty()) else {
            continue;
        };
        let mut by_space = Map::new();
        for (space_id, session_ids) in spaces {
            let (Some(session_ids), false) = (session_ids.as_array(), space_id.is_empty()) else {
                continue;
            };
            let mut unique: Vec<Value> = Vec::new();
            for session_id in session_ids {
                let Some(session_id) = session_id.as_str().filter(|id| !id.is_empty()) else {
                    continue;
                };
                if unique.iter().any(|seen| seen.as_str() == Some(session_id)) {
                    continue;
                }
                unique.push(Value::String(session_id.to_string()));
            }
            unique.truncate(MAX_RECENT_SPACE_SESSION_IDS);
            if !unique.is_empty() {
                by_space.insert(space_id.clone(), Value::Array(unique));
            }
        }
        if !by_space.is_empty() {
            normalized.insert(section_key.clone(), Value::Object(by_space));
        }
    }
    Value::Object(normalized)
}

/// The collapsed collections a payload written before the scoped key existed carried: they lived
/// in the collections document itself, under the local section key.
fn legacy_collapsed_collections(raw: Option<&str>) -> BTreeSet<String> {
    let Some(document) = raw.and_then(parse_object) else {
        return BTreeSet::new();
    };
    document
        .get("collections")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .filter_map(|collection| {
            let collection = collection.as_object()?;
            if collection.get("collapsed") != Some(&Value::Bool(true)) {
                return None;
            }
            let collection_id = collection.get("collectionId")?.as_str()?;
            Some(format!("{LOCAL_MACHINE_ID}:{collection_id}"))
        })
        .collect()
}
