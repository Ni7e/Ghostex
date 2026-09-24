//! Where a sidebar session lands in the Agents panes: the selection rule that puts it in the
//! focused pane, and the drag from a sidebar row onto a pane body.

use gpui::{DragMoveEvent, Window};

use crate::GhostexGpuiApp;
use crate::app::model::{
    GpuiLocalWorkspaceSessionKey, TerminalSessionId, WorkspaceDropFeedback, WorkspaceDropTarget,
    WorkspaceDropZone, WorkspacePaneId, workspace_pane_body_drop_zone,
};
use crate::app::native_sidebar::drag::{SidebarDrag, SidebarDragPreview};
use crate::app::native_sidebar::row_drag::RowDragIdentity;

impl GhostexGpuiApp {
    /// CDXC:FocusRouting 2026-09-22 DECISION:
    /// User: selecting a session (a sidebar click, the session hotkeys, or any other way) shows it
    /// in the focused pane, replacing the session that pane was showing, so the sidebar is the
    /// list of what can be shown and a split pane is a viewport onto it. A session that is already
    /// on screen in another split pane is focused there instead of being pulled across. Before
    /// this, a selection switched to whichever pane held the session's tab and left the focused
    /// pane alone.
    ///
    /// Returns the pane the session is now the active tab of.
    pub(crate) fn pull_workspace_session_into_focused_pane(
        &mut self,
        source_pane_id: WorkspacePaneId,
        session_id: TerminalSessionId,
    ) -> WorkspacePaneId {
        let focused_pane_id = self.agents_workspace.focused_pane;
        if source_pane_id == focused_pane_id
            || self.agents_workspace.find_leaf(focused_pane_id).is_none()
        {
            return source_pane_id;
        }
        let on_screen = self
            .agents_workspace
            .rendered_leaf_order()
            .contains(&source_pane_id)
            && self.agents_workspace.active_session_in_pane(source_pane_id) == Some(session_id);
        if on_screen {
            return source_pane_id;
        }
        if self
            .agents_workspace
            .group_tab_into_pane(source_pane_id, focused_pane_id, session_id)
        {
            focused_pane_id
        } else {
            source_pane_id
        }
    }

    /// The local session a sidebar row drag can land on a pane: a terminal row of the project the
    /// Agents tree belongs to that already has a tab. Anything else shows no drop zone.
    /// `None` when the dragged row cannot land on a pane at all; `Some(None)` for a session of the
    /// active project that has no tab in any pane yet, which only the middle of a pane takes.
    fn sidebar_drag_pane_session(
        &self,
        drag: &SidebarDrag,
    ) -> Option<Option<(TerminalSessionId, WorkspacePaneId)>> {
        if drag.kind != "session" {
            return None;
        }
        let SidebarDragPreview::Row(row) = &drag.preview else {
            return None;
        };
        let RowDragIdentity::Session { session } = &row.identity else {
            return None;
        };
        if session.is_browser() {
            return None;
        }
        let key = ghostex_gx_core::SessionKey::parse_sidebar_session_id(&drag.id)?;
        if !key.machine.is_local()
            || self.agents_workspace_project_id.as_deref() != Some(&key.project_id)
        {
            return None;
        }
        Some(
            self.local_workspace_session_mappings
                .get(&GpuiLocalWorkspaceSessionKey {
                    project_id: key.project_id,
                    session_id: key.session_id,
                })
                .copied()
                .and_then(|shell_session_id| {
                    self.agents_workspace
                        .pane_id_for_session(shell_session_id)
                        .map(|pane_id| (shell_session_id, pane_id))
                }),
        )
    }

