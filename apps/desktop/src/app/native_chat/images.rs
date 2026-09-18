//! Pictures shared in the conversation.
//!
//! CDXC:SessionChat 2026-09-18 SEE-ALSO:
//! React renders the same blocks through session-chat-image-viewer.tsx and the message-list rows;
//! both surfaces classify a block with `sessionChatImageSource` in
//! packages/shared/session-chat-presentation/images.ts. A machine path is bytes only
//! `readSessionChatImage` can serve, because the picture lives on the session's machine, so it is
//! read once here and shared by the thumbnail and the full-size viewer. A picture that cannot be
//! read renders the named chip it would otherwise have been, never a broken image well.

use super::{appearance::ChatAppearance, state::NativeChatView, transcript::text};
use base64::Engine as _;
use gpui::prelude::FluentBuilder as _;
use gpui::{
    AnyElement, Context, ImageFormat, InteractiveElement as _, IntoElement, ParentElement as _,
    StatefulInteractiveElement as _, Styled as _, StyledImage as _, div, img, px, svg,
};
use serde_json::{Value, json};
use std::{cell::RefCell, collections::HashMap, sync::Arc};

/// React's `.ghostex-chat-inline-image`: a 3rem square with a hairline and an 8px radius.
pub(super) const THUMBNAIL_SIZE: f32 = 48.0;

enum ChatImageEntry {
    Loading,
    Ready(Arc<gpui::Image>),
    Failed,
}

/// Bytes for the transcript's pictures, read once per location and shared by every thumbnail and the viewer.
///
/// A picture written into prose is asked for from the Markdown renderer, which runs with the view
/// borrowed shared, so the map is behind a cell rather than reachable only from `&mut self`.
#[derive(Default)]
pub(crate) struct ChatImageCache {
    entries: RefCell<HashMap<String, ChatImageEntry>>,
}

/// What a renderer can do with one picture right now.
pub(super) enum ChatImageSource {
    /// An http(s) address GPUI fetches itself.
    Uri(String),
    Bytes(Arc<gpui::Image>),
    Loading,
    /// No transport, unreadable bytes, or a format GPUI cannot decode: the named chip stands in.
    Unavailable,
}

fn image_format(media_type: &str) -> Option<ImageFormat> {
    match media_type.trim().to_ascii_lowercase().as_str() {
        "image/png" => Some(ImageFormat::Png),
        "image/jpeg" | "image/jpg" => Some(ImageFormat::Jpeg),
        "image/webp" => Some(ImageFormat::Webp),
        "image/gif" => Some(ImageFormat::Gif),
        "image/svg+xml" => Some(ImageFormat::Svg),
        "image/bmp" => Some(ImageFormat::Bmp),
        "image/tiff" => Some(ImageFormat::Tiff),
        "image/x-icon" | "image/vnd.microsoft.icon" => Some(ImageFormat::Ico),
        _ => None,
    }
}

fn decode_data_url(url: &str) -> Option<gpui::Image> {
    let (meta, payload) = url.strip_prefix("data:")?.split_once(',')?;
    if !meta.contains(";base64") {
        return None;
    }
    let format = image_format(meta.split(';').next().unwrap_or_default())?;
    let bytes = base64::engine::general_purpose::STANDARD
        .decode(payload.trim())
        .ok()?;
    Some(gpui::Image::from_bytes(format, bytes))
}

/// The 3rem square React draws for a picture (`.ghostex-chat-inline-image`), or nothing when its
/// bytes are not there and the caller has to fall back to the picture's name.
fn thumbnail(source: &ChatImageSource, p: &ChatAppearance) -> Option<AnyElement> {
    let s = p.scale;
    let size = px(THUMBNAIL_SIZE * s);
    let radius = px(8.0 * s);
    // `ObjectFit::Cover` paints the scaled picture through the bounds it was given instead of
    // cropping to them, so the tile itself has to be the clipping well React's `overflow-hidden`
    // rounded box is; without it a wide picture bleeds over its neighbours and the pane's edge.
    let framed = |picture: gpui::Img| {
        div()
            .size(size)
            .flex_shrink_0()
            .overflow_hidden()
            .rounded(radius)
            .border(px(s))
            .border_color(p.border)
            .child(
                picture
                    .size_full()
                    .rounded(radius)
                    .object_fit(gpui::ObjectFit::Cover),
            )
            .into_any_element()
    };
    match source {
        ChatImageSource::Uri(url) => Some(framed(img(url.clone()))),
        ChatImageSource::Bytes(bytes) => Some(framed(img(bytes.clone()))),
        ChatImageSource::Loading => Some(
            div()
                .size(size)
                .flex_shrink_0()
                .flex()
                .items_center()
                .justify_center()
                .rounded(radius)
                .border(px(s))
                .border_color(p.border.opacity(0.6))
                .child(
                    svg()
                        .path("chat-actions/photo")
                        .size(px(16.0 * s))
                        .text_color(p.muted.opacity(0.5)),
                )
                .into_any_element(),
        ),
        ChatImageSource::Unavailable => None,
    }
}

