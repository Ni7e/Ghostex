//! Open, close, data, and sidebar bridge plumbing for the native Handoff / Export dialog.
//! SEE-ALSO: apps/desktop/src/app/window/export_transcript_modal.rs (the window entity and its decision record).
use crate::app::helpers::*;
use crate::app::window::*;
use crate::*;
use std::path::PathBuf;
use std::rc::Rc;

/// GPUI-owned replacement for the React dialog's `ghostex.exportTranscript.mode`
/// and `ghostex.exportTranscript.includeOptions` localStorage keys.
pub(crate) fn gpui_export_transcript_modal_prefs_path() -> PathBuf {
    ghostex_state_root().join("gpui-export-transcript-modal.json")
}

impl GhostexGpuiApp {
    /*
    CDXC:TranscriptExport 2026-09-15 WHY:
    The sidebar runtime still owns the session context, the gxserver export
    call (local and remote), the exported path, and the follow-up session
    creation. The native dialog therefore posts the same
    `runExportSessionTranscript`, `startExportedTranscriptConversation` and
    `cancelExportSessionTranscript` bridge commands the React page did and
    receives the same `exportSessionTranscriptResult` answer, so remote
    sessions keep working without a Rust tunnel client. Only the window and
    its rendering moved to GPUI.
    */
    /// Opens the native dialog for the sidebar's `open` message of the
    /// `exportTranscriptResult` modal kind.
    pub(crate) fn open_gpui_export_transcript_modal(
        &mut self,
        message: &serde_json::Value,
        cx: &mut gpui::Context<Self>,
    ) {
        let Some(request_id) = message
            .get("requestId")
            .and_then(serde_json::Value::as_str)
            .map(str::trim)
            .filter(|request_id| !request_id.is_empty() && request_id.chars().count() <= 128)
            .map(str::to_string)
        else {
            return;
        };
        let default_agent_id = message
            .get("agentId")
            .and_then(serde_json::Value::as_str)
            .map(str::trim)
            .filter(|agent_id| !agent_id.is_empty())
            .map(str::to_string);
        // One app modal at a time, like the shared React host window.
        self.remove_gpui_app_modal_window_without_focus_restore(cx);
        self.remove_gpui_export_transcript_modal_window(cx);
        let settings = shared_settings::shared_sidebar_settings_snapshot();
        let config = ExportTranscriptModalConfig {
            agents: self.gpui_export_transcript_prompt_agents(),
            default_agent_id,
            light: CHROME_LIGHT_APPEARANCE.load(std::sync::atomic::Ordering::Relaxed),
            sidebar_theme: settings
                .object()
                .get("sidebarTheme")
                .and_then(serde_json::Value::as_str)
                .map(str::to_string),
            prefs_path: Some(gpui_export_transcript_modal_prefs_path()),
            initial_mode: None,
        };
        let main_app = cx.weak_entity();
        // The dialog sends commands from inside its own window update, and the
        // result path reaches it from inside an app update, so the app is
        // always re-entered through `defer` rather than borrowed twice.
        let host: ExportTranscriptModalHost = Rc::new(move |command, cx: &mut App| {
            let main_app = main_app.clone();
            let request_id = request_id.clone();
            cx.defer(move |cx| {
                let _ = main_app.update(cx, |app, cx| {
                    app.handle_gpui_export_transcript_modal_command(&request_id, command, cx);
                });
            });
        });
        let window_size = size(
            px(EXPORT_TRANSCRIPT_MODAL_WIDTH),
            px(EXPORT_TRANSCRIPT_MODAL_INITIAL_HEIGHT),
        );
        let options = WindowOptions {
            window_bounds: Some(WindowBounds::Windowed(gpui::Bounds::centered_at(
                self.main_window_bounds.center(),
                window_size,
            ))),
            app_id: gpui_platform_window_app_id(),
            focus: true,
            icon: gpui_platform_window_icon(),
            show: true,
            is_resizable: false,
            is_minimizable: false,
            display_id: self.main_window_display_id,
            titlebar: None,
            ..Default::default()
        };
        self.export_transcript_modal_window = cx
            .open_window(options, move |window, cx| {
                window.set_window_title("");
                window.activate_window();
                cx.new(|cx| GpuiExportTranscriptModalWindow::new(config, host, window, cx))
            })
            .ok();
        // The cached HUD agents open the dialog instantly; a fresh read follows
        // and is pushed into the open dialog when it lands.
        self.refresh_gpui_new_thread_picker_agents(cx);
    }

