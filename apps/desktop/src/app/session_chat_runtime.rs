use crate::*;

impl GhostexGpuiApp {
    fn session_chat_runtime_key(&self, generation: u64) -> Option<GpuiWorkspaceTerminalSessionKey> {
        self.agents_chat_page_states
            .values()
            .chain(
                self.parked_agents_chat_runtimes_by_project
                    .values()
                    .flat_map(|parked| parked.page_states.values()),
            )
            .find(|state| state.generation == generation)
            .and_then(|state| state.account_key.clone())
    }

    /// CDXC:SessionChat 2026-09-13 WHY:
    /// Packaged chat pages have opaque file origins, so the existing sidebar owns the shared cache and sockets instead of a SharedWorker or one cache per renderer.
    /// Derive the endpoint and conversation from the native binding; a delayed page request cannot select another machine or session.
    pub(crate) fn relay_session_chat_runtime_request(
        &mut self,
        generation: u64,
        message: &serde_json::Value,
        cx: &mut gpui::Context<Self>,
    ) {
        support_logs::append_for_scenario(
            support_logs::GpuiSupportLog::SessionChat,
            "gpui.sessionChat.viewState",
            "sessionChat.nativeBrokerRequest",
            serde_json::json!({
                "generation": generation,
                "method": message["method"],
                "requestId": message["requestId"],
                "hasBinding": self.session_chat_runtime_key(generation).is_some(),
                "brokerReady": self.session_chat_broker_epoch.is_some(),
            }),
        );
        let Some(key) = self.session_chat_runtime_key(generation) else {
            return;
        };
        if message["method"] == "presentation" {
            self.cache_session_chat_presentation(key, &message["params"]["state"]);
            return;
        }
        let Some(method) = message["method"]
            .as_str()
            .filter(|method| matches!(*method, "subscribe" | "unsubscribe" | "reconnect"))
        else {
            return;
        };
        let request_id = message["requestId"].as_str().unwrap_or_default();
        if request_id.len() > 100 {
            return;
        }
        let (machine_id, project_id, session_id, bootstrap) = match key {
            GpuiWorkspaceTerminalSessionKey::Local(key) => (
                "local".to_string(),
                key.project_id,
                key.session_id,
                self.sidebar_gxserver_bootstrap
                    .as_ref()
                    .map(|bootstrap| (bootstrap.base_url.clone(), bootstrap.auth_token.clone())),
            ),
            GpuiWorkspaceTerminalSessionKey::Remote(key) => {
                let bootstrap = self
                    .gpui_remote_gxserver_request_target(&key.remote_machine_id)
                    .map(|target| {
                        (
                            format!("http://127.0.0.1:{}", target.local_port),
                            target.token,
                        )
                    });
                (
                    key.remote_machine_id,
                    key.project_id,
                    key.session_id,
                    bootstrap,
                )
            }
        };
        let (base_url, auth_token) = bootstrap.unwrap_or_default();
        self.session_chat_broker_endpoints
            .insert(machine_id.clone(), (base_url.clone(), auth_token.clone()));
        let Some(epoch) = self.session_chat_broker_epoch.as_ref() else {
            self.dispatch_session_chat_generation_response(generation, "onSessionChatRuntimeMessage", &serde_json::json!({"kind":"response", "requestId":request_id,"error":"The shared chat service is starting."}), false, cx);
            return;
        };
        let mut params = serde_json::Map::new();
        for field in ["limit", "beforeOffset"] {
            if let Some(value) = message["params"][field].as_u64() {
                params.insert(field.to_string(), value.into());
            }
        }
        if let Some(catalog) = message["params"]["catalog"].as_bool() {
            params.insert("catalog".into(), catalog.into());
        }
        let client_id = message["clientId"]
            .as_str()
            .filter(|id| id.len() <= 128)
            .unwrap_or_default();
        let payload = serde_json::json!({"clientId":client_id,"epoch":epoch,"generation":generation.to_string(),"requestId":request_id,"method":method,"params":params,"identity":{"machineId":machine_id,"projectId":project_id,"sessionId":session_id},"endpoint":{"baseUrl":base_url,"authToken":auth_token}});
        // The warm pool replays this exact request to resume a paused view (session_chat_warm_pool.rs).
        if method == "subscribe" {
            self.session_chat_subscribe_requests
                .insert(generation, payload.clone());
            self.session_chat_paused_generations.remove(&generation);
        } else if method == "unsubscribe" {
            self.session_chat_subscribe_requests.remove(&generation);
            self.session_chat_paused_generations.remove(&generation);
        }
        if let Some(sidebar) = self.sidebar.as_ref() {
            sidebar.update(cx, |sidebar, _| {
                sidebar.execute_app_owned_script(&format!(
                    "window.ghostexGpui?.onSessionChatRuntimeRequest?.({payload}); undefined;"
                ));
            });
        }
    }

    pub(crate) fn release_session_chat_runtime_subscription(
        &self,
        generation: u64,
        cx: &mut gpui::Context<Self>,
    ) {
        if let Some(sidebar) = self.sidebar.as_ref() {
            let payload = serde_json::json!({"epoch":self.session_chat_broker_epoch,"generation":generation.to_string(),"method":"release"});
            sidebar.update(cx, |sidebar, _| {
                sidebar.execute_app_owned_script(&format!(
                    "window.ghostexGpui?.onSessionChatRuntimeRequest?.({payload}); undefined;"
                ));
            });
        }
    }

