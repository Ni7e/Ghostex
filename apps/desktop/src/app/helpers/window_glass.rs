//! Window glass: whether the main window shows the blurred desktop through its surfaces, and the
//! fills each layer paints so the tint is applied once instead of stacking into an opaque slab.

use std::sync::atomic::{AtomicBool, AtomicU8, AtomicU64, Ordering};

use gpui::{Context, Hsla, Window, WindowBackgroundAppearance};

use crate::GhostexGpuiApp;
use crate::app::helpers::*;

static WINDOW_GLASS_ACTIVE: AtomicBool = AtomicBool::new(false);

/// What the main window was last switched to: 0 nothing yet, 1 opaque, 2 blurred. GPUI has no
/// getter for the window's background appearance, and re-applying it every frame rebuilds the
/// window's AppKit backing state.
static APPLIED_MAIN_WINDOW_GLASS: AtomicU8 = AtomicU8::new(0);

/// Only the main window is blurred. Views that also render in their own windows (the chat) ask
/// with `window_glass_active_in` so they stay opaque there.
static MAIN_WINDOW_ID: AtomicU64 = AtomicU64::new(u64::MAX);

/// Coverage of the shell tint over the blurred desktop. Dark chrome is measured so white text and
/// the muted sidebar text keep their contrast even over a white desktop; light chrome needs more
/// because the desktop's colour bleeds through a light tint more readily.
const SHELL_GLASS_ALPHA_DARK: f32 = 0.80;
const SHELL_GLASS_ALPHA_LIGHT: f32 = 0.88;

/// Coverage of the workspace colour laid over the shell tint, which keeps the work area one step
/// darker than the sidebar the way the opaque theme does.
const WORKSPACE_GLASS_ALPHA: f32 = 0.40;

/// CDXC:Theming 2026-09-23 DECISION:
/// User: the whole desktop window can be frosted glass that shows the blurred desktop behind it, as its own setting rather than part of a theme. Automatic (the default) is frosted in dark mode and opaque in light mode, where glass has the weakest text contrast; Frosted and Opaque force one look.
///
/// CDXC:Theming 2026-09-23 WHY:
/// Only macOS gets a blurred backdrop here (Linux compositors cannot promise a blur, so glass there would expose the raw desktop), and the system Reduce Transparency setting always wins.
///
/// Returns whether the resolved state changed.
pub(crate) fn refresh_window_glass(object: &serde_json::Map<String, serde_json::Value>) -> bool {
    let light = CHROME_LIGHT_APPEARANCE.load(Ordering::Relaxed);
    let wanted = match object
        .get("windowGlass")
        .and_then(serde_json::Value::as_str)
    {
        Some("frosted") => true,
        Some("opaque") => false,
        _ => !light,
    };
    let active = cfg!(target_os = "macos") && wanted && !system_reduces_transparency();
    WINDOW_GLASS_ACTIVE.swap(active, Ordering::Relaxed) != active
}

#[cfg(target_os = "macos")]
fn system_reduces_transparency() -> bool {
    unsafe { GhostexGpuiAccessibilityDisplayShouldReduceTransparency() == 1 }
}

#[cfg(not(target_os = "macos"))]
fn system_reduces_transparency() -> bool {
    false
}

pub(crate) fn window_glass_active() -> bool {
    WINDOW_GLASS_ACTIVE.load(Ordering::Relaxed)
}

pub(crate) fn window_glass_active_in(window: &Window) -> bool {
    window_glass_active_for(Some(window.window_handle()))
}

/// `window_glass_active_in` for code that has only the handle a view recorded at its last render.
pub(crate) fn window_glass_active_for(window: Option<gpui::AnyWindowHandle>) -> bool {
    window_glass_active()
        && window.is_some_and(|window| {
            window.window_id().as_u64() == MAIN_WINDOW_ID.load(Ordering::Relaxed)
        })
}

pub(crate) fn window_glass_background_appearance() -> WindowBackgroundAppearance {
    if window_glass_active() {
        WindowBackgroundAppearance::Blurred
    } else {
        WindowBackgroundAppearance::Opaque
    }
}

