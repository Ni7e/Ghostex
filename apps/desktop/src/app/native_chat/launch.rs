use super::state::{NativeChatConfig, NativeChatView};
use crate::*;
use serde_json::json;

impl GhostexGpuiApp {
    /// CDXC:AgentLauncher 2026-09-22 DECISION:
    /// User: launching an agent from the sidebar or the Cmd+Shift+T menu must open chat and accept typing instantly; terminal startup, agent launch, status line, model and account preparation all run in the background. The mounting tab now owns the real composer before gxserver assigns its session ID, and binding that ID keeps the same input and caret.
    pub(crate) fn stage_native_chat_launch(
        &mut self,
        shell_session_id: TerminalSessionId,
        project_id: &str,
        agent_id: &str,
        name: &str,
        icon: Option<&str>,
        cx: &mut gpui::Context<Self>,
    ) {
        let config = NativeChatConfig {
            machine_id: crate::app::gx_chat::LOCAL_MACHINE_ID.into(),
            project_id: project_id.into(),
            session_id: String::new(),
            sidebar_session_id: String::new(),
            shell_session_id,
            client_id: format!("native-desktop-{}", std::process::id()),
            remote: None,
            app: Some(cx.weak_entity()),
            preview: None,
            parent_native_view: self.parent_ns_view,
            initial_snapshot: None,
            initial_presentation: None,
        };
        let view = self.insert_native_chat(config, None, cx);
        view.update(cx, |view, cx| {
            view.snapshot = std::sync::Arc::new(json!({
                "status": "starting",
                "agent": agent_id,
                "sessionAgentId": agent_id,
                "composerPlaceholder": format!("Message {name}…"),
                "newSessionWelcome": {
                    "agentName": name,
                    "icon": icon,
                    "showTitle": true,
                    "title": format!("What should we build with {name}?")
                },
                "loadingStage": null
            }));
            view.focus_requested = true;
            cx.notify();
        });
    }
}

impl NativeChatView {
    pub(crate) fn bind_launched_session(
        &mut self,
        config: NativeChatConfig,
        cx: &mut gpui::Context<Self>,
    ) {
        self.config = config;
        self.runtime = Some(Self::start_runtime(&self.config, cx));
        cx.notify();
    }

    pub(super) fn retain_launch_welcome(&self, snapshot: &mut serde_json::Value) {
        if self.items.is_empty()
            && self.snapshot["newSessionWelcome"].is_object()
            && (snapshot["status"] == "loading" || snapshot["status"].is_null())
            && snapshot["error"].is_null()
        {
            snapshot["status"] = json!("starting");
            snapshot["loadingStage"] = serde_json::Value::Null;
            snapshot["newSessionWelcome"] = self.snapshot["newSessionWelcome"].clone();
        }
    }
}
