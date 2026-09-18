use crate::*;
use serde_json::Value;

/*
CDXC:Extensions 2026-09-18 DECISION:
User: every built-in view and every extension gets the same Edit button and the same "Available in"
picker the custom views already have, so a workarea, a titlebar button, or a store extension can be
limited to chosen projects or chosen spaces instead of only being on or off app-wide.

The scope is a plain settings map (`viewScopes`), so it resolves synchronously while the titlebar
renders. A view with NO entry is available everywhere, which is why an absent key returns true rather
than falling back to a default entry: the setting only ever stores the views the user narrowed.

Space membership itself is owned by the daemon's collections and spaces documents, which this process
cannot read; the sidebar HUD carries the active project's resolved spaces instead.
SEE-ALSO: packages/shared/ghostex-settings/view-scopes.ts owns the same rule for React and the settings
schema, and apps/desktop/sidebar/gxserver-runtime/helpers/view-scopes.ts resolves the HUD field.
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

impl GhostexGpuiApp {
    /// The spaces the ACTIVE project resolves into, with group and worktree-parent inheritance already
    /// applied by the sidebar runtime that owns the daemon documents.
    fn active_project_space_refs(&self) -> Option<&Vec<Value>> {
        self.native_sidebar
            .snapshot
            .as_ref()?
            .hud
            .get("activeProjectSpaceRefs")?
            .as_array()
    }

    /// False when the user narrowed this view to projects or spaces the active project is not in.
    pub(crate) fn view_scope_allows(&self, key: &str) -> bool {
        let settings = shared_settings::shared_sidebar_settings_snapshot();
        let Some(scope) = settings
            .object()
            .get("viewScopes")
            .and_then(|map| map.get(key))
        else {
            return true;
        };
        let availability = scope
            .get("availability")
            .and_then(Value::as_str)
            .unwrap_or("all");
        if availability == "all" {
            return true;
        }
        let Some(project_id) = self
            .latest_sidebar_project_snapshot
            .as_ref()
            .and_then(|snapshot| snapshot.active_project_id.as_ref())
            .map(|id| id.0.as_str())
        else {
            return false;
        };
        if availability == "selected" {
            return scope["projectIds"]
                .as_array()
                .is_some_and(|ids| ids.iter().any(|id| id.as_str() == Some(project_id)));
        }
        let Some(current) = self.active_project_space_refs() else {
            return false;
        };
        scope["spaceRefs"].as_array().is_some_and(|refs| {
            refs.iter().any(|reference| {
                current.iter().any(|space| {
                    space["sectionKey"] == reference["sectionKey"]
                        && space["spaceId"] == reference["spaceId"]
                })
            })
        })
    }

    pub(crate) fn official_view_scope_allows(&self, official_extension_id: &str) -> bool {
        self.view_scope_allows(&official_view_scope_key(official_extension_id))
    }

    /// The scope gate for one titlebar tab. Custom views keep their own richer availability rule in
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
