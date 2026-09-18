use super::super::images::ChatImageSource;
use super::super::{appearance::ChatAppearance, transcript::text};
use super::window::ImageViewerWindow;
use base64::Engine as _;
use gpui::prelude::FluentBuilder as _;
use gpui::{
    AnyElement, Context, InteractiveElement as _, IntoElement, ParentElement as _, Render,
    StatefulInteractiveElement as _, Styled as _, StyledImage as _, Window, div, img, px, svg,
};
use serde_json::{Value, json};
use std::sync::atomic::{AtomicU64, Ordering};

/**
 * Three steps between the fitted size and the largest view, spaced geometrically so the first
 * click is always a modest zoom. React measures the original's natural size to pick its steps;
 * GPUI paints from the fitted box, so the steps are fixed multiples of it instead.
 */
pub(super) const ZOOM_LEVEL_COUNT: usize = 3;
const ZOOM_STEPS: [f32; ZOOM_LEVEL_COUNT] = [1.5, 2.25, 3.375];
/// React caps the fitted picture at 75% of the window height; the same cap keeps the toolbar clear.
const FIT_HEIGHT: f32 = 0.75;
const FIT_WIDTH: f32 = 0.9;
/// The app-bridge image transfer moves already-base64 bytes in ordered 256 KiB messages.
const SAVE_CHUNK_CHARS: usize = 256 * 1024;

static SAVE_REQUEST_SEQUENCE: AtomicU64 = AtomicU64::new(0);

impl super::window::ImageViewerRequest {
    pub(super) fn current(&self) -> &Value {
        &self.images[self.index.min(self.images.len().saturating_sub(1))]
    }
}

impl ImageViewerWindow {
    /// One segment of React's joined image-actions ButtonGroup: Copy path, Save image, Copy image,
    /// each swapping its glyph for a tick once it has run.
    fn action_button(
        &self,
        id: &'static str,
        label: &'static str,
        icon: &'static str,
        done: bool,
        p: &ChatAppearance,
        cx: &Context<Self>,
        action: impl Fn(&mut ImageViewerWindow, &mut Context<Self>) + 'static,
    ) -> AnyElement {
        div()
            .id(id)
            .role(gpui::Role::Button)
            .aria_label(label)
            .tab_index(0)
            .size(px(28.0))
            .flex()
            .flex_shrink_0()
            .items_center()
            .justify_center()
            .cursor_pointer()
            .hover(|style| style.bg(p.input))
            .focus_visible(|style| style.bg(p.input))
            .tooltip(move |window, cx| {
                gpui_component::tooltip::Tooltip::new(label).build(window, cx)
            })
            .child(
                svg()
                    .path(if done { "titlebar/check.svg" } else { icon })
                    .size(px(15.0))
                    .text_color(if p.light { p.foreground } else { p.primary }),
            )
            .on_click(cx.listener(move |this, _, _, cx| action(this, cx)))
            .into_any_element()
    }

    fn current_image(&self, cx: &Context<Self>) -> Option<Value> {
        self.chat
            .read(cx)
            .image_viewer
            .request
            .as_ref()
            .map(|request| request.current().clone())
    }

    fn copy_image(&mut self, cx: &mut Context<Self>) {
        let Some(image) = self.current_image(cx) else {
            return;
        };
        let bytes = self
            .chat
            .update(cx, |chat, cx| match chat.chat_image(&image, cx) {
                ChatImageSource::Bytes(bytes) => Some(bytes),
                _ => None,
            });
        if let Some(bytes) = bytes {
            cx.write_to_clipboard(gpui::ClipboardItem::new_image(&bytes));
            crate::app::helpers::gpui_play_copy_sound();
            self.chat.update(cx, |chat, cx| {
                chat.note_image_viewer_action("Image copied", cx)
            });
        }
    }

    fn copy_path(&mut self, cx: &mut Context<Self>) {
        let Some(path) = self
            .current_image(cx)
            .map(|image| text(&image, "copyPath"))
            .filter(|path| !path.is_empty())
        else {
            return;
        };
        cx.write_to_clipboard(gpui::ClipboardItem::new_string(path));
        crate::app::helpers::gpui_play_copy_sound();
        self.chat.update(cx, |chat, cx| {
            chat.note_image_viewer_action("Path copied", cx)
        });
    }

