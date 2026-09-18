use crate::*;
use gpui::{Subscription, WeakEntity, WindowHandle};
use std::ffi::c_void;

unsafe extern "C" {
    fn GhostexGpuiNativeSidebarRevealRequest(
        root: *mut c_void,
        width: f64,
        titlebar_height: f64,
        companion_hidden: bool,
        requested: bool,
        keep_under_pointer: bool,
    ) -> i32;
    fn GhostexGpuiNativeSidebarRevealUpdate(
        root: *mut c_void,
        popup: *mut c_void,
        enabled: bool,
        width: f64,
        titlebar_height: f64,
        requested: bool,
        sticky: bool,
    ) -> bool;
}

pub(crate) struct NativeSidebarReveal {
    pub(crate) window: WindowHandle<gpui_component::Root>,
    native_view: *mut c_void,
}

impl Drop for NativeSidebarReveal {
    fn drop(&mut self) {
        unsafe {
            GhostexGpuiNativeSidebarRevealUpdate(
                std::ptr::null_mut(),
                self.native_view,
                false,
                0.0,
                0.0,
                false,
                false,
            );
        }
    }
}

pub(crate) struct FloatingSidebarWindow {
    pub(crate) app: WeakEntity<GhostexGpuiApp>,
    _subscription: Subscription,
}

impl Render for FloatingSidebarWindow {
    fn render(&mut self, window: &mut Window, cx: &mut gpui::Context<Self>) -> impl IntoElement {
        let Some(app) = self.app.upgrade() else {
            return div().into_any_element();
        };
        app.update(cx, |app, cx| {
            let width = app.sidebar_width;
            let offset = window.bounds().size.width.as_f32() - width;
            div()
                .size_full()
                .overflow_hidden()
                .on_action(cx.listener(
                    |app, action: &super::actions::NativeSidebarAction, window, cx| {
                        app.handle_native_sidebar_action(action, window, cx)
                    },
                ))
                .child(
                    div()
                        .flex()
                        .w(px(width))
                        .h_full()
                        .ml(px(offset))
                        .child(app.render_native_sidebar(window, cx)),
                )
                .into_any_element()
        })
    }
}

impl GhostexGpuiApp {
    pub(crate) fn update_native_sidebar_reveal(
        &mut self,
        requested: bool,
        keep_under_pointer: bool,
        cx: &mut gpui::Context<Self>,
    ) {
        if !self.sidebar_collapsed {
            self.close_native_sidebar_reveal(cx);
            return;
        }
        if self.companion_reveal.is_some() {
            if requested {
                self.close_floating_companion(cx);
            } else {
                self.sync_floating_companion(cx);
                if self.companion_reveal.is_some() {
                    return;
                }
            }
        }
        if let Some(reveal) = self.native_sidebar.reveal.as_ref() {
            let visible = unsafe {
                GhostexGpuiNativeSidebarRevealUpdate(
                    self.parent_ns_view,
                    reveal.native_view,
                    true,
                    self.sidebar_width as f64,
                    TITLEBAR_HEIGHT as f64,
                    requested,
                    false,
                )
            };
            if !visible {
                self.close_native_sidebar_reveal(cx);
            }
            return;
        }
        let request = unsafe {
            GhostexGpuiNativeSidebarRevealRequest(
                self.parent_ns_view,
                self.sidebar_width as f64,
                TITLEBAR_HEIGHT as f64,
                self.active_mode.is_project_editor_mode()
                    && !self.project_editor_shell.left_companion_visible,
                requested,
                keep_under_pointer,
            )
        };
        match request {
            1 => self.open_native_sidebar_reveal(requested, keep_under_pointer, cx),
            2 => self.open_floating_companion(cx),
            _ => {}
        }
    }

    fn open_native_sidebar_reveal(
        &mut self,
        requested: bool,
        sticky: bool,
        cx: &mut gpui::Context<Self>,
    ) {
        let app = cx.weak_entity();
        gpui::App::defer(cx, move |cx| {
            let Some(app) = app.upgrade() else {
                return;
            };
            let options = {
                let this = app.read(cx);
                if this.native_sidebar.reveal.is_some() || !this.sidebar_collapsed {
                    return;
                }
                gpui::WindowOptions {
                    window_bounds: Some(gpui::WindowBounds::Windowed(Bounds::new(
                        this.main_window_bounds.origin,
                        size(
                            px(this.sidebar_width),
                            px(
                                (this.main_window_bounds.size.height.as_f32() - TITLEBAR_HEIGHT)
                                    .max(1.0),
                            ),
                        ),
                    ))),
                    display_id: this.main_window_display_id,
                    focus: false,
                    show: false,
                    kind: gpui::WindowKind::PopUp,
                    is_movable: false,
                    is_resizable: false,
                    is_minimizable: false,
                    titlebar: None,
                    ..Default::default()
                }
            };
            let observed = app.clone();
            let result = cx.open_window(options, move |window, cx| {
                let view = cx.new(|cx| FloatingSidebarWindow {
                    app: observed.downgrade(),
                    _subscription: cx.observe(&observed, |_, _, cx| cx.notify()),
                });
                cx.new(|cx| gpui_component::Root::new(view, window, cx))
            });
            let handle = match result {
                Ok(handle) => handle,
                Err(error) => {
                    app.update(cx, |app, cx| {
                        app.dispatch_gpui_app_modal_toast(
                            "warning",
                            "Sidebar unavailable",
                            &error.to_string(),
                            cx,
                        )
                    });
                    return;
                }
            };
            let native_view = handle
                .update(cx, |_, window, _| cef_parent_native_view(window))
                .ok()
                .and_then(Result::ok);
            let Some(native_view) = native_view else {
                let _ = handle.update(cx, |_, window, _| window.remove_window());
                return;
            };
            app.update(cx, |app, cx| {
                app.native_sidebar.reveal = Some(NativeSidebarReveal {
                    window: handle,
                    native_view,
                });
                let visible = unsafe {
                    GhostexGpuiNativeSidebarRevealUpdate(
                        app.parent_ns_view,
                        native_view,
                        app.sidebar_collapsed,
                        app.sidebar_width as f64,
                        TITLEBAR_HEIGHT as f64,
                        requested,
                        sticky,
                    )
                };
                if !visible {
                    app.close_native_sidebar_reveal(cx);
                }
                cx.notify();
            });
        });
    }

    fn close_native_sidebar_reveal(&mut self, cx: &mut gpui::Context<Self>) {
        if let Some(reveal) = self.native_sidebar.reveal.take() {
            let handle = reveal.window;
            drop(reveal);
            let _ = handle.update(cx, |_, window, _| window.remove_window());
            cx.notify();
        }
    }
}
