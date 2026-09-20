use serde_json::{Value, json};

use crate::GhostexGpuiApp;

#[derive(Clone, Debug, PartialEq, gpui::Action)]
#[action(namespace = ghostex_gpui, no_json)]
pub(crate) struct NativeSidebarAction {
    pub(crate) command: Value,
}

impl GhostexGpuiApp {
    pub(crate) fn handle_native_sidebar_action(
        &mut self,
        action: &NativeSidebarAction,
        window: &mut gpui::Window,
        cx: &mut gpui::Context<Self>,
    ) {
        if action
            .command
            .get("type")
            .and_then(serde_json::Value::as_str)
            == Some("renameCollection")
        {
            if let Some(id) = action.command["collectionId"].as_str() {
                self.begin_native_collection_rename(id, window, cx);
            }
        } else if action.command["type"] == "renameGroup" {
            if let Some(id) = action.command["groupId"].as_str() {
                self.begin_native_sidebar_rename("group", id, window, cx);
            }
        } else if action.command["type"] == "confirmCloseGroup" {
            if let Some(id) = action.command["groupId"].as_str() {
                let id = id.to_owned();
                if let Some(group) =
                    self.native_sidebar.snapshot.as_ref().and_then(|snapshot| {
                        snapshot.groups.iter().find(|group| group.group_id == id)
                    })
                {
                    let detail = format!(
                        "This will close all {} sessions in {}.",
                        group.sessions.len(),
                        group.title
                    );
                    let answer = window.prompt(
                        gpui::PromptLevel::Warning,
                        "Close group?",
                        Some(&detail),
                        &["Cancel", "Close Group"],
                        cx,
                    );
                    cx.spawn(async move |app, cx| {
                        if answer.await == Ok(1) {
                            let _ = app.update(cx, |app, cx| {
                                app.dispatch_native_sidebar_command(
                                    json!({"type": "closeGroup", "groupId": id}),
                                    cx,
                                )
                            });
                        }
                    })
                    .detach();
                }
            }
        } else if action
            .command
            .get("type")
            .and_then(serde_json::Value::as_str)
            == Some("showMenu")
        {
            let coordinate = |key| {
                gpui::px(
                    action
                        .command
                        .get(key)
                        .and_then(serde_json::Value::as_f64)
                        .unwrap_or(0.0) as f32,
                )
            };
            let position = gpui::point(coordinate("x"), coordinate("y"));
            let scale = action
                .command
                .get("scale")
                .and_then(serde_json::Value::as_f64)
                .unwrap_or(1.0) as f32;
            Self::show_native_sidebar_menu(&action.command["items"], position, scale, window, cx);
        } else {
            self.dispatch_native_sidebar_ui(action.command.clone(), cx);
        }
    }

    pub(crate) fn dispatch_native_sidebar_command(
        &mut self,
        message: Value,
        cx: &mut gpui::Context<Self>,
    ) {
        self.dispatch_native_sidebar_ui(json!({"type": "command", "message": message}), cx);
    }

    pub(crate) fn dispatch_native_sidebar_ui(
        &mut self,
        command: Value,
        cx: &mut gpui::Context<Self>,
    ) {
        let Some(service) = self.sidebar.clone() else {
            return;
        };
        if command["type"] == "selectSession" && command["mode"] == "focus" {
            if let Some(session_id) = command["sessionId"].as_str() {
                crate::app::native_chat::diagnostics::focus_requested(session_id);
            }
            crate::support_logs::append(
                crate::support_logs::GpuiSupportLog::SidebarRefresh,
                "gpui.sidebar.focusRequested",
                json!({"sessionId": command["sessionId"], "epochMs": crate::support_logs::temporary_epoch_ms()}),
            );
        }
        self.stage_agent_launch_placeholder(&command, cx);
        // CDXC:Sidebar 2026-09-20 DECISION:
        // User: every interaction is a local state change plus one redraw. A command that moves the
        // sidebar's own state (collapse, Space, filters, hidden items, selection) moves the Rust
        // state here and the list is rebuilt in the same frame; the command is still sent on, and
        // the old projection keeps its own copy for the menus it owns until M4c.
        self.gx_store_note_sidebar_command(&command, cx);
        // A sidebar command can change focus in the runtime, so it must not be handled while the runtime still holds an older focus stamp than the store (gx_store/burst.rs).
        self.gx_store_flush_old_runtime_tell(cx);
        let script = format!("window.ghostexGpui.onNativeSidebarCommand({command}); undefined;");
        service.update(cx, |surface, _| {
            surface.execute_app_owned_script(&script);
        });
    }
}
