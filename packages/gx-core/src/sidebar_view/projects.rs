//! Which projects the list shows, in which order, and what rides on each of them: the chat
//! projects, the parked ones, the icon, the worktree metadata, and the manual order.
//!
//! SEE-ALSO: apps/desktop/sidebar/gxserver-runtime/helpers/presentation-projection.ts
//! (`createGpuiPresentationProjectProjectionMetadata`), packages/shared/project-worktree-order.ts,
//! packages/shared/gxserver-presentation-sidebar-projection.ts
//! (`orderGxserverPresentationSidebarProjects`).

use std::collections::{BTreeMap, BTreeSet};

use ghostex_gx_protocol::PresentationProject;
use serde_json::Value;

use crate::presentation_store::MachinePresentation;
use crate::selectors::is_chat_project_path;

use super::text::js_trim;
use super::view::WorktreeView;

/// What the projection knows about one project beside its daemon row.
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub(crate) struct ProjectOverlay {
    pub(crate) icon_data_url: Option<String>,
    pub(crate) is_chat_project: bool,
    pub(crate) is_quick_project: bool,
    pub(crate) order_index: Option<usize>,
    pub(crate) worktree: Option<WorktreeView>,
}

/// Every project fact the list needs, rebuilt when a project, a domain row, or the manual order
/// changes.
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub(crate) struct ProjectMeta {
    pub(crate) overlays: BTreeMap<String, ProjectOverlay>,
    pub(crate) hidden_project_ids: BTreeSet<String>,
    pub(crate) chat_project_ids: BTreeSet<String>,
    /// Visible chat projects in sidebar order.
    pub(crate) chat_order: Vec<String>,
    /// Visible code projects in sidebar order, worktrees under their parents.
    pub(crate) project_order: Vec<String>,
    /// How many projects the Projects settings page would list; the empty state reads it.
    pub(crate) project_settings_count: usize,
}

impl ProjectMeta {
    pub(crate) fn overlay(&self, project_id: &str) -> Option<&ProjectOverlay> {
        self.overlays.get(project_id)
    }
}

fn string_field(value: Option<&Value>, key: &str) -> Option<String> {
    let text = value?.get(key)?.as_str()?;
    let trimmed = js_trim(text);
    (!trimmed.is_empty()).then(|| trimmed.to_string())
}

fn boolean_field(value: Option<&Value>, key: &str) -> Option<bool> {
    value?.get(key)?.as_bool()
}

/// `normalizeGpuiProjectPath`.
fn normalize_project_path(value: Option<&str>) -> Option<String> {
    let trimmed = js_trim(value?);
    if trimmed.is_empty() {
        return None;
    }
    Some(trimmed.trim_end_matches('/').to_string())
}

/// `normalizeGpuiPathForProjectComparison`.
fn path_for_comparison(value: &str) -> String {
    let trimmed = js_trim(value);
    let stripped = trimmed.trim_end_matches('/');
    if stripped.is_empty() {
        trimmed.to_string()
    } else {
        stripped.to_string()
    }
}

/// `isGpuiPresentationChatDomainProject`.
fn is_chat_domain_project(project: &Value) -> bool {
    boolean_field(Some(project), "isChat") == Some(true)
        || boolean_field(project.get("launchSettings"), "isChat") == Some(true)
        || project
            .get("path")
            .and_then(Value::as_str)
            .and_then(|path| normalize_project_path(Some(path)))
            .is_some_and(|path| is_chat_project_path(&path))
}

/// `isGpuiPresentationQuickDomainProject`.
fn is_quick_domain_project(project: &Value) -> bool {
    boolean_field(Some(project), "isQuick") == Some(true)
        || boolean_field(project.get("launchSettings"), "isQuick") == Some(true)
        || is_chat_domain_project(project)
}