    /// Hands the bytes to the host's Downloads writer, the route React's Save image also takes.
    fn save_image(&mut self, cx: &mut Context<Self>) {
        let Some(image) = self.current_image(cx) else {
            return;
        };
        self.chat.update(cx, |chat, cx| {
            let ChatImageSource::Bytes(bytes) = chat.chat_image(&image, cx) else {
                return;
            };
            let encoded = base64::engine::general_purpose::STANDARD.encode(&bytes.bytes);
            let request_id = format!(
                "native-image-{}",
                SAVE_REQUEST_SEQUENCE.fetch_add(1, Ordering::Relaxed)
            );
            let name = text(&image, "fileName");
            chat.host(
                "saveImageStart",
                json!({
                    "requestId": request_id,
                    "suggestedName": if name.is_empty() { "image.png".to_string() } else { name },
                }),
                cx,
            );
            for (index, chunk) in encoded.as_bytes().chunks(SAVE_CHUNK_CHARS).enumerate() {
                chat.host(
                    "saveImageChunk",
                    json!({
                        "requestId": request_id,
                        "chunkIndex": index,
                        "base64Chunk": String::from_utf8_lossy(chunk),
                    }),
                    cx,
                );
            }
            chat.host("saveImageFinish", json!({ "requestId": request_id }), cx);
            chat.note_image_viewer_action("Saving image", cx);
        });
    }
}

