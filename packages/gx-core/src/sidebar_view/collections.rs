//! Project collections: the coloured folders projects are grouped into, and the top-level row
//! sequence they produce.
//!
//! SEE-ALSO: packages/core-ui/project-collections.ts and
//! packages/core-ui/sidebar-app/project-collection-model.ts.

use std::collections::BTreeMap;

use ghostex_gx_protocol::SidebarProjectCollectionsState as WireCollectionsState;

use super::text::{js_trim, utf16_prefix};

/// The palette a collection without a valid colour falls back to, by position.
const COLLECTION_COLORS: &[&str] = &[
    "#4f5663", "#808080", "#7c6df2", "#3aa675", "#d6873f", "#d75b72", "#3f8fc7", "#b36ad4",
    "#8c9b45", "#c95353", "#c4a23d", "#2f9b95", "#596fd1",
];

#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub(crate) struct Collection {
    pub(crate) collection_id: String,
    pub(crate) title: String,
    pub(crate) color: String,
    pub(crate) project_ids: Vec<String>,
}

/// One machine's collections after client normalization.
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub(crate) struct CollectionsState {
    pub(crate) collections: Vec<Collection>,
}

impl CollectionsState {
    /// `parseSidebarProjectCollectionsFromGxserver`: the order array first, then anything the map
    /// holds beyond it, each row sanitized and each project kept in one collection only.
    pub(crate) fn from_wire(state: &WireCollectionsState) -> Self {
        let mut ordered_ids: Vec<&String> = Vec::new();
        for entry in &state.order {
            if state.collections.contains_key(entry) && !ordered_ids.contains(&entry) {
                ordered_ids.push(entry);
            }
        }
        for collection_id in state.collections.keys() {
            if !ordered_ids.contains(&collection_id) {
                ordered_ids.push(collection_id);
            }
        }
        let mut sanitized = Self::default();
        let mut seen_projects: Vec<String> = Vec::new();
        for collection_id in ordered_ids {
            let Some(raw) = state.collections.get(collection_id) else {
                continue;
            };
            // The map key wins over the row's own id, as the spread in the TypeScript does.
            let id = utf16_prefix(js_trim(collection_id), 120).to_string();
            let title = utf16_prefix(js_trim(&raw.title), 80).to_string();
            let color = sanitize_color(&raw.color, sanitized.collections.len());
            if id.is_empty()
                || title.is_empty()
                || sanitized
                    .collections
                    .iter()
                    .any(|collection| collection.collection_id == id)
            {
                continue;
            }
            let mut project_ids: Vec<String> = Vec::new();
            for project_id in &raw.project_ids {
                let project_id = utf16_prefix(js_trim(project_id), 300).to_string();
                if project_id.is_empty() || seen_projects.contains(&project_id) {
                    continue;
                }
                seen_projects.push(project_id.clone());
                project_ids.push(project_id);
            }
            if project_ids.is_empty() {
                continue;
            }
            sanitized.collections.push(Collection {
                collection_id: id,
                title,
                color,
                project_ids,
            });
        }
        sanitized
    }

    /// `createProjectCollectionIdByProjectId`: the collection each project resolves to, including
    /// what a worktree inherits from its parent project.
    pub(crate) fn collection_id_by_project(
        &self,
        group_ids: &[String],
        project_of_group: &dyn Fn(&str) -> Option<String>,
        parent_project_of_group: &dyn Fn(&str) -> Option<String>,
    ) -> BTreeMap<String, String> {
        let mut result: BTreeMap<String, String> = BTreeMap::new();
        for collection in &self.collections {
            for project_id in &collection.project_ids {
                result.insert(project_id.clone(), collection.collection_id.clone());
            }
        }
        for group_id in group_ids {
            let project_id = project_of_group(group_id);
            let inherited =
                parent_project_of_group(group_id).and_then(|parent| result.get(&parent).cloned());
            if let (Some(project_id), Some(inherited)) = (project_id, inherited) {
                result.insert(project_id, inherited);
            }
        }
        result
    }
}

