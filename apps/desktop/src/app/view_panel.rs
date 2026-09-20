use gpui::Window;

use crate::app::helpers::*;
use crate::app::model::*;
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

    /// CDXC:Workarea 2026-09-20 DECISION:
    /// User (screen 09): Expand gives the view the whole workarea and folds the sessions column away
    /// with nothing left behind, and the same button brings it back. That fold is the one thing that
    /// can take the Agents workspace off screen, which is what this predicate exists for: every
    /// terminal, chat and focus gate reads it instead of comparing the active mode, so hiding the
    /// column hides its native child views in the same breath instead of leaving them painted over a
    /// maximised page. It supersedes the phase 3 note that this always returns true.
    pub(crate) fn agents_workspace_visible(&self) -> bool {
        !self.view_panel_maximized()
    }

    /// Maximised only counts while a view is really open; closing the panel puts the sessions column
    /// back by itself rather than leaving the window with nothing in it.
    pub(crate) fn view_panel_maximized(&self) -> bool {
        self.view_panel_maximized && self.view_panel_open()
    }

    /// The view the panel toggle opens for the active project: the tab it showed last, the view this
    /// project last had open, or the first view its context makes available.
    pub(crate) fn view_panel_toggle_target(&self) -> Option<TitlebarMode> {
        if let Some(mode) = self
            .open_view_tabs()
            .into_iter()
            .find(|mode| Some(*mode) == self.last_open_view_mode)
        {
            return Some(mode);
        }
        if let Some(mode) = self.open_view_tabs().first().copied() {
            return Some(mode);
        }
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
        if self.view_panel_open() {
            self.close_view_panel(window, cx);
            return;
        }
        let Some(target) = self.view_panel_toggle_target() else {
            return;
        };
        self.open_view_tab(target, window, cx);
    }

    /// CDXC:Workarea 2026-09-20 WHY:
    /// The tab strip is the open-views list filtered by what this project can actually show, not a
    /// second list: a view whose scope the user narrowed, or whose feature this project does not
    /// have, keeps its place in the stored order and comes back the moment it is available again.
    /// Pruning the stored list instead would forget the tab as soon as the user opened the wrong
    /// project once.
    pub(crate) fn open_view_tabs(&self) -> Vec<TitlebarMode> {
        self.open_views
            .iter()
            .copied()
            .filter(|mode| self.titlebar_mode_available(*mode))
            .collect()
    }

    /// Where a newly opened view lands in the strip. The user's `titlebarViewOrder` seeds the
    /// position, so a freshly opened Code tab appears where the user put Code in Settings; a tab the
    /// user has since dragged keeps whatever place they dragged it to, because the stored list is
    /// the order and only the insertion point is derived.
    fn view_tab_insertion_index(&self, mode: TitlebarMode) -> usize {
        let order = gpui_titlebar_view_order_slugs();
        let rank = |mode: &TitlebarMode| {
            let slug = mode.element_slug();
            order
                .iter()
                .position(|id| *id == slug)
                .unwrap_or(usize::MAX)
        };
        let target = rank(&mode);
        self.open_views
            .iter()
            .position(|existing| rank(existing) > target)
            .unwrap_or(self.open_views.len())
    }

    /// Open a view as a tab and focus it. An already-open view just gets focused, which is what the
    /// `+` menu's checked rows do.
    pub(crate) fn open_view_tab(
        &mut self,
        mode: TitlebarMode,
        window: &mut Window,
        cx: &mut gpui::Context<Self>,
    ) -> bool {
        if mode == TitlebarMode::Agents {
            return false;
        }
        if self.set_active_mode(mode, window, cx) {
            cx.notify();
            return true;
        }
        false
    }

    /// Fold the open view's list entry in. Every route that changes `active_mode` passes through
    /// `change_active_mode_with_pane_state`, so this is the one place a tab is born.
    pub(crate) fn record_open_view_tab(&mut self, mode: TitlebarMode) {
        if mode == TitlebarMode::Agents || self.open_views.contains(&mode) {
            return;
        }
        let index = self.view_tab_insertion_index(mode);
        self.open_views.insert(index, mode);
    }

    /// The tab that takes over when `mode` closes: the one to its right, else the one to its left,
    /// else nothing, which closes the panel.
    fn view_tab_successor(&self, mode: TitlebarMode) -> Option<TitlebarMode> {
        let tabs = self.open_view_tabs();
        let index = tabs.iter().position(|tab| *tab == mode)?;
        tabs.get(index + 1)
            .or_else(|| index.checked_sub(1).and_then(|index| tabs.get(index)))
            .copied()
    }

    pub(crate) fn close_view_tab(
        &mut self,
        mode: TitlebarMode,
        window: &mut Window,
        cx: &mut gpui::Context<Self>,
    ) {
        if mode == TitlebarMode::Agents || !self.open_views.contains(&mode) {
            return;
        }
        let successor = (mode == self.active_mode)
            .then(|| self.view_tab_successor(mode))
            .flatten();
        self.open_views.retain(|tab| *tab != mode);
        // A closed tab is not a sleeping tab: the page it owned has no way back on screen, so it
        // releases its CEF surface here instead of waiting for the idle timer.
        self.sleep_titlebar_view(mode, cx);
        match successor {
            Some(next) => {
                self.set_active_mode(next, window, cx);
            }
            None if mode == self.active_mode => self.close_view_panel(window, cx),
            None => {}
        }
        self.persist_shell_layout_state();
        cx.notify();
    }

    /// Closing the panel leaves the tab strip alone: reopening it comes back to the same tabs.
    pub(crate) fn close_view_panel(&mut self, window: &mut Window, cx: &mut gpui::Context<Self>) {
        self.view_panel_maximized = false;
        self.set_active_mode(TitlebarMode::Agents, window, cx);
    }

    pub(crate) fn reorder_view_tab(
        &mut self,
        mode: TitlebarMode,
        insertion_index: usize,
        cx: &mut gpui::Context<Self>,
    ) -> bool {
        let Some(current_index) = self.open_views.iter().position(|tab| *tab == mode) else {
            return false;
        };
        let target = insertion_index.min(self.open_views.len());
        let target = if target > current_index {
            target - 1
        } else {
            target
        };
        if target == current_index {
            return false;
        }
        self.open_views.remove(current_index);
        self.open_views.insert(target, mode);
        self.persist_shell_layout_state();
        cx.notify();
        true
    }

    /// Expand and restore, the button in the tab strip and the `⋯` row beside it.
    pub(crate) fn toggle_view_panel_maximized(&mut self, cx: &mut gpui::Context<Self>) {
        if !self.view_panel_open() {
            return;
        }
        self.view_panel_maximized = !self.view_panel_maximized;
        // The sessions column just appeared or vanished, so every Ghostty and chat child view that
        // reads `agents_workspace_visible()` has to be reconciled at this boundary, exactly as a
        // mode switch reconciles them.
        self.reconcile_agents_pane_surfaces(cx);
        self.update_active_mode_cef_child_visibility(cx);
        self.persist_shell_layout_state();
        cx.notify();
    }
}
