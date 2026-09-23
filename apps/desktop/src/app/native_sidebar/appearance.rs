use gpui::{Hsla, Window, rgb};
use serde_json::Value;

use crate::app::helpers::*;

#[derive(Clone)]
pub(crate) struct SidebarAppearance {
    pub(crate) light: bool,
    /// Whether this sidebar sits on window glass: only in the main window, never in the floating
    /// reveal panel, which is an opaque window of its own.
    pub(crate) glass: bool,
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
    pub(crate) fn from_hud(hud: &Value, window: &Window) -> Self {
        let scale = hud
            .get("agentManagerZoomPercent")
            .and_then(Value::as_f64)
            .unwrap_or(100.0) as f32
            / 100.0
            * sidebar_content_scale(window);
        let light = hud["settings"]
            .as_object()
            .is_some_and(sidebar_uses_light_theme);
        let base = titlebar_background().blend(rgb(0).opacity(0.04).into());
        let glass = window_glass_active_in(window);
        let foreground = titlebar_active_text_color();
        Self {
            light,
            glass,
            session_selected: if light {
                rgb(0xe7e7e7).into()
            } else {
                rgb(0xffffff).opacity(0.12).into()
            },
            session_outline: chrome_ink().opacity(if light { 0.22 } else { 0.08 }).into(),
            tooltip_delay: tooltip_delay_from_hud(hud),
            foreground: chrome_color(0xb4b8c0, 0x262626).into(),
            muted: chrome_color(0x7c828c, 0x6b7280).into(),
            selected: rgb(0xffffff).opacity(if light { 1.0 } else { 0.12 }).into(),
            selected_outline: chrome_ink().opacity(if light { 0.12 } else { 0.08 }).into(),
            selected_highlight: rgb(0xffffff).opacity(if light { 0.6 } else { 0.04 }).into(),
            hover: rgb(0x808080).opacity(0.12).into(),
            // Under window glass these are washes of the same ink rather than opaque blends of the
            // chrome colour, which would sit on the frosted sidebar as solid slabs.
            session_hover: if glass {
                foreground.opacity(if light { 0.12 } else { 0.16 })
            } else {
                base.blend(foreground.opacity(if light { 0.12 } else { 0.22 }))
            },
            visible: if glass {
                foreground.opacity(if light { 0.06 } else { 0.12 })
            } else if light {
                base.blend(foreground.opacity(0.06))
            } else {
                base.blend(foreground.opacity(0.30))
                    .blend(rgb(0).opacity(0.40).into())
            },
            scale,
        }
    }
}

fn tooltip_delay_from_hud(hud: &Value) -> std::time::Duration {
    std::time::Duration::from_millis(
        hud["settings"]["sidebarTooltipDelayMs"]
            .as_u64()
            .unwrap_or(500),
    )
}

impl crate::GhostexGpuiApp {
    /// The user's Tooltip Delay setting, for native chrome outside the sidebar
    /// that must wait as long as the sidebar's own tooltips do.
    pub(crate) fn configured_tooltip_delay(&self) -> std::time::Duration {
        match self.native_sidebar.snapshot.as_ref() {
            Some(snapshot) => tooltip_delay_from_hud(&snapshot.hud),
            None => tooltip_delay_from_hud(&Value::Null),
        }
    }
}

/// CDXC:Sidebar 2026-09-18 WHY:
/// Linux GPUI can infer 133% scaling from monitor dimensions while Chromium uses 100%, making the same sidebar and menu metrics one-third larger after native rendering.
/// Convert Chromium display units to GPUI units so fonts, rows, menus, and drag previews retain the embedded sidebar's physical size while preserving the user's zoom setting.
fn sidebar_content_scale(window: &Window) -> f32 {
    #[cfg(target_os = "linux")]
    {
        use ::cef::ImplDisplay;

        let scale = window.scale_factor();
        let bounds = window.bounds();
        let bounds = ::cef::Rect {
            x: (bounds.origin.x.as_f32() * scale).round() as i32,
            y: (bounds.origin.y.as_f32() * scale).round() as i32,
            width: (bounds.size.width.as_f32() * scale).round() as i32,
            height: (bounds.size.height.as_f32() * scale).round() as i32,
        };
        // A missing display (CEF not initialised yet, or a window off every known screen) falls back to
        // GPUI's own scale: a panic here would take the whole render pass down with it.
        let Some(display) = ::cef::display_get_matching_bounds(Some(&bounds), 1) else {
            return 1.0;
        };
        let content_scale = display.device_scale_factor() / scale;
        if content_scale.is_finite() && content_scale > 0.0 {
            content_scale
        } else {
            1.0
        }
    }
    #[cfg(not(target_os = "linux"))]
    {
        let _ = window;
        1.0
    }
}
