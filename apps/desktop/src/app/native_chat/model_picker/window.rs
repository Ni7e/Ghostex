use super::super::state::NativeChatView;
use gpui::{
    AppContext as _, Context, Entity, FocusHandle, Styled as _, Subscription, WindowBounds,
    WindowOptions,
};
use gpui_component::Root;
use serde_json::json;

#[derive(Default)]
pub(in crate::app::native_chat) struct ModelPickerWindowState {
    pub(super) handle: Option<gpui::WindowHandle<Root>>,
    opening: bool,
    /// The last pane size reported to the runtime, so only a real layout change costs an action.
    pane_size: Option<(f32, f32)>,
    subscription: Option<Subscription>,
    /// Set when the pane was hidden under an open picker; blocks reopening until the runtime reports the picker gone.
    dismissed: bool,
}

impl ModelPickerWindowState {
    pub(in crate::app::native_chat) fn is_open(&self) -> bool {
        self.handle.is_some()
    }
}

pub(super) struct ModelPickerWindow {
    pub(super) chat: Entity<NativeChatView>,
    pub(super) focus: FocusHandle,
    pub(super) last_size: Option<(f32, f32)>,
    pub(super) started: web_time::Instant,
    _activation: Subscription,
    _subscription: Subscription,
}

impl NativeChatView {
    pub(crate) fn toggle_model_picker(&mut self, cx: &mut Context<Self>) {
        let size = self.bounds.get().size;
        self.invoke(json!({"type":"toggleModelPicker","size":{"width":size.width.as_f32(),"height":size.height.as_f32()}}), cx);
    }

    /// The chat pane's painted frame, reported while the picker window is up; the runtime decides when that counts as a resize (model-picker-pane-resize.ts).
    pub(in crate::app::native_chat) fn report_model_picker_pane_size(
        &mut self,
        size: gpui::Size<gpui::Pixels>,
        cx: &mut Context<Self>,
    ) {
        if self.model_picker_window.handle.is_none() {
            return;
        }
        let size = (size.width.as_f32(), size.height.as_f32());
        if self.model_picker_window.pane_size == Some(size) {
            return;
        }
        self.model_picker_window.pane_size = Some(size);
        self.invoke(
            json!({"type":"modelPickerPane","size":{"width":size.0,"height":size.1}}),
            cx,
        );
    }

    /// Cancels the picker and takes its window down at once, skipping the close animation and the
    /// composer refocus, because the pane it covered is no longer on screen.
    pub(in crate::app::native_chat) fn dismiss_model_picker_for_hidden_pane(
        &mut self,
        cx: &mut Context<Self>,
    ) {
        if self.snapshot["modelPicker"].is_null() {
            return;
        }
        self.model_picker_window.dismissed = true;
        self.model_picker_window.pane_size = None;
        self.model_picker_window.subscription = None;
        if let Some(handle) = self.model_picker_window.handle.take() {
            cx.defer(move |cx| {
                let _ = handle.update(cx, |_, window, _| window.remove_window());
            });
        }
        if self.snapshot["modelPicker"]["closing"] != true {
            self.invoke(json!({"type":"modelPickerCancel"}), cx);
        }
    }