/// `gpuiPresentationProjectIconDataUrl`: the user's attached image, else the stored data URL.
fn project_icon_data_url(project: &Value) -> Option<String> {
    let identity_icon = project.get("identityIcon")?;
    let icon = identity_icon.get("icon");
    if icon
        .and_then(|icon| icon.get("kind"))
        .and_then(Value::as_str)
        == Some("image")
    {
        if let Some(data_url) = icon
            .and_then(|icon| icon.get("dataUrl"))
            .and_then(Value::as_str)
            .filter(|value| is_project_icon_data_url(value))
        {
            return Some(data_url.to_string());
        }
        return None;
    }
    identity_icon
        .get("iconDataUrl")
        .and_then(Value::as_str)
        .filter(|value| is_project_icon_data_url(value))
        .map(str::to_string)
}

/// `normalizeWorkspaceProjectIconDataUrl`: `^data:image\/(?:png|svg\+xml);base64,`.
fn is_project_icon_data_url(value: &str) -> bool {
    value.starts_with("data:image/png;base64,") || value.starts_with("data:image/svg+xml;base64,")
}

/// `normalizeGpuiSidebarWorktreeMetadata`: every field is required.
fn normalize_worktree(worktree: Option<&Value>) -> Option<WorktreeView> {
    Some(WorktreeView {
        branch: string_field(worktree, "branch")?,
        name: string_field(worktree, "name")?,
        parent_project_id: string_field(worktree, "parentProjectId")?,
        parent_project_name: string_field(worktree, "parentProjectName")?,
        parent_project_path: string_field(worktree, "parentProjectPath")?,
    })
}

/// One candidate parent project for `resolveGpuiProjectWorktreeParentMetadata`.
struct ParentCandidate<'a> {
    project_id: &'a str,
    name: Option<&'a str>,
    path: Option<&'a str>,
    is_worktree: bool,
}