fn sanitize_color(value: &str, position: usize) -> String {
    let color = js_trim(value);
    let is_hex = color.len() == 7
        && color.starts_with('#')
        && color.as_bytes()[1..].iter().all(u8::is_ascii_hexdigit);
    if is_hex {
        return color.to_string();
    }
    if color == "transparent" {
        return COLLECTION_COLORS[0].to_string();
    }
    COLLECTION_COLORS[position % COLLECTION_COLORS.len()].to_string()
}

/// One top-level row: a project group, or a collection with the groups it holds.
#[derive(Clone, Debug, PartialEq, Eq)]
pub(crate) enum CollectionItem {
    Project {
        group_id: String,
    },
    Collection {
        collection: Collection,
        group_ids: Vec<String>,
    },
}

/// `projectSidebarCollections`: the drawn rows in the section's own project order, with each
/// collection placed where its first project sits.
pub(crate) fn project_sidebar_collections(
    section_group_ids: &[String],
    state: &CollectionsState,
    project_of_group: &dyn Fn(&str) -> Option<String>,
    parent_project_of_group: &dyn Fn(&str) -> Option<String>,
) -> Vec<CollectionItem> {
    let mut group_id_by_project: BTreeMap<String, String> = BTreeMap::new();
    let mut project_id_by_group: BTreeMap<String, String> = BTreeMap::new();
    for group_id in section_group_ids {
        if let Some(project_id) = project_of_group(group_id) {
            group_id_by_project.insert(project_id.clone(), group_id.clone());
            project_id_by_group.insert(group_id.clone(), project_id);
        }
    }
    let collection_id_by_project = state.collection_id_by_project(
        section_group_ids,
        project_of_group,
        parent_project_of_group,
    );

    let mut items: Vec<CollectionItem> = section_group_ids
        .iter()
        .filter(|group_id| !project_id_by_group.contains_key(*group_id))
        .map(|group_id| CollectionItem::Project {
            group_id: group_id.clone(),
        })
        .collect();
    let mut emitted: Vec<String> = Vec::new();
    for collection in &state.collections {
        let mut visible_project_ids: Vec<String> = collection
            .project_ids
            .iter()
            .filter(|project_id| group_id_by_project.contains_key(*project_id))
            .cloned()
            .collect();
        for group_id in section_group_ids {
            let Some(project_id) = project_id_by_group.get(group_id) else {
                continue;
            };
            if !visible_project_ids.contains(project_id)
                && collection_id_by_project.get(project_id) == Some(&collection.collection_id)
            {
                visible_project_ids.push(project_id.clone());
            }
        }
        if visible_project_ids.is_empty() {
            continue;
        }
        emitted.push(collection.collection_id.clone());
        let group_ids = visible_project_ids
            .iter()
            .filter_map(|project_id| group_id_by_project.get(project_id).cloned())
            .collect();
        items.push(CollectionItem::Collection {
            collection: Collection {
                project_ids: visible_project_ids,
                ..collection.clone()
            },
            group_ids,
        });
    }
    for group_id in section_group_ids {
        let Some(project_id) = project_id_by_group.get(group_id) else {
            continue;
        };
        if collection_id_by_project
            .get(project_id)
            .is_some_and(|collection_id| emitted.contains(collection_id))
        {
            continue;
        }
        items.push(CollectionItem::Project {
            group_id: group_id.clone(),
        });
    }
    let position_of = |item: &CollectionItem| -> usize {
        let ids: Vec<&String> = match item {
            CollectionItem::Project { group_id } => vec![group_id],
            CollectionItem::Collection { group_ids, .. } => group_ids.iter().collect(),
        };
        ids.into_iter()
            .map(|group_id| {
                section_group_ids
                    .iter()
                    .position(|candidate| candidate == group_id)
                    .unwrap_or(usize::MAX)
            })
            .min()
            .unwrap_or(usize::MAX)
    };
    items.sort_by_key(position_of);
    items
}
