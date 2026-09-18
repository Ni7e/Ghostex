use super::*;

/// CDXC:SessionChat 2026-09-13 WHY:
/// Chat measures selections, transcript rows, and composer insets in browser CSS pixels.
/// Use Chromium page zoom so those measurements and popup positioning share the same coordinate system.
/// SEE-ALSO: packages/shared/ghostex-settings/types.ts owns the matching percentage range and step.
#[derive(Default)]
pub(crate) struct SessionChatZoom {
    applied_default_percent: Cell<Option<u8>>,
}

impl SessionChatZoom {
    pub(crate) fn refresh(&self, browser: &cef::Browser, force: bool) {
        let Some(frame) = browser.main_frame() else {
            return;
        };
        // Initial activation can arrive before navigation leaves about:blank.
        if !is_gpui_first_party_cef_entry_url(
            &CefString::from(&frame.url()).to_string(),
            "chat.html",
        ) {
            return;
        }
        let snapshot = crate::shared_settings::shared_sidebar_settings_snapshot();
        let percent = snapshot
            .object()
            .get("sessionChatZoomPercent")
            .and_then(serde_json::Value::as_f64)
            .unwrap_or(100.0)
            .clamp(70.0, 200.0);
        let percent = ((percent / 5.0).round() * 5.0) as u8;
        // An unrelated Settings save must preserve a chat's temporary keyboard zoom.
        if !force && self.applied_default_percent.get() == Some(percent) {
            return;
        }
        let Some(host) = browser.host() else {
            return;
        };
        host.set_zoom_level((f64::from(percent) / 100.0).ln() / 1.2_f64.ln());
        self.applied_default_percent.set(Some(percent));
    }
}
