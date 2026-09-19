use serde_json::Value;

use crate::*;

impl GhostexGpuiApp {
    /// The armed Delayed Send / Close After Done labels for a chat's session, from the native sidebar clock.
    /// CDXC:SessionChat 2026-09-19 SEE-ALSO: packages/shared/session-chat-presentation/armed-actions.ts builds the labels; apps/desktop/sidebar/native-sidebar/clock.ts publishes them every second for all sessions, because the sidebar snapshot omits rows hidden by machine, space, or tag filters.
    pub(crate) fn session_chat_armed_actions(&self, session_id: TerminalSessionId) -> Value {
        let sidebar_session_id = match self.workspace_terminal_key_for_shell_session(session_id) {
            Some(GpuiWorkspaceTerminalSessionKey::Local(key)) => {
                gpui_combined_presentation_session_id(&key.project_id, &key.session_id)
            }
            Some(GpuiWorkspaceTerminalSessionKey::Remote(key)) => gpui_remote_scoped_session_id(
                &key.remote_machine_id,
                &key.project_id,
                &key.session_id,
            ),
            None => return Value::Array(Vec::new()),
        };
        self.native_sidebar
            .armed_actions
            .get(&sidebar_session_id)
            .cloned()
            .unwrap_or_else(|| Value::Array(Vec::new()))
    }

    /// Hand changed labels to every open chat: GPUI views re-render, React pages get a pushed update.
    pub(crate) fn sync_session_chat_armed_actions(&mut self, cx: &mut gpui::Context<Self>) {
        let views = self
            .native_chat_views
            .iter()
            .map(|(session_id, view)| (*session_id, view.clone()))
            .collect::<Vec<_>>();
        for (session_id, view) in views {
            let actions = self.session_chat_armed_actions(session_id);
            view.update(cx, |view, cx| {
                if view.armed_actions != actions {
                    view.armed_actions = actions;
                    cx.notify();
                }
            });
        }
        let pages = self
            .agents_chat_surfaces
            .keys()
            .copied()
            .collect::<Vec<_>>();
        for session_id in pages {
            let actions = self.session_chat_armed_actions(session_id);
            let sent = self
                .agents_chat_page_states
                .get(&session_id)
                .and_then(|state| state.armed_actions_sent.as_ref());
            if sent != Some(&actions) {
                self.push_session_chat_armed_actions(session_id, cx);
            }
        }
    }

    /// Push the current labels to a React chat page; also answers the page's request on mount.
    pub(crate) fn push_session_chat_armed_actions(
        &mut self,
        session_id: TerminalSessionId,
        cx: &mut gpui::Context<Self>,
    ) {
        let Some(surface) = self.agents_chat_surfaces.get(&session_id).cloned() else {
            return;
        };
        let actions = self.session_chat_armed_actions(session_id);
        let script = format!(
            "window.ghostexGpui?.onSessionChatArmedActionsChanged?.({actions}); undefined;"
        );
        surface.update(cx, |surface, _| {
            surface.execute_app_owned_script(&script);
        });
        if let Some(state) = self.agents_chat_page_states.get_mut(&session_id) {
            state.armed_actions_sent = Some(actions);
        }
    }
}
