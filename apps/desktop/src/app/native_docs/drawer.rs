//! The floating files list (a drawer or a peek) in a native child window of its own, laid over the
//! right edge of the Docs view.
//!
//! CDXC:Docs 2026-09-25 DECISION:
//! User: "make the sidebar for the files list work like the sessions sidebar. it has glass effect and it's able to appear on top of cef panes without any issue". The floating list is drawn in a child window over the Docs view, exactly as the floating sessions sidebar is, so it shows over an HTML file or a drawing without hiding the page, and under glass its backdrop is the main window's glass picture (`sync_overlay_window_glass`) with the sidebar's own tint over it. Docked, the list stays in the main window beside the document.
//!
//! CDXC:Docs 2026-09-25 WHY:
//! The window slides by moving its frame, one step per frame of the slide, with the list laid out at full width against the window's right edge so nothing reflows. Windows cannot move a GPUI window, so there the list opens and closes in one step.

use gpui::{
    AnyElement, AppContext as _, Bounds, Context, InteractiveElement as _, IntoElement,
    ParentElement as _, Pixels, Render, StatefulInteractiveElement as _, Styled as _,
    Subscription, WeakEntity, Window, div, point, px, size,
};

use super::render::SIDEBAR_WIDTH;
use crate::GhostexGpuiApp;
use crate::app::helpers::{
    cef_parent_native_view, set_docs_drawer_glass_window, sync_overlay_window_glass,
    window_glass_background_appearance, window_shell_background,
};

/// Whether this platform can move a child window, which the slide needs.
const CAN_SLIDE: bool = cfg!(any(target_os = "macos", target_os = "linux"));

/// The open drawer window.
pub(crate) struct DocsDrawerHost {
    pub(crate) window: gpui::WindowHandle<gpui_component::Root>,
}

/// The drawer window's root. It borrows the app entity and draws the same files list the docked
/// layout draws.
pub(crate) struct DocsDrawerWindow {
    app: WeakEntity<GhostexGpuiApp>,
    _subscription: Subscription,
}

impl Render for DocsDrawerWindow {
    fn render(&mut self, window: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
        let Some(app) = self.app.upgrade() else {
            return div().into_any_element();
        };
        app.update(cx, |app, cx| app.render_native_docs_drawer(window, cx))
    }
}

impl GhostexGpuiApp {
    /// The window this Docs element is drawn in is the drawer's.
    pub(crate) fn native_docs_in_drawer(&self, window: &Window) -> bool {
        self.native_docs
            .drawer
            .as_ref()
            .is_some_and(|drawer| drawer.window.window_id() == window.window_handle().window_id())
    }

    /// Moves a rectangle from the drawer window's coordinates into the main window's.
    pub(crate) fn native_docs_drawer_to_main(&self, bounds: Bounds<Pixels>) -> Bounds<Pixels> {
        let origin = self
            .native_docs
            .drawer_frame
            .map_or(point(px(0.0), px(0.0)), |frame| frame.origin);
        Bounds::new(origin + bounds.origin, bounds.size)
    }

    /// Focuses a field of the files list in whichever window draws it. A floating list is in the
    /// drawer's window, which takes the keyboard and focuses the field when it next draws.
    pub(crate) fn native_docs_focus_list_input(
        &mut self,
        input: &gpui::Entity<gpui_component::input::InputState>,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) {
        if self.native_docs_sidebar_layout().overlay && !self.native_docs_in_drawer(window) {
            self.native_docs.drawer_focus = Some(input.clone());
            self.native_docs_notify(cx);
            return;
        }
        super::actions::focus_and_select_all(input, window);
    }