    /// CDXC:Workarea 2026-09-23 DECISION:
    /// User: a session row dragged from the sidebar onto a terminal or chat pane splits that pane
    /// the way a dragged tab did, so the tab bar is not needed to split, and "allow dragging to the
    /// center": the middle of a pane shows the dragged session in that pane, replacing what it
    /// showed, including with no split and for a session no pane holds yet. This supersedes the
    /// 2026-09-22 edges-only rule. Only local sessions of the active project drop; other rows show
    /// no zone, a session with no tab yet shows only the middle (an edge would split a pane off a
    /// session that has none), and the middle of the pane already showing the session shows
    /// nothing. The pane hides its surfaces for the zones the moment the drag enters a
    /// pane rather than when it starts, so reordering rows in the sidebar leaves the terminals
    /// alone.
    pub(crate) fn update_sidebar_session_pane_drag_feedback(
        &mut self,
        event: &DragMoveEvent<SidebarDrag>,
        pane_id: WorkspacePaneId,
        cx: &mut gpui::Context<Self>,
    ) {
        let over_pane = event.bounds.contains(&event.event.position);
        let Some(tab) = self.sidebar_drag_pane_session(event.drag(cx)) else {
            return;
        };
        if !over_pane {
            if self.workspace_drop_feedback.is_some_and(|feedback| {
                feedback.pane_id == pane_id
                    && matches!(feedback.target, WorkspaceDropTarget::PaneBody(_))
            }) {
                self.clear_workspace_drop_feedback(cx);
            }
            return;
        }
        self.begin_workspace_tab_drag(cx);
        let zone = workspace_pane_body_drop_zone(event.bounds, event.event.position);
        let center = matches!(zone, WorkspaceDropZone::Center);
        // A session with no tab yet can only be shown, not split off; the middle of the pane
        // already showing a session has nothing to do.
        let refused = match tab {
            None => !center,
            Some((session_id, source_pane_id)) => {
                (center
                    && source_pane_id == pane_id
                    && self.agents_workspace.active_session_in_pane(pane_id) == Some(session_id))
                    || self
                        .agents_workspace
                        .workspace_tab_edge_drop_is_single_tab_own_pane_noop(
                            source_pane_id,
                            pane_id,
                            zone,
                        )
            }
        };
        if refused {
            self.clear_workspace_drop_feedback(cx);
            return;
        }
        self.set_workspace_drop_feedback(
            Some(WorkspaceDropFeedback {
                pane_id,
                target: WorkspaceDropTarget::PaneBody(zone),
            }),
            cx,
        );
    }

    pub(crate) fn handle_sidebar_session_pane_body_drop(
        &mut self,
        target_pane_id: WorkspacePaneId,
        drag: &SidebarDrag,
        window: &mut Window,
        cx: &mut gpui::Context<Self>,
    ) {
        let session = self.sidebar_drag_pane_session(drag);
        let zone = match self.workspace_drop_feedback {
            Some(WorkspaceDropFeedback {
                pane_id,
                target: WorkspaceDropTarget::PaneBody(zone),
            }) if pane_id == target_pane_id => Some(zone),
            _ => None,
        };
        self.finish_workspace_tab_drag_state(cx);
        let (Some(tab), Some(zone)) = (session, zone) else {
            cx.notify();
            return;
        };
        window.prevent_default();
        cx.stop_propagation();
        let Some((session_id, source_pane_id)) = tab else {
            // No tab yet: the middle of a pane shows the session there exactly as clicking its row
            // shows it in the focused pane, wake and attach included.
            self.focus_agents_pane(target_pane_id, cx);
            self.dispatch_native_sidebar_ui(
                serde_json::json!({"type": "selectSession", "sessionId": drag.id, "mode": "focus"}),
                cx,
            );
            let _ = self.react_to_native_sidebar_session_click(&drag.id, cx);
            cx.notify();
            return;
        };
        let was_on_screen = self
            .agents_workspace
            .rendered_leaf_order()
            .contains(&source_pane_id)
            && self.agents_workspace.active_session_in_pane(source_pane_id) == Some(session_id);
        if self
            .agents_workspace
            .split_tab_to_pane(source_pane_id, target_pane_id, session_id, zone)
        {
            if was_on_screen {
                self.close_pane_left_by_dragged_session(source_pane_id, target_pane_id);
            }
            // The same activation a tab drop completes with, so a sleeping or runtime-missing
            // session is reported to the sidebar for its wake and reattach.
            self.select_agents_tab(self.agents_workspace.focused_pane, session_id, cx);
        } else {
            cx.notify();
        }
    }

    /// CDXC:Workarea 2026-09-23 DECISION:
    /// User: dragging a session onto the middle of another pane moves it there, and with `a b / c d` dragging `c` onto `b` leaves `a b / d d`: the pane `c` came from goes away and `d` fills the row. `b`'s pane now shows `c`, the way any selection replaces what the focused pane shows. A pane is a viewport onto the session it shows, so when that session is dragged to another pane (the middle or an edge) the viewport it leaves closes instead of showing some other session; the sessions it held behind the scenes join its neighbour and keep running.
    pub(crate) fn close_pane_left_by_dragged_session(
        &mut self,
        source_pane_id: WorkspacePaneId,
        target_pane_id: WorkspacePaneId,
    ) {
        if source_pane_id == target_pane_id
            || self.agents_workspace.find_leaf(source_pane_id).is_none()
        {
            return;
        }
        let focused = self.agents_workspace.focused_pane;
        if self
            .agents_workspace
            .close_pane_keeping_sessions(source_pane_id)
            .is_some()
            && self.agents_workspace.find_leaf(focused).is_some()
        {
            self.agents_workspace.set_focused_pane(focused);
        }
    }
}
