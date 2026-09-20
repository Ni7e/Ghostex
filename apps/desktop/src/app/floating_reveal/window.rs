//! The native child window the panels ride in, and the one entry point the rest of the app calls.

use gpui::Bounds;
use gpui::InteractiveElement as _;
use gpui::IntoElement;
use gpui::ParentElement as _;
use gpui::Pixels;
use gpui::Render;
use gpui::Styled as _;
use gpui::Subscription;
use gpui::WeakEntity;
use gpui::Window;
use gpui::div;
use gpui::point;
use gpui::prelude::FluentBuilder as _;
use gpui::px;
use gpui::size;
use gpui_component::h_flex;

use super::model::*;
use crate::app::helpers::*;
use crate::app::render::agents_workspace_layout::AgentsWorkspaceLayout;
use crate::app::render::workarea_header::workarea_header_bottom_y;
use crate::*;

/// The root of the floating window. It borrows the app entity and draws the same sidebar and
/// sessions column the docked layout draws, so there is one implementation of each.
pub(crate) struct FloatingRevealWindow {
    pub(crate) app: WeakEntity<GhostexGpuiApp>,
    _subscription: Subscription,
}

impl Render for FloatingRevealWindow {
    fn render(&mut self, window: &mut Window, cx: &mut gpui::Context<Self>) -> impl IntoElement {
        let Some(app) = self.app.upgrade() else {
            return div().into_any_element();
        };
        app.update(cx, |app, cx| {
            let Some((content, width)) = app
                .floating_reveal
                .panel
                .as_ref()
                .map(|panel| (panel.content, panel.width))
            else {
                return div().into_any_element();
            };
            // The window itself is what slides: it is resized from nothing to its full width while
            // the panels stay pinned to its right edge, so the page enters without reflowing once.
            let offset = window.bounds().size.width.as_f32() - width;
            let sidebar_width = app.sidebar_width;
            div()
                .size_full()
                .overflow_hidden()
                .bg(workspace_background_color())
                .on_action(cx.listener(
                    |app,
                     action: &crate::app::native_sidebar::actions::NativeSidebarAction,
                     window,
                     cx| {
                        app.handle_native_sidebar_action(action, window, cx)
                    },
                ))
                .child(
                    h_flex()
                        .w(px(width))
                        .h_full()
                        .ml(px(offset))
                        .items_start()
                        .child(
                            div()
                                .w(px(sidebar_width))
                                .flex_shrink_0()
                                .h_full()
                                .child(app.render_native_sidebar(window, cx)),
                        )
                        .when(content.agents_column, |this| {
                            this.child(
                                // Painted chrome only: no id and no listener, so GPUI gives it no
                                // hitbox and the panel is not a place to resize the split.
                                div()
                                    .w(px(FLOATING_REVEAL_RAIL_WIDTH))
                                    .flex_shrink_0()
                                    .h_full()
                                    .bg(sidebar_divider_background_color()),
                            )
                            .child(
                                div()
                                    .flex()
                                    .flex_col()
                                    .flex_1()
                                    .h_full()
                                    .min_w_0()
                                    .overflow_hidden()
                                    .child(app.render_agents_workspace(
                                        AgentsWorkspaceLayout::Floating,
                                        window,
                                        cx,
                                    )),
                            )
                        }),
                )
                .into_any_element()
        })
    }
}

impl GhostexGpuiApp {
    /// Where the panel sits: down the window's left edge, from the header's bottom to the floor, so
    /// the header keeps its window controls and its drag band while the panel is out.
    pub(crate) fn floating_reveal_frame(&self, width: f32) -> Bounds<Pixels> {
        let top = workarea_header_bottom_y();
        let height = (self.main_window_bounds.size.height.as_f32() - top).max(1.0);
        Bounds::new(
            self.main_window_bounds.origin + point(px(0.0), px(top)),
            size(px(width.max(1.0)), px(height)),
        )
    }

    /// The one call the rest of the app makes. `requested` is a reveal asked for by name,
    /// `keep_under_pointer` is a layout change that must not pull the sidebar out from under the
    /// pointer; everything else is the edge strip's doing.
    pub(crate) fn update_floating_reveal(
        &mut self,
        requested: bool,
        keep_under_pointer: bool,
        cx: &mut gpui::Context<Self>,
    ) {
        if requested {
            self.floating_reveal.requested_until = Some(
                std::time::Instant::now()
                    + std::time::Duration::from_secs(FLOATING_REVEAL_REQUEST_GRACE_SECS),
            );
        }
        if !self.floating_reveal_eligible() {
            self.close_floating_reveal(cx);
            return;
        }
        self.refresh_floating_reveal_panel_shape(cx);
        self.sync_floating_reveal_host(requested, keep_under_pointer, cx);
    }

    /// The 60ms sweep that owns the gesture: it is the only thing that watches the pointer leave.
    /// Returns whether a panel is on screen, which is what shortens the next interval on the
    /// backends that animate the slide themselves.
    pub(crate) fn poll_floating_reveal(
        &mut self,
        window: &Window,
        cx: &mut gpui::Context<Self>,
    ) -> bool {
        if !self.floating_reveal_eligible() {
            self.close_floating_reveal(cx);
            return false;
        }
        // A panel over a window the user has switched away from is not what the gesture promised.
        // AppKit decides this inside the panel host, from the key window; the other two backends
        // have to read it here, from the window the poll already holds.
        #[cfg(not(target_os = "macos"))]
        if !window.is_window_active() && self.floating_reveal.panel.is_some() {
            self.close_floating_reveal(cx);
            return false;
        }
        let _ = window;
        self.update_floating_reveal(false, false, cx);
        // An armed edge counts as active too: the panel opens on a deferred task, so the sweep that
        // asked for it has nothing to show yet and the slide would otherwise start a beat late.
        self.floating_reveal.panel.is_some() || self.floating_reveal.edge_hovered
    }

