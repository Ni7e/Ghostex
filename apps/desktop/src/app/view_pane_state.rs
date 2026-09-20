use crate::*;

impl GhostexGpuiApp {
    pub(crate) fn saved_view_pane_state(&self, mode: TitlebarMode) -> GpuiViewPaneState {
        self.view_pane_layouts
            .get(GpuiViewPaneLayoutKind::for_mode(mode))
    }

    /// The layouts with the active view's live pane values folded in. The live
    /// values only exist in the app fields, so the shell-state writer and every
    /// view or project switch read them through here.
    pub(crate) fn view_pane_layouts_with_live_values(&self) -> GpuiViewPaneLayouts {
        let mut layouts = self.view_pane_layouts.clone();
        let kind = GpuiViewPaneLayoutKind::for_mode(self.active_mode);
        match self.sidebar_visibility_memory {
            GpuiSidebarVisibilityMemory::Shared => {
                layouts.shared_sidebar_collapsed = self.sidebar_collapsed;
            }
            GpuiSidebarVisibilityMemory::PerView => {
                layouts.get_mut(kind).sidebar_collapsed = self.sidebar_collapsed;
            }
        }
        let panes = layouts.get_mut(kind);
        // Project selection swaps Agents and Commands independently. Read Commands
        // only while its model belongs to the active project.
        if self.command_pane_project_id == self.agents_workspace_project_id {
            panes.command_mode = self.command_pane.mode;
            if self.command_pane.last_expanded_mode != CommandPaneMode::Collapsed {
                panes.command_last_expanded_mode = self.command_pane.last_expanded_mode;
            }
        }
        layouts
    }

    pub(crate) fn capture_view_pane_layout(&mut self) {
        self.view_pane_layouts = self.view_pane_layouts_with_live_values();
    }

    /// All mode entry routes capture the outgoing layout before restoring the incoming one.
    ///
    /// CDXC:Workarea 2026-09-20 WHY:
    /// Nothing here touches the Agents workspace, its sessions, or its surfaces, and that is the
    /// reason opening, changing or closing a view cannot unmount a terminal or a chat: the only
    /// things a view switch moves are the sidebar, the Commands pane, and which view the panel shows.
    pub(crate) fn change_active_mode_with_pane_state(
        &mut self,
        mode: TitlebarMode,
        cx: &mut gpui::Context<Self>,
    ) {
        if mode == self.active_mode {
            return;
        }
        self.capture_view_pane_layout();
        self.active_mode = mode;
        /*
        CDXC:Workarea 2026-09-20 WHY:
        Every route that opens a view ends here, so the tab strip is maintained here too rather than
        at each entry point: a file opened from chat, a hotkey, the command palette, an extension's
        own launch and the `+` menu all leave a tab behind, and none of them has to remember to.
        Closing the panel leaves the strip alone, and it stops being maximised because there is
        nothing left to maximise.
        */
        match self.open_view_mode() {
            Some(view) => {
                self.record_open_view_tab(view);
                self.last_open_view_mode = Some(view);
                self.view_panel_picker_open = false;
                self.ensure_ghostex_page_panel(view, cx);
            }
            None => self.view_panel_maximized = false,
        }
        self.apply_view_pane_state(cx);
    }

    pub(crate) fn apply_view_pane_state(&mut self, cx: &mut gpui::Context<Self>) {
        let panes = self.saved_view_pane_state(self.active_mode);
        let was_docked = !self.sidebar_collapsed;
        self.sidebar_collapsed = match self.sidebar_visibility_memory {
            GpuiSidebarVisibilityMemory::Shared => self.view_pane_layouts.shared_sidebar_collapsed,
            GpuiSidebarVisibilityMemory::PerView => panes.sidebar_collapsed,
        };
        self.cancel_sidebar_divider_interaction_state();
        self.workarea_split_drag = None;
        self.clear_workarea_split_divider_hover_state();
        /*
        CDXC:Sidebar 2026-09-12 DECISION:
        User: with per-view sidebar memory, hopping between projects with the sidebar must not pull it out from under the pointer.
        A switch that hides the docked sidebar keeps it on screen as the floating panel while the pointer is over it, with no slide, and the ordinary pointer-leave dismissal takes it away afterwards.
        Layout changes on a switch never animate; only the hover reveal does.
        */
        let keep_under_pointer = was_docked && self.sidebar_collapsed;
        self.update_sidebar_reveal(false, keep_under_pointer, cx);
        self.apply_command_view_pane_state();
    }

    pub(crate) fn apply_command_view_pane_state(&mut self) {
        // Project selection swaps Agents and Commands independently. Restore Commands
        // only after its model belongs to the incoming project.
        if self.command_pane_project_id != self.agents_workspace_project_id {
            return;
        }
        let panes = self.saved_view_pane_state(self.active_mode);
        self.command_pane_auto_minimize.idle_since = None;
        self.command_pane.mode = panes.command_mode;
        self.command_pane.last_expanded_mode = panes.command_last_expanded_mode;
        self.command_pane.resize_drag = None;
        self.clear_command_resize_hover_state();
    }

    /// Switching the memory model folds the live sidebar state into the model being
    /// left and seeds the one being entered from the sidebar as it is on screen, so
    /// the switch itself moves nothing.
    pub(crate) fn apply_gpui_sidebar_visibility_memory_from_saved_settings(
        &mut self,
        settings_snapshot: &shared_settings::SharedSidebarSettingsSnapshot,
    ) {
        let next = GpuiSidebarVisibilityMemory::from_shared_settings(settings_snapshot);
        if next == self.sidebar_visibility_memory {
            return;
        }
        self.capture_view_pane_layout();
        self.sidebar_visibility_memory = next;
        match next {
            GpuiSidebarVisibilityMemory::Shared => {
                self.view_pane_layouts.shared_sidebar_collapsed = self.sidebar_collapsed;
            }
            GpuiSidebarVisibilityMemory::PerView => {
                self.view_pane_layouts.agents.sidebar_collapsed = self.sidebar_collapsed;
                self.view_pane_layouts.wide.sidebar_collapsed = self.sidebar_collapsed;
            }
        }
        self.persist_shell_layout_state();
    }
}
