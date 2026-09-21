use super::keyboard::ComposerInputActions as _;
use super::{appearance::ChatAppearance, state::NativeChatView};
use gpui::{
    AppContext as _, Context, Entity, Focusable as _, InteractiveElement as _, IntoElement,
    MouseButton, ParentElement as _, Render, Styled as _, Subscription, Window, WindowBounds,
    WindowOptions, div, px,
};
use gpui_component::Root;

struct MaximizedComposer {
    chat: Entity<NativeChatView>,
    _subscription: Subscription,
}

impl Render for MaximizedComposer {
    fn render(&mut self, window: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
        self.chat.update(cx, |chat, cx| {
            chat.ensure_input(window, cx);
            let p = ChatAppearance::current(&chat.snapshot);
            let composer = chat.render_composer(&p, window, cx);
            let available = window.viewport_size();
            let width = (available.width.as_f32() - 48.0 * p.scale)
                .min(896.0 * p.scale)
                .max(1.0);
            let height = (available.height.as_f32() - 48.0 * p.scale)
                .min(720.0 * p.scale)
                .max(1.0);
            div()
                .size_full()
                .min_h_0()
                .flex()
                .items_center()
                .justify_center()
                .bg(gpui::black().opacity(0.55))
                .on_mouse_down(
                    MouseButton::Left,
                    cx.listener(|chat, _, _, cx| chat.close_maximized(cx)),
                )
                .font_family(p.font)
                .text_color(p.primary)
                .text_size(px(14.0 * p.scale))
                .line_height(px(24.0 * p.scale))
                .on_action(cx.listener(NativeChatView::handle_action))
                // The maximized composer scales with the pane, so it answers the zoom chords too.
                .capture_action(cx.listener(NativeChatView::chat_zoom_in_action))
                .capture_action(cx.listener(NativeChatView::chat_zoom_out_action))
                .capture_action(cx.listener(NativeChatView::chat_zoom_reset_action))
                .capture_key_down(cx.listener(NativeChatView::composer_key_down))
                .composer_input_actions(cx)
                .capture_key_up(cx.listener(|chat, _, _, _| chat.composer_held_key = None))
                .capture_action(cx.listener(NativeChatView::paste_attachments))
                .on_drop(cx.listener(|chat, paths: &gpui::ExternalPaths, _, cx| {
                    let paths = paths
                        .0
                        .iter()
                        .map(|path| path.to_string_lossy().into_owned())
                        .collect::<Vec<_>>();
                    chat.invoke(serde_json::json!({"type":"attachPaths","paths":paths}), cx);
                    cx.stop_propagation();
                }))
                .child(
                    div()
                        .w(px(width))
                        .h(px(height))
                        .min_h_0()
                        .on_mouse_down(MouseButton::Left, |_, _, cx| cx.stop_propagation())
                        .child(composer),
                )
        })
    }
}

impl NativeChatView {
    pub(crate) fn toggle_maximized(&mut self, window: &mut Window, cx: &mut Context<Self>) {
        if self.maximized_window.is_some() {
            self.close_maximized(cx);
            return;
        }
        self.invoke(
            serde_json::json!({"type":"composerExpand","editor":true}),
            cx,
        );
        let pane = self.bounds.get();
        let bounds = gpui::Bounds::new(window.bounds().origin + pane.origin, pane.size);
        let parent_native_view = self.config.parent_native_view;
        let display_id = window.display(cx).map(|display| display.id());
        let chat = cx.entity();
        cx.defer(move |cx| {
            let result = cx.open_window(
                WindowOptions {
                    window_bounds: Some(WindowBounds::Windowed(bounds)),
                    display_id,
                    app_id: crate::gpui_platform_window_app_id(),
                    icon: crate::gpui_platform_window_icon(),
                    focus: true,
                    show: true,
                    is_resizable: false,
                    is_minimizable: false,
                    is_movable: false,
                    titlebar: None,
                    window_background: gpui::WindowBackgroundAppearance::Transparent,
                    ..Default::default()
                },
                {
                    let chat = chat.clone();
                    move |window, cx| {
                        crate::app::window::popup_frame::strip_gpui_popup_window_frame(window);
                        crate::app::window::attach_gpui_app_modal_window_to_main_window(
                            window,
                            parent_native_view,
                        );
                        let view = cx.new(|cx| {
                            let subscription = cx.observe(&chat, |_, _, cx| cx.notify());
                            MaximizedComposer {
                                chat,
                                _subscription: subscription,
                            }
                        });
                        cx.new(|cx| Root::new(view, window, cx).bg(gpui::transparent_black()))
                    }
                },
            );
            chat.update(cx, |this, cx| match result {
                Ok(handle) => {
                    this.maximized_window = Some(handle);
                    let chat = cx.weak_entity();
                    this.window_subscription = Some(cx.on_window_closed(move |cx, id| {
                        let _ = chat.update(cx, |chat, cx| {
                            if chat
                                .maximized_window
                                .is_some_and(|handle| handle.window_id() == id)
                            {
                                chat.close_maximized(cx);
                            }
                        });
                    }));
                    this.focus_requested = true;
                    cx.notify();
                }
                Err(error) => {
                    this.error = Some(error.to_string());
                    cx.notify();
                }
            });
        });
    }

    pub(crate) fn close_maximized(&mut self, cx: &mut Context<Self>) {
        let Some(handle) = self.maximized_window.take() else {
            return;
        };
        let main_window = self.main_window;
        let chat = cx.weak_entity();
        cx.defer(move |cx| {
            let _ = handle.update(cx, |_, window, _| window.remove_window());
            if let Some(main_window) = main_window {
                let _ = main_window.update(cx, |_, window, cx| {
                    window.activate_window();
                    let _ = chat.update(cx, |chat, cx| {
                        chat.ensure_input(window, cx);
                        if let Some(input) = &chat.input {
                            input.read(cx).focus_handle(cx).focus(window, cx);
                        }
                        cx.notify();
                    });
                });
            }
        });
        cx.notify();
    }
}