/// `resolveGpuiProjectWorktreeParentMetadata`: point the worktree at the project that really owns
/// its parent path, when one is registered.
fn resolve_worktree_parent(
    worktree: Option<WorktreeView>,
    candidates: &[ParentCandidate<'_>],
) -> Option<WorktreeView> {
    let worktree = worktree?;
    let parent_path = path_for_comparison(&worktree.parent_project_path);
    let canonical = candidates.iter().find(|candidate| {
        if candidate.project_id == worktree.parent_project_id {
            return false;
        }
        let Some(path) = candidate.path.filter(|path| !path.is_empty()) else {
            return false;
        };
        path_for_comparison(path) == parent_path && !candidate.is_worktree
    });
    let Some(canonical) = canonical else {
        return Some(worktree);
    };
    let name = canonical
        .name
        .map(js_trim)
        .filter(|name| !name.is_empty())
        .map(str::to_string);
    let path = canonical
        .path
        .map(js_trim)
        .filter(|path| !path.is_empty())
        .map(str::to_string);
    Some(WorktreeView {
        parent_project_id: canonical.project_id.to_string(),
        parent_project_name: name.unwrap_or(worktree.parent_project_name),
        parent_project_path: path.unwrap_or(worktree.parent_project_path),
        ..worktree
    })
}

/// Builds every project fact of one machine.
pub(crate) fn build_project_meta(
    machine: &MachinePresentation,
    project_order: &[String],
) -> ProjectMeta {
    let mut meta = ProjectMeta::default();
    let Some(loaded) = machine.loaded() else {
        return meta;
    };
    let order_index: BTreeMap<&str, usize> = project_order
        .iter()
        .enumerate()
        .map(|(index, project_id)| (project_id.as_str(), index))
        .collect();
    let domain_projects: Vec<(&String, &Value)> = machine.domain_projects.iter().collect();
    let mut candidates: Vec<ParentCandidate<'_>> = loaded
        .projects()
        .iter()
        .map(|project| ParentCandidate {
            project_id: project.project_id.as_str(),
            name: Some(project.title.as_str()),
            path: project.path.as_deref(),
            is_worktree: string_field(project.worktree.as_ref(), "parentProjectId").is_some(),
        })
        .collect();
    candidates.extend(
        domain_projects
            .iter()
            .map(|(project_id, project)| ParentCandidate {
                project_id: project_id.as_str(),
                name: project.get("name").and_then(Value::as_str),
                path: project.get("path").and_then(Value::as_str),
                is_worktree: string_field(project.get("worktree"), "parentProjectId").is_some(),
            }),
    );

    for (project_id, project) in &domain_projects {
        let is_chat = is_chat_domain_project(project);
        let is_quick = is_quick_domain_project(project);
        let worktree =
            resolve_worktree_parent(normalize_worktree(project.get("worktree")), &candidates);
        if boolean_field(Some(project), "isRecentProject") == Some(true) {
            meta.hidden_project_ids.insert((*project_id).clone());
        }
        if is_chat || is_quick {
            meta.chat_project_ids.insert((*project_id).clone());
        }
        merge_overlay(
            &mut meta.overlays,
            project_id,
            ProjectOverlayPatch {
                icon_data_url: project_icon_data_url(project),
                is_chat_project: is_chat,
                is_quick_project: is_quick,
                order_index: order_index.get(project_id.as_str()).copied(),
                worktree,
            },
        );
    }
    for project in loaded.projects() {
        let index = order_index.get(project.project_id.as_str()).copied();
        let worktree =
            resolve_worktree_parent(normalize_worktree(project.worktree.as_ref()), &candidates);
        if index.is_some() || worktree.is_some() {
            merge_overlay(
                &mut meta.overlays,
                &project.project_id,
                ProjectOverlayPatch {
                    order_index: index,
                    worktree,
                    ..ProjectOverlayPatch::default()
                },
            );
        }
        let known_domain = machine.domain_projects.contains_key(&project.project_id);
        let chat_path = project
            .path
            .as_deref()
            .and_then(|path| normalize_project_path(Some(path)))
            .is_some_and(|path| is_chat_project_path(&path));
        if known_domain || !chat_path {
            continue;
        }
        meta.chat_project_ids.insert(project.project_id.clone());
        merge_overlay(
            &mut meta.overlays,
            &project.project_id,
            ProjectOverlayPatch {
                is_chat_project: true,
                is_quick_project: true,
                ..ProjectOverlayPatch::default()
            },
        );
    }

    let visible: Vec<&PresentationProject> = loaded
        .projects()
        .iter()
        .filter(|project| {
            !meta.hidden_project_ids.contains(&project.project_id)
                && !machine.is_project_hidden(&project.project_id)
        })
        .collect();
    // `isGxserverPresentationChatProject`: the overlay's flags, else the projection's chat set.
    let is_chat = |project: &PresentationProject, meta: &ProjectMeta| {
        meta.overlays
            .get(&project.project_id)
            .is_some_and(|overlay| overlay.is_quick_project || overlay.is_chat_project)
            || meta.chat_project_ids.contains(&project.project_id)
    };
    let chat_order = order_sidebar_projects(
        visible
            .iter()
            .copied()
            .filter(|project| is_chat(project, &meta)),
        &meta,
    );
    let project_order = order_sidebar_projects(
        visible
            .iter()
            .copied()
            .filter(|project| !is_chat(project, &meta)),
        &meta,
    );
    meta.chat_order = chat_order;
    meta.project_order = project_order;
    meta.project_settings_count = project_settings_count(machine);
    meta
}

/// Merges one patch into a project's overlay, creating it only when the patch says something
/// (`mergeGpuiPresentationProjectOverlay`).
fn merge_overlay(
    overlays: &mut BTreeMap<String, ProjectOverlay>,
    project_id: &str,
    patch: ProjectOverlayPatch,
) {
    if !overlays.contains_key(project_id) && patch.is_empty() {
        return;
    }
    let overlay = overlays.entry(project_id.to_string()).or_default();
    if let Some(icon_data_url) = patch.icon_data_url {
        overlay.icon_data_url = Some(icon_data_url);
    }
    if patch.is_chat_project {
        overlay.is_chat_project = true;
    }
    if patch.is_quick_project {
        overlay.is_quick_project = true;
    }
    if let Some(order_index) = patch.order_index {
        overlay.order_index = Some(order_index);
    }
    if let Some(worktree) = patch.worktree {
        overlay.worktree = Some(worktree);
    }
}

#[derive(Default)]
struct ProjectOverlayPatch {
    icon_data_url: Option<String>,
    is_chat_project: bool,
    is_quick_project: bool,
    order_index: Option<usize>,
    worktree: Option<WorktreeView>,
}

impl ProjectOverlayPatch {
    fn is_empty(&self) -> bool {
        self.icon_data_url.is_none()
            && !self.is_chat_project
            && !self.is_quick_project
            && self.order_index.is_none()
            && self.worktree.is_none()
    }
}

/// `orderGxserverPresentationSidebarProjects`: the manual order when there is one, else the
/// daemon's sort key, then worktrees under their parent projects.
fn order_sidebar_projects<'a>(
    projects: impl Iterator<Item = &'a PresentationProject>,
    meta: &ProjectMeta,
) -> Vec<String> {
    let mut ordered: Vec<&PresentationProject> = projects.collect();
    ordered.sort_by(|left, right| {
        let left_index = meta.overlay(&left.project_id).and_then(|o| o.order_index);
        let right_index = meta.overlay(&right.project_id).and_then(|o| o.order_index);
        if left_index.is_some() || right_index.is_some() {
            return left_index
                .unwrap_or(usize::MAX)
                .cmp(&right_index.unwrap_or(usize::MAX));
        }
        left.sort_key
            .cmp(&right.sort_key)
            .then_with(|| {
                right
                    .updated_at
                    .as_deref()
                    .unwrap_or("")
                    .cmp(left.updated_at.as_deref().unwrap_or(""))
            })
            .then_with(|| left.project_id.cmp(&right.project_id))
    });
    let ids: Vec<String> = ordered
        .iter()
        .map(|project| project.project_id.clone())
        .collect();
    order_projects_with_worktrees(&ids, meta)
}

