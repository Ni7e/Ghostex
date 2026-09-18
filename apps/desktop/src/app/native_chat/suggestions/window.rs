use super::super::{appearance::ChatAppearance, state::NativeChatView};
use gpui::{
    AppContext as _, Bounds, Context, Entity, Pixels, ScrollHandle, Styled as _, Subscription,
    WindowBounds, WindowOptions, px, size,
};
use gpui_component::Root;
use serde_json::json;

#[derive(Default)]
pub(in crate::app::native_chat) struct SuggestionWindowState {
    handle: Option<gpui::WindowHandle<Root>>,
    bounds: Option<Bounds<Pixels>>,
    opening: bool,
    inline: Option<gpui::WeakEntity<SuggestionPanel>>,
}

pub(in crate::app::native_chat) struct SuggestionPanel {
    pub(super) chat: Entity<NativeChatView>,
    pub(super) source: gpui::AnyWindowHandle,
    pub(super) scroll: ScrollHandle,
    pub(super) selected: Option<usize>,
    _subscription: Subscription,
}

impl NativeChatView {
    pub(in crate::app::native_chat) fn inline_suggestions(
        &mut self,
        window: &gpui::Window,
        cx: &mut Context<Self>,
    ) -> Option<Entity<SuggestionPanel>> {
        if self.snapshot["suggestions"].is_null() {
            return None;
        }
        let source = window.window_handle();
        if let Some(panel) = self
            .suggestions
            .inline
            .as_ref()
            .and_then(gpui::WeakEntity::upgrade)
        {
            panel.update(cx, |panel, _| panel.source = source);
            return Some(panel);
        }
        let chat = cx.entity();
        let panel = cx.new(|cx| {
            let subscription = cx.observe(&chat, |_, _, cx| cx.notify());
            SuggestionPanel {
                chat,
                source,
                scroll: Default::default(),
                selected: None,
                _subscription: subscription,
            }
        });
        self.suggestions.inline = Some(panel.downgrade());
        Some(panel)
    }

    pub(in crate::app::native_chat) fn update_suggestion_selection(
        &mut self,
        cx: &mut Context<Self>,
    ) {
        let Some(input) = &self.input else {
            return;
        };
        let text = input.read(cx).value().to_string();
        let offset = input.read(cx).cursor().min(text.len());
        let caret = text[..offset].encode_utf16().count();
        if self
            .suggestion_selection
            .as_ref()
            .is_some_and(|old| old.0 == text && old.1 == caret)
        {
            return;
        }
        self.suggestion_selection = Some((text.clone(), caret));
        self.invoke(
            json!({"type":"composerSelection","text":text,"caret":caret}),
            cx,
        );
    }

    pub(crate) fn sync_suggestion_window(&mut self, cx: &mut Context<Self>) {
        if self.suggestions.opening {
            return;
        }
        let source = self
            .maximized_window
            .map(|window| window.into())
            .or(self.main_window);
        let Some(source) = source else {
            return;
        };
        let p = ChatAppearance::current(&self.snapshot);
        let anchor = self.composer_bounds.get();
        let projection = &self.snapshot["suggestions"];
        let visible = self.maximized_window.is_none()
            && self.pane_focused
            && projection.is_object()
            && self.snapshot["questionCard"]["visible"] != true
            && anchor.size.width > px(0.0);
        let height = (40.0
            + 36.0 * projection["rows"].as_array().map_or(0, Vec::len) as f32
            + if projection["status"].is_string() {
                36.0
            } else {
                0.0
            })
        .min(290.0)
            * p.scale;
        let chat = cx.entity();
        let parent = self.config.parent_native_view;
        self.suggestions.opening = true;
        cx.defer(move |cx| {
            let geometry = visible
                .then(|| {
                    source
                        .update(cx, |_, window, _| {
                            let height = px(height)
                                .min(anchor.top() - px(8.0 * p.scale))
                                .max(px(0.0));
                            Bounds::new(
                                window.bounds().origin
                                    + gpui::point(
                                        anchor.left(),
                                        anchor.top() - height - px(8.0 * p.scale),
                                    ),
                                size(anchor.size.width, height),
                            )
                        })
                        .ok()
                })
                .flatten();
            if chat.read(cx).suggestions.bounds == geometry {
                chat.update(cx, |chat, _| chat.suggestions.opening = false);
                return;
            }
            let old = chat.update(cx, |chat, _| {
                chat.suggestions.bounds = geometry;
                chat.suggestions.handle.take()
            });
            if let Some(old) = old {
                let _ = old.update(cx, |_, window, _| window.remove_window());
            }
            let result = geometry
                .filter(|bounds| bounds.size.height > px(0.0))
                .map(|bounds| {
                    cx.open_window(
                        WindowOptions {
                            window_bounds: Some(WindowBounds::Windowed(bounds)),
                            titlebar: None,
                            kind: gpui::WindowKind::PopUp,
                            focus: false,
                            show: true,
                            is_movable: false,
                            is_resizable: false,
                            is_minimizable: false,
                            app_id: crate::gpui_platform_window_app_id(),
                            icon: crate::gpui_platform_window_icon(),
                            window_background: gpui::WindowBackgroundAppearance::Transparent,
                            ..Default::default()
                        },
                        {
                            let chat = chat.clone();
                            move |window, cx| {
                                attach_suggestion_window(window, parent);
                                let panel = cx.new(|cx| {
                                    let subscription = cx.observe(&chat, |_, _, cx| cx.notify());
                                    SuggestionPanel {
                                        chat,
                                        source,
                                        scroll: Default::default(),
                                        selected: None,
                                        _subscription: subscription,
                                    }
                                });
                                cx.new(|cx| {
                                    Root::new(panel, window, cx).bg(gpui::transparent_black())
                                })
                            }
                        },
                    )
                });
            chat.update(cx, |chat, cx| {
                chat.suggestions.opening = false;
                match result {
                    Some(Ok(handle)) => chat.suggestions.handle = Some(handle),
                    Some(Err(error)) => {
                        chat.error = Some(error.to_string());
                        chat.suggestions.bounds = None;
                    }
                    None => {}
                }
                cx.notify();
            });
        });
    }
}

impl SuggestionPanel {
    pub(super) fn choose(&mut self, command: serde_json::Value, cx: &mut Context<Self>) {
        let source = self.source;
        let chat = self.chat.clone();
        cx.defer(move |cx| {
            let _ = source.update(cx, |_, window, cx| {
                chat.update(cx, |chat, cx| {
                    chat.invoke(command, cx);
                    chat.focus_requested = true;
                    chat.ensure_input(window, cx);
                });
            });
        });
    }
}

#[cfg(target_os = "macos")]
fn attach_suggestion_window(window: &mut gpui::Window, parent: *mut std::ffi::c_void) {
    use raw_window_handle::{HasWindowHandle, RawWindowHandle};
    unsafe extern "C" {
        fn GhostexGpuiAttachComposerSuggestionsWindow(
            view: *mut std::ffi::c_void,
            parent: *mut std::ffi::c_void,
        );
    }
    if let Ok(handle) = HasWindowHandle::window_handle(window) {
        if let RawWindowHandle::AppKit(handle) = handle.as_raw() {
            unsafe {
                GhostexGpuiAttachComposerSuggestionsWindow(handle.ns_view.as_ptr(), parent);
            }
        }
    }
}

#[cfg(not(target_os = "macos"))]
fn attach_suggestion_window(_: &mut gpui::Window, _: *mut std::ffi::c_void) {}