fn decode_read_result(result: &Value) -> Option<gpui::Image> {
    let format = image_format(result["mediaType"].as_str()?)?;
    let bytes = base64::engine::general_purpose::STANDARD
        .decode(result["base64Data"].as_str()?)
        .ok()?;
    Some(gpui::Image::from_bytes(format, bytes))
}

impl NativeChatView {
    /// Resolves one projected image source, starting the read the first time it is asked for.
    pub(super) fn chat_image(&self, image: &Value, cx: &Context<Self>) -> ChatImageSource {
        let transport = image["transport"].as_str().unwrap_or("none");
        if transport == "url" {
            let url = text(image, "url");
            return if url.is_empty() {
                ChatImageSource::Unavailable
            } else {
                ChatImageSource::Uri(url)
            };
        }
        let key = match transport {
            "data" => text(image, "url"),
            "read" => text(image, "path"),
            _ => String::new(),
        };
        if key.is_empty() {
            return ChatImageSource::Unavailable;
        }
        match self.images.entries.borrow().get(&key) {
            Some(ChatImageEntry::Ready(image)) => return ChatImageSource::Bytes(image.clone()),
            Some(ChatImageEntry::Failed) => return ChatImageSource::Unavailable,
            Some(ChatImageEntry::Loading) => return ChatImageSource::Loading,
            None => {}
        }
        self.images
            .entries
            .borrow_mut()
            .insert(key.clone(), ChatImageEntry::Loading);
        if transport == "data" {
            let decode_key = key.clone();
            let task = cx
                .background_executor()
                .spawn(async move { decode_data_url(&decode_key) });
            cx.spawn(async move |this, cx| {
                let loaded = task.await;
                let _ = this.update(cx, |this, cx| this.store_chat_image(key, loaded, cx));
            })
            .detach();
        } else {
            // The path is on the session's machine, so the read goes through the shared transport.
            // Asked for on the next turn of the loop, because this runs while the row is rendering.
            cx.spawn(async move |this, cx| {
                let _ = this.update(cx, |this, cx| {
                    this.invoke(json!({"type": "loadImage", "path": key}), cx)
                });
            })
            .detach();
        }
        ChatImageSource::Loading
    }

    /// The transport answered a `loadImage` ask (native-host.ts pushes the `chatImage` request).
    pub(super) fn receive_chat_image(&mut self, request: &Value, cx: &mut Context<Self>) {
        let path = text(&request["params"], "path");
        if path.is_empty() {
            return;
        }
        if request["method"] != "loaded" {
            self.store_chat_image(path, None, cx);
            return;
        }
        let params = request["params"].clone();
        let task = cx
            .background_executor()
            .spawn(async move { decode_read_result(&params) });
        cx.spawn(async move |this, cx| {
            let loaded = task.await;
            let _ = this.update(cx, |this, cx| this.store_chat_image(path, loaded, cx));
        })
        .detach();
    }

    fn store_chat_image(
        &mut self,
        key: String,
        loaded: Option<gpui::Image>,
        cx: &mut Context<Self>,
    ) {
        self.images.entries.borrow_mut().insert(
            key,
            match loaded {
                Some(image) => ChatImageEntry::Ready(Arc::new(image)),
                None => ChatImageEntry::Failed,
            },
        );
        self.list.remeasure();
        cx.notify();
    }

    /// The user turn's own pictures, right-aligned above the bubble (React: `UserImageThumbnails`).
    pub(super) fn user_image_thumbnails(
        &mut self,
        message: &Value,
        p: &ChatAppearance,
        cx: &mut Context<Self>,
    ) -> Option<AnyElement> {
        self.image_row(message, true, p, cx)
    }

    /// Pictures an agent shared, left-aligned above its prose (React: `ImageAttachments`).
    pub(super) fn assistant_image_attachments(
        &mut self,
        message: &Value,
        p: &ChatAppearance,
        cx: &mut Context<Self>,
    ) -> Option<AnyElement> {
        self.image_row(message, false, p, cx)
    }

