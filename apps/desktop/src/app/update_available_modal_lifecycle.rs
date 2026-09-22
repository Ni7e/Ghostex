//! Open and close plumbing for the native Ghostex Update dialog.
//! SEE-ALSO: apps/desktop/src/app/window/update_available_modal.rs (the window entity and its decision record), apps/desktop/src/app/os_integration/updater.rs (the Windows updater that opens it and runs its two actions), apps/desktop/src/app/native_app_modal_lifecycle.rs (the shared window path).
use crate::app::window::*;
use crate::*;

impl GhostexGpuiApp {
    /// Opens the native dialog for the `updateAvailable` open message the
    /// Windows and Linux updaters build (`open_windows_update_modal`, `open_linux_update_modal`). Refuses payloads
    /// the React host would have ignored: a missing version or an unknown state.
    pub(crate) fn open_gpui_update_available_modal(
        &mut self,
        message: &serde_json::Value,
        cx: &mut gpui::Context<Self>,
    ) {
        if message.get("modal").and_then(serde_json::Value::as_str)
            != Some(GpuiAppModalKind::UpdateAvailable.modal_id())
        {
            return;
        }
        let Some(version) = message
            .get("version")
            .and_then(serde_json::Value::as_str)
            .map(str::to_string)
        else {
            return;
        };
        let state = match message.get("state").and_then(serde_json::Value::as_str) {
            Some("available") => UpdateAvailableState::Available,
            Some("ready") => UpdateAvailableState::Ready,
            Some("notify") => UpdateAvailableState::Notify,
            _ => return,
        };
        let config = UpdateAvailableModalConfig {
            version,
            state,
            notes_markdown: message
                .get("notesMarkdown")
                .and_then(serde_json::Value::as_str)
                .unwrap_or_default()
                .to_string(),
            portable: message.get("portable").and_then(serde_json::Value::as_bool) == Some(true),
            palette: self.gpui_native_modal_palette(),
        };
        let host = self.native_app_modal_host(cx, |app, command, cx| {
            app.handle_gpui_update_available_modal_command(command, cx);
        });
        let mut height = UPDATE_AVAILABLE_MODAL_INITIAL_HEIGHT;
        if let Some(display) = cx
            .displays()
            .into_iter()
            .find(|display| Some(display.id()) == self.main_window_display_id)
        {
            let visible = display.visible_bounds();
            let center = self.main_window_bounds.center().y;
            let room = f32::from((center - visible.top()).min(visible.bottom() - center))
                - MODAL_SCROLL_FIT_SCREEN_MARGIN;
            if room > 0.0 {
                height = height.min(room * 2.0);
            }
        }
        self.open_native_app_modal(
            GpuiAppModalKind::UpdateAvailable,
            UPDATE_AVAILABLE_MODAL_WIDTH,
            height,
            move |window, cx| {
                cx.new(|cx| GpuiUpdateAvailableModalWindow::new(config, host, window, cx))
            },
            cx,
        );
    }

    /// The dialog has already removed its window. `Download` and `Restart`
    /// are the `downloadGhostexUpdate` / `restartAndUpdateGhostex` bridge
    /// commands the React page posted and exist only on Windows;
    /// `OpenDownloadPage` is the Linux dialog's one action.
    fn handle_gpui_update_available_modal_command(
        &mut self,
        command: UpdateAvailableModalCommand,
        cx: &mut gpui::Context<Self>,
    ) {
        let kind = GpuiAppModalKind::UpdateAvailable;
        self.release_native_app_modal_window(kind, cx);
        match command {
            UpdateAvailableModalCommand::Cancel => {}
            UpdateAvailableModalCommand::Download => {
                #[cfg(target_os = "windows")]
                self.download_windows_update(cx);
            }
            UpdateAvailableModalCommand::Restart => {
                #[cfg(target_os = "windows")]
                self.restart_and_apply_windows_update(cx);
            }
            UpdateAvailableModalCommand::OpenDownloadPage => {
                #[cfg(target_os = "linux")]
                self.open_linux_update_download_page(cx);
            }
        }
        #[cfg(not(any(target_os = "windows", target_os = "linux")))]
        let _ = cx;
    }
}
