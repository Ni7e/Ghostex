use crate::*;
use futures::StreamExt as _;
use ghostex_chat_runtime::ServiceWorker;
use serde_json::{Value, json};

pub(crate) struct NativeService {
    runtime: ServiceWorker,
    sidebar_handler: cef::SidebarBridgeEventHandler,
    host_handler: cef::AppModalHostBridgeEventHandler,
}

impl NativeService {
    pub(crate) fn new(
        settings: cef::SidebarRuntimeSettingsSnapshot,
        bootstrap: Option<cef::SidebarGxserverBootstrap>,
        sidebar_handler: cef::SidebarBridgeEventHandler,
        host_handler: cef::AppModalHostBridgeEventHandler,
        cx: &mut gpui::App,
    ) -> Result<Entity<Self>, String> {
        let config = json!({
            "legacyProfile": std::env::var_os("GHOSTEX_GPUI_CEF_CACHE_DIR").map(std::path::PathBuf::from).unwrap_or_else(|| shared_settings::ghostex_storage_paths().cef_cache_dir()).join("Default"),
            "runtimeSettings": Self::settings(&settings),
            "gxserverBootstrap": Self::bootstrap(bootstrap.as_ref()),
            "bridgeFunctions": cef::sidebar_bridge_manifest::SIDEBAR_BRIDGE_FUNCTION_SPECS.iter().map(|spec|spec.js_function_name).collect::<Vec<_>>(),
        });
        let path = shared_settings::ghostex_storage_paths()
            .state_dir
            .join("client-storage.sqlite3");
        let (wake, mut wakes) = futures::channel::mpsc::unbounded();
        let runtime = ServiceWorker::start(config, path, move || {
            let _ = wake.unbounded_send(());
        })
        .map_err(|error| error.to_string())?;
        Ok(cx.new(|cx: &mut gpui::Context<Self>| {
            cx.spawn(async move |service, cx| {
                while wakes.next().await.is_some() {
                    if service.update(cx, |service, _| service.pump()).is_err() {
                        break;
                    }
                }
            })
            .detach();
            Self {
                runtime,
                sidebar_handler,
                host_handler,
            }
        }))
    }

    fn pump(&mut self) {
        for result in self.runtime.drain_ready() {
            match result {
                Ok(message) => match message["kind"].as_str() {
                    Some("sidebar") => {
                        if let Some(event) = cef::sidebar_event_for_function(
                            message["name"].as_str().unwrap_or_default(),
                            message["payload"].as_str().unwrap_or_default().to_owned(),
                        ) {
                            (self.sidebar_handler)(event);
                        }
                    }
                    Some("nativeHost") => {
                        (self.host_handler)(cef::AppModalHostBridgeEvent::NativeHostMessage(
                            message["message"].to_string(),
                        ))
                    }
                    Some("modalHost") => (self.host_handler)(
                        cef::AppModalHostBridgeEvent::Message(message["message"].to_string()),
                    ),
                    Some("log") if message["level"] == "error" || message["level"] == "warn" => {
                        Self::report(message["message"].as_str().unwrap_or_default())
                    }
                    _ => {}
                },
                Err(error) => Self::report(&error.to_string()),
            }
        }
    }
    fn report(error: &str) {
        support_logs::append(
            support_logs::GpuiSupportLog::CrashReports,
            "gpui.nativeService.error",
            json!({"error":error.lines().next().unwrap_or_default(),"stack":error.lines().skip(1).take(12).collect::<Vec<_>>()}),
        );
    }
    pub(crate) fn execute_app_owned_script(&mut self, source: &str) -> bool {
        match self.runtime.evaluate(source) {
            Ok(()) => true,
            Err(error) => {
                Self::report(&error.to_string());
                false
            }
        }
    }
    pub(crate) fn refresh_sidebar_runtime_settings(
        &mut self,
        settings: cef::SidebarRuntimeSettingsSnapshot,
    ) {
        let settings = Self::settings(&settings);
        self.execute_app_owned_script(&format!("window.ghostexGpui.runtimeSettings = {settings}; window.ghostexGpui.onRuntimeSettingsChanged?.({settings}); void 0;"));
    }
    pub(crate) fn refresh_sidebar_gxserver_bootstrap(
        &mut self,
        bootstrap: Option<cef::SidebarGxserverBootstrap>,
    ) {
        let bootstrap = Self::bootstrap(bootstrap.as_ref());
        self.execute_app_owned_script(&format!("window.ghostexGpui.gxserverBootstrap = {bootstrap}; window.ghostexGpui.onGxserverBootstrapChanged?.({bootstrap}); void 0;"));
    }
    fn settings(settings: &cef::SidebarRuntimeSettingsSnapshot) -> Value {
        json!({"debuggingMode":settings.debugging_mode,"showBetaFeatures":settings.show_beta_features,"settings":serde_json::from_str::<Value>(&settings.saved_settings_json).unwrap_or_else(|_| json!({}))})
    }
    fn bootstrap(bootstrap: Option<&cef::SidebarGxserverBootstrap>) -> Value {
        bootstrap.map(|b| json!({"baseUrl":b.base_url,"authToken":b.auth_token,"protocolVersion":b.protocol_version,"clientId":b.client_id,"initialActiveProjectId":b.initial_active_project_id,"focusedSessionId":b.focused_session_id,"visibleSessionIds":b.visible_session_ids})).unwrap_or_else(||json!({}))
    }
}
