//! Server-owned sidebar documents that ride the presentation snapshot and have their own change
//! frames: user-made session groups, project collections, Spaces, and the custom tag catalog.
//!
//! Each document is normalized by gxserver and always travels whole: a change frame replaces the
//! client's copy. `order` is the authoritative ordering; the maps are keyed by id. Member ids may
//! be soft references to things that no longer exist, so clients tolerate ids they cannot resolve.

use std::collections::BTreeMap;

use serde::{Deserialize, Serialize};

#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceSessionGroup {
    pub group_id: String,
    #[serde(default, deserialize_with = "crate::de::lenient_strings")]
    pub session_ids: Vec<String>,
    #[serde(default, deserialize_with = "crate::de::null_as_default")]
    pub title: String,
}

#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceProjectGroups {
    #[serde(default, deserialize_with = "crate::de::null_as_default")]
    pub groups: Vec<WorkspaceSessionGroup>,
    #[serde(
        default,
        deserialize_with = "crate::de::lenient_opt_u64",
        skip_serializing_if = "Option::is_none"
    )]
    pub next_group_number: Option<u64>,
}

/// User-made session groups per project, plus the manual project order.
#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceSessionGroupsState {
    #[serde(default, deserialize_with = "crate::de::null_as_default")]
    pub project_order: Vec<String>,
    #[serde(default, deserialize_with = "crate::de::null_as_default")]
    pub projects: BTreeMap<String, WorkspaceProjectGroups>,
}

#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SidebarProjectCollection {
    pub collection_id: String,
    #[serde(default, deserialize_with = "crate::de::null_as_default")]
    pub color: String,
    #[serde(default, deserialize_with = "crate::de::null_as_default")]
    pub project_ids: Vec<String>,
    #[serde(default, deserialize_with = "crate::de::null_as_default")]
    pub title: String,
}

/// Project collections (folders). A project id appears in at most one collection; empty
/// collections are dropped by the server.
#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SidebarProjectCollectionsState {
    #[serde(default, deserialize_with = "crate::de::null_as_default")]
    pub collections: BTreeMap<String, SidebarProjectCollection>,
    #[serde(default, deserialize_with = "crate::de::lenient_u64")]
    pub next_collection_number: u64,
    #[serde(default, deserialize_with = "crate::de::null_as_default")]
    pub order: Vec<String>,
}

#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SidebarSpace {
    pub space_id: String,
    #[serde(default, deserialize_with = "crate::de::null_as_default")]
    pub name: String,
    /// Lowercase `#rrggbb`.
    #[serde(default, deserialize_with = "crate::de::null_as_default")]
    pub color: String,
    #[serde(default, deserialize_with = "crate::de::null_as_default")]
    pub icon: String,
    #[serde(default, deserialize_with = "crate::de::null_as_default")]
    pub member_collection_ids: Vec<String>,
    #[serde(default, deserialize_with = "crate::de::null_as_default")]
    pub member_project_ids: Vec<String>,
}

/// Spaces: saved sidebar filters. An empty Space is valid and kept.
#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SidebarSpacesState {
    #[serde(default, deserialize_with = "crate::de::null_as_default")]
    pub order: Vec<String>,
    #[serde(default, deserialize_with = "crate::de::null_as_default")]
    pub spaces: BTreeMap<String, SidebarSpace>,
}

#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CustomSessionTag {
    pub tag_id: String,
    #[serde(default, deserialize_with = "crate::de::null_as_default")]
    pub name: String,
    /// Lowercase `#rrggbb`.
    #[serde(default, deserialize_with = "crate::de::null_as_default")]
    pub color: String,
    #[serde(default, deserialize_with = "crate::de::null_as_default")]
    pub icon: String,
}

/// The custom tag catalog. A tag removed here is cleared from every session in the same write.
#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CustomSessionTagsState {
    #[serde(default, deserialize_with = "crate::de::null_as_default")]
    pub order: Vec<String>,
    #[serde(default, deserialize_with = "crate::de::null_as_default")]
    pub tags: BTreeMap<String, CustomSessionTag>,
}