impl Render for ImageViewerWindow {
    fn render(&mut self, window: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
        let snapshot = self.chat.read(cx).snapshot.clone();
        let p = ChatAppearance::current(&snapshot);
        let Some((image, zoom, completed)) = self
            .chat
            .read(cx)
            .image_viewer
            .request
            .as_ref()
            .map(|request| (request.current().clone(), request.zoom, request.completed))
        else {
            return div().size_full().into_any_element();
        };
        // The overlay owns the window's keyboard: without a focused element Escape would reach
        // nothing, which is how a viewer can look stuck open.
        if window.focused(cx).is_none() {
            self.focus.focus(window, cx);
        }
        let label = text(&image, "label");
        let copyable = !text(&image, "copyPath").is_empty();
        let source = self.chat.update(cx, |chat, cx| chat.chat_image(&image, cx));
        let loading = matches!(source, ChatImageSource::Loading);
        let viewport = window.viewport_size();
        let step = if zoom == 0 {
            1.0
        } else {
            ZOOM_STEPS[(zoom - 1).min(ZOOM_LEVEL_COUNT - 1)]
        };
        let max_height = viewport.height * FIT_HEIGHT * step;
        let max_width = viewport.width * FIT_WIDTH * step;
        let picture = match source {
            ChatImageSource::Uri(url) => Some(
                img(url)
                    .max_h(max_height)
                    .max_w(max_width)
                    .object_fit(gpui::ObjectFit::Contain)
                    .into_any_element(),
            ),
            ChatImageSource::Bytes(bytes) => Some(
                img(bytes)
                    .max_h(max_height)
                    .max_w(max_width)
                    .object_fit(gpui::ObjectFit::Contain)
                    .into_any_element(),
            ),
            _ => None,
        };
        let content = match picture {
            Some(picture) => div()
                .id("chat-image-viewer-picture")
                .cursor_pointer()
                // Clicking the picture itself steps the zoom; only the surround dismisses.
                .on_mouse_down(
                    gpui::MouseButton::Left,
                    cx.listener(|this, _, _, cx| {
                        cx.stop_propagation();
                        this.chat.update(cx, |chat, cx| chat.zoom_image_viewer(cx));
                    }),
                )
                .child(picture)
                .into_any_element(),
            None => div()
                .px(px(16.0))
                .py(px(12.0))
                .rounded(px(12.0))
                .border_1()
                .border_color(p.control_border)
                .text_color(p.muted)
                .child(if loading {
                    "Loading image…".to_string()
                } else {
                    format!("{label} could not be shown here.")
                })
                .into_any_element(),
        };
        let body = div()
            .id("chat-image-viewer-scroll")
            .flex_1()
            .min_h_0()
            .w_full()
            .overflow_scroll()
            .flex()
            .items_center()
            .justify_center()
            .child(content);
        let stop = |element: gpui::Div, cx: &Context<Self>| {
            element.on_mouse_down(
                gpui::MouseButton::Left,
                cx.listener(|_, _, _, cx| cx.stop_propagation()),
            )
        };
        // React's three actions in one joined group (`.ghostex-chat-image-preview-actions`), inset
        // from the right so the round close button sits beside them, both outside the scrolling
        // layer so zooming and panning never move them.
        let surface = if p.light {
            gpui::white().opacity(0.9)
        } else {
            gpui::black().opacity(0.5)
        };
        let toolbar = stop(
            div()
                .absolute()
                .top(px(12.0))
                .right(px(56.0))
                .flex()
                .items_center()
                .rounded(px(8.0))
                .border_1()
                .border_color(p.control_border)
                .bg(surface)
                .overflow_hidden(),
            cx,
        )
        .when(copyable, |bar| {
            bar.child(self.action_button(
                "chat-image-copy-path",
                "Copy path",
                "titlebar/link.svg",
                completed == Some("Path copied"),
                &p,
                cx,
                |this, cx| this.copy_path(cx),
            ))
        })
        .child(self.action_button(
            "chat-image-save",
            "Save image",
            "titlebar/download.svg",
            completed == Some("Saving image"),
            &p,
            cx,
            |this, cx| this.save_image(cx),
        ))
        .child(self.action_button(
            "chat-image-copy",
            "Copy image",
            "titlebar/copy.svg",
            completed == Some("Image copied"),
            &p,
            cx,
            |this, cx| this.copy_image(cx),
        ));
        let close = stop(
            div()
                .absolute()
                .top(px(12.0))
                .right(px(12.0))
                .flex()
                .items_center(),
            cx,
        )
        .child(
            div()
                .id("chat-image-close")
                .role(gpui::Role::Button)
                .aria_label("Close image preview")
                .tab_index(0)
                .size(px(32.0))
                .flex()
                .flex_shrink_0()
                .items_center()
                .justify_center()
                .rounded_full()
                .bg(surface)
                .when(p.light, |this| this.border_1().border_color(p.border))
                .cursor_pointer()
                .hover(|style| style.bg(p.input))
                .focus_visible(|style| style.border_1().border_color(p.ring))
                .child(
                    svg()
                        .path("titlebar/x.svg")
                        .size(px(18.0))
                        .text_color(if p.light { p.foreground } else { p.primary }),
                )
                .on_click(cx.listener(|this, _, _, cx| {
                    this.chat.update(cx, |chat, cx| chat.close_image_viewer(cx));
                })),
        );
        div()
            .size_full()
            .relative()
            .track_focus(&self.focus)
            .font_family(p.font.clone())
            .flex()
            .flex_col()
            .items_center()
            .justify_center()
            .bg(gpui::Hsla::from(gpui::rgb(0x000000)).opacity(0.7))
            .on_mouse_down(
                gpui::MouseButton::Left,
                cx.listener(|this, _, _, cx| {
                    this.chat.update(cx, |chat, cx| chat.close_image_viewer(cx));
                }),
            )
            // Captured, not bubbled: a focused action button must never swallow Escape.
            .capture_key_down(cx.listener(|this, event: &gpui::KeyDownEvent, window, cx| {
                let handled = match event.keystroke.key.as_str() {
                    "escape" => {
                        this.chat.update(cx, |chat, cx| chat.close_image_viewer(cx));
                        true
                    }
                    "left" | "up" => {
                        this.chat
                            .update(cx, |chat, cx| chat.step_image_viewer(-1, cx));
                        true
                    }
                    "right" | "down" => {
                        this.chat
                            .update(cx, |chat, cx| chat.step_image_viewer(1, cx));
                        true
                    }
                    "enter" | "space" => {
                        this.chat.update(cx, |chat, cx| chat.zoom_image_viewer(cx));
                        true
                    }
                    _ => false,
                };
                if handled {
                    cx.stop_propagation();
                    window.prevent_default();
                }
            }))
            .child(body)
            .child(toolbar)
            .child(close)
            .into_any_element()
    }
}
