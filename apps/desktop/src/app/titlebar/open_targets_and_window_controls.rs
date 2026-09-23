// C1 wave-4 deferred split: apps/desktop/src/app/titlebar.rs (~3.9k lines)
// further divided into responsibility-scoped submodules, pure move (the
// only edit from the original app/titlebar.rs body is wrapping each group
// of `impl GhostexGpuiApp` methods in its own impl block; multiple impl
// blocks for the same type across files is the established pattern used by
// every sibling file in apps/desktop/src/app/). This file holds open-target navigation helpers, focus-mode exit, and the right-side/window control renderers.
// See docs/2026-08-22/repo-restructure/SPLITS.md C1.

// C1 wave-4 extraction: `impl GhostexGpuiApp` methods moved verbatim out of
// main.rs (pure move; the only edit is the `pub(crate) ` visibility prefix the
// cross-module split requires). See docs/2026-08-22/repo-restructure/SPLITS.md C1.
//
// Cluster: titlebar menus, popups, actions, and titlebar render_* builders

use std::path::PathBuf;

use gpui::Window;
use gpui_component::WindowExt;
use gpui_component::notification::Notification;

use crate::app::consts::*;
use crate::app::helpers::*;
use crate::app::model::*;
use crate::*;

#[cfg(any(target_os = "windows", target_os = "linux"))]
use gpui::WindowControlArea;

impl GhostexGpuiApp {
    /*
    CDXC:Extensions 2026-09-18 DECISION:
    User: a titlebar button is scoped exactly like a workarea, so "hidden" means either the
    Extensions page switch is off OR the button's view scope hides it in the active project.
    Every button and every ⋯ menu row asks this one question, so they stay one behaviour.
    SEE-ALSO: apps/desktop/src/app/view_scopes.rs, apps/desktop/src/app/titlebar/more_menu.rs, packages/core-ui/settings-modal/tabs/extensions.tsx.
    */
    pub(crate) fn titlebar_button_hidden(
        &self,
        settings_key: &str,
        official_extension_id: &str,
    ) -> bool {
        shared_settings::shared_sidebar_settings_snapshot()
            .object()
            .get(settings_key)
            .and_then(serde_json::Value::as_bool)
            .unwrap_or(false)
            || !self.official_view_scope_allows(official_extension_id)
    }

    pub(crate) fn active_open_target_index(&self, targets: &[GpuiOpenTarget]) -> Option<usize> {
        self.active_open_target_id
            .as_deref()
            .and_then(|active_id| targets.iter().position(|target| target.id == active_id))
            .or_else(|| (!targets.is_empty()).then_some(0))
    }

    pub(crate) fn titlebar_open_target_icon(&self) -> (&'static str, f32) {
        let targets = gpui_visible_open_targets_from_current_settings();
        let active_target_id = self
            .active_open_target_index(&targets)
            .and_then(|index| targets.get(index))
            .map(|target| target.id.as_str());
        active_target_id
            .map(titlebar_open_target_icon_for_id)
            .unwrap_or((TITLEBAR_ICON_FOLDER_OPEN, 16.0))
    }

    pub(crate) fn active_project_open_in_path(&self) -> Option<PathBuf> {
        self.latest_sidebar_project_snapshot
            .as_ref()
            .and_then(|snapshot| snapshot.in_memory_project_path.clone())
    }

    pub(crate) fn open_active_project_with_active_open_target(
        &mut self,
        window: &mut Window,
        cx: &mut gpui::Context<Self>,
    ) {
        let targets = gpui_visible_open_targets_from_current_settings();
        let Some(target_index) = self.active_open_target_index(&targets) else {
            window.push_notification(Notification::warning("No Open In targets are visible."), cx);
            cx.notify();
            return;
        };
        self.open_active_project_with_open_target(target_index, targets, window, cx);
    }

    pub(crate) fn open_active_project_with_open_target_index(
        &mut self,
        target_index: usize,
        window: &mut Window,
        cx: &mut gpui::Context<Self>,
    ) {
        self.open_active_project_with_open_target(
            target_index,
            gpui_visible_open_targets_from_current_settings(),
            window,
            cx,
        );
    }

