//! The two menus the view panel's tab strip owns: `+`, which opens another view, and a tab's
//! right-click menu, which is where a view's scope lives now.

use gpui::Pixels;
use gpui::Window;

use crate::app::actions::*;
use crate::app::context_menu::GpuiContextMenu;
use crate::app::model::*;
use crate::app::project_views::ProjectViewCommand;
use crate::*;

impl GhostexGpuiApp {
    /// Every view this project could show, in the user's `titlebarViewOrder`, whether or not its
    /// scope currently allows it here. The `+` menu splits this into the rows it offers and the
    /// `Hidden here` submenu.
    pub(crate) fn view_picker_modes(&self) -> Vec<TitlebarModeSwitcherItem> {
        self.titlebar_mode_switcher_items_unscoped()
            .into_iter()
            .filter(|item| item.mode != TitlebarMode::Agents)
            .collect()
    }

    /// The views the user hid in this project, in one of its spaces, or everywhere. Ruling 2A: this
    /// is where they come back from, with no new hit target of their own.
    pub(crate) fn hidden_here_view_modes(&self) -> Vec<TitlebarMode> {
        self.view_picker_modes()
            .into_iter()
            .filter(|item| !self.titlebar_mode_view_scope_allows(item.mode))
            .map(|item| item.mode)
            .collect()
    }

    fn hidden_here_submenu_rows(&self) -> Vec<(gpui::SharedString, Box<dyn gpui::Action>)> {
        self.hidden_here_view_modes()
            .into_iter()
            .map(|mode| {
                let action: Box<dyn gpui::Action> = Box::new(ShowGpuiHiddenViewHere {
                    mode_index: mode.switcher_index(),
                });
                (gpui::SharedString::from(mode.tab_label()), action)
            })
            .collect()
    }

    /// CDXC:Workarea 2026-09-20 DECISION:
    /// User (screen 04): the `+` menu is the picker, compact. It lists every view, ticks the ones
    /// already open so clicking them focuses their tab instead of opening a second one, and ends
    /// with `Hidden here ▸` (ruling 2A) and Manage views, so a view hidden in this project comes back
    /// without a control of its own anywhere.
    pub(crate) fn show_view_tab_add_menu(
        &mut self,
        position: gpui::Point<Pixels>,
        window: &mut Window,
        cx: &mut gpui::Context<Self>,
    ) {
        let open = self.open_view_tabs();
        let mut menu = GpuiContextMenu::new();
        for item in self.view_picker_modes() {
            if !self.titlebar_mode_view_scope_allows(item.mode) {
                continue;
            }
            let action = Box::new(OpenGpuiViewTab {
                mode_index: item.mode.switcher_index(),
            });
            if item.is_available {
                menu =
                    menu.menu_with_check(item.mode.tab_label(), open.contains(&item.mode), action);
            } else {
                menu = menu.menu_with_disabled(item.mode.tab_label(), true, action);
            }
        }
        menu.separator()
            .submenu("Hidden here", self.hidden_here_submenu_rows())
            .menu("Manage views…", Box::new(OpenGpuiExtensionsModal))
            .show(position, window, cx);
    }

    /// CDXC:Workarea 2026-09-20 DECISION:
    /// User (screen 05): right-clicking a view tab is where its scope lives. `Show in <project>` and
    /// `Show in space <space>` are checkable and each writes exactly one override; per ruling 1A the
    /// space row names the project's OWN space and is absent when the project belongs to none.
    /// `Choose where it's shown…` opens the Settings editor for exactly this view, and the rest,
    /// Reload, Sleep, Pop out and Close, act on the tab that was clicked rather than the active one.
    pub(crate) fn show_view_tab_context_menu(
        &mut self,
        mode: TitlebarMode,
        position: gpui::Point<Pixels>,
        window: &mut Window,
        cx: &mut gpui::Context<Self>,
    ) {
        let mode_index = mode.switcher_index();
        let mut menu = GpuiContextMenu::new();
        if let Some(scope_key) = self.titlebar_mode_view_scope_key(mode) {
            let shown =
                self.view_scope_state_for_active_project(&scope_key) == ViewScopeState::Shown;
            menu = menu.menu_with_check(
                format!("Show in {}", self.project_name),
                shown,
                Box::new(ToggleGpuiViewProjectScope { mode_index }),
            );
            for (space_key, space_name) in self.active_project_space_labels() {
                let space_shown =
                    self.view_scope_space_state(&scope_key, &space_key) != Some(false);
                menu = menu.menu_with_check(
                    format!("Show in space {space_name}"),
                    space_shown,
                    Box::new(ToggleGpuiViewSpaceScope {
                        mode_index,
                        space_key,
                    }),
                );
            }
            menu = menu
                .menu(
                    "Choose where it's shown…",
                    Box::new(OpenGpuiViewScopeSettings { mode_index }),
                )
                .separator();
        }
        let unavailable = !self.titlebar_mode_available(mode);
        menu = menu.menu_with_disabled(
            "Reload",
            unavailable,
            Box::new(ReloadGpuiTitlebarView { mode_index }),
        );
        menu = if self.project_editor_shell.is_mode_awake(mode) {
            menu.menu_with_disabled(
                "Sleep",
                unavailable,
                Box::new(SleepGpuiTitlebarView { mode_index }),
            )
        } else {
            menu.menu_with_disabled(
                "Wake",
                unavailable,
                Box::new(OpenGpuiViewTab { mode_index }),
            )
        };
        /*
        CDXC:Extensions 2026-09-16 DECISION:
        User: keep Start / Restart and Stop removed, but restore Configure view and make it open the
        clicked view's editor. The rows moved from the mode tab's right-click menu to the view tab's
        when the tab strip replaced the mode switcher; nothing about them changed.
        */
        if let TitlebarMode::Extension(id) = mode
            && gpui_custom_view(id).is_some_and(|view| view.definition.get("source").is_some())
        {
            menu = menu
                .menu(
                    "Command output",
                    Box::new(ProjectViewCommand {
                        id: id.as_str().into(),
                        operation: "output".into(),
                    }),
                )
                .menu(
                    "Configure view",
                    Box::new(ProjectViewCommand {
                        id: id.as_str().into(),
                        operation: "configure".into(),
                    }),
                );
        }
        menu.menu_with_disabled(
            "Pop out to window",
            self.view_pop_out_url(mode).is_none(),
            Box::new(PopOutGpuiViewTab { mode_index }),
        )
        .separator()
        .submenu("Hidden here", self.hidden_here_submenu_rows())
        .separator()
        .menu("Close tab", Box::new(CloseGpuiViewTab { mode_index }))
        .show(position, window, cx);
    }