/// `orderProjectsWithWorktrees` over ids, using the overlay's worktree metadata.
fn order_projects_with_worktrees(ids: &[String], meta: &ProjectMeta) -> Vec<String> {
    let parent_of = |project_id: &str| -> Option<String> {
        meta.overlay(project_id)
            .and_then(|overlay| overlay.worktree.as_ref())
            .map(|worktree| js_trim(&worktree.parent_project_id).to_string())
            .filter(|parent| !parent.is_empty())
    };
    let family_parent = |project_id: &str| -> Option<String> {
        let direct = parent_of(project_id)?;
        let mut family = direct.clone();
        let mut seen: BTreeSet<String> = BTreeSet::from([project_id.to_string()]);
        while !seen.contains(&family) {
            seen.insert(family.clone());
            match ids
                .iter()
                .find(|candidate| **candidate == family)
                .and_then(|candidate| parent_of(candidate))
            {
                Some(next) => family = next,
                None => return Some(family),
            }
        }
        Some(direct)
    };
    let mut worktree_ids: BTreeSet<String> = BTreeSet::new();
    let mut worktrees_by_parent: BTreeMap<String, Vec<String>> = BTreeMap::new();
    for project_id in ids {
        let Some(parent) = family_parent(project_id) else {
            continue;
        };
        if !ids.iter().any(|candidate| *candidate == parent) {
            continue;
        }
        worktree_ids.insert(project_id.clone());
        worktrees_by_parent
            .entry(parent)
            .or_default()
            .push(project_id.clone());
    }
    let mut ordered: Vec<String> = Vec::with_capacity(ids.len());
    for project_id in ids {
        if worktree_ids.contains(project_id) {
            continue;
        }
        ordered.push(project_id.clone());
        if parent_of(project_id).is_none() {
            ordered.extend(
                worktrees_by_parent
                    .get(project_id)
                    .cloned()
                    .unwrap_or_default(),
            );
        }
    }
    ordered
}

/// `createGpuiProjectSettingsProjects(...).length`.
fn project_settings_count(machine: &MachinePresentation) -> usize {
    if !machine.domain_projects.is_empty() {
        return machine
            .domain_projects
            .values()
            .filter(|project| {
                normalize_project_path(project.get("path").and_then(Value::as_str)).is_some()
                    && boolean_field(Some(project), "isRecentProject") != Some(true)
                    && !is_quick_domain_project(project)
            })
            .count();
    }
    machine
        .loaded()
        .map(|loaded| {
            loaded
                .projects()
                .iter()
                .filter(|project| {
                    normalize_project_path(project.path.as_deref())
                        .is_some_and(|path| !is_chat_project_path(&path))
                })
                .count()
        })
        .unwrap_or_default()
}
