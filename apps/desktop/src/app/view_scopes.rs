use crate::*;
use serde_json::Value;
use std::collections::HashMap;

/*
CDXC:Extensions 2026-09-20 DECISION:
User (ruling 3A): the per-view scope is a set of OVERRIDES, not an allow-list. Each view carries a
`default` of shown or hidden plus per-project and per-space overrides, resolved project, then space,
then default, so "hide this view here" is one override instead of a list of every other project.
This supersedes the 2026-09-18 "Available in" picker ('all' | 'selected' | 'spaces'), whose stored
shape is still read here and converted, because a settings file written before the rewrite is exactly
expressible in the new model.

The scope is a plain settings map (`viewScopes`), so it resolves synchronously while the work area
header renders. A view with NO entry is shown everywhere, which is why an absent key returns true
rather than falling back to a default entry: the setting only ever stores the views the user narrowed.

Space membership itself is owned by the daemon's collections and spaces documents, which this process
cannot read; the sidebar HUD carries the active project's resolved spaces instead.
SEE-ALSO: packages/shared/ghostex-settings/view-scopes.ts owns the same rule, the same precedence and
the same allow-list migration for React and the settings schema, and
apps/desktop/sidebar/gxserver-runtime/helpers/view-scopes.ts resolves the HUD field.
*/

pub(crate) fn official_view_scope_key(official_extension_id: &str) -> String {
    format!("official:{official_extension_id}")
}

pub(crate) fn extension_view_scope_key(extension_id: &str) -> String {
    format!("extension:{extension_id}")
}

/// The official descriptor id behind a built-in workarea tab, matching `GHOSTEX_OFFICIAL_EXTENSIONS`.
/// The titlebar's own slugs (`source`, `manage`) are deliberately not used as scope keys.
pub(crate) fn titlebar_mode_official_extension_id(mode: TitlebarMode) -> Option<&'static str> {
    match mode {
        TitlebarMode::Source => Some("code"),
        TitlebarMode::Browser => Some("browser"),
        TitlebarMode::Kanban => Some("kanban"),
        TitlebarMode::Automate => Some("automate"),
        TitlebarMode::Manage => Some("docs"),
        TitlebarMode::Agents | TitlebarMode::Extension(_) => None,
    }
}

#[derive(Clone, Copy, PartialEq, Eq)]
pub(crate) enum ViewScopeState {
    Shown,
    Hidden,
}

fn view_scope_state(value: Option<&Value>) -> Option<ViewScopeState> {
    match value.and_then(Value::as_str) {
        Some("shown") => Some(ViewScopeState::Shown),
        Some("hidden") => Some(ViewScopeState::Hidden),
        _ => None,
    }
}

/// A space override is keyed by section and space together, because each gxserver section mints its
/// space ids independently.
fn view_scope_space_key(section_key: &str, space_id: &str) -> String {
    format!("{section_key}:{space_id}")
}

struct ViewScope {
    default_state: ViewScopeState,
    projects: HashMap<String, ViewScopeState>,
    spaces: HashMap<String, ViewScopeState>,
}

fn view_scope_overrides(value: Option<&Value>) -> HashMap<String, ViewScopeState> {
    value
        .and_then(Value::as_object)
        .map(|overrides| {
            overrides
                .iter()
                .filter_map(|(key, state)| Some((key.clone(), view_scope_state(Some(state))?)))
                .collect()
        })
        .unwrap_or_default()
}

impl ViewScope {
    fn from_json(value: &Value) -> Self {
        if view_scope_state(value.get("default")).is_none()
            && let Some(availability) = value.get("availability").and_then(Value::as_str)
        {
            return Self::from_allow_list(value, availability);
        }
        Self {
            default_state: view_scope_state(value.get("default")).unwrap_or(ViewScopeState::Shown),
            projects: view_scope_overrides(value.get("projects")),
            spaces: view_scope_overrides(value.get("spaces")),
        }
    }

