//! The regions of the window's top band that move the window when dragged.

use std::sync::Mutex;

use gpui::InteractiveElement;
use gpui::MouseButton;
use gpui::WindowControlArea;

/// Where a left press landed on a drag region that has not moved the window yet. One slot serves
/// every region: there is one pointer.
static WINDOW_DRAG_PRESS: Mutex<Option<gpui::Point<gpui::Pixels>>> = Mutex::new(None);

/// How far the pointer travels before a press becomes a window move, so a click that wobbles on a
/// control inside a region stays a click.
const WINDOW_DRAG_THRESHOLD: f32 = 3.0;

fn set_window_drag_press(press: Option<gpui::Point<gpui::Pixels>>) {
    if let Ok(mut slot) = WINDOW_DRAG_PRESS.lock() {
        *slot = press;
    }
}

#[cfg(target_os = "macos")]
fn window_drag_is_app_owned(_window: &gpui::Window) -> bool {
    true
}

#[cfg(target_os = "linux")]
fn window_drag_is_app_owned(window: &gpui::Window) -> bool {
    matches!(
        window.window_decorations(),
        gpui::Decorations::Client { .. }
    )
}

#[cfg(target_os = "windows")]
fn window_drag_is_app_owned(_window: &gpui::Window) -> bool {
    false
}

/// CDXC:Titlebar 2026-09-21 WHY:
/// The view tab strip sits in the window's top band, and on macOS AppKit moved the window from any
/// drag that started in that band, so dragging a tab to reorder it dragged the window instead.
/// Reporting only the tabs' rectangle to AppKit as app-owned was tried and did not stop it, so the
/// main window owns its titlebar drag outright (`app_owns_titlebar_drag` in main.rs) and the band's
/// empty regions hand the move to the platform themselves, the way the header already had to on
/// X11, which never reads GPUI's `WindowControlArea` hit boxes. The move starts once the
/// pointer has travelled a few pixels so clicks and the double-click zoom keep working. Controls inside a region
/// stop their own presses from reaching it, which is what keeps a tab drag a tab drag. Windows
/// resolves the same regions from the `Drag` hit test in the platform layer.
pub(crate) fn window_drag_region<E: InteractiveElement>(element: E) -> E {
    element
        .window_control_area(WindowControlArea::Drag)
        .on_mouse_down(MouseButton::Left, |event, window, _| {
            set_window_drag_press(window_drag_is_app_owned(window).then_some(event.position));
        })
        .on_mouse_up(MouseButton::Left, |_, _, _| set_window_drag_press(None))
        .on_mouse_move(|event, window, _| {
            let Some(press) = WINDOW_DRAG_PRESS.lock().ok().and_then(|slot| *slot) else {
                return;
            };
            // A release that some control swallowed leaves the press behind; without the button
            // still held there is no drag to hand over.
            if event.pressed_button != Some(MouseButton::Left) {
                set_window_drag_press(None);
                return;
            }
            if (event.position - press).magnitude() > f64::from(WINDOW_DRAG_THRESHOLD) {
                set_window_drag_press(None);
                window.start_window_move();
            }
        })
}