    /// Keep the open panel's content and width current: un-maximising the view panel while it is
    /// out takes the sessions column back, and a window resize re-derives the column's share.
    fn refresh_floating_reveal_panel_shape(&mut self, cx: &mut gpui::Context<Self>) {
        let content = self.floating_reveal_content();
        let width = self.floating_reveal_width_for(content);
        let Some(panel) = self.floating_reveal.panel.as_mut() else {
            return;
        };
        if panel.content == content && (panel.width - width).abs() < 0.5 {
            return;
        }
        let hosted_before = panel.content.agents_column;
        panel.content = content;
        panel.width = width;
        if hosted_before != content.agents_column {
            self.reconcile_agents_pane_surfaces(cx);
            self.update_active_mode_cef_child_visibility(cx);
        }
        cx.notify();
    }

    /// CDXC:Sidebar 2026-09-09 WHY:
    /// GPUI `open_window` synchronously draws its root, whose render updates this app entity.
    /// Opening it inside the hover handler's own update caused the repeated double-lease panic in
    /// the September 9 crash reports. Defer creation onto `App` itself, outside any app-entity
    /// update, then attach the finished window in a separate update.
    pub(crate) fn open_floating_reveal(&mut self, sticky: bool, cx: &mut gpui::Context<Self>) {
        let app = cx.weak_entity();
        gpui::App::defer(cx, move |cx| {
            let Some(app) = app.upgrade() else {
                return;
            };
            let (options, content, width) = {
                let this = app.read(cx);
                if this.floating_reveal.panel.is_some() || !this.floating_reveal_eligible() {
                    return;
                }
                let content = this.floating_reveal_content();
                let width = this.floating_reveal_width_for(content);
                // AppKit sizes the panel itself from the first frame of its own animation; the
                // other backends start the window at a sliver and grow it.
                let opening_width = if sticky || cfg!(target_os = "macos") {
                    width
                } else {
                    1.0
                };
                let bounds = this.floating_reveal_frame(opening_width);
                (
                    gpui::WindowOptions {
                        window_bounds: Some(gpui::WindowBounds::Windowed(bounds)),
                        display_id: this.main_window_display_id,
                        focus: false,
                        // The AppKit host orders the panel in once it is a child window; elsewhere
                        // the popup is shown by the platform when it is created.
                        show: !cfg!(target_os = "macos"),
                        kind: gpui::WindowKind::PopUp,
                        is_movable: false,
                        is_resizable: false,
                        is_minimizable: false,
                        titlebar: None,
                        app_id: crate::gpui_platform_window_app_id(),
                        icon: crate::gpui_platform_window_icon(),
                        ..Default::default()
                    },
                    content,
                    width,
                )
            };
            let observed = app.clone();
            let result = cx.open_window(options, move |window, cx| {
                let view = cx.new(|cx| FloatingRevealWindow {
                    app: observed.downgrade(),
                    _subscription: cx.observe(&observed, |_, _, cx| cx.notify()),
                });
                /*
                CDXC:SessionChat 2026-09-18 WHY:
                gpui-component drives transcript text selection from the window's
                `gpui_component::Root`, so a window that hosts the native chat without one cannot
                select any text. The panel paints its own background, so the Root's surface stays
                clear.
                */
                cx.new(|cx| {
                    gpui_component::Root::new(view, window, cx).bg(gpui::transparent_black())
                })
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
            // Read outside the app update: the AppKit host needs the panel's own view, and leasing
            // a second window from inside the app entity's update is what the defer above exists to
            // avoid.
            let native_view = handle
                .update(cx, |_, window, _| cef_parent_native_view(window))
                .ok()
                .and_then(Result::ok);
            let anchor = app.read(cx).floating_reveal_frame(width).origin;
            app.update(cx, |app, cx| {
                if !app.attach_floating_reveal_panel(
                    handle,
                    native_view,
                    anchor,
                    content,
                    width,
                    sticky,
                    cx,
                ) {
                    return;
                }
                if content.agents_column {
                    // The sessions column just came back on screen in a second window, so every
                    // gate that reads `agents_workspace_visible()` is reconciled at this boundary,
                    // exactly as the expand toggle reconciles them.
                    app.reconcile_agents_pane_surfaces(cx);
                    app.update_active_mode_cef_child_visibility(cx);
                }
                cx.notify();
            });
        });
    }

    pub(crate) fn close_floating_reveal(&mut self, cx: &mut gpui::Context<Self>) {
        let Some(panel) = self.floating_reveal.panel.take() else {
            self.floating_reveal.edge_hovered = false;
            self.floating_reveal.requested_until = None;
            return;
        };
        let hosted_agents_column = panel.content.agents_column;
        self.dispose_floating_reveal_host(&panel);
        let _ = panel
            .window
            .update(cx, |_, window, _| window.remove_window());
        self.floating_reveal.edge_hovered = false;
        self.floating_reveal.requested_until = None;
        #[cfg(not(target_os = "macos"))]
        {
            self.floating_reveal.outside_since = None;
            self.floating_reveal.slide = FloatingRevealSlide::default();
        }
        if hosted_agents_column {
            self.reconcile_agents_pane_surfaces(cx);
            self.update_active_mode_cef_child_visibility(cx);
        }
        cx.notify();
    }
}