    /// Opens, moves or closes the drawer window to match the list's state. Runs in the main
    /// window's render, after the layout that decided whether the list floats.
    pub(crate) fn native_docs_sync_drawer(
        &mut self,
        floating: bool,
        slide_offset: f32,
        view: Bounds<Pixels>,
        cx: &mut Context<Self>,
    ) {
        let wanted = (floating && view.size.width > px(0.0)).then(|| {
            let full = SIDEBAR_WIDTH.min(view.size.width.as_f32());
            let shown = if CAN_SLIDE {
                (full * (1.0 - slide_offset)).clamp(1.0, full)
            } else {
                full
            };
            Bounds::new(
                point(view.right() - px(shown), view.top()),
                size(px(shown), view.size.height),
            )
        });
        let Some(frame) = wanted else {
            self.native_docs.drawer_frame = None;
            self.native_docs.drawer_focus = None;
            self.native_docs_close_drawer_window(cx);
            return;
        };
        self.native_docs.drawer_synced = true;
        let moved = self.native_docs.drawer_frame != Some(frame);
        self.native_docs.drawer_frame = Some(frame);
        match self.native_docs.drawer.as_ref() {
            Some(drawer) if moved => {
                let handle = drawer.window;
                let parent = self.parent_ns_view;
                cx.defer(move |cx| {
                    crate::app::native_chat::child_window::move_child_window(
                        handle.into(),
                        parent,
                        frame,
                        cx,
                    );
                    // The move runs on a task of its own; GPUI rereads the size after it, the way
                    // the floating reveal panel does (`schedule_floating_reveal_bounds_refresh`).
                    cx.spawn(async move |cx| {
                        let _ = handle.update(cx, |_, window, cx| window.bounds_changed(cx));
                    })
                    .detach();
                });
            }
            Some(_) => {}
            None if !self.native_docs.drawer_opening => self.native_docs_open_drawer_window(cx),
            None => {}
        }
    }

    /// Runs as the main window's frame begins: a drawer the Docs view did not draw last frame
    /// belongs to a view that went away (another view, a closed panel), so it goes too.
    pub(crate) fn native_docs_drop_unseen_drawer(&mut self, cx: &mut Context<Self>) {
        let seen = std::mem::replace(&mut self.native_docs.drawer_synced, false);
        if seen || self.native_docs.drawer.is_none() {
            return;
        }
        self.native_docs.transient = None;
        self.native_docs.slide = None;
        self.native_docs.peek_timer = None;
        self.native_docs.drawer_frame = None;
        self.native_docs.drawer_focus = None;
        self.native_docs_close_drawer_window(cx);
    }

    fn native_docs_close_drawer_window(&mut self, cx: &mut Context<Self>) {
        let Some(drawer) = self.native_docs.drawer.take() else {
            return;
        };
        set_docs_drawer_glass_window(None);
        let handle = drawer.window;
        cx.defer(move |cx| {
            let _ = handle.update(cx, |_, window, _| {
                detach_child_window(window);
                window.remove_window();
            });
        });
    }

    /// Opening a window draws its root at once, and the root updates this entity, so the window is
    /// opened on a deferred task outside this update (the floating reveal panel does the same).
    fn native_docs_open_drawer_window(&mut self, cx: &mut Context<Self>) {
        let Some(main) = self.main_window_handle else {
            return;
        };
        self.native_docs.drawer_opening = true;
        let parent_view = self.parent_ns_view;
        let app = cx.weak_entity();
        gpui::App::defer(cx, move |cx| {
            let Some(app) = app.upgrade() else {
                return;
            };
            let finish = |app: &gpui::Entity<GhostexGpuiApp>, cx: &mut gpui::App| {
                app.update(cx, |app, _| app.native_docs.drawer_opening = false);
            };
            let Some(frame) = app.read(cx).native_docs.drawer_frame else {
                finish(&app, cx);
                return;
            };
            let Ok((origin, display_id)) = main.update(cx, |_, window, cx| {
                (
                    crate::app::native_chat::child_window::content_bounds(window).origin,
                    window.display(cx).map(|display| display.id()),
                )
            }) else {
                finish(&app, cx);
                return;
            };
            let screen = Bounds::new(origin + frame.origin, frame.size);
            let options = gpui::WindowOptions {
                window_bounds: Some(gpui::WindowBounds::Windowed(screen)),
                display_id: crate::app::window::popup_frame::display_at(screen.center(), cx)
                    .or(display_id),
                focus: false,
                show: true,
                kind: gpui::WindowKind::PopUp,
                window_background: window_glass_background_appearance(),
                is_movable: false,
                is_resizable: false,
                is_minimizable: false,
                titlebar: None,
                app_id: crate::gpui_platform_window_app_id(),
                icon: crate::gpui_platform_window_icon(),
                ..Default::default()
            };
            let observed = app.clone();
            let result = cx.open_window(options, move |window, cx| {
                let view = cx.new(|cx| DocsDrawerWindow {
                    app: observed.downgrade(),
                    _subscription: cx.observe(&observed, |_, _, cx| cx.notify()),
                });
                cx.new(|cx| {
                    gpui_component::Root::new(view, window, cx).bg(gpui::transparent_black())
                })
            });
            let Ok(handle) = result else {
                finish(&app, cx);
                return;
            };
            let _ = handle.update(cx, |_, window, _| attach_child_window(window, parent_view));
            set_docs_drawer_glass_window(Some(handle.into()));
            app.update(cx, |app, cx| {
                app.native_docs.drawer_opening = false;
                app.native_docs.drawer = Some(DocsDrawerHost { window: handle });
                // The list may have closed while the window was opening; the next sync closes it.
                cx.notify();
            });
        });
    }