    pub(crate) fn release_parked_session_chat_runtime_subscriptions(
        &self,
        parked: &ParkedAgentsChatRuntime,
        cx: &mut gpui::Context<Self>,
    ) {
        for state in parked.page_states.values() {
            self.release_session_chat_runtime_subscription(state.generation, cx);
        }
    }

    pub(crate) fn refresh_session_chat_runtime_endpoints(
        &mut self,
        force: bool,
        cx: &mut gpui::Context<Self>,
    ) {
        // CDXC:RemoteMachines 2026-09-23 WHY:
        // Reconnecting can replace the SSH forward port while native chat views remain alive. Refresh their mutation/upload target alongside the shared read broker, including parked views, without recreating controllers or drafts.
        let native_views = self
            .native_chat_views
            .values()
            .chain(
                self.parked_agents_chat_runtimes_by_project
                    .values()
                    .flat_map(|parked| parked.native_views.values()),
            )
            .cloned()
            .collect::<Vec<_>>();
        for view in native_views {
            let machine_id = view.read(cx).config.machine_id.clone();
            if machine_id == crate::app::gx_chat::LOCAL_MACHINE_ID {
                continue;
            }
            if let Some(target) = self.gpui_remote_gxserver_request_target(&machine_id) {
                view.update(cx, |view, _| view.config.remote = Some(target));
            }
        }
        let Some(epoch) = self.session_chat_broker_epoch.clone() else {
            return;
        };
        let Some(sidebar) = self.sidebar.clone() else {
            return;
        };
        let machines = self
            .session_chat_broker_endpoints
            .keys()
            .cloned()
            .collect::<Vec<_>>();
        for machine_id in machines {
            let endpoint = if machine_id == "local" {
                self.sidebar_gxserver_bootstrap
                    .as_ref()
                    .map(|bootstrap| (bootstrap.base_url.clone(), bootstrap.auth_token.clone()))
            } else {
                self.gpui_remote_gxserver_request_target(&machine_id)
                    .map(|target| {
                        (
                            format!("http://127.0.0.1:{}", target.local_port),
                            target.token,
                        )
                    })
            }
            .unwrap_or_default();
            if !force && self.session_chat_broker_endpoints.get(&machine_id) == Some(&endpoint) {
                continue;
            }
            let payload = serde_json::json!({"epoch":epoch,"method":"machineEndpoint","machineId":machine_id,"endpoint":{"baseUrl":endpoint.0,"authToken":endpoint.1}});
            self.session_chat_broker_endpoints
                .insert(machine_id, endpoint);
            sidebar.update(cx, |sidebar, _| {
                sidebar.execute_app_owned_script(&format!(
                    "window.ghostexGpui?.onSessionChatRuntimeRequest?.({payload}); undefined;"
                ));
            });
        }
    }

    pub(crate) fn receive_session_chat_runtime_broker(
        &mut self,
        message: &serde_json::Value,
        cx: &mut gpui::Context<Self>,
    ) {
        support_logs::append_for_scenario(
            support_logs::GpuiSupportLog::SessionChat,
            "gpui.sessionChat.viewState",
            "sessionChat.nativeBrokerResponse",
            serde_json::json!({
                "generation": message["generation"],
                "kind": message["kind"],
                "requestId": message["requestId"],
                "epochMatches": message["epoch"].as_str() == self.session_chat_broker_epoch.as_deref(),
                "hasFailure": message["error"].is_string(),
            }),
        );
        let Some(epoch) = message["epoch"]
            .as_str()
            .filter(|epoch| !epoch.is_empty() && epoch.len() < 100)
        else {
            return;
        };
        if message["kind"] == "ready" {
            if self.session_chat_broker_epoch.as_deref() == Some(epoch) {
                return;
            }
            self.session_chat_broker_epoch = Some(epoch.to_string());
            self.refresh_session_chat_runtime_endpoints(true, cx);
            let generations = self
                .agents_chat_page_states
                .values()
                .chain(
                    self.parked_agents_chat_runtimes_by_project
                        .values()
                        .flat_map(|parked| parked.page_states.values()),
                )
                .map(|state| state.generation)
                .collect::<Vec<_>>();
            for generation in generations {
                self.dispatch_session_chat_generation_response(
                    generation,
                    "onSessionChatRuntimeMessage",
                    &serde_json::json!({"kind":"reset"}),
                    false,
                    cx,
                );
            }
            return;
        }
        if self.session_chat_broker_epoch.as_deref() != Some(epoch) {
            return;
        }
        let Some(generation) = message["generation"]
            .as_str()
            .and_then(|value| value.parse::<u64>().ok())
        else {
            return;
        };
        if self.session_chat_runtime_key(generation).is_none() {
            return;
        }
        if let Some(raw) = message["raw"].as_str() {
            self.dispatch_session_chat_generation_event_raw(generation, raw.to_owned(), cx);
            return;
        }
        self.dispatch_session_chat_generation_response(
            generation,
            "onSessionChatRuntimeMessage",
            message,
            false,
            cx,
        );
    }
}