    /// The pre-2026-09-20 allow-list, read in place: `selected` is "hidden except these projects",
    /// `spaces` is "hidden except these spaces", and `all` carries nothing at all.
    fn from_allow_list(value: &Value, availability: &str) -> Self {
        let shown = |key: &str, id: fn(&Value) -> Option<String>| {
            value
                .get(key)
                .and_then(Value::as_array)
                .map(|entries| {
                    entries
                        .iter()
                        .filter_map(|entry| Some((id(entry)?, ViewScopeState::Shown)))
                        .collect()
                })
                .unwrap_or_default()
        };
        match availability {
            "selected" => Self {
                default_state: ViewScopeState::Hidden,
                projects: shown("projectIds", |entry| entry.as_str().map(ToOwned::to_owned)),
                spaces: HashMap::new(),
            },
            "spaces" => Self {
                default_state: ViewScopeState::Hidden,
                projects: HashMap::new(),
                spaces: shown("spaceRefs", |entry| {
                    Some(view_scope_space_key(
                        entry.get("sectionKey").and_then(Value::as_str)?,
                        entry.get("spaceId").and_then(Value::as_str)?,
                    ))
                }),
            },
            _ => Self {
                default_state: ViewScopeState::Shown,
                projects: HashMap::new(),
                spaces: HashMap::new(),
            },
        }
    }

    /// Project, then space, then default: the most specific rule wins, and where two of the project's
    /// spaces disagree, hidden wins.
    fn resolve(&self, project_id: Option<&str>, space_keys: &[String]) -> ViewScopeState {
        if let Some(state) = project_id.and_then(|id| self.projects.get(id)) {
            return *state;
        }
        let mut shown = false;
        for key in space_keys {
            match self.spaces.get(key) {
                Some(ViewScopeState::Hidden) => return ViewScopeState::Hidden,
                Some(ViewScopeState::Shown) => shown = true,
                None => {}
            }
        }
        if shown {
            ViewScopeState::Shown
        } else {
            self.default_state
        }
    }
}

impl GhostexGpuiApp {
    /// The spaces the ACTIVE project resolves into, as `sectionKey:spaceId` override keys, with group
    /// and worktree-parent inheritance already applied by the sidebar runtime that owns the daemon
    /// documents. A project only the built-in Other space holds resolves into no space at all.
    fn active_project_space_keys(&self) -> Vec<String> {
        self.native_sidebar
            .snapshot
            .as_ref()
            .and_then(|snapshot| snapshot.hud.get("activeProjectSpaceRefs"))
            .and_then(Value::as_array)
            .map(|refs| {
                refs.iter()
                    .filter_map(|reference| {
                        Some(view_scope_space_key(
                            reference.get("sectionKey").and_then(Value::as_str)?,
                            reference.get("spaceId").and_then(Value::as_str)?,
                        ))
                    })
                    .collect()
            })
            .unwrap_or_default()
    }

    /// False when the user hid this view in the active project, in one of its spaces, or everywhere.
    pub(crate) fn view_scope_allows(&self, key: &str) -> bool {
        let settings = shared_settings::shared_sidebar_settings_snapshot();
        let Some(scope) = settings
            .object()
            .get("viewScopes")
            .and_then(|map| map.get(key))
        else {
            return true;
        };
        let project_id = self
            .latest_sidebar_project_snapshot
            .as_ref()
            .and_then(|snapshot| snapshot.active_project_id.as_ref())
            .map(|id| id.0.as_str());
        ViewScope::from_json(scope).resolve(project_id, &self.active_project_space_keys())
            == ViewScopeState::Shown
    }

    pub(crate) fn official_view_scope_allows(&self, official_extension_id: &str) -> bool {
        self.view_scope_allows(&official_view_scope_key(official_extension_id))
    }

    /// The scope gate for one workarea view. Custom views keep their own richer availability rule in
    /// `custom_project_view_visible`, so they are not scoped twice.
    pub(crate) fn titlebar_mode_view_scope_allows(&self, mode: TitlebarMode) -> bool {
        match mode {
            TitlebarMode::Extension(id) => {
                gpui_custom_view(id).is_some()
                    || self.view_scope_allows(&extension_view_scope_key(id.as_str()))
            }
            _ => match titlebar_mode_official_extension_id(mode) {
                Some(official) => self.official_view_scope_allows(official),
                None => true,
            },
        }
    }
}