    /// The pointer left the drawer window or came back to it: a peek closes after the grace once
    /// the pointer is gone, wherever it went (a browser page under it reports nothing to Docs).
    fn native_docs_drawer_hovered(&mut self, hovered: bool, cx: &mut Context<Self>) {
        if hovered {
            if self.native_docs.transient == Some(super::state::DocsTransient::Peek) {
                self.native_docs.peek_timer = None;
            }
            return;
        }
        self.native_docs_leave_peek(cx);
    }

    fn render_native_docs_drawer(&mut self, window: &mut Window, cx: &mut Context<Self>) -> AnyElement {
        let (Some(p), Some(frame)) = (
            self.native_docs.palette.clone(),
            self.native_docs.drawer_frame,
        ) else {
            return div().into_any_element();
        };
        sync_overlay_window_glass(window, point(-frame.origin.x, -frame.origin.y));
        if let Some(input) = self.native_docs.drawer_focus.take() {
            window.activate_window();
            super::actions::focus_and_select_all(&input, window);
        }
        let layout = self.native_docs_sidebar_layout();
        let offset = window.viewport_size().width.as_f32() - SIDEBAR_WIDTH;
        let list = self.render_native_docs_files_list(&p, layout, true, window, cx);
        div()
            .id("native-docs-drawer")
            .size_full()
            .overflow_hidden()
            .bg(window_shell_background())
            .key_context("NativeDocs")
            .on_action(cx.listener(Self::handle_native_docs_action))
            .on_key_down(cx.listener(Self::native_docs_key_down))
            .on_hover(cx.listener(|this, hovered: &bool, _, cx| {
                this.native_docs_drawer_hovered(*hovered, cx)
            }))
            .child(
                div()
                    .absolute()
                    .top_0()
                    .bottom_0()
                    .left(px(offset))
                    .w(px(SIDEBAR_WIDTH))
                    .child(list),
            )
            .into_any_element()
    }
}

#[cfg(target_os = "macos")]
fn attach_child_window(window: &Window, parent: *mut std::ffi::c_void) {
    unsafe extern "C" {
        fn GhostexGpuiAttachToastPopupToMainWindow(
            view: *mut std::ffi::c_void,
            parent: *mut std::ffi::c_void,
        );
    }
    if let Ok(view) = cef_parent_native_view(window) {
        unsafe { GhostexGpuiAttachToastPopupToMainWindow(view, parent) };
    }
}

#[cfg(not(target_os = "macos"))]
fn attach_child_window(_: &Window, _: *mut std::ffi::c_void) {}

/// Orders the window out before it closes: an attached child window that closes stays in its
/// parent's list and can be ordered back in with it.
#[cfg(target_os = "macos")]
fn detach_child_window(window: &Window) {
    unsafe extern "C" {
        fn GhostexGpuiSetFrostedChildWindowVisible(
            child: *mut std::ffi::c_void,
            parent: *mut std::ffi::c_void,
            visible: bool,
        );
    }
    if let Ok(view) = cef_parent_native_view(window) {
        unsafe { GhostexGpuiSetFrostedChildWindowVisible(view, std::ptr::null_mut(), false) };
    }
}

#[cfg(not(target_os = "macos"))]
fn detach_child_window(_: &Window) {}
