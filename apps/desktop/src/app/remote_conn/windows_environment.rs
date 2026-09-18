use crate::*;

impl GhostexGpuiApp {
    /// CDXC:Settings 2026-09-14 DECISION:
    /// User: switching between WSL and PowerShell should show a dialog to restart the app.
    pub(crate) fn prompt_windows_environment_restart_after_settings_save(
        &mut self,
        previous: &serde_json::Map<String, serde_json::Value>,
        next: &serde_json::Map<String, serde_json::Value>,
        cx: &mut gpui::Context<Self>,
    ) {
        let is_wsl = |settings: &serde_json::Map<String, serde_json::Value>| {
            settings
                .get("windowsTerminalBackend")
                .and_then(serde_json::Value::as_str)
                == Some("wsl")
        };
        if is_wsl(previous) == is_wsl(next) {
            return;
        }
        let environment = if is_wsl(next) { "WSL" } else { "PowerShell" };
        let detail = format!(
            "Your Windows environment has been saved as {environment}. Restart Ghostex to apply it. Existing sessions stay in their original environment."
        );
        cx.spawn(async move |this, cx| {
            let Ok(receiver) = this.update_in(cx, |_, window, cx| {
                window.prompt(
                    gpui::PromptLevel::Info,
                    "Restart Ghostex?",
                    Some(detail.as_str()),
                    &[
                        gpui::PromptButton::Ok("Restart now".into()),
                        gpui::PromptButton::Cancel("Later".into()),
                    ],
                    cx,
                )
            }) else {
                return;
            };
            if receiver.await == Ok(0) {
                let _ = this.update(cx, |_, cx| {
                    cx.dispatch_action(&RestartGhostexGpui);
                });
            }
        })
        .detach();
    }
}
