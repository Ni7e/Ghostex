//! Moving the chat's open child windows after the pane they cover or anchor to moved.

use super::state::NativeChatView;
use gpui::{Bounds, Context, Pixels};

impl NativeChatView {
    pub(crate) fn active_child_window_source(&self, cx: &gpui::App) -> Option<gpui::WindowId> {
        let source = self.main_window?.window_id();
        let children = [
            self.image_viewer.handle.map(|handle| handle.window_id()),
            self.save_markdown_window
                .handle
                .map(|handle| handle.window_id()),
            self.rewind_window.handle.map(|handle| handle.window_id()),
            self.context_editor_window
                .handle
                .map(|handle| handle.window_id()),
            self.maximized_window.map(|handle| handle.window_id()),
            self.model_picker_window.window_id(),
        ];
        if let Some(menu_source) = self.active_option_menu_source(cx)
            && (menu_source == source || children.contains(&Some(menu_source)))
        {
            return Some(source);
        }
        children
            .contains(&Some(cx.active_window()?.window_id()))
            .then_some(source)
    }

    /// CDXC:SessionChat 2026-09-19 DECISION:
    /// User: an open image preview or quick picker is dismissed when the user switches to another session. Both are native child windows that would otherwise stay on screen over the session shown next.
    pub(crate) fn dismiss_windows_for_hidden_pane(&mut self, cx: &mut Context<Self>) {
        self.close_image_viewer(cx);
        self.dismiss_model_picker_for_hidden_pane(cx);
    }

    pub(super) fn pane_windows_open(&self) -> bool {
        self.image_viewer.handle.is_some()
            || self.save_markdown_window.handle.is_some()
            || self.rewind_window.handle.is_some()
            || self.context_editor_window.handle.is_some()
            || self.maximized_window.is_some()
    }

    /// Keep every pane-covering child window on the pane after the pane was resized or moved;
    /// React draws these as overlays inside the pane, so they follow it for free.
    pub(super) fn follow_pane_windows(&mut self, cx: &mut Context<Self>) {
        let pane = self.bounds.get();
        let parent = self.config.parent_native_view;
        let scale = super::appearance::ChatAppearance::current(&self.snapshot).scale;
        let windows: [Option<(gpui::AnyWindowHandle, Bounds<Pixels>)>; 5] = [
            self.image_viewer.handle.map(|handle| (handle.into(), pane)),
            self.save_markdown_window
                .handle
                .map(|handle| (handle.into(), pane)),
            self.rewind_window
                .handle
                .map(|handle| (handle.into(), pane)),
            self.context_editor_window.handle.map(|handle| {
                (
                    handle.into(),
                    super::context_editor::context_editor_frame(pane, scale),
                )
            }),
            self.maximized_window.map(|handle| (handle.into(), pane)),
        ];
        for (handle, frame) in windows.into_iter().flatten() {
            if !move_child_window(handle, parent, frame, cx) {
                // GPUI has no cross-platform way to move a window, so elsewhere it keeps its
                // origin and only takes the pane's size.
                let _ = handle.update(cx, |_, window, _| window.resize(frame.size));
            }
        }
    }
}

/// The chat window's content area in screen coordinates, which is what element bounds and child
/// window frames are measured from. Chat Lab's regular macOS titlebar sits outside it; the app's
/// own windows draw under their titlebar, so there the two are the same.
pub(super) fn content_bounds(window: &gpui::Window) -> Bounds<Pixels> {
    let bounds = window.bounds();
    #[cfg(target_os = "macos")]
    let bounds = Bounds::from_corners(
        bounds.origin
            + gpui::point(
                gpui::px(0.0),
                (bounds.size.height - window.viewport_size().height).max(gpui::px(0.0)),
            ),
        bounds.bottom_right(),
    );
    bounds
}

/// Move an open child window to `frame`, given in the chat window's content coordinates. False
/// when the window is gone or this platform cannot move it.
///
/// CDXC:SessionChat 2026-09-19 WHY:
/// AppKit reports the new size to GPUI synchronously from `setFrame:`, and GPUI drops that report while the app is borrowed, which left a child window moved from inside an update painting at its old size inside its new frame. The frame is therefore set from a task that runs outside any app update, the way GPUI's own `Window::resize` does.
#[cfg(target_os = "macos")]
pub(super) fn move_child_window(
    handle: gpui::AnyWindowHandle,
    parent: *mut std::ffi::c_void,
    frame: Bounds<Pixels>,
    cx: &mut gpui::App,
) -> bool {
    use raw_window_handle::{HasWindowHandle, RawWindowHandle};
    unsafe extern "C" {
        fn GhostexGpuiSetChildWindowContentFrame(
            child_native_view: *mut std::ffi::c_void,
            main_native_view: *mut std::ffi::c_void,
            x: f64,
            y: f64,
            width: f64,
            height: f64,
        );
    }
    fn native_view(window: &gpui::Window) -> Option<*mut std::ffi::c_void> {
        match HasWindowHandle::window_handle(window).ok()?.as_raw() {
            RawWindowHandle::AppKit(handle) => Some(handle.ns_view.as_ptr()),
            _ => None,
        }
    }
    if !matches!(
        handle.update(cx, |_, window, _| native_view(window)),
        Ok(Some(_))
    ) {
        return false;
    }
    cx.spawn(async move |cx| {
        let Ok(Some(view)) = handle.update(cx, |_, window, _| native_view(window)) else {
            return;
        };
        unsafe {
            GhostexGpuiSetChildWindowContentFrame(
                view,
                parent,
                f64::from(frame.origin.x.as_f32()),
                f64::from(frame.origin.y.as_f32()),
                f64::from(frame.size.width.as_f32()),
                f64::from(frame.size.height.as_f32()),
            );
        }
    })
    .detach();
    true
}

#[cfg(not(target_os = "macos"))]
pub(super) fn move_child_window(
    _: gpui::AnyWindowHandle,
    _: *mut std::ffi::c_void,
    _: Bounds<Pixels>,
    _: &mut gpui::App,
) -> bool {
    false
}