    fn image_row(
        &mut self,
        message: &Value,
        user: bool,
        p: &ChatAppearance,
        cx: &mut Context<Self>,
    ) -> Option<AnyElement> {
        let images = message["images"].as_array()?.clone();
        if images.is_empty() {
            return None;
        }
        let id = text(message, "id");
        // React: `gap-2` between an agent's pictures (`ImageAttachments`), `gap-1.5` between the
        // user's own (`UserImageThumbnails`), both with `py-1`.
        let mut row = div()
            .flex()
            .flex_wrap()
            .min_w_0()
            .gap(px(if user { 6.0 } else { 8.0 } * p.scale))
            .py(px(4.0 * p.scale))
            .when(user, |row| row.justify_end());
        for index in 0..images.len() {
            row = row.child(self.image_tile(&id, &images, index, user, p, cx));
        }
        Some(row.into_any_element())
    }

    fn image_tile(
        &mut self,
        message_id: &str,
        images: &[Value],
        index: usize,
        user: bool,
        p: &ChatAppearance,
        cx: &mut Context<Self>,
    ) -> AnyElement {
        let s = p.scale;
        let image = &images[index];
        let label = text(image, "label");
        let alt = text(image, "alt");
        let source = self.chat_image(image, cx);
        let open = images.to_vec();
        let tile = div()
            .id(gpui::SharedString::from(format!(
                "chat-image:{message_id}:{index}"
            )))
            .role(gpui::Role::Button)
            .aria_label(if alt.is_empty() {
                format!("View {label}")
            } else {
                format!("View {alt}")
            })
            .flex_shrink_0()
            .cursor_pointer()
            .on_click(
                cx.listener(move |chat, _, _, cx| chat.open_image_viewer(open.clone(), index, cx)),
            );
        match thumbnail(&source, p) {
            Some(picture) => tile.child(picture).into_any_element(),
            // A host with no image transport, or a file that has since gone: the honest stand-in.
            None if user => div()
                .flex_shrink_0()
                .text_size(px(12.0 * s))
                .text_color(p.muted)
                .child(if label.is_empty() {
                    format!("Image #{}", index + 1)
                } else {
                    label
                })
                .into_any_element(),
            // React's `Attachment size='xs'`: a 12px-radius card with a 4px inset, a 28px rounded
            // media well for the icon, and a medium-weight title in the card's own colour.
            None => div()
                .flex()
                .flex_shrink_0()
                .items_center()
                .gap(px(6.0 * s))
                .max_w(px(220.0 * s))
                .p(px(4.0 * s))
                .rounded(px(12.0 * s))
                .border(px(s))
                .border_color(p.border)
                .bg(p.card_background)
                .text_size(px(12.0 * s))
                .text_color(p.foreground)
                .child(
                    div()
                        .flex_shrink_0()
                        .size(px(28.0 * s))
                        .flex()
                        .items_center()
                        .justify_center()
                        .rounded(px(8.0 * s))
                        .bg(p.input)
                        .child(
                            svg()
                                .path("chat-actions/photo")
                                .size(px(14.0 * s))
                                .flex_shrink_0()
                                .text_color(p.foreground),
                        ),
                )
                .child(
                    div()
                        .min_w_0()
                        .px(px(6.0 * s))
                        .py(px(4.0 * s))
                        .truncate()
                        .font_weight(gpui::FontWeight::MEDIUM)
                        .child(label),
                )
                .into_any_element(),
        }
    }

    /// A picture written into prose, at the position its author wrote it.
    ///
    /// React draws the same 3rem thumbnail for a Markdown image and for a link that names a picture
    /// (`SessionChatInlineImage`); the shared projection marks both, so a `data:` URL and a machine
    /// path load through this transport instead of the blank band a `TextView` leaves behind. When
    /// the bytes cannot be read the picture's own words stand in, exactly as React's fallback does.
    pub(super) fn inline_image(
        &self,
        id: &str,
        image: &Value,
        p: &ChatAppearance,
        cx: &Context<Self>,
    ) -> AnyElement {
        let label = text(image, "label");
        let alt = text(image, "alt");
        let source = self.chat_image(image, cx);
        let open = vec![image.clone()];
        match thumbnail(&source, p) {
            Some(picture) => div()
                .id(gpui::SharedString::from(format!("chat-inline-image:{id}")))
                .role(gpui::Role::Button)
                .aria_label(if alt.is_empty() {
                    format!("View {label}")
                } else {
                    format!("View {alt}")
                })
                .flex_shrink_0()
                .cursor_pointer()
                .on_click(
                    cx.listener(move |chat, _, _, cx| chat.open_image_viewer(open.clone(), 0, cx)),
                )
                .child(picture)
                .into_any_element(),
            None => div()
                .flex_shrink_0()
                .child(if label.is_empty() {
                    "Image".to_owned()
                } else {
                    label
                })
                .into_any_element(),
        }
    }
}
