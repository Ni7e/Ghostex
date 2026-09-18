use gpui::{Hsla, rgb};
use serde_json::Value;

use crate::app::helpers::*;

#[derive(Clone)]
pub(crate) struct SidebarAppearance {
    pub(crate) light: bool,
    pub(crate) session_selected: Hsla,
    pub(crate) session_outline: Hsla,
    pub(crate) tooltip_delay: std::time::Duration,
    pub(crate) selected_outline: Hsla,
    pub(crate) selected_highlight: Hsla,
    pub(crate) foreground: Hsla,
    pub(crate) muted: Hsla,
    pub(crate) selected: Hsla,
    pub(crate) hover: Hsla,
    pub(crate) session_hover: Hsla,
    pub(crate) visible: Hsla,
    pub(crate) scale: f32,
}

impl SidebarAppearance {
    pub(crate) fn from_hud(hud: &Value) -> Self {
        let scale = hud
            .get("agentManagerZoomPercent")
            .and_then(Value::as_f64)
            .unwrap_or(100.0) as f32
            / 100.0;
        let light = hud["settings"]
            .as_object()
            .is_some_and(sidebar_uses_light_theme);
        let base = titlebar_background().blend(rgb(0).opacity(0.04).into());
        let foreground = titlebar_active_text_color();
        Self {
            light,
            session_selected: if light {
                rgb(0xe7e7e7).into()
            } else {
                rgb(0xffffff).opacity(0.12).into()
            },
            session_outline: chrome_ink().opacity(if light { 0.22 } else { 0.08 }).into(),
            tooltip_delay: std::time::Duration::from_millis(
                hud["settings"]["sidebarTooltipDelayMs"]
                    .as_u64()
                    .unwrap_or(500),
            ),
            foreground: chrome_color(0xb4b8c0, 0x262626).into(),
            muted: chrome_color(0x7c828c, 0x6b7280).into(),
            selected: rgb(0xffffff).opacity(if light { 1.0 } else { 0.12 }).into(),
            selected_outline: chrome_ink().opacity(if light { 0.12 } else { 0.08 }).into(),
            selected_highlight: rgb(0xffffff).opacity(if light { 0.6 } else { 0.04 }).into(),
            hover: rgb(0x808080).opacity(0.12).into(),
            session_hover: base.blend(foreground.opacity(if light { 0.12 } else { 0.22 })),
            visible: if light {
                base.blend(foreground.opacity(0.06))
            } else {
                base.blend(foreground.opacity(0.30))
                    .blend(rgb(0).opacity(0.40).into())
            },
            scale,
        }
    }
}
