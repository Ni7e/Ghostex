//! The scroll handles that keep each tab strip's active tab in view. Moved verbatim out of
//! `app/workarea.rs` on 2026-09-20.

use crate::app::model::*;
use crate::*;
use gpui::ScrollHandle;

impl GhostexGpuiApp {
    pub(crate) fn ensure_tab_scroll_handles_for_current_layout(&mut self) {
        /*
        CDXC:CommandPane 2026-06-22-12:30:
        Native tab overflow parity needs runtime-only ScrollHandles for Agents pane tab strips, Browser pane tab strips, expanded command group tab strips, and the collapsed command strip. Selection, keyboard cycling, close-neighbor selection, new-tab creation, and drag/drop moves should reveal the active item with scroll_to_item(active index) without persisting scroll offsets or adding overlays, hidden hit regions, hit-test routing, synthetic coordinate routing, or broad layout overlap.
        */
        let workspace_pane_ids = self.agents_workspace.leaf_order();
        self.workspace_tab_scroll_handles
            .retain(|pane_id, _| workspace_pane_ids.contains(pane_id));
        for pane_id in workspace_pane_ids {
            self.workspace_tab_scroll_handles
                .entry(pane_id)
                .or_insert_with(ScrollHandle::new);
        }

        let browser_pane_ids = self.browser_tabs.rendered_leaf_order();
        self.browser_tab_scroll_handles
            .retain(|pane_id, _| browser_pane_ids.contains(pane_id));
        for pane_id in browser_pane_ids {
            self.browser_tab_scroll_handles
                .entry(pane_id)
                .or_insert_with(ScrollHandle::new);
        }

        let command_group_ids = self.command_pane.group_order();
        self.command_tab_scroll_handles
            .retain(|group_id, _| command_group_ids.contains(group_id));
        for group_id in command_group_ids {
            self.command_tab_scroll_handles
                .entry(group_id)
                .or_insert_with(ScrollHandle::new);
        }
    }

    pub(crate) fn workspace_tab_scroll_handle(&self, pane_id: WorkspacePaneId) -> ScrollHandle {
        self.workspace_tab_scroll_handles
            .get(&pane_id)
            .cloned()
            .unwrap_or_else(ScrollHandle::new)
    }

    pub(crate) fn browser_tab_scroll_handle(&self, pane_id: BrowserPaneId) -> ScrollHandle {
        self.browser_tab_scroll_handles
            .get(&pane_id)
            .cloned()
            .unwrap_or_else(ScrollHandle::new)
    }

    pub(crate) fn command_tab_scroll_handle(&self, group_id: CommandPaneGroupId) -> ScrollHandle {
        self.command_tab_scroll_handles
            .get(&group_id)
            .cloned()
            .unwrap_or_else(ScrollHandle::new)
    }

    pub(crate) fn scroll_all_active_tab_strips(&mut self) {
        self.ensure_tab_scroll_handles_for_current_layout();
        for pane_id in self.agents_workspace.leaf_order() {
            self.scroll_workspace_pane_active_tab_without_ensure(pane_id);
        }
        for pane_id in self.browser_tabs.rendered_leaf_order() {
            self.scroll_browser_pane_active_tab_without_ensure(pane_id);
        }
        for group_id in self.command_pane.group_order() {
            self.scroll_command_group_active_tab_without_ensure(group_id);
        }
        self.scroll_command_collapsed_active_tab_without_ensure();
    }

    pub(crate) fn scroll_workspace_pane_active_tab(&mut self, pane_id: WorkspacePaneId) {
        self.ensure_tab_scroll_handles_for_current_layout();
        self.scroll_workspace_pane_active_tab_without_ensure(pane_id);
    }

    pub(crate) fn scroll_browser_pane_active_tab(&mut self, pane_id: BrowserPaneId) {
        self.ensure_tab_scroll_handles_for_current_layout();
        self.scroll_browser_pane_active_tab_without_ensure(pane_id);
    }

    pub(crate) fn scroll_focused_browser_pane_active_tab(&mut self) {
        self.scroll_browser_pane_active_tab(self.browser_tabs.focused_pane);
    }

    pub(crate) fn scroll_command_group_active_tab(&mut self, group_id: CommandPaneGroupId) {
        self.ensure_tab_scroll_handles_for_current_layout();
        self.scroll_command_group_active_tab_without_ensure(group_id);
        self.scroll_command_collapsed_active_tab_without_ensure();
    }