impl GhostexGpuiApp {
    /// Puts the main window's compositing in line with the resolved glass state. Called from the
    /// root render, which is where settings saves, system appearance changes and Reduce
    /// Transparency all land. Terminals carry their background alpha in their own config, so a
    /// change reloads it after this frame.
    pub(crate) fn sync_main_window_glass(&mut self, window: &Window, cx: &mut Context<Self>) {
        MAIN_WINDOW_ID.store(
            window.window_handle().window_id().as_u64(),
            Ordering::Relaxed,
        );
        let wanted = window_glass_background_appearance();
        let code = if wanted == WindowBackgroundAppearance::Blurred {
            2
        } else {
            1
        };
        let previous = APPLIED_MAIN_WINDOW_GLASS.swap(code, Ordering::Relaxed);
        if previous == code {
            return;
        }
        window.set_background_appearance(wanted);
        if previous != 0 {
            cx.defer_in(window, |this, _window, cx| {
                this.reload_live_gpui_engine_terminal_config(cx);
            });
        }
    }
}

/// CDXC:Theming 2026-09-23 DECISION:
/// User: under window glass, view panel pages (Kanban, Automate, Docs, Code) are solid cards set a little in from the panel's edges, so a page that cannot be see-through reads as intentional against the glass. The opaque window keeps them edge to edge.
///
/// CDXC:Theming 2026-09-23 WHY:
/// A windowed CEF page cannot be made transparent (DevTools background override and clearing its layers were both tried) and cannot be rounded either: corner radius and a mask layer on the page's native views, all the way down to Chromium's own, left its corners square. So the card is square; do not retry those.
pub(crate) const VIEW_PANEL_GLASS_CARD_INSET: f32 = 6.0;

/// Fill coverage of a menu or popover window under glass; its own window blurs what is behind it.
pub(crate) const WINDOW_GLASS_MENU_ALPHA: f32 = 0.78;

/// The fill of a menu or panel that has a window of its own (the header's dropdowns): thinned under
/// glass, where that window blurs whatever is behind it.
pub(crate) fn popup_window_surface(color: Hsla) -> Hsla {
    if window_glass_active() {
        color.opacity(WINDOW_GLASS_MENU_ALPHA)
    } else {
        color
    }
}

/// The window's outermost fill. Under glass it is the one layer that tints the blurred desktop,
/// in the sidebar's chrome colour because the sidebar sits directly on it.
pub(crate) fn window_shell_background() -> Hsla {
    if !window_glass_active() {
        return workspace_background_color();
    }
    let alpha = if CHROME_LIGHT_APPEARANCE.load(Ordering::Relaxed) {
        SHELL_GLASS_ALPHA_LIGHT
    } else {
        SHELL_GLASS_ALPHA_DARK
    };
    titlebar_background().opacity(alpha)
}

/// The workspace column's fill, laid over the shell tint under glass.
pub(crate) fn workspace_column_background() -> Hsla {
    let workspace = workspace_background_color();
    if window_glass_active() {
        workspace.opacity(WORKSPACE_GLASS_ALPHA)
    } else {
        workspace
    }
}

/// Fills for surfaces inside the workspace column. Under glass the column has already tinted the
/// area, so another layer of the same colour would only make it opaque again.
pub(crate) fn workspace_nested_background() -> Hsla {
    if window_glass_active() {
        gpui::transparent_black()
    } else {
        workspace_background_color()
    }
}

/// A pane-level fill inside the workspace column (a chat host, a pane's base, the command pane's
/// chrome). Under glass it is left out so the column's tint is the only layer over the desktop.
pub(crate) fn glass_clear(color: Hsla) -> Hsla {
    if window_glass_active() {
        gpui::transparent_black()
    } else {
        color
    }
}

/// The body row behind the sidebar, its divider and the workspace column. Opaque, it is the
/// divider's colour showing between them; under glass the shell tint already covers that.
pub(crate) fn window_body_row_background() -> Hsla {
    if window_glass_active() {
        gpui::transparent_black()
    } else {
        sidebar_divider_background_color()
    }
}

/// The sidebar's own fill: its chrome gradient, or nothing under glass, where the shell tint
/// beneath it already is the sidebar's colour.
pub(crate) fn sidebar_chrome_fill(glass: bool, angle: f32) -> gpui::Background {
    if glass {
        gpui::transparent_black().into()
    } else {
        sidebar_chrome_gradient_fill(angle)
    }
}

/// How much of a terminal's default background it paints itself. Under glass the column tint shows
/// through instead; cells with an explicit background colour still paint it in full.
pub(crate) fn terminal_default_background_alpha() -> f32 {
    if window_glass_active() { 0.0 } else { 1.0 }
}
