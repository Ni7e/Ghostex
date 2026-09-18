use std::sync::atomic::Ordering;

use gpui::{Rgba, rgb};

use super::titlebar::CHROME_LIGHT_APPEARANCE;

/// CDXC:Theming 2026-09-13 DECISION:
/// User: titlebar dropdowns, the Browser header, companion pane chrome and command terminal tabs must work in light mode.
/// Use the resolved app appearance for both foregrounds and surfaces, independently of terminal content themes.
pub(crate) fn chrome_color(dark: u32, light: u32) -> Rgba {
    rgb(if CHROME_LIGHT_APPEARANCE.load(Ordering::Relaxed) {
        light
    } else {
        dark
    })
}

pub(crate) fn chrome_ink() -> Rgba {
    chrome_color(0xffffff, 0x000000)
}

/// CDXC:Theming 2026-09-13 SEE-ALSO:
/// apps/desktop/views/workarea-theme.ts consumes this appearance-only event in Docs, Kanban and Automate.
pub(crate) fn workarea_theme_script(light: bool) -> &'static str {
    if light {
        "window.ghostexGpui = window.ghostexGpui || {}; window.ghostexGpui.workareaTheme = 'light'; window.dispatchEvent(new CustomEvent('ghostex-workarea-theme-changed', {detail: 'light'}));"
    } else {
        "window.ghostexGpui = window.ghostexGpui || {}; window.ghostexGpui.workareaTheme = 'dark'; window.dispatchEvent(new CustomEvent('ghostex-workarea-theme-changed', {detail: 'dark'}));"
    }
}

/// CDXC:Theming 2026-09-13 DECISION:
/// User: the background before a pane loads must be white in light mode.
/// CEF's initial paint and the native placeholder must agree to avoid a dark flash before page content arrives.
pub(crate) fn pane_prepaint_background_color() -> u32 {
    if CHROME_LIGHT_APPEARANCE.load(Ordering::Relaxed) {
        0xffffffff
    } else {
        crate::app::consts::CEF_DARK_PREPAINT_BACKGROUND_COLOR
    }
}