    pub(crate) fn focused_command_active_tab_reveal_target(
        command_pane: &CommandPaneModel,
    ) -> Option<(CommandPaneGroupId, CommandSessionId)> {
        /*
        CDXC:CommandPane 2026-06-26-00:39:
        Focused command active-tab reveal is responder-like: resolve only the live `focused_group` active session and no-op when `focused_group` is stale, so expanded and collapsed reveal never fall back to the first command group.
        */
        command_pane.focused_group_active_session_id()
    }

    pub(crate) fn scroll_focused_command_active_tab(&mut self) {
        self.ensure_tab_scroll_handles_for_current_layout();
        let Some((group_id, _session_id)) =
            Self::focused_command_active_tab_reveal_target(&self.command_pane)
        else {
            return;
        };
        self.scroll_command_group_active_tab_without_ensure(group_id);
        self.scroll_command_collapsed_active_tab_without_ensure();
    }

    pub(crate) fn scroll_workspace_pane_active_tab_without_ensure(&self, pane_id: WorkspacePaneId) {
        let Some(active_index) = self
            .agents_workspace
            .find_leaf(pane_id)
            .and_then(|leaf| leaf.tab_group.active_session_index())
        else {
            return;
        };
        if let Some(handle) = self.workspace_tab_scroll_handles.get(&pane_id) {
            handle.scroll_to_item(active_index);
        }
    }

    pub(crate) fn scroll_browser_pane_active_tab_without_ensure(&self, pane_id: BrowserPaneId) {
        let Some(active_index) = self
            .browser_tabs
            .find_leaf(pane_id)
            .and_then(|leaf| leaf.tab_group.active_tab_index())
        else {
            return;
        };
        if let Some(handle) = self.browser_tab_scroll_handles.get(&pane_id) {
            handle.scroll_to_item(active_index);
        }
    }

    pub(crate) fn scroll_command_group_active_tab_without_ensure(
        &self,
        group_id: CommandPaneGroupId,
    ) {
        let Some(active_index) = self
            .command_pane
            .find_leaf(group_id)
            .and_then(|leaf| leaf.tab_group.active_session_index())
        else {
            return;
        };
        if let Some(handle) = self.command_tab_scroll_handles.get(&group_id) {
            command_pane_reveal_active_tab_with_native_margin(handle, active_index);
        }
    }

    pub(crate) fn scroll_command_collapsed_active_tab_without_ensure(&self) {
        let Some((active_group_id, active_session_id)) =
            self.command_pane.active_group_and_session_id()
        else {
            return;
        };
        let Some(active_index) =
            self.command_pane
                .flat_tab_ids()
                .into_iter()
                .position(|(group_id, session_id)| {
                    group_id == active_group_id && session_id == active_session_id
                })
        else {
            return;
        };
        command_pane_reveal_active_tab_with_native_margin(
            &self.command_collapsed_tab_scroll_handle,
            active_index,
        );
    }

    pub(crate) fn show_command_pane_active_tab_from_sticky_proxy(
        &mut self,
        group_id: CommandPaneGroupId,
        scroll_handle: ScrollHandle,
        active_index: usize,
        cx: &mut gpui::Context<Self>,
    ) {
        /*
        CDXC:CommandPane 2026-06-25-13:34:
        Clicking Show Active Tab should reveal the already-selected command tab in the current scroll strip. This is navigation state and must not mutate tab order, session identity, action metadata, command text, or logs.

        CDXC:CommandPane 2026-06-25-18:56:
        Native `performStickyActiveTabButton` scrolls existing tab geometry directly; it does not route through tab action dispatch or select a different session.

        CDXC:CommandPane 2026-06-25-21:50:
        The GPUI command-pane overflow proxy must focus the command pane/group that owns the clipped active tab before revealing it. This remains a real button click path, not a hidden overlay or hit-test route, and it must not select another tab, change drag/drop state, or mutate command session identity.

        CDXC:CommandPane 2026-06-25-21:56:
        Native `performStickyActiveTabButton` calls `centerActiveTabInTabStrip`, so Show Active Tab should center the clipped active tab when scroll bounds allow. Keep the softer native-margin reveal helper for ordinary focus/selection scrolling, not this explicit proxy action.
        */
        if self.command_pane.focus_group(group_id) {
            self.focus_command_pane(cx);
            self.request_command_group_terminal_text_focus_handoff(group_id);
        }
        command_pane_center_active_tab_in_scroll_handle(&scroll_handle, active_index);
        cx.notify();
    }
}