    pub(crate) fn open_active_project_with_open_target(
        &mut self,
        target_index: usize,
        targets: Vec<GpuiOpenTarget>,
        window: &mut Window,
        cx: &mut gpui::Context<Self>,
    ) {
        let Some(target) = targets.into_iter().nth(target_index) else {
            return;
        };
        let Some(project_path) = self.active_project_open_in_path() else {
            window.push_notification(
                Notification::warning("Open an active project before using Open In."),
                cx,
            );
            cx.notify();
            return;
        };
        self.persist_gpui_titlebar_project_selection(
            GPUI_TITLEBAR_OPEN_TARGET_SELECTIONS_SETTINGS_KEY,
            &target.id,
        );
        self.active_open_target_id = Some(target.id.clone());
        if let Err(message) = gpui_launch_open_target(&target, &project_path) {
            window.push_notification(Notification::warning(message), cx);
        }
        cx.notify();
    }

    pub(crate) fn titlebar_exit_focus_control_signature(
        &self,
    ) -> Option<GpuiTitlebarExitFocusControlSignature> {
        gpui_titlebar_exit_focus_control_signature(self.agents_workspace.focus_mode_pane.is_some())
    }

    pub(crate) fn exit_titlebar_focus_mode(&mut self, cx: &mut gpui::Context<Self>) -> bool {
        if self.agents_workspace.focus_mode_pane.is_none()
            || !self.agents_workspace.toggle_focus_mode()
        {
            return false;
        }

        let focused_pane = self.agents_workspace.focused_pane;
        self.focus_shell_target(ShellFocusTarget::AgentsPane(focused_pane), cx);
        self.scroll_workspace_pane_active_tab(focused_pane);
        self.persist_shell_layout_state();
        cx.notify();
        true
    }

    #[cfg(any(target_os = "windows", target_os = "linux"))]
    pub(crate) fn render_titlebar_window_controls(
        &self,
        window: &mut Window,
        cx: &mut gpui::Context<Self>,
    ) -> impl IntoElement {
        /*
        Windows and Linux use the same flat, contiguous titlebar button chrome
        as the existing Ghostex actions, but caption controls keep the native
        Windows 46px width. They are normal trailing layout children, so they
        neither overlap the draggable titlebar nor need synthetic hit routing.
        */
        let maximize_control = if window.is_maximized() {
            GpuiWindowCaptionControl::Restore
        } else {
            GpuiWindowCaptionControl::Maximize
        };
        h_flex()
            .id("ghostex-gpui-titlebar-window-controls")
            .flex_shrink_0()
            .h_full()
            .items_center()
            .child(self.render_titlebar_window_control(GpuiWindowCaptionControl::Minimize, cx))
            .child(self.render_titlebar_window_control(maximize_control, cx))
            .child(self.render_titlebar_window_control(GpuiWindowCaptionControl::Close, cx))
    }

    #[cfg(any(target_os = "windows", target_os = "linux"))]
    pub(crate) fn render_titlebar_window_control(
        &self,
        control: GpuiWindowCaptionControl,
        _cx: &mut gpui::Context<Self>,
    ) -> AnyElement {
        let button = div()
            .id(control.element_id())
            .relative()
            .flex()
            .flex_shrink_0()
            .h(px(TITLEBAR_CONTROL_HEIGHT))
            .w(px(TITLEBAR_WINDOW_BUTTON_WIDTH))
            .items_center()
            .justify_center()
            .occlude()
            .text_color(titlebar_icon_color())
            .cursor_default()
            .hover(|this| {
                this.bg(titlebar_button_hover_color())
                    .text_color(titlebar_icon_hover_color())
            })
            .child(titlebar_svg_icon(
                control.icon_path(),
                control.icon_size(),
                titlebar_icon_color(),
            ));

        #[cfg(target_os = "windows")]
        {
            button
                .window_control_area(control.window_control_area())
                .into_any_element()
        }

        #[cfg(target_os = "linux")]
        {
            button
                .on_mouse_down(
                    MouseButton::Left,
                    _cx.listener(move |_this, _event, window, cx| {
                        window.prevent_default();
                        cx.stop_propagation();
                        match control {
                            GpuiWindowCaptionControl::Minimize => window.minimize_window(),
                            GpuiWindowCaptionControl::Maximize
                            | GpuiWindowCaptionControl::Restore => window.zoom_window(),
                            GpuiWindowCaptionControl::Close => window.remove_window(),
                        }
                    }),
                )
                .into_any_element()
        }
    }
}