    /// A view's stored state for one space, with no precedence applied: the space row ticks what the
    /// space itself says, so unticking it writes `hidden` there rather than fighting the project
    /// override above it.
    pub(crate) fn view_scope_space_state(&self, key: &str, space_key: &str) -> Option<bool> {
        shared_settings::shared_sidebar_settings_snapshot()
            .object()
            .get("viewScopes")
            .and_then(|scopes| scopes.get(key))
            .and_then(|scope| scope.get("spaces"))
            .and_then(|spaces| spaces.get(space_key))
            .and_then(serde_json::Value::as_str)
            .map(|state| state == "shown")
    }

    /// The view a tab menu row names, including a view whose scope currently hides it, which is what
    /// the `Hidden here` rows have to be able to reach.
    pub(crate) fn view_tab_mode_for_index(&self, index: u64) -> Option<TitlebarMode> {
        self.titlebar_mode_switcher_items_unscoped()
            .into_iter()
            .find(|item| item.mode.switcher_index() == index)
            .map(|item| item.mode)
    }

    pub(crate) fn toggle_view_project_scope(&mut self, index: u64, cx: &mut gpui::Context<Self>) {
        let Some(mode) = self.view_tab_mode_for_index(index) else {
            return;
        };
        let Some(scope_key) = self.titlebar_mode_view_scope_key(mode) else {
            return;
        };
        let Some(project_id) = self.active_project_id_for_view_scope() else {
            return;
        };
        let shown = self.view_scope_state_for_active_project(&scope_key) == ViewScopeState::Shown;
        self.set_view_scope_override(
            &scope_key,
            ViewScopeOverrideTarget::Project,
            &project_id,
            Some(if shown {
                ViewScopeState::Hidden
            } else {
                ViewScopeState::Shown
            }),
            cx,
        );
    }

    pub(crate) fn toggle_view_space_scope(
        &mut self,
        index: u64,
        space_key: &str,
        cx: &mut gpui::Context<Self>,
    ) {
        let Some(mode) = self.view_tab_mode_for_index(index) else {
            return;
        };
        let Some(scope_key) = self.titlebar_mode_view_scope_key(mode) else {
            return;
        };
        let shown = self.view_scope_space_state(&scope_key, space_key) != Some(false);
        self.set_view_scope_override(
            &scope_key,
            ViewScopeOverrideTarget::Space,
            space_key,
            Some(if shown {
                ViewScopeState::Hidden
            } else {
                ViewScopeState::Shown
            }),
            cx,
        );
    }

    /// `Hidden here ▸ <view>`: show it here again. The project override says `shown` outright rather
    /// than clearing whatever hid it, because the thing hiding it may be the default or a space, and
    /// the user asked for it in THIS project.
    pub(crate) fn show_hidden_view_here(
        &mut self,
        index: u64,
        window: &mut Window,
        cx: &mut gpui::Context<Self>,
    ) {
        let Some(mode) = self.view_tab_mode_for_index(index) else {
            return;
        };
        let Some(scope_key) = self.titlebar_mode_view_scope_key(mode) else {
            return;
        };
        let Some(project_id) = self.active_project_id_for_view_scope() else {
            return;
        };
        self.set_view_scope_override(
            &scope_key,
            ViewScopeOverrideTarget::Project,
            &project_id,
            Some(ViewScopeState::Shown),
            cx,
        );
        self.open_view_tab(mode, window, cx);
    }

    /// CDXC:Workarea 2026-09-20 WHY:
    /// "Choose where it's shown…" is a deep link, not just "open Settings": the Extensions page picks
    /// its scope editor from `initialViewScopeKey`, so the user lands on the view they right-clicked
    /// instead of hunting for its row.
    pub(crate) fn open_view_scope_settings(
        &mut self,
        index: u64,
        window: &mut Window,
        cx: &mut gpui::Context<Self>,
    ) {
        let Some(mode) = self.view_tab_mode_for_index(index) else {
            return;
        };
        let Some(scope_key) = self.titlebar_mode_view_scope_key(mode) else {
            return;
        };
        let modal = GpuiAppModalKind::Settings;
        let sidebar_state_message = self.gpui_app_modal_sidebar_state_message_for_open(modal, cx);
        let mut open_message = modal.open_message();
        open_message["initialTab"] = serde_json::Value::String("extensions".to_string());
        open_message["initialViewScopeKey"] = serde_json::Value::String(scope_key);
        self.open_gpui_app_modal_window(
            modal,
            open_message,
            sidebar_state_message,
            Some(window),
            cx,
        );
    }
}