    /// CDXC:SessionChat 2026-09-17 WHY:
    /// A pane-sized native child window owns picker input while preserving the chat pane's existing frame and focus.
    pub(in crate::app::native_chat) fn sync_model_picker_window(&mut self, cx: &mut Context<Self>) {
        if self.snapshot["modelPicker"].is_null() {
            self.model_picker_window.pane_size = None;
            self.model_picker_window.dismissed = false;
            if let Some(handle) = self.model_picker_window.handle.take() {
                let main = self.main_window;
                let chat = cx.weak_entity();
                cx.defer(move |cx| {
                    let _ = handle.update(cx, |_, window, _| window.remove_window());
                    if let Some(main) = main {
                        let _ = main.update(cx, |_, window, cx| {
                            window.activate_window();
                            let _ = chat.update(cx, |chat, cx| {
                                chat.focus_requested = true;
                                chat.ensure_input(window, cx);
                            });
                        });
                    }
                });
            }
            return;
        }
        if self.model_picker_window.handle.is_some()
            || self.model_picker_window.opening
            || self.model_picker_window.dismissed
            || self.snapshot["modelPicker"]["closing"] == true
        {
            return;
        }
        let Some(main) = self.main_window else {
            return;
        };
        let pane = self.bounds.get();
        let parent = self.config.parent_native_view;
        let chat = cx.entity();
        self.model_picker_window.opening = true;
        cx.defer(move |cx| {
            let geometry = main.update(cx, |_, window, cx| {
                (
                    gpui::Bounds::new(window.bounds().origin + pane.origin, pane.size),
                    window.display(cx).map(|display| display.id()),
                )
            });
            let result = geometry.and_then(|(bounds, display_id)| {
                cx.open_window(
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
                        window_background: gpui::WindowBackgroundAppearance::Blurred,
                        ..Default::default()
                    },
                    {
                        let chat = chat.clone();
                        move |window, cx| {
                            crate::app::window::popup_frame::strip_gpui_popup_window_frame(window);
                            crate::app::window::attach_gpui_app_modal_window_to_main_window(
                                window, parent,
                            );
                            let view = cx.new(|cx| {
                                let subscription = cx.observe(&chat, |_, _, cx| cx.notify());
                                /*
                                CDXC:SessionChat 2026-09-18 WHY:
                                React treats losing the window as a blur: the held-key highlights
                                release and the picker stays open with its choice
                                (`useModelPickerKeyFeedback` in session-chat-model-picker-input.ts).
                                Cancelling here instead would throw away a selection the user made.
                                */
                                let activation = cx.observe_window_activation(
                                    window,
                                    |view: &mut ModelPickerWindow, window, cx| {
                                        if !window.is_window_active() {
                                            view.chat.update(cx, |chat, cx| {
                                                chat.invoke(json!({"type":"modelPickerBlur"}), cx);
                                            });
                                        }
                                    },
                                );
                                let focus = cx.focus_handle();
                                // GPUI focus alone does not restore AppKit's first responder after
                                // configuring the child window; key-up must reach this GPUI root too.
                                super::super::focus::reclaim_keyboard_focus(window);
                                focus.focus(window, cx);
                                ModelPickerWindow {
                                    chat,
                                    focus,
                                    last_size: None,
                                    started: web_time::Instant::now(),
                                    _activation: activation,
                                    _subscription: subscription,
                                }
                            });
                            cx.new(|cx| Root::new(view, window, cx).bg(gpui::transparent_black()))
                        }
                    },
                )
            });
            chat.update(cx, |chat, cx| {
                chat.model_picker_window.opening = false;
                match result {
                    Ok(handle) if chat.model_picker_window.dismissed => {
                        cx.defer(move |cx| {
                            let _ = handle.update(cx, |_, window, _| window.remove_window());
                        });
                    }
                    Ok(handle) => {
                        chat.model_picker_window.handle = Some(handle);
                        chat.report_model_picker_pane_size(pane.size, cx);
                        let weak = cx.weak_entity();
                        chat.model_picker_window.subscription =
                            Some(cx.on_window_closed(move |cx, id| {
                                let _ = weak.update(cx, |chat, cx| {
                                    if chat
                                        .model_picker_window
                                        .handle
                                        .is_some_and(|handle| handle.window_id() == id)
                                    {
                                        chat.model_picker_window.handle = None;
                                        chat.invoke(json!({"type":"modelPickerCancel"}), cx);
                                    }
                                });
                            }));
                        chat.sync_model_picker_window(cx);
                    }
                    Err(error) => {
                        chat.error = Some(error.to_string());
                        chat.invoke(json!({"type":"modelPickerCancel"}), cx);
                    }
                }
                cx.notify();
            });
        });
    }
}
