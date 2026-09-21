use super::state::{NativeChatConfig, NativeChatEvent, NativeChatView};
use crate::*;

impl GhostexGpuiApp {
    /// CDXC:SessionChat 2026-09-21 DECISION:
    /// User: "remove the ability to switch between GPUI chat view and the React chat view in the settings, and take out the React chat view completely from the GPUI app". Desktop chat is GPUI only, superseding the 2026-09-17 GPUI/React toggle; React chat remains for web and mobile.
    pub(crate) fn ensure_native_chat(
        &mut self,
        session_id: TerminalSessionId,
        cx: &mut gpui::Context<Self>,
    ) -> Option<Entity<NativeChatView>> {
        if let Some(view) = self.native_chat_views.get(&session_id) {
            return Some(view.clone());
        }
        let key = self.workspace_terminal_key_for_shell_session(session_id)?;
        let sidebar_session_id = match &key {
            GpuiWorkspaceTerminalSessionKey::Local(key) => {
                gpui_combined_presentation_session_id(&key.project_id, &key.session_id)
            }
            GpuiWorkspaceTerminalSessionKey::Remote(key) => gpui_remote_scoped_session_id(
                &key.remote_machine_id,
                &key.project_id,
                &key.session_id,
            ),
        };
        let (project_id, server_session_id, remote) = match &key {
            GpuiWorkspaceTerminalSessionKey::Local(key) => {
                (key.project_id.clone(), key.session_id.clone(), None)
            }
            GpuiWorkspaceTerminalSessionKey::Remote(key) => (
                key.project_id.clone(),
                key.session_id.clone(),
                Some(self.gpui_remote_gxserver_request_target(&key.remote_machine_id)?),
            ),
        };
        let mut state = SessionChatPageState::new();
        state.account_key = Some(key.clone());
        let generation = state.generation;
        let config = NativeChatConfig {
            project_id,
            session_id: server_session_id,
            sidebar_session_id,
            shell_session_id: session_id,
            app: Some(cx.weak_entity()),
            preview: None,
            parent_native_view: self.parent_ns_view,
            client_id: format!("native-desktop-{}", std::process::id()),
            remote,
            initial_snapshot: self.cached_session_chat_runtime_snapshot(Some(&key)),
            initial_presentation: self.initial_session_chat_presentation(Some(&key)),
        };
        let armed_actions = self.session_chat_armed_actions(session_id);
        let view = cx.new(|cx| {
            let mut view = NativeChatView::new(config, cx);
            view.armed_actions = armed_actions;
            view
        });
        let subscription =
            cx.subscribe(
                &view,
                move |this, view, event: &NativeChatEvent, cx| match event {
                    NativeChatEvent::Broker(message) => {
                        let mut message = message.clone();
                        message["clientId"] = view.read(cx).config.client_id.clone().into();
                        message["requestId"] = message["id"]
                            .as_u64()
                            .map(|id| id.to_string())
                            .unwrap_or_default()
                            .into();
                        this.relay_session_chat_runtime_request(generation, &message, cx);
                    }
                    NativeChatEvent::ComposerFocused => {
                        this.reclaim_gpui_root_for_chrome_input_focus();
                        if this.record_shell_focus_for_session_chat(session_id) == Some(true) {
                            this.persist_shell_layout_state();
                            cx.notify();
                        }
                    }
                    NativeChatEvent::DraftState(empty) => {
                        if this
                            .agents_chat_page_states
                            .get(&session_id)
                            .is_some_and(|state| state.generation == generation)
                        {
                            this.session_chat_composer_empty_reports
                                .insert(session_id, *empty);
                        }
                    }
                    NativeChatEvent::Host(message) => {
                        let message = message.clone();
                        cx.spawn(async move |this, cx| {
                            let _ = this.update_in(cx, |this, window, cx| {
                                if !this
                                    .agents_chat_page_states
                                    .get(&session_id)
                                    .is_some_and(|state| state.generation == generation)
                                {
                                    return;
                                }
                                if message["action"] == "modelPicker" {
                                    this.open_session_chat_model_picker(session_id, cx);
                                } else {
                                    this.receive_session_chat_host_action(
                                        session_id,
                                        &message.to_string(),
                                        window,
                                        cx,
                                    );
                                }
                            });
                        })
                        .detach();
                    }
                },
            );
        view.update(cx, |view, _| view.subscriptions.push(subscription));
        self.agents_chat_page_states.insert(session_id, state);
        self.native_chat_views.insert(session_id, view.clone());
        Some(view)
    }

    pub(crate) fn native_chat_for_generation(
        &self,
        generation: u64,
    ) -> Option<Entity<NativeChatView>> {
        self.agents_chat_page_states
            .iter()
            .find_map(|(id, state)| {
                (state.generation == generation)
                    .then(|| self.native_chat_views.get(id).cloned())
                    .flatten()
            })
            .or_else(|| {
                self.parked_agents_chat_runtimes_by_project
                    .values()
                    .find_map(|parked| {
                        parked.page_states.iter().find_map(|(id, state)| {
                            (state.generation == generation)
                                .then(|| parked.native_views.get(id).cloned())
                                .flatten()
                        })
                    })
            })
    }
}
