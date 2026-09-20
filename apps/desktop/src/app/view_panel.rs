use gpui::Window;

use crate::*;

impl GhostexGpuiApp {
    /// CDXC:Workarea 2026-09-20 WHY:
    /// `active_mode` no longer says which of several workspaces is on screen; it says which view the
    /// right-hand panel shows, and `Agents` says the panel is closed. Everything that used to ask
    /// "am I in Agents mode?" asks one of the three questions below instead, so the difference
    /// between "no view is open" and "the sessions are on screen" is written down exactly once.
    pub(crate) fn open_view_mode(&self) -> Option<TitlebarMode> {
        (self.active_mode != TitlebarMode::Agents).then_some(self.active_mode)
    }

    /// The same question for a mode that is not (yet) the active one.
    pub(crate) fn open_view_mode_for(&self, mode: TitlebarMode) -> Option<TitlebarMode> {
        (mode != TitlebarMode::Agents).then_some(mode)
    }

    pub(crate) fn view_panel_open(&self) -> bool {
        self.active_mode != TitlebarMode::Agents
    }

    /// Whether the Agents workspace is on screen. It always is: it fills the workarea when no view is
    /// open and takes the left column when one is. This is the one place phase 4's maximise will
    /// change when it can hide the column, and every terminal, chat and focus gate reads it rather
    /// than comparing the active mode, which no longer answers this question.
    pub(crate) fn agents_workspace_visible(&self) -> bool {
        true
    }

    /// The view the panel toggle opens for the active project: the last one this project had open,
    /// or the first view its context makes available.
    pub(crate) fn view_panel_toggle_target(&self) -> Option<TitlebarMode> {
        if let Some(mode) = self
            .last_open_view_mode
            .filter(|mode| self.titlebar_mode_available(*mode))
        {
            return Some(mode);
        }
        self.titlebar_mode_switcher_items()
            .into_iter()
            .find(|item| item.is_available && item.mode != TitlebarMode::Agents)
            .map(|item| item.mode)
    }

    /// The header's view-panel toggle: close the panel when a view is open, otherwise reopen the view
    /// this project last showed.
    pub(crate) fn toggle_view_panel(&mut self, window: &mut Window, cx: &mut gpui::Context<Self>) {
        let target = if self.view_panel_open() {
            TitlebarMode::Agents
        } else {
            let Some(target) = self.view_panel_toggle_target() else {
                return;
            };
            target
        };
        self.set_active_mode(target, window, cx);
    }
}