    fn handle_gpui_export_transcript_modal_command(
        &mut self,
        request_id: &str,
        command: ExportTranscriptModalCommand,
        cx: &mut gpui::Context<Self>,
    ) {
        let mut message = serde_json::Map::new();
        message.insert("requestId".to_string(), serde_json::json!(request_id));
        match command {
            ExportTranscriptModalCommand::RunExport(include) => {
                message.insert(
                    "includeCommands".to_string(),
                    serde_json::json!(include.commands),
                );
                message.insert(
                    "includePatches".to_string(),
                    serde_json::json!(include.patches),
                );
                message.insert(
                    "includeReasoning".to_string(),
                    serde_json::json!(include.reasoning),
                );
                if !self.forward_gpui_export_transcript_modal_command_to_sidebar(
                    "runExportSessionTranscript",
                    &message,
                    cx,
                ) {
                    let result = serde_json::json!({
                        "error": "The sidebar runtime is not available.",
                        "ok": false,
                        "requestId": request_id,
                        "type": "exportSessionTranscriptResult",
                    });
                    let app = cx.entity();
                    cx.defer(move |cx| {
                        app.update(cx, |app, cx| {
                            app.receive_gpui_export_transcript_result(&result, cx);
                        });
                    });
                }
            }
            ExportTranscriptModalCommand::StartConversation { agent_id } => {
                message.insert("agentId".to_string(), serde_json::json!(agent_id));
                self.forward_gpui_export_transcript_modal_command_to_sidebar(
                    "startExportedTranscriptConversation",
                    &message,
                    cx,
                );
                self.release_gpui_export_transcript_modal_window();
            }
            ExportTranscriptModalCommand::Cancel => {
                self.forward_gpui_export_transcript_modal_command_to_sidebar(
                    "cancelExportSessionTranscript",
                    &message,
                    cx,
                );
                self.release_gpui_export_transcript_modal_window();
            }
            ExportTranscriptModalCommand::Reveal => {
                self.reveal_gpui_exported_transcript(cx);
                self.release_gpui_export_transcript_modal_window();
            }
        }
    }

    /// Drops the handle after the dialog removed its own window.
    pub(crate) fn release_gpui_export_transcript_modal_window(&mut self) {
        self.export_transcript_modal_window = None;
        self.pending_export_transcript_reveal_path = None;
    }

    /// Removes a live dialog window: another app modal is opening, or a new
    /// export request replaces the current one.
    pub(crate) fn remove_gpui_export_transcript_modal_window(
        &mut self,
        cx: &mut gpui::Context<Self>,
    ) -> bool {
        let Some(handle) = self.export_transcript_modal_window.take() else {
            return false;
        };
        self.pending_export_transcript_reveal_path = None;
        handle
            .update(cx, |_modal, window, _cx| {
                window.remove_window();
            })
            .is_ok()
    }

    /// Delivers the sidebar runtime's sanitized `exportSessionTranscriptResult`
    /// to the native dialog. Returns false when no native dialog is open so the
    /// caller can hand the result to the React modal host instead.
    pub(crate) fn receive_gpui_export_transcript_result(
        &mut self,
        result: &serde_json::Value,
        cx: &mut gpui::Context<Self>,
    ) -> bool {
        let Some(handle) = self.export_transcript_modal_window else {
            return false;
        };
        let text = |key: &str| {
            result
                .get(key)
                .and_then(serde_json::Value::as_str)
                .map(str::trim)
                .filter(|value| !value.is_empty())
                .map(str::to_string)
        };
        let ok = result.get("ok").and_then(serde_json::Value::as_bool) == Some(true);
        let can_reveal = result.get("canReveal").and_then(serde_json::Value::as_bool) == Some(true);
        let (path, agent_id, error) = (text("path"), text("agentId"), text("error"));
        let delivered = handle
            .update(cx, |modal, window, cx| {
                modal.receive_result(ok, path, can_reveal, agent_id, error, window, cx);
            })
            .is_ok();
        if !delivered {
            self.release_gpui_export_transcript_modal_window();
        }
        delivered
    }

    /// The configured agents that can take the handoff: the sidebar HUD
    /// buttons with a launch command, the same filter the React dialog applies.
    pub(crate) fn gpui_export_transcript_prompt_agents(&self) -> Vec<ExportTranscriptAgent> {
        self.new_thread_picker_agents
            .as_deref()
            .unwrap_or(&[])
            .iter()
            .filter_map(|value| {
                let field = |key: &str| {
                    value
                        .get(key)
                        .and_then(serde_json::Value::as_str)
                        .map(str::trim)
                        .filter(|text| !text.is_empty())
                        .map(str::to_string)
                };
                field("command")?;
                Some(ExportTranscriptAgent {
                    agent_id: field("agentId")?,
                    name: field("name")?,
                })
            })
            .collect()
    }

    /// Pushes a refreshed HUD agent list into the open dialog.
    pub(crate) fn push_gpui_export_transcript_modal_agents(
        &mut self,
        cx: &mut gpui::Context<Self>,
    ) {
        let Some(handle) = self.export_transcript_modal_window else {
            return;
        };
        let agents = self.gpui_export_transcript_prompt_agents();
        if handle
            .update(cx, |modal, _window, cx| modal.set_agents(agents, cx))
            .is_err()
        {
            self.release_gpui_export_transcript_modal_window();
        }
    }
}
