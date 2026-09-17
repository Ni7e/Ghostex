use crate::app::helpers::gpui_session_chat_uses_light_theme;
use gpui::{Hsla, rgb};

#[derive(Clone)]
pub(crate) struct ChatAppearance {
    pub(crate) background: Hsla,
    pub(crate) foreground: Hsla,
    pub(crate) primary: Hsla,
    pub(crate) muted: Hsla,
    pub(crate) border: Hsla,
    pub(crate) input: Hsla,
    pub(crate) composer_border: Hsla,
    pub(crate) composer_background: Hsla,
    pub(crate) scale: f32,
    pub(crate) font: String,
    pub(crate) light: bool,
    pub(crate) verbose: bool,
    pub(crate) simple: bool,
    pub(crate) file_previews: bool,
    pub(crate) transcript_width: Option<f32>,
}

impl ChatAppearance {
    pub(crate) fn current(state: &serde_json::Value) -> Self {
        let snapshot = crate::shared_settings::shared_sidebar_settings_snapshot();
        let settings = state["previewSettings"].as_object().unwrap_or_else(|| snapshot.object());
        let light = gpui_session_chat_uses_light_theme(settings);
        let color = |dark, light_color| rgb(if light { light_color } else { dark }).into();
        let enabled = |name| settings.get(name).and_then(serde_json::Value::as_bool) == Some(true);
        Self {
            background: color(0x0d0d0d, 0xfcfcfc),
            foreground: color(0xfcfcfc, 0x27272a),
            primary: color(0xb4b8c0, 0x4d4d50),
            muted: color(0x9e9e9e, 0x71717b),
            border: color(0x1c1c1c, 0xe4e4e7),
            input: color(0x141414, 0xf4f4f5),
            composer_border: color(0x202020, 0xebebeb),
            composer_background: color(0x141414, 0xffffff),
            scale: settings
                .get("sessionChatZoomPercent")
                .and_then(serde_json::Value::as_f64)
                .unwrap_or(100.0) as f32
                / 100.0,
            font: settings
                .get("sessionChatFontFamily")
                .and_then(serde_json::Value::as_str)
                .filter(|value| !value.trim().is_empty())
                .unwrap_or("DM Sans")
                .to_string(),
            light,
            verbose: state["verboseOverride"]
                .as_bool()
                .unwrap_or_else(|| enabled("sessionChatVerboseMode")),
            simple: enabled("sessionChatSimpleMode"),
            file_previews: enabled("sessionChatFileEditPreviews"),
            transcript_width: enabled("sessionChatCustomTranscriptWidthEnabled").then(|| {
                settings
                    .get("sessionChatTranscriptWidthPercent")
                    .and_then(serde_json::Value::as_f64)
                    .unwrap_or(75.0) as f32
                    / 100.0
            }),
        }
    }
}
